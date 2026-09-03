document.addEventListener('DOMContentLoaded', async () => {
  const sb = getSupabase();
  if (!sb) {
    const el = document.getElementById('user-name');
    if (el) el.textContent = 'Guest';
    return;
  }

  // Check and require admin role
  const authData = await requireAdmin();
  if (!authData || !authData.profile) return;
  const profile = authData.profile;

  const userNameEl = document.getElementById('user-name');
  if (userNameEl) userNameEl.textContent = profile.full_name || 'Admin';

  const avatarMark = document.getElementById('avatar-mark');
  if (avatarMark && profile.full_name) {
    avatarMark.textContent = profile.full_name.charAt(0).toUpperCase();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }


  // ==========================================
  // 1. ENROLLMENT STATUS TOGGLE LOGIC
  // ==========================================
  const btnOpen = document.getElementById('btn-status-open');
  const btnClosed = document.getElementById('btn-status-closed');
  const previewBadge = document.getElementById('enrollment-preview-badge');
  const syncMsg = document.getElementById('enrollment-sync-msg');

  function updateStatusUI(status) {
    const isOpen = status === 'open';
    if (btnOpen && btnClosed) {
      btnOpen.className = isOpen ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
      btnClosed.className = !isOpen ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
    }
    if (previewBadge) {
      if (isOpen) {
        previewBadge.className = 'hero-badge';
        previewBadge.innerHTML = '<span class="live"></span> Accepting New Students';
      } else {
        previewBadge.className = 'hero-badge closed';
        previewBadge.innerHTML = '<span class="live"></span> Not Accepting Students Currently';
      }
    }
  }

  async function loadEnrollmentStatus() {
    if (!window.EnrollmentSettings) return;
    try {
      const status = await window.EnrollmentSettings.get();
      updateStatusUI(status || 'open');
    } catch (e) {
      console.warn('Failed to load status:', e);
      updateStatusUI('open');
    }
  }

  async function handleStatusChange(newStatus) {
    if (!window.EnrollmentSettings) return;
    if (btnOpen) btnOpen.disabled = true;
    if (btnClosed) btnClosed.disabled = true;
    if (syncMsg) {
      syncMsg.style.display = 'block';
      syncMsg.style.color = 'var(--c-ink-3)';
      syncMsg.textContent = 'Saving status to Supabase...';
    }

    try {
      await window.EnrollmentSettings.set(newStatus);
      updateStatusUI(newStatus);
      if (syncMsg) {
        syncMsg.style.color = '#059669';
        syncMsg.textContent = `✓ Status updated to "${newStatus === 'open' ? 'Accepting New Students' : 'Not Accepting Students Currently'}"`;
        setTimeout(() => { syncMsg.style.display = 'none'; }, 4000);
      }
    } catch (err) {
      console.error('Failed to update status:', err);
      if (syncMsg) {
        syncMsg.style.color = '#DC2626';
        syncMsg.textContent = `✕ Failed to save: ${(err && err.message) || 'Permission denied or network issue'}`;
      }
    } finally {
      if (btnOpen) btnOpen.disabled = false;
      if (btnClosed) btnClosed.disabled = false;
    }
  }

  if (btnOpen) btnOpen.addEventListener('click', () => handleStatusChange('open'));
  if (btnClosed) btnClosed.addEventListener('click', () => handleStatusChange('closed'));
  loadEnrollmentStatus();

  // ==========================================
  // 2. DROPDOWN TOGGLES
  // ==========================================
  function setupDropdown(btnId, wrapId) {
    const btn = document.getElementById(btnId);
    const wrap = document.getElementById(wrapId);
    if (!btn || !wrap) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = wrap.classList.contains('open');
      document.querySelectorAll('.drop-wrap').forEach(w => w.classList.remove('open'));
      if (!isOpen) wrap.classList.add('open');
    });
  }
  setupDropdown('notif-btn', 'notif-wrap');
  setupDropdown('profile-btn', 'profile-wrap');

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.drop-wrap')) {
      document.querySelectorAll('.drop-wrap').forEach(w => w.classList.remove('open'));
    }
  });

  // ==========================================
  // 3. FETCH AND DISPLAY DASHBOARD DATA
  // ==========================================
  const PACKAGE_PRICES = {
    'Starter': 149,
    'Starter Plan': 149,
    'Progress': 579,
    'Progress Plan': 579,
    'Intensive': 1299,
    'Intensive Plan': 1299,
  };
  const priceFor = (name) => PACKAGE_PRICES[name] || 0;

  let allStudents = [];
  let allSubs = [];

  // Render the student roster table (used on load and after refresh).
  function renderRoster(list) {
    const studentList = document.getElementById('student-list');
    if (!studentList) return;
    if (!list || !list.length) {
      studentList.innerHTML = '<tr><td colspan="8" class="muted">No matching students found.</td></tr>';
      return;
    }
    studentList.innerHTML = list.map(s => {
      const s2 = allSubs.find(x => x.student_id === s.id && x.status === 'active');
      const plan = s2 ? `<span class="badge badge-soft" style="font-weight:700;">${s2.package_name}</span>` : '<span class="muted">—</span>';
      const status = s2 ? '<span class="badge badge-ok">Active</span>' : '<span class="badge badge-warn">No plan</span>';
      return `<tr>
        <td><strong>${s.full_name || 'Student'}</strong></td>
        <td><small class="muted">${s.email || '—'}</small></td>
        <td>${s.english_level || 'Intermediate'}</td>
        <td>${s.learning_goal ? s.learning_goal.slice(0, 32) + (s.learning_goal.length > 32 ? '…' : '') : '—'}</td>
        <td>${plan}</td>
        <td>${status}</td>
        <td>
          <select class="role-select" data-uid="${s.id}" data-prev="${s.role}" onchange="changeRole('${s.id}', this)">
            <option value="student" ${s.role === 'student' ? 'selected' : ''}>Student</option>
            <option value="tutor" ${s.role === 'tutor' ? 'selected' : ''}>Tutor</option>
            <option value="admin" ${s.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </td>
        <td><button type="button" class="btn btn-ghost btn-sm" style="color:#DC2626;font-size:.78rem;" data-delstudent="${s.id}" title="Remove student">Delete</button></td>
      </tr>`;
    }).join('');
    studentList.querySelectorAll('[data-delstudent]').forEach(btn => btn.addEventListener('click', async () => {
      const uid = btn.dataset.delstudent;
      const stu = list.find(x => x.id === uid);
      if (!window.confirm('Delete student ' + (stu && stu.full_name || '') + '? This removes their profile but not their auth account.')) return;
      btn.disabled = true;
      try {
        const { error } = await sb.from('profiles').delete().eq('id', uid);
        if (error) throw error;
        allStudents = allStudents.filter(x => x.id !== uid);
        renderRoster(allStudents);
      } catch (e) { alert('Failed: ' + ((e && e.message) || 'permission error')); }
      finally { btn.disabled = false; }
    }));
  }

  try {
    const [studentsRes, subsRes, notesRes, hwRes] = await Promise.all([
      sb.from('profiles').select('*').order('created_at', { ascending: false }),
      sb.from('subscriptions').select('*').order('created_at', { ascending: false }),
      sb.from('lesson_notes').select('*').order('created_at', { ascending: false }).limit(10),
      sb.from('homework').select('*').eq('completed', false).limit(100),
    ]);

    allStudents = (studentsRes.data || []).filter(p => p.role !== 'admin');
    const studentOnly = allStudents.filter(p => p.role === 'student');
    allSubs = subsRes.data || [];
    const notes = notesRes.data || [];
    const pendingHw = hwRes.data || [];

    const activeSubs = allSubs.filter(s => s.status === 'active');
    const revenue = activeSubs.reduce((sum, s) => sum + priceFor(s.package_name), 0);

    const kpiStudents = document.getElementById('kpi-students');
    const kpiPlans = document.getElementById('kpi-plans');
    const kpiRev = document.getElementById('kpi-revenue');
    const kpiHw = document.getElementById('kpi-hw');

    if (kpiStudents) kpiStudents.textContent = studentOnly.length;
    if (kpiPlans) kpiPlans.textContent = activeSubs.length;
    if (kpiRev) kpiRev.textContent = `$${revenue.toLocaleString()}`;
    if (kpiHw) kpiHw.textContent = pendingHw.length;

    const studentById = {};
    (studentsRes.data || []).forEach(s => studentById[s.id] = s);
    const nameOf = (id) => (studentById[id] && (studentById[id].full_name || studentById[id].email)) || '—';

    // Render Student Roster
    renderRoster(allStudents);

    // Live search filter
    const searchInput = document.getElementById('admin-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        if (!q) {
          renderRoster(allStudents);
          return;
        }
        const filtered = allStudents.filter(s =>
          (s.full_name && s.full_name.toLowerCase().includes(q)) ||
          (s.email && s.email.toLowerCase().includes(q)) ||
          (s.english_level && s.english_level.toLowerCase().includes(q)) ||
          (s.learning_goal && s.learning_goal.toLowerCase().includes(q))
        );
        renderRoster(filtered);
      });
    }

    // Render Subscriptions
    const subList = document.getElementById('sub-list');
    if (subList) {
      if (allSubs.length) {
        subList.innerHTML = allSubs.map(s => {
          const status = s.status === 'active' ? '<span class="badge badge-ok">Active</span>' : `<span class="badge badge-warn">${s.status || '—'}</span>`;
          return `<tr>
            <td><strong>${nameOf(s.student_id)}</strong></td>
            <td>${s.package_name || '—'}</td>
            <td>$${priceFor(s.package_name)}</td>
            <td>${s.lessons_used || 0} / ${s.lessons_total || 0}</td>
            <td>${status}</td>
          </tr>`;
        }).join('');
      } else {
        subList.innerHTML = '<tr><td colspan="5" class="muted">No subscriptions recorded yet.</td></tr>';
      }
    }

    // Render Recent Notes
    const recentNotes = document.getElementById('recent-notes');
    if (recentNotes) {
      if (notes.length) {
        recentNotes.innerHTML = notes.map(n => `
          <div class="act-item">
            <div class="a-ic">
              <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </div>
            <div class="a-body">
              <strong>${n.title || 'Lesson Note'} <span class="muted" style="font-weight:400;">· ${nameOf(n.student_id)}</span></strong>
              <p>${n.content || ''}</p>
            </div>
            <div class="a-time">${new Date(n.created_at).toLocaleDateString()}</div>
          </div>
        `).join('');
      } else {
        recentNotes.innerHTML = '<p class="muted">No lesson notes recorded yet.</p>';
      }
    }
  } catch (err) {
    console.error('Error fetching admin dashboard data:', err);
  }

  // ==========================================
  // 4. MODALS: Add Student / Add Note / Assign Homework
  // ==========================================
  const modals = {
    'modal-add-student': document.getElementById('modal-add-student'),
    'modal-add-note': document.getElementById('modal-add-note'),
    'modal-add-hw': document.getElementById('modal-add-hw'),
  };

  function openModal(id) {
    const m = modals[id];
    if (m) { m.hidden = false; populateStudentSelects(); }
  }
  function closeModal(id) {
    const m = modals[id];
    if (m) m.hidden = true;
  }

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close')));
  });
  Object.values(modals).forEach(m => {
    if (m) m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; });
  });

  function populateStudentSelects() {
    const options = allStudents
      .filter(s => s.role === 'student')
      .map(s => `<option value="${s.id}">${s.full_name || s.email}</option>`)
      .join('');
    const noteSel = document.getElementById('an-student');
    const hwSel = document.getElementById('ah-student');
    const placeholder = `<option value="">Select a student...</option>`;
    if (noteSel) noteSel.innerHTML = placeholder + (options || '<option value="">No students yet</option>');
    if (hwSel) hwSel.innerHTML = placeholder + (options || '<option value="">No students yet</option>');
  }

  function setMsg(id, text, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'block';
    el.style.color = ok ? '#059669' : '#DC2626';
    el.textContent = text;
  }

  const btnAddStudent = document.getElementById('btn-add-student');
  if (btnAddStudent) btnAddStudent.addEventListener('click', () => openModal('modal-add-student'));

  const openNoteBtn = document.getElementById('btn-open-note');
  if (openNoteBtn) openNoteBtn.addEventListener('click', () => openModal('modal-add-note'));

  const openHwBtn = document.getElementById('btn-open-hw');
  if (openHwBtn) openHwBtn.addEventListener('click', () => openModal('modal-add-hw'));

  // ---- Add Student (creates a real auth user + auto profile) ----
  const addStudentForm = document.getElementById('add-student-form');
  if (addStudentForm) {
    addStudentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('as-name').value.trim();
      const email = document.getElementById('as-email').value.trim();
      const pass = document.getElementById('as-pass').value;
      const level = document.getElementById('as-level').value;
      const goal = document.getElementById('as-goal').value.trim();
      const submit = document.getElementById('as-submit');
      if (submit) { submit.disabled = true; submit.textContent = 'Creating...'; }
      try {
        const { data, error } = await sb.auth.signUp({
          email, password: pass,
          options: { data: { full_name: name } }
        });
        if (error) throw error;
        // Ensure a matching profile exists (backup if trigger not present).
        await sb.from('profiles').upsert({
          id: data.user.id, email, full_name: name,
          role: 'student', english_level: level, learning_goal: goal || 'Improve spoken English confidence and fluency'
        }, { onConflict: 'id' });
        setMsg('as-msg', `✓ Created ${name} (${email}). They can log in with the password you set.`, true);
        addStudentForm.reset();
        await refreshAdminData();
      } catch (err) {
        const m = (err && err.message) || 'Failed to create student';
        setMsg('as-msg', `✕ ${m}`, false);
        if (/rate|too many|attempts/i.test(m)) {
          setMsg('as-msg', '✕ Supabase signup is rate-limited right now. Wait ~1 minute and try again.', false);
        }
      } finally {
        if (submit) { submit.disabled = false; submit.textContent = 'Create Student'; }
      }
    });
  }

  // ---- Add Lesson Note ----
  const addNoteForm = document.getElementById('add-note-form');
  if (addNoteForm) {
    addNoteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const studentId = document.getElementById('an-student').value;
      const title = document.getElementById('an-title').value.trim();
      const content = document.getElementById('an-content').value.trim();
      if (!studentId || !title || !content) return;
      const submit = document.getElementById('an-submit');
      if (submit) { submit.disabled = true; submit.textContent = 'Saving...'; }
      try {
        const { error } = await sb.from('lesson_notes').insert({
          tutor_id: profile.id, student_id: studentId, title, content,
          created_at: new Date().toISOString()
        });
        if (error) throw error;
        setMsg('an-msg', '✓ Lesson note saved.', true);
        addNoteForm.reset();
        closeModal('modal-add-note');
        await refreshAdminData();
      } catch (err) {
        setMsg('an-msg', `✕ ${(err && err.message) || 'Failed to save note'}`, false);
      } finally {
        if (submit) { submit.disabled = false; submit.textContent = 'Save Note'; }
      }
    });
  }

  // ---- Assign Homework ----
  const addHwForm = document.getElementById('add-hw-form');
  if (addHwForm) {
    addHwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const studentId = document.getElementById('ah-student').value;
      const title = document.getElementById('ah-title').value.trim();
      const desc = document.getElementById('ah-desc').value.trim();
      const due = document.getElementById('ah-due').value || null;
      if (!studentId || !title || !desc) return;
      const submit = document.getElementById('ah-submit');
      if (submit) { submit.disabled = true; submit.textContent = 'Assigning...'; }
      try {
        const { error } = await sb.from('homework').insert({
          tutor_id: profile.id, student_id: studentId, title,
          description: desc, due_date: due, completed: false,
          created_at: new Date().toISOString()
        });
        if (error) throw error;
        setMsg('ah-msg', '✓ Homework assigned.', true);
        addHwForm.reset();
        closeModal('modal-add-hw');
        await refreshAdminData();
      } catch (err) {
        setMsg('ah-msg', `✕ ${(err && err.message) || 'Failed to assign homework'}`, false);
      } finally {
        if (submit) { submit.disabled = false; submit.textContent = 'Assign'; }
      }
    });
  }

  async function refreshAdminData() {
    try {
      const [r1, r2, r3, r4] = await Promise.all([
        sb.from('profiles').select('*').order('created_at', { ascending: false }),
        sb.from('subscriptions').select('*').order('created_at', { ascending: false }),
        sb.from('lesson_notes').select('*').order('created_at', { ascending: false }).limit(10),
        sb.from('homework').select('*').eq('completed', false).limit(100),
      ]);
      allStudents = (r1.data || []).filter(p => p.role !== 'admin');
      const studentOnly = allStudents.filter(p => p.role === 'student');
      allSubs = r2.data || [];
      const notes = r3.data || [];
      const pendingHw = r4.data || [];
      const activeSubs = allSubs.filter(s => s.status === 'active');
      const revenue = activeSubs.reduce((sum, s) => sum + priceFor(s.package_name), 0);
      const kpiStudents = document.getElementById('kpi-students');
      const kpiPlans = document.getElementById('kpi-plans');
      const kpiRev = document.getElementById('kpi-revenue');
      const kpiHw = document.getElementById('kpi-hw');
      if (kpiStudents) kpiStudents.textContent = studentOnly.length;
      if (kpiPlans) kpiPlans.textContent = activeSubs.length;
      if (kpiRev) kpiRev.textContent = `$${revenue.toLocaleString()}`;
      if (kpiHw) kpiHw.textContent = pendingHw.length;
      renderRoster(allStudents);
      const subList = document.getElementById('sub-list');
      if (subList) {
        const studentById = {};
        (r1.data || []).forEach(s => studentById[s.id] = s);
        const nameOf = (id) => (studentById[id] && (studentById[id].full_name || studentById[id].email)) || '—';
        subList.innerHTML = allSubs.length ? allSubs.map(s => `
          <tr>
            <td><strong>${nameOf(s.student_id)}</strong></td>
            <td>${s.package_name || '—'}</td>
            <td>$${priceFor(s.package_name)}</td>
            <td>${s.lessons_used || 0} / ${s.lessons_total || 0}</td>
            <td>${s.status === 'active' ? '<span class="badge badge-ok">Active</span>' : `<span class="badge badge-warn">${s.status || '—'}</span>`}</td>
          </tr>`).join('') : '<tr><td colspan="5" class="muted">No subscriptions recorded yet.</td></tr>';
      }
      const recentNotes = document.getElementById('recent-notes');
      if (recentNotes) {
        const studentById = {};
        (r1.data || []).forEach(s => studentById[s.id] = s);
        const nameOf = (id) => (studentById[id] && (studentById[id].full_name || studentById[id].email)) || '—';
        recentNotes.innerHTML = notes.length ? notes.map(n => `
          <div class="act-item">
            <div class="a-body">
              <strong>${n.title || 'Lesson Note'} <span class="muted" style="font-weight:400;">· ${nameOf(n.student_id)}</span></strong>
              <p>${n.content || ''}</p>
            </div>
            <div class="a-time">${new Date(n.created_at).toLocaleDateString()}</div>
          </div>`).join('') : '<p class="muted">No lesson notes recorded yet.</p>';
      }
    } catch (e) {
      console.error('Error refreshing admin data:', e);
    }
  }

  // ==========================================
  // 5. BOOKINGS & LESSON USAGE (admin)
  // ==========================================
  async function loadAdminBookings() {
    const el = document.getElementById('admin-bookings');
    if (!el) return;
    try {
      const { data: rows } = await sb.from('bookings').select('*').order('start_at', { ascending: false }).limit(50);
      if (!rows || !rows.length) {
        el.innerHTML = '<div style="padding:14px 0;text-align:center;" class="muted">No on-site bookings recorded yet.</div>';
        return;
      }
      const byId = {};
      (await sb.from('profiles').select('id,full_name,email')).data.forEach(p => byId[p.id] = p);

      const nameOf = b => {
        const p = byId[b.student_id];
        if (p) return p.full_name || p.email;
        return b.guest_email || '—';
      };
      const slugLabel = s => ({
        '30min-trial': 'Free Trial',
        '30min': '30-Min Lesson',
        '60min': '60-Min Lesson',
      }[s] || s || 'Lesson');

      const rowsHtml = rows.map((b, i) => {
        const start = new Date(b.start_at);
        const end = b.end_at ? new Date(b.end_at) : null;
        const dateStr = start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) + (end ? ' – ' + end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) : '');
        const dur = b.duration_min ? b.duration_min + 'm' : (end ? Math.round((end - start) / 60000) + 'm' : '—');
        const booked = b.status === 'booked';
        const calShort = b.cal_uid ? b.cal_uid.slice(0, 8) + '…' : '—';
        const title = (b.title && !['30min-trial', '30min', '60min'].includes(b.title)) ? b.title : slugLabel(b.event_slug);
        return `<tr>
          <td><strong>${esc(nameOf(b))}</strong></td>
          <td>${esc(title)}</td>
          <td>${esc(dateStr)}<div style="font-size:.78rem;color:var(--c-ink-3);">${esc(timeStr)}</div></td>
          <td>${esc(dur)}</td>
          <td>
            <span class="badge ${booked ? 'badge-ok' : 'badge-warn'}">${esc(b.status)}</span>
            ${b.consumed_lesson ? '<span class="badge badge-acc" style="margin-left:4px;">lesson used</span>' : ''}
          </td>
          <td style="font-size:.78rem;color:var(--c-ink-3);">${esc(calShort)}</td>
          <td>
            <div style="display:flex;gap:6px;justify-content:flex-end;">
              <button type="button" class="btn btn-sm btn-ghost" style="color:#DC2626;font-size:.78rem;" data-delbooking="${b.id}" title="Remove booking record (does not cancel on Cal.com)">Delete</button>
            </div>
          </td>
        </tr>`;
      }).join('');

      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
          <span class="muted" style="font-size:.82rem;">Showing latest ${rows.length} bookings.</span>
        </div>
        <div style="overflow-x:auto;">
          <table class="table">
            <thead><tr>
              <th>Student</th><th>Lesson</th><th>Date &amp; Time</th><th>Dur</th><th>Status</th><th>Cal UID</th><th></th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`;

      el.querySelectorAll('[data-delbooking]').forEach(btn => btn.addEventListener('click', async () => {
        if (!window.confirm('Delete this booking record? This does not cancel it on Cal.com.')) return;
        const { error } = await sb.from('bookings').delete().eq('id', btn.dataset.delbooking);
        if (error) { alert('Failed: ' + error.message); return; }
        loadAdminBookings();
      }));
    } catch (e) { console.error('load bookings error:', e); }
  }

  async function renderUsageList() {
    const list = document.getElementById('usage-list');
    if (!list) return;
    try {
      const { data: subs } = await sb.from('subscriptions').select('*').order('created_at', { ascending: false });
      if (!subs || !subs.length) {
        list.innerHTML = '<tr><td colspan="6" class="muted">No subscriptions yet.</td></tr>';
        return;
      }
      const byId = {};
      (await sb.from('profiles').select('id,full_name,email')).data.forEach(p => byId[p.id] = p);
      list.innerHTML = subs.map(s => {
        const name = (byId[s.student_id] && (byId[s.student_id].full_name || byId[s.student_id].email)) || '—';
        const total = s.lessons_total || 0, used = s.lessons_used || 0, left = Math.max(total - used, 0);
        return `<tr>
          <td><strong>${name}</strong></td>
          <td>${s.package_name || '—'}</td>
          <td>${total}</td>
          <td>${used}</td>
          <td><span class="badge ${left > 0 ? 'badge-ok' : 'badge-warn'}">${left}</span></td>
          <td><button type="button" class="btn btn-sm btn-soft" data-edi="${s.id}">Edit</button></td>
          <td><button type="button" class="btn btn-sm btn-ghost" style="color:#DC2626;" data-delsub="${s.id}" title="Remove subscription">Delete</button></td>
        </tr>`;
      }).join('');
      list.querySelectorAll('[data-edi]').forEach(b => b.addEventListener('click', () => openUsageEditor(b.dataset.edi, subs)));
      list.querySelectorAll('[data-delsub]').forEach(b => b.addEventListener('click', async () => {
        if (!window.confirm('Delete this subscription record?')) return;
        const { error } = await sb.from('subscriptions').delete().eq('id', b.dataset.delsub);
        if (error) { alert('Failed: ' + error.message); return; }
        renderUsageList();
      }));
    } catch (e) { console.error('usage list error:', e); }
  }

  function openUsageEditor(id, subs) {
    const s = subs.find(x => x.id === id);
    if (!s) return;
    document.getElementById('eu-id').value = s.id;
    document.getElementById('eu-student').value = '';
    (async () => {
      const { data: p } = await sb.from('profiles').select('full_name,email').eq('id', s.student_id).maybeSingle();
      document.getElementById('eu-student').value = (p && (p.full_name || p.email)) || s.student_id;
    })();
    document.getElementById('eu-total').value = s.lessons_total || 0;
    document.getElementById('eu-used').value = s.lessons_used || 0;
    const m = document.getElementById('modal-edit-usage');
    if (m) m.hidden = false;
  }

  const editUsageForm = document.getElementById('edit-usage-form');
  if (editUsageForm) {
    editUsageForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('eu-id').value;
      const total = parseInt(document.getElementById('eu-total').value, 10) || 0;
      const used = parseInt(document.getElementById('eu-used').value, 10) || 0;
      const msg = document.getElementById('eu-msg');
      const btn = document.getElementById('eu-submit');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
      try {
        const { error } = await sb.from('subscriptions').update({ lessons_total: total, lessons_used: used }).eq('id', id);
        if (error) throw error;
        if (msg) { msg.style.display = 'block'; msg.style.color = '#059669'; msg.textContent = '✓ Lesson balance updated.'; }
        document.getElementById('modal-edit-usage').hidden = true;
        await renderUsageList();
      } catch (err) {
        if (msg) { msg.style.display = 'block'; msg.style.color = '#DC2626'; msg.textContent = '✕ ' + ((err && err.message) || 'Failed to update'); }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      }
    });
  }

  // ==========================================
  // 6. CHAT INBOX (admin / main controller)
  // ==========================================
  const CHAT_FN = (window.APP_CONFIG && window.APP_CONFIG.booking && window.APP_CONFIG.booking.chatUrl) || '';
  let inboxToken = '';
  let activeChatId = null;
  let inboxChannel = null;
  let inboxChannel2 = null;
  let inboxTab = 'all';
  let inboxAll = [];
  let inboxContacts = [];

  function inh(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function avaHue(name) {
    let h = 0;
    const s = String(name || '?');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  async function inboxApi(path, options) {
    try {
      const res = await fetch(CHAT_FN + path, {
        ...options,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + inboxToken, ...(options && options.headers) },
      });
      return await res.json();
    } catch (e) { return { status: 'error', message: e && e.message || 'Network error' }; }
  }

  async function setInboxBadge() {
    const badge = document.getElementById('inbox-badge');
    if (!badge || !inboxToken) return;
    const r = await inboxApi('?action=chats', { method: 'GET' });
    if (r.status !== 'success') return;
    const total = (r.chats || []).reduce((n, c) => n + (c.unread_admin || 0), 0);
    badge.textContent = total > 99 ? '99+' : total;
    badge.style.display = total > 0 ? 'inline-block' : 'none';
  }

async function loadInboxList() {
  const list = document.getElementById('inbox-list');
  if (!list || !inboxToken) return;
  const r = await inboxApi('?action=chats', { method: 'GET' });
  if (r.status !== 'success') {
    list.innerHTML = '<div class="inbox-no muted">Could not load conversations.</div>';
    return;
  }
  inboxAll = (r.chats || []).filter(c => c.id !== activeChatId || c.unread_admin === 0);
  let rows = applyInboxView();

  if (inboxTab === 'contacts') {
    await loadInboxContacts();
    return;
  }

  list.innerHTML = rows;
  wireInboxRows(list);
}

function applyInboxView() {
  const qTxt = document.getElementById('inbox-search') ? document.getElementById('inbox-search').value.trim().toLowerCase() : '';
  let chats = inboxAll.slice();
  if (inboxTab === 'unread') chats = chats.filter(c => (c.unread_admin || 0) > 0);
  if (qTxt) chats = chats.filter(c => {
    const n = (c.student_name || '').toLowerCase();
    const e = (c.student_email || '').toLowerCase();
    const m = ((c.last_message && c.last_message.body) || '').toLowerCase();
    return n.indexOf(qTxt) >= 0 || e.indexOf(qTxt) >= 0 || m.indexOf(qTxt) >= 0;
  });
  if (!inboxAll.length) return `<div class="inbox-no muted">No conversations yet. Students and visitors can start a chat from any page.</div>`;
  if (!chats.length) return `<div class="inbox-no muted">Nothing here.</div>`;
  return chats.map(c => {
    const guest = !!c.guest_email && !c.student_id;
    const preview = c.last_message ? (c.last_message.sender === 'admin' ? 'You: ' : c.student_name.split(' ')[0] + ': ') + (c.last_message.body || '') : (c.subject || '');
    const when = c.last_message ? new Date(c.last_message.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    const unread = c.unread_admin || 0;
    const hurt = c.student_name || 'Student';
    const h = String(hurt).toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 2) || 'S';
    return `
    <div class="inbox-row ${guest ? 'guest' : ''} ${activeChatId === c.id ? 'active' : ''}" data-chat="${c.id}">
      <div class="inbox-ava" style="background:hsl(${avaHue(hurt)} 62% 42%);">${inh(h.charAt(0).toUpperCase())}</div>
      <div class="inbox-main">
        <div class="inbox-top"><strong>${inh(hurt)}</strong>${when ? `<time>${inh(when)}</time>` : ''}</div>
        <div class="inbox-prev">${inh(preview)}</div>
        <div class="inbox-bottom">
          ${guest ? `<span class="inbox-tag">Guest</span>` : `<span class="badge-soft">${inh((c.student_email || '').split('@')[0].slice(0, 12))}</span>`}
          <div style="display:flex;align-items:center;gap:8px;">
            ${unread > 0 ? `<span class="inbox-unread">${unread}</span>` : ''}
            <button type="button" class="inbox-del" title="Delete conversation" data-del="${c.id}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function wireInboxRows(list) {
  list.querySelectorAll('[data-chat]').forEach(row => row.addEventListener('click', () => openInboxThread(row.dataset.chat)));
  list.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    confirmDeleteChat(btn.dataset.del);
  }));
}

function confirmDeleteChat(chatId) {
  const name = (() => { const c = inboxAll.find(x => x.id === chatId); return c ? c.student_name : ''; })();
  if (!window.confirm('Delete this conversation' + (name ? ' with ' + name : '') + '? This cannot be undone.')) return;
  inboxApi('', { method: 'POST', body: JSON.stringify({ action: 'delete', chatId }) }).then(r => {
    if (r.status !== 'success') { alert(r.message || 'Could not delete.'); return; }
    if (activeChatId === chatId) {
      activeChatId = null;
      const thread = document.getElementById('inbox-thread');
      if (thread) {
        thread.style.justifyContent = 'center';
        thread.innerHTML = `<div class="inbox-no muted">Select a conversation to read and reply.</div>`;
      }
    }
    loadInboxList(); setInboxBadge();
  });
}

async function loadInboxContacts() {
  const list = document.getElementById('inbox-list');
  if (!list || !sb) return;
  try {
    const { data, error } = await sb.from('contacts').select('*').order('created_at', { ascending: false }).limit(100);
    inboxContacts = error ? [] : (data || []);
  } catch (e) { inboxContacts = []; }

  const qTxt = document.getElementById('inbox-search') ? document.getElementById('inbox-search').value.trim().toLowerCase() : '';
  let rows = inboxContacts.slice();
  if (qTxt) rows = rows.filter(c => (c.name || '').toLowerCase().indexOf(qTxt) >= 0 || (c.email || '').toLowerCase().indexOf(qTxt) >= 0 || (c.message || '').toLowerCase().indexOf(qTxt) >= 0);

  if (!rows.length) {
    list.innerHTML = `<div class="inbox-no muted">${inboxContacts.length ? 'Nothing matches.' : 'No contact-form messages yet.'}</div>`;
    return;
  }
  list.innerHTML = rows.map(c => `
    <div class="inbox-row" data-contact="${c.id}">
      <div class="inbox-ava" style="background:${c.status === 'new' ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'hsla(0,0%,60%,1)'};">${inh((c.name || '?').charAt(0).toUpperCase())}</div>
      <div class="inbox-main">
        <div class="inbox-top"><strong>${inh(c.name || 'Unknown')}</strong><time>${new Date(c.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</time></div>
        <div class="inbox-prev">${inh((c.message || '').slice(0, 60))}</div>
        <div class="inbox-bottom">
          <span class="badge-soft" style="${c.status === 'new' ? 'background:#eef2ff;color:#4338ca;border-color:#e0e7ff;' : ''}">${c.status === 'new' ? 'New' : 'Seen'}</span>
          <button type="button" class="inbox-del" title="Delete message" data-delcon="${c.id}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-contact]').forEach(row => row.addEventListener('click', () => openInboxContact(row.dataset.contact)));
  list.querySelectorAll('[data-delcon]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    if (!window.confirm('Delete this contact message?')) return;
    sb.from('contacts').delete().eq('id', btn.dataset.delcon).then(() => loadInboxContacts());
  }));
}

function openInboxContact(id) {
  const thread = document.getElementById('inbox-thread');
  const c = inboxContacts.find(x => x.id === id);
  if (!thread || !c) return;
  thread.style.justifyContent = 'flex-start';
  thread.innerHTML = `
    <div class="inbox-thread-head">
      <div class="inbox-ava" style="background:hsla(0,0%,60%,1);">${inh((c.name || '?').charAt(0).toUpperCase())}</div>
      <div><strong>${inh(c.name || 'Unknown')}</strong><div class="muted">${inh(c.email || '')}</div></div>
      <div class="inbox-thread-meta">
        <span class="badge-soft">Contact form</span>
        <span class="badge-soft" style="${c.status === 'new' ? 'background:#eef2ff;color:#4338ca;border-color:#e0e7ff;' : ''}">${c.status === 'new' ? 'New' : 'Seen'}</span>
      </div>
    </div>
    <div id="admin-thread-body" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:16px;">
      <div class="bk-bubble guest">${inh(c.message || '')}<span class="bk-btime">${new Date(c.created_at).toLocaleString()}</span></div>
    </div>
    <div class="inbox-replybar">
      <a class="btn btn-primary btn-sm" style="margin:auto;text-decoration:none;" href="mailto:${encodeURIComponent(c.email || '')}?subject=${encodeURIComponent('Re: your message to TutorEnglishPro')}">Reply by email →</a>
    </div>`;
  if (c.status === 'new') sb.from('contacts').update({ status: 'seen' }).eq('id', c.id).then(() => loadInboxContacts());
}

async function openInboxThread(chatId) {
  activeChatId = chatId;
  const thread = document.getElementById('inbox-thread');
  if (!thread) return;
  thread.style.justifyContent = 'flex-start';
  thread.innerHTML = '<div class="inbox-no muted">Loading…</div>';
  loadInboxList();
  subscribeInboxThread(chatId);
  const { data: msgs, error } = await sb.from('chat_messages').select('*').eq('chat_id', chatId).order('created_at', { ascending: true });
  if (error) { thread.innerHTML = '<div class="inbox-no muted">Could not load messages.</div>'; return; }
  const chat = inboxAll.find(c => c.id === chatId) || {};
  const guest = !!chat.guest_email && !chat.student_id;
  const who = chat.student_name || 'Student';
  thread.innerHTML = `
    <div class="inbox-thread-head">
      <div class="inbox-ava" style="background:hsl(${avaHue(who)} 62% 42%);">${inh((who || 'S').charAt(0).toUpperCase())}</div>
      <div><strong>${inh(who)}</strong><div class="muted">${inh(chat.student_email || '')}</div></div>
      <div class="inbox-thread-meta">
        ${guest ? '<span class="inbox-tag">Guest</span>' : `<span class="badge-soft">${inh((chat.student_email || '').split('@')[0].slice(0, 12))}</span>`}
        <button type="button" class="inbox-del" title="Delete conversation" id="inbox-thread-del">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
    <div id="admin-thread-body" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:16px;"></div>
    <div class="inbox-replybar">
      <input class="field" id="inbox-reply" placeholder="Type your reply…" autocomplete="off" style="margin:0;">
      <button type="button" class="btn btn-primary btn-sm" id="inbox-send">Send</button>
    </div>`;
  const bodyEl = document.getElementById('admin-thread-body');
  (msgs || []).forEach(m => {
    const mine = m.sender === 'admin';
    const b = document.createElement('div');
    b.className = 'bk-bubble' + (mine ? ' mine' : (guest && m.sender === 'student' ? ' guest' : ''));
    b.textContent = m.body;
    const t = document.createElement('span');
    t.className = 'bk-btime';
    t.textContent = new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    b.appendChild(t);
    bodyEl.appendChild(b);
  });
  bodyEl.scrollTop = bodyEl.scrollHeight;
  const field = document.getElementById('inbox-reply');
  const send = document.getElementById('inbox-send');
  function doSend() {
    const text = (field.value || '').trim();
    if (!text) return;
    if (send) send.disabled = true;
    inboxApi('', { method: 'POST', body: JSON.stringify({ action: 'send', chatId, body: text }) }).then(r => {
      if (send) send.disabled = false;
      if (r.status !== 'success') { field.placeholder = r.message || 'Could not send'; return; }
      field.value = '';
      const b = document.createElement('div');
      b.className = 'bk-bubble mine';
      b.textContent = text;
      const t = document.createElement('span');
      t.className = 'bk-btime';
      t.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      b.appendChild(t);
      bodyEl.appendChild(b);
      bodyEl.scrollTop = bodyEl.scrollHeight;
      loadInboxList(); setInboxBadge();
    });
  }
  send.addEventListener('click', doSend);
  field.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
  const delBtn = document.getElementById('inbox-thread-del');
  if (delBtn) delBtn.addEventListener('click', () => confirmDeleteChat(chatId));
  await inboxApi('', { method: 'POST', body: JSON.stringify({ action: 'read', chatId }) });
  loadInboxList(); setInboxBadge();
}

  function subscribeInbox() {
    if (inboxChannel) { try { sb.removeChannel(inboxChannel); } catch {} }
    inboxChannel = sb.channel('inbox-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, () => { loadInboxList(); setInboxBadge(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => { loadInboxList(); setInboxBadge(); })
      .subscribe();
  }

  function subscribeInboxThread(chatId) {
    if (inboxChannel2) { try { sb.removeChannel(inboxChannel2); } catch {} }
    inboxChannel2 = sb.channel('inbox-thread-' + chatId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: 'chat_id=eq.' + chatId }, payload => {
        const bodyEl = document.getElementById('admin-thread-body');
        if (!bodyEl) return;
        const m = payload.new;
        if (m.sender === 'admin') return;
        const b = document.createElement('div');
        b.style.cssText = 'align-self:flex-start;max-width:82%;background:#fff;color:#111;padding:9px 12px;border-radius:12px;font-size:.86rem;white-space:pre-wrap;border:1px solid var(--c-card-border);';
        b.textContent = m.body;
        bodyEl.appendChild(b);
        bodyEl.scrollTop = bodyEl.scrollHeight;
        inboxApi('', { method: 'POST', body: JSON.stringify({ action: 'read', chatId }) });
        loadInboxList(); setInboxBadge();
      })
      .subscribe();
  }

async function initAdsControl(sbc) {
  const ads = window.__ahmAds;
  if (!ads) return;

  const esc = (v) => String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const zones = ['banner', 'in-content', 'in-article', 'sidebar', 'footer', 'mobile']; // types & locations
  const zoneInfo = {
    banner:     { loc: 'Top of every page',                       type: 'Display' },
    'in-content':{ loc: 'Between content blocks (home page)',     type: 'In-feed' },
    'in-article':{ loc: 'Inside lesson / article body text',      type: 'In-article' },
    sidebar:    { loc: 'Right sidebar of content pages',          type: 'Widget' },
    footer:     { loc: 'Before the footer on all pages',          type: 'Display' },
    mobile:     { loc: 'Fixed bar at the bottom on phones only',  type: 'Mobile' }
  };
  const previewToggle = document.getElementById('ads-preview-toggle');
  const previewBox = document.getElementById('ads-preview');
  const clientEl = document.getElementById('ads-client');
  const trackingEl = document.getElementById('ads-tracking');
  const msgEl = document.getElementById('ads-msg');
  const saveBtn = document.getElementById('ads-save-btn');
  const resetBtn = document.getElementById('ads-reset-btn');
  const refreshBtn = document.getElementById('ads-refresh');
  const totalEl = document.getElementById('ads-total');
  const todayEl = document.getElementById('ads-today');
  const topList = document.getElementById('ads-top-list');

  function current() {
    const cfg = ads.get();
    return {
      client: cfg.client || '',
      slots: cfg.slots || {},
      code: cfg.code || {},
      zones: cfg.zones || {},
      tracking: cfg.tracking !== false
    };
  }

  function fillForm() {
    const c = current();
    if (clientEl) clientEl.value = c.client;
    if (trackingEl) trackingEl.checked = c.tracking;
    zones.forEach((z) => {
      const t = document.querySelector('[data-zone-toggle="' + z + '"]');
      if (t) t.checked = c.zones[z] === true;
      const s = document.querySelector('[data-zone-slot="' + z + '"]');
      if (s) s.value = c.slots[z] || '';
      const codeEl = document.querySelector('[data-zone-code="' + z + '"]');
      if (codeEl) codeEl.value = c.code[z] || '';
    });
  }

  function collect() {
    const slots = {}, zones = {}, code = {};
    zones.forEach((z) => {
      const s = document.querySelector('[data-zone-slot="' + z + '"]');
      slots[z] = (s && s.value || '').trim();
      const t = document.querySelector('[data-zone-toggle="' + z + '"]');
      zones[z] = !!(t && t.checked);
      const codeEl = document.querySelector('[data-zone-code="' + z + '"]');
      code[z] = (codeEl && codeEl.value || '').trim();
    });
    return {
      client: (clientEl && clientEl.value || '').trim(),
      slots,
      code,
      zones,
      tracking: !!(trackingEl && trackingEl.checked)
    };
  }

  function flash(m, ok) {
    if (!msgEl) return;
    msgEl.textContent = (ok ? 'Saved ✓ ' : '') + m;
    msgEl.style.color = ok ? '#065F46' : '#B45309';
    msgEl.style.display = 'inline-block';
    setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 3000);
  }

  // Google-Ads-style live preview: shows where each ad will actually sit on the site
  function renderPreview() {
    if (!previewBox) return;
    const active = {};
    zones.forEach((z) => {
      const t = document.querySelector('[data-zone-toggle="' + z + '"]');
      const codeEl = document.querySelector('[data-zone-code="' + z + '"]');
      const slotEl = document.querySelector('[data-zone-slot="' + z + '"]');
      const enabled = !!(t && t.checked);
      const hasCode = !!(codeEl && codeEl.value.trim());
      const hasSlot = !!(slotEl && slotEl.value.trim() && clientEl && clientEl.value.trim());
      const info = zoneInfo[z] || { type: z, loc: z };
      active[z] = hasCode ? 'g' : ((enabled && hasSlot) ? 'y' : (enabled ? 'y' : ''));
    });
    const ad = (z) => {
      const info = zoneInfo[z] || { type: z, loc: z };
      if (!active[z]) return '';
      return '<div class="ads-prev-ad ' + (active[z] === 'g' ? 'g' : '') + '" title="' + esc(info.type) + ' · ' + esc(info.loc) + '"><span class="adx">AD</span> ' + (active[z] === 'g' ? 'Custom code' : info.type) + '</div>';
    };
    const legend = '<div class="ads-prev-label" style="margin-bottom:8px;">Live placement preview — <span style="color:#065F46;font-weight:800;">green</span> = your custom code · <span style="color:#b45309;font-weight:800;">amber</span> = enabled managed AdSense unit</div>';
    previewBox.innerHTML = legend +
      '<div class="ads-prev-browser">' +
        '<div class="ads-prev-bar"><i></i><i></i><i></i><span class="ads-prev-url">tutorenglishpro.com</span></div>' +
        '<div class="ads-prev-site">' +
          '<div class="ads-prev-nav"><span></span><span></span><span></span><span></span></div>' +
          (ad('banner') || '') +
          '<div class="ads-prev-row">' +
            '<div class="ads-prev-main">' +
              '<div class="ads-prev-h w60"></div><div class="ads-prev-h w80"></div><div class="ads-prev-h w80"></div>' +
              (ad('in-content') || '') +
              '<div class="ads-prev-h w80"></div><div class="ads-prev-h w60"></div><div class="ads-prev-h w80"></div>' +
              (ad('in-article') || '') +
            '</div>' +
            '<div class="ads-prev-side">' +
              '<div class="ads-prev-h w80"></div><div class="ads-prev-h w80"></div>' +
              (ad('sidebar') || '') +
            '</div>' +
          '</div>' +
          (ad('footer') || '') +
          '<div class="ads-prev-h"></div>' +
        '</div>' +
      '</div>' +
      (active.mobile ? '<div class="ads-prev-ad' + (active.mobile === 'g' ? ' g' : '') + '" style="border-radius:0;margin-top:10px;"><span class="adx">AD</span> Mobile Sticky (phones only)</div>' : '');
  }

  if (previewToggle && previewBox) {
    previewToggle.addEventListener('click', () => {
      const show = previewBox.style.display !== 'block';
      previewBox.style.display = show ? 'block' : 'none';
      previewToggle.innerHTML = show ? 'Hide live preview of ad locations' : '&#128065; Show live preview of ad locations';
      if (show) renderPreview();
    });
    document.querySelectorAll('#ads-zones input, #ads-zones textarea').forEach((n) => {
      n.addEventListener('input', renderPreview);
      n.addEventListener('change', renderPreview);
    });
  }

  if (saveBtn) saveBtn.addEventListener('click', () => {
    ads.save(collect());
    flash('Ad settings saved for this browser.', true);
  });

  if (resetBtn) resetBtn.addEventListener('click', () => {
    try { localStorage.removeItem('ahm_ads'); } catch (e) {}
    fillForm();
    flash('Reset to defaults.');
  });

  async function loadStats() {
    if (!totalEl || !topList) return;
    try {
      const since = new Date(Date.now() - 14 * 86400000).toISOString();
      let res = await sbc.from('visitor_views').select('id').gte('created_at', since);
      const rows = (res && res.data) || [];
      const total = rows.length;
      if (totalEl) totalEl.textContent = total.toLocaleString();
      if (todayEl) {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const tRes = await sbc.from('visitor_views').select('id').gte('created_at', todayStart);
        todayEl.textContent = ((tRes && tRes.data) || []).length.toLocaleString();
      }
      const PAGE_NAMES = {
        '/': 'Home', '//index.html': 'Home', '/index.html': 'Home',
        '/about.html': 'About', '/lessons.html': 'Lessons', '/packages.html': 'Packages & Pricing',
        '/booking.html': 'Book a Lesson', '/login.html': 'Login', '/signup.html': 'Sign Up',
        '/dashboard.html': 'Teacher Workspace', '/student.html': 'Student Portal',
        '/admin.html': 'Admin Console', '/privacy.html': 'Privacy Policy', '/terms.html': 'Terms'
      };
      const pageName = (r) => {
        if (r && r.title && r.title.trim()) return r.title.trim();
        const raw = (r && r.path) || '/';
        const p = raw.split('?')[0];
        if (PAGE_NAMES[p]) return PAGE_NAMES[p];
        const base = p.split('/').pop() || 'Home';
        return base === '' || base === 'index.html' ? 'Home'
          : base.replace(/\.html$/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      };
      const byPage = {};
      rows.forEach((r) => {
        const name = pageName(r);
        byPage[name] = (byPage[name] || 0) + 1;
      });
      const sorted = Object.entries(byPage).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (!sorted.length) {
        topList.innerHTML = '<tr><td colspan="2" class="muted">No views recorded yet. Open any page to start tracking.</td></tr>';
        return;
      }
      topList.innerHTML = sorted.map(([name, n]) => `
        <tr>
          <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${esc(name) || 'Home'}</td>
          <td style="text-align:right;font-weight:700;">${n}</td>
        </tr>`).join('');
    } catch (e) {
      console.error('ads stats error:', e);
      if (topList) topList.innerHTML = '<tr><td colspan="2" class="muted">Could not load stats.</td></tr>';
    }
  }

  fillForm();
  loadStats();
  if (refreshBtn) refreshBtn.addEventListener('click', loadStats);
}

async function initChatInbox() {
  if (!CHAT_FN) return;


  const { data: { session } } = await sb.auth.getSession();
  if (session && session.access_token) inboxToken = session.access_token;
  if (!inboxToken) return;

  const tabs = document.querySelectorAll('.bk-tab');
  tabs.forEach(t => t.addEventListener('click', () => {
    inboxTab = t.dataset.tab;
    tabs.forEach(x => {
      const on = x === t;
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-selected', on);
    });
    const thread = document.getElementById('inbox-thread');
    if (thread) { thread.style.justifyContent = 'center'; thread.innerHTML = '<div class="inbox-no muted">Select an item to open it.</div>'; }
    activeChatId = null;
    if (inboxTab === 'contacts') loadInboxContacts();
    else loadInboxList();
  }));

  const search = document.getElementById('inbox-search');
  if (search) search.addEventListener('input', () => {
    if (inboxTab === 'contacts') loadInboxContacts();
    else { const list = document.getElementById('inbox-list'); if (list) list.innerHTML = applyInboxView(); wireInboxRows(list); }
  });

  const refresh = document.getElementById('inbox-refresh-btn');
  if (refresh) refresh.addEventListener('click', () => { loadInboxList(); loadInboxContacts(); });

  const archive = document.getElementById('inbox-archive-btn');
  if (archive) archive.addEventListener('click', async () => {
    const r = await inboxApi('', { method: 'POST', body: JSON.stringify({ action: 'purge' }) });
    if (r.status === 'success') {
      alert('Cleaned up ' + (r.deleted || 0) + ' conversation(s) idle for over 90 days.');
      loadInboxList(); loadInboxContacts(); setInboxBadge();
    } else {
      alert(r.message || 'Could not clean up conversations.');
    }
  });

  subscribeInbox();
  await loadInboxList();
  await setInboxBadge();
  setInterval(() => { loadInboxList(); loadInboxContacts(); setInboxBadge(); }, 60000);
}

  initChatInbox();
  initAdsControl(sb);

  // View-swap between the main dashboard and the dedicated Ads & Tracking view
  function showView(name) {
    const dash = document.getElementById('admin-dash-view');
    const ads = document.getElementById('admin-ads-view');
    const active = name === 'ads' ? ads : dash;
    const other = name === 'ads' ? dash : ads;
    if (active) active.style.display = 'block';
    if (other) other.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Smooth-scroll side-nav links to their sections (works on phone/tablet too)
  document.querySelectorAll('.side-link[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href').slice(1);
      document.querySelectorAll('.side-link').forEach((l) => l.classList.remove('active'));
      link.classList.add('active');

      // "Ads & Tracking" opens its own dedicated view instead of scrolling
      if (id === 'ads-panel') {
        e.preventDefault();
        showView('ads');
        history.replaceState(null, '', '#ads-panel');
        return;
      }

      showView('dash');
      const target = document.getElementById(id);
      if (!target) { history.replaceState(null, '', '#' + id); return; }
      e.preventDefault();
      // wait a tick for the dashboard view to reappear before scrolling
      requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      history.replaceState(null, '', '#' + id);
    });
  });

  const adsBackBtn = document.getElementById('ads-back-btn');
  if (adsBackBtn) {
    adsBackBtn.addEventListener('click', () => {
      showView('dash');
      document.querySelectorAll('.side-link').forEach((l) => l.classList.remove('active'));
      const ov = document.querySelector('.side-link[href="#overview"]');
      if (ov) ov.classList.add('active');
      history.replaceState(null, '', '#overview');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  loadAdminBookings();
  renderUsageList();
});

// ── Change a user's account type (student / tutor / admin) ──
// Only reachable from the admin panel. Relies on the RLS policy
// "Admin can manage all profiles" added to the database.
window.changeRole = async function (userId, selectEl) {
  const prev = selectEl.dataset.prev;
  const role = selectEl.value;
  if (prev === role) return;

  if (role === 'admin') {
    if (!confirm('Promote this user to ADMIN? They will gain full admin access.')) {
      selectEl.value = prev; return;
    }
  } else if (prev === 'admin') {
    if (!confirm('Demote this admin account? They will lose admin access.')) {
      selectEl.value = prev; return;
    }
  }

  selectEl.disabled = true;
  try {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase unavailable');
    const { error } = await sb.from('profiles').update({ role }).eq('id', userId);
    if (error) throw error;
    selectEl.dataset.prev = role;
  } catch (e) {
    console.error('Role change failed:', e);
    alert('Failed to change role: ' + ((e && e.message) || 'permission or network error'));
    selectEl.value = prev;
  } finally {
    selectEl.disabled = false;
  }
};


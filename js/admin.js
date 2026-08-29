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
      studentList.innerHTML = '<tr><td colspan="7" class="muted">No matching students found.</td></tr>';
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
      </tr>`;
    }).join('');
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

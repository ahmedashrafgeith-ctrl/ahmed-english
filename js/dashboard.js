document.addEventListener('DOMContentLoaded', async () => {
  const sb = getSupabase();
  const user = sb ? await (async () => {
    try {
      const { data: { session } } = await sb.auth.getSession();
      return session ? session.user : null;
    } catch {
      return null;
    }
  })() : null;

  if (!user) {
    const el = document.getElementById('user-name');
    if (el) el.textContent = 'Tutor';
    return;
  }

  const { data: profile } = sb
    ? await sb.from('profiles').select('*').eq('id', user.id).maybeSingle()
    : { data: null };

  if (profile) {
    const el = document.getElementById('user-name');
    if (el) el.textContent = profile.full_name || 'Tutor';
  }

  if (!sb) return;

  async function refreshDashboard() {
    try {
      const { count: studentCount } = await sb.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student');
      const sCountEl = document.getElementById('students-count');
      if (sCountEl) sCountEl.textContent = studentCount || 0;

      const { count: subCount } = await sb.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active');
      const subCountEl = document.getElementById('subscriptions-count');
      if (subCountEl) subCountEl.textContent = subCount || 0;

      const { count: notesCount } = await sb.from('lesson_notes').select('*', { count: 'exact', head: true }).eq('tutor_id', user.id);
      const notesCountEl = document.getElementById('notes-count');
      if (notesCountEl) notesCountEl.textContent = notesCount || 0;

      const { count: hwCount } = await sb.from('homework').select('*', { count: 'exact', head: true }).eq('tutor_id', user.id).eq('completed', false);
      const hwCountEl = document.getElementById('homework-count');
      if (hwCountEl) hwCountEl.textContent = hwCount || 0;

      const { data: students } = await sb.from('profiles').select('*').eq('role', 'student').limit(50);
      const studentList = document.getElementById('student-list');
      if (studentList) {
        if (students && students.length) {
          studentList.innerHTML = students.map(s => `
            <tr>
              <td><strong>${s.full_name || 'Student'}</strong><br><small style="color:var(--c-ink-3);">${s.email || ''}</small></td>
              <td>${s.english_level || 'Intermediate'}</td>
              <td>${s.learning_goal || 'Spoken Fluency'}</td>
              <td><span class="badge badge-ok">Active</span></td>
            </tr>
          `).join('');
        } else {
          studentList.innerHTML = '<tr><td colspan="4" class="muted">No students enrolled yet.</td></tr>';
        }
      }

      // Populate student selects for modals
      const noteSelect = document.getElementById('note-student-select');
      const hwSelect = document.getElementById('hw-student-select');
      if (students && students.length) {
        const options = students.map(s => `<option value="${s.id}">${s.full_name || s.email}</option>`).join('');
        if (noteSelect) noteSelect.innerHTML = options;
        if (hwSelect) hwSelect.innerHTML = options;
      } else {
        if (noteSelect) noteSelect.innerHTML = '<option value="">No students found</option>';
        if (hwSelect) hwSelect.innerHTML = '<option value="">No students found</option>';
      }

      const { data: notes } = await sb.from('lesson_notes').select('*').eq('tutor_id', user.id).order('created_at', { ascending: false }).limit(10);
      const recentNotes = document.getElementById('recent-notes');
      if (recentNotes) {
        if (notes && notes.length) {
          const studentMap = {};
          (students || []).forEach(s => studentMap[s.id] = s.full_name || s.email);
          recentNotes.innerHTML = notes.map(n => `
            <div style="padding:14px 0;border-bottom:1px solid var(--c-card-border);">
              <strong>${n.title || 'Lesson Note'}</strong>
              <span style="color:var(--c-ink-3);font-size:0.85rem;margin-left:10px;">for ${studentMap[n.student_id] || 'Student'}</span>
              <p style="margin-top:4px;font-size:0.92rem;">${n.content || ''}</p>
              <small style="color:var(--c-ink-3);">${new Date(n.created_at).toLocaleDateString()}</small>
            </div>
          `).join('');
        } else {
          recentNotes.innerHTML = '<p class="muted">No lesson notes recorded yet.</p>';
        }
      }
    } catch (e) {
      console.error('Error refreshing tutor dashboard:', e);
    }
  }

  await refreshDashboard();

  // Wire Modal Triggers
  const addNoteBtn = document.getElementById('add-note-btn');
  const addHwBtn = document.getElementById('add-hw-btn');
  const noteModal = document.getElementById('note-modal');
  const hwModal = document.getElementById('hw-modal');

  if (addNoteBtn && noteModal) {
    addNoteBtn.addEventListener('click', () => noteModal.showModal());
  }
  if (addHwBtn && hwModal) {
    addHwBtn.addEventListener('click', () => hwModal.showModal());
  }

  // Handle Note Submission
  const noteForm = document.getElementById('note-form');
  if (noteForm) {
    noteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const studentId = document.getElementById('note-student-select').value;
      const title = document.getElementById('note-title-input').value.trim();
      const content = document.getElementById('note-content-input').value.trim();
      if (!studentId || !title) return;

      try {
        const { error } = await sb.from('lesson_notes').insert({
          tutor_id: user.id,
          student_id: studentId,
          title,
          content,
          created_at: new Date().toISOString()
        });
        if (!error) {
          noteModal.close();
          noteForm.reset();
          await refreshDashboard();
        } else {
          alert(`Error saving note: ${error.message}`);
        }
      } catch (err) {
        console.error('Save note error:', err);
      }
    });
  }

  // Handle Homework Submission
  const hwForm = document.getElementById('hw-form');
  if (hwForm) {
    hwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const studentId = document.getElementById('hw-student-select').value;
      const title = document.getElementById('hw-title-input').value.trim();
      const desc = document.getElementById('hw-desc-input').value.trim();
      const dueDate = document.getElementById('hw-due-input').value || null;
      if (!studentId || !title) return;

      try {
        const { error } = await sb.from('homework').insert({
          tutor_id: user.id,
          student_id: studentId,
          title,
          description: desc,
          due_date: dueDate,
          completed: false,
          created_at: new Date().toISOString()
        });
        if (!error) {
          hwModal.close();
          hwForm.reset();
          await refreshDashboard();
        } else {
          alert(`Error assigning homework: ${error.message}`);
        }
      } catch (err) {
        console.error('Assign homework error:', err);
      }
    });
  }

  const cfg = window.APP_CONFIG;
  if (cfg) {
    if (document.getElementById('cal-link-side')) document.getElementById('cal-link-side').href = cfg.cal.dashboardUrl;
    if (document.getElementById('stripe-link-side')) document.getElementById('stripe-link-side').href = cfg.stripe.dashboardUrl;
    if (document.getElementById('drive-link')) document.getElementById('drive-link').href = cfg.drive;
    if (document.getElementById('cal-link')) document.getElementById('cal-link').href = cfg.cal.dashboardUrl;
    if (document.getElementById('stripe-link')) document.getElementById('stripe-link').href = cfg.stripe.dashboardUrl;
  }
});

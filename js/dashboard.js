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

  // ==========================================
  // MONTHLY PROGRESS REPORT
  // ==========================================
  const reportBtn = document.getElementById('add-report-btn');
  const reportModal = document.getElementById('report-modal');
  const reportForm = document.getElementById('report-form');

  if (reportBtn && reportModal) {
    reportBtn.addEventListener('click', () => {
      // Default period to last 30 days
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const ds = (d) => d.toISOString().slice(0, 10);
      const se = document.getElementById('report-start');
      const ee = document.getElementById('report-end');
      if (se) se.value = ds(start);
      if (ee) ee.value = ds(end);
      reportModal.showModal();
    });
  }

  // Populate the report student selector
  async function populateReportStudents() {
    const sel = document.getElementById('report-student-select');
    if (!sel) return;
    try {
      const { data: students } = await sb.from('profiles').select('*').eq('role', 'student').limit(200);
      if (students && students.length) {
        sel.innerHTML = students.map(s => `<option value="${s.id}">${s.full_name || s.email}${s.email ? ' (' + s.email + ')' : ''}</option>`).join('');
      } else {
        sel.innerHTML = '<option value="">No students found</option>';
      }
    } catch (e) { console.error('report student load error:', e); }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function generateReport() {
    const sel = document.getElementById('report-student-select');
    const msg = document.getElementById('report-msg');
    const btn = document.getElementById('report-download-btn');
    const studentId = sel ? sel.value : '';
    if (!studentId) { if (msg) { msg.style.display = 'block'; msg.style.color = '#DC2626'; msg.textContent = 'Select a student first.'; } return; }

    const start = (document.getElementById('report-start') || {}).value || '';
    const end = (document.getElementById('report-end') || {}).value || '';
    if (btn) { btn.disabled = true; btn.textContent = 'Building report...'; }

    try {
      const [pRes, subRes, notesRes, hwRes] = await Promise.all([
        sb.from('profiles').select('*').eq('id', studentId).maybeSingle(),
        sb.from('subscriptions').select('*').eq('student_id', studentId).eq('status', 'active').maybeSingle(),
        sb.from('lesson_notes').select('*').eq('student_id', studentId).order('created_at', { ascending: false }),
        sb.from('homework').select('*').eq('student_id', studentId).order('created_at', { ascending: false }),
      ]);

      const student = pRes.data || {};
      const sub = subRes.data || {};
      const notes = notesRes.data || [];
      const hw = hwRes.data || [];

      const used = sub.lessons_used || 0;
      const total = sub.lessons_total || 0;
      const pkg = sub.package_name || 'Starter';
      const pct = total ? Math.min(Math.round((used / total) * 100), 100) : 0;
      const hwDone = hw.filter(h => h.completed).length;
      const hwPending = hw.filter(h => !h.completed).length;

      const periodLabel = (start && end)
        ? new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          + ' — ' + new Date(end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      const noteRows = notes.length
        ? notes.map(n => `<tr><td>${esc(new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</td><td>${esc(n.title || 'Lesson Session')}</td><td>${esc(n.content || '')}</td></tr>`).join('')
        : '<tr><td colspan="3">No lesson notes recorded this period.</td></tr>';

      const hwRows = hw.length
        ? hw.map(h => `<tr><td>${esc(h.title || 'Task')}</td><td>${esc(h.description || '')}</td><td>${h.completed ? '✅ Done' : '⏳ Pending'}</td></tr>`).join('')
        : '<tr><td colspan="3">No homework assigned.</td></tr>';

      const reportHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monthly Progress Report — ${esc(student.full_name || 'Student')}</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;margin:0;background:#f3f4f6;color:#111827;}
  .sheet{max-width:820px;margin:24px auto;background:#fff;padding:40px 46px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.12);}
  h1{margin:0 0 4px;font-size:24px;color:#4F46E5;}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:#9CA3AF;margin:30px 0 10px;border-bottom:1px solid #e5e7eb;padding-bottom:6px;}
  .sub{color:#6B7280;font-size:13px;}
  .toprow{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;}
  .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 24px;margin:18px 0 6px;}
  .m label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9CA3AF;font-weight:700;}
  .m{border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;background:#fafafa;}
  .m .val{font-size:14px;font-weight:600;}
  .fill{border:1px solid #d1d5db;border-radius:8px;padding:10px 12px;width:100%;box-sizing:border-box;font-size:14px;font-family:inherit;color:#111827;background:#fff;}
  textarea.fill{min-height:70px;resize:vertical;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  td,th{border:1px solid #e5e7eb;padding:8px 10px;text-align:left;vertical-align:top;}
  th{background:#f3f4f6;font-size:12px;text-transform:uppercase;letter-spacing:.04em;}
  .score{font-size:26px;font-weight:800;color:#111827;text-align:center;}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:20px;}
  @media(max-width:640px){.row2{grid-template-columns:1fr;} .meta{grid-template-columns:1fr;}}
  .foot{margin-top:30px;font-size:11px;color:#9CA3AF;text-align:center;}
  @media print{.zoombar{display:none!important;}}
</style>
</head>
<body>
<div class="sheet">
  <div class="toprow">
    <div>
      <h1>Monthly Progress Report</h1>
      <div class="sub">${esc(periodLabel)}</div>
    </div>
    <div class="sub" style="text-align:right;">Prepared by<br><b>Ahmed — English Tutor</b><br><small>ahmedashrafgeith@gmail.com</small></div>
  </div>

  <div class="meta">
    <div class="m"><label>Student</label><div class="val">${esc(student.full_name || '—')}</div></div>
    <div class="m"><label>Email</label><div class="val">${esc(student.email || '—')}</div></div>
    <div class="m"><label>English Level</label><div class="val">${esc(student.english_level || 'Intermediate')}</div></div>
    <div class="m"><label>Package</label><div class="val">${esc(pkg)}</div></div>
    <div class="m"><label>Lessons Completed</label><div class="val">${used} / ${total}</div></div>
    <div class="m"><label>Learning Goal</label><div class="val">${esc(student.learning_goal || '—')}</div></div>
  </div>

  <h2>Overall Progress</h2>
  <div class="score">${pct}%</div>

  <h2>Summary &amp; Highlights</h2>
  <textarea class="fill" placeholder="Write a summary of the student's progress this month..."></textarea>

  <h2>Strengths</h2>
  <textarea class="fill" placeholder="What the student is doing well..."></textarea>

  <h2>Areas for Improvement</h2>
  <textarea class="fill" placeholder="Pronunciation, grammar, confidence, vocabulary...""></textarea>

  <h2>Homework Performance</h2>
  <table>
    <thead><tr><th>Task</th><th>Details</th><th>Status</th></tr></thead>
    <tbody>${hwRows}</tbody>
  </table>
  <p class="sub" style="margin-top:8px;">Completed: ${hwDone} · Pending: ${hwPending}</p>

  <h2>Lesson Notes This Period</h2>
  <table>
    <thead><tr><th>Date</th><th>Topic</th><th>Summary</th></tr></thead>
    <tbody>${noteRows}</tbody>
  </table>

  <div class="row2">
    <div>
      <h2>Next Steps &amp; Goals</h2>
      <textarea class="fill" placeholder="Actions for next month..."></textarea>
    </div>
    <div>
      <h2>Recommendations</h2>
      <textarea class="fill" placeholder="Suggested practice, courses, resources..."></textarea>
    </div>
  </div>

  <p class="foot">Ahmed English · 1-on-1 Personalized Online English Lessons</p>
</div>
</body>
</html>`;

      const blob = new Blob([reportHTML], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const name = (student.full_name || 'student').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      a.href = url;
      a.download = `monthly-progress-report-${name}-${new Date().toISOString().slice(0, 10)}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      if (msg) { msg.style.display = 'block'; msg.style.color = '#059669'; msg.textContent = 'Report downloaded. Open it, edit the sections, then Save/Print to PDF.'; }
      reportModal.close();
    } catch (err) {
      console.error('Report generation error:', err);
      if (msg) { msg.style.display = 'block'; msg.style.color = '#DC2626'; msg.textContent = 'Could not generate report: ' + ((err && err.message) || 'error'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Download Report'; }
    }
  }

  if (reportForm) reportForm.addEventListener('submit', (e) => { e.preventDefault(); generateReport(); });
  populateReportStudents();
});

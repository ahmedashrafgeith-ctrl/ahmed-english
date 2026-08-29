document.addEventListener('DOMContentLoaded', async () => {
  const sb = getSupabase();
  const user = sb ? await (async () => {
    try {
      const { data: { session } } = await sb.auth.getSession();
      return session ? session.user : null;
    } catch { return null; }
  })() : null;

  // ── Unauthenticated state ──
  if (!user) {
    const nameEl = document.getElementById('student-name');
    if (nameEl) nameEl.textContent = 'Student';
    const tagEl = document.getElementById('student-tagline');
    if (tagEl) tagEl.textContent = 'Sign in to unlock your personalized learning space.';
    renderTimeline(null, null);
    renderChecklist([], null);
    const goalEl = document.getElementById('student-goal');
    if (goalEl) goalEl.textContent = 'Signing in lets us personalise your sessions and track your progress.';
    return;
  }

  // ── Profile ──
  let profile = null;
  try {
    const res = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    profile = res.data;
  } catch (e) { console.warn('Profile fetch error:', e); }

  if (profile) {
    const nameEl = document.getElementById('student-name');
    if (nameEl) nameEl.textContent = profile.full_name || 'Student';
    const levelEl = document.getElementById('student-level');
    if (levelEl && profile.english_level) levelEl.textContent = profile.english_level;
    const goalEl = document.getElementById('student-goal');
    if (goalEl && profile.learning_goal) goalEl.textContent = profile.learning_goal;
    const tagEl = document.getElementById('student-tagline');
    if (tagEl) {
      const goal = profile.learning_goal || 'spoken confidence and fluency';
      tagEl.textContent = `Welcome back! Every session brings you closer to your goal: ${goal}.`;
    }
  }

  if (!sb) return;
  try {
    // ── 1. Subscription & Progress Ring ──
    const { data: sub } = await sb.from('subscriptions')
      .select('*').eq('student_id', user.id).eq('status', 'active').limit(1).maybeSingle();

    const used  = (sub && sub.lessons_used)  || 0;
    const total = (sub && sub.lessons_total) || 10;
    const pkgName = (sub && sub.package_name) || 'Starter Package';

    const lessonCountEl = document.getElementById('lesson-count');
    if (lessonCountEl) lessonCountEl.textContent = `${used} / ${total} Lessons`;

    const pkgStatusEl = document.getElementById('package-status');
    if (pkgStatusEl) {
      pkgStatusEl.innerHTML = sub
        ? '<span class="badge badge-ok" style="background:rgba(255,255,255,.9);color:#059669;border:none;">Active</span>'
        : '<span class="badge badge-warn">No active plan</span>';
    }

    // Animate progress ring (circumference 2π×42 ≈ 264)
    const circumference = 264;
    const pct = Math.min(Math.round((used / Math.max(total, 1)) * 100), 100);
    const circle = document.getElementById('progress-circle');
    const pctEl  = document.getElementById('progress-pct');
    const ringTitle = document.getElementById('ring-plan-title');
    const ringSub   = document.getElementById('ring-plan-sub');
    // Animate after paint
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (circle) circle.style.strokeDashoffset = circumference - (circumference * pct / 100);
        if (pctEl)  pctEl.textContent = `${pct}%`;
      }, 200);
    });
    if (ringTitle) ringTitle.textContent = pkgName;
    if (ringSub)   ringSub.textContent   = `${used} of ${total} lessons completed`;

    // ── 2. Lesson Notes Timeline ──
    const { data: notes } = await sb.from('lesson_notes')
      .select('*').eq('student_id', user.id).order('created_at', { ascending: false }).limit(10);
    renderTimeline(notes, user);

    // ── 3. Homework Checklist ──
    const { data: hwAll } = await sb.from('homework')
      .select('*').eq('student_id', user.id).order('created_at', { ascending: false }).limit(50);
    const hw = hwAll || [];
    renderChecklist(hw, user);

    // ── 4. Stats ──
    const done = hw.filter(h => h.completed);
    const lessonsTaken = (notes && notes.length) || used;
    const statLessons = document.getElementById('stat-lessons');
    if (statLessons) statLessons.textContent = lessonsTaken;
    const statHw = document.getElementById('stat-hw');
    if (statHw) statHw.textContent = done.length;
    const statStreak = document.getElementById('stat-streak');
    if (statStreak) statStreak.textContent = Math.max(done.length + 1, 1);
    const statHours = document.getElementById('stat-hours');
    if (statHours) statHours.textContent = lessonsTaken;

  } catch (err) {
    console.error('Error loading student dashboard data:', err);
  }
});

// ── Timeline renderer ──
function renderTimeline(notes, user) {
  const el = document.getElementById('notes-timeline');
  if (!el) return;
  if (!user) {
    el.innerHTML = '<p class="muted">Sign in to view your lesson notes.</p>';
    return;
  }
  if (!notes || !notes.length) {
    el.innerHTML = '<p class="muted">No lesson notes yet. Your tutor will publish notes after each session.</p>';
    return;
  }
  el.innerHTML = notes.map((n, i) => `
    <div class="tl-item fade-in-up delay-${Math.min(i+1,4)}">
      <div class="tl-dot-col">
        <div class="tl-dot${i === 0 ? '' : ' done'}"></div>
        ${i < notes.length - 1 ? '<div class="tl-line"></div>' : ''}
      </div>
      <div class="tl-content">
        <div class="tl-title">${n.title || 'Lesson Session'}</div>
        <div class="tl-meta">${new Date(n.created_at).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'})}</div>
        ${n.content ? `<div class="tl-body">${n.content}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// ── Checklist renderer ──
function renderChecklist(hw, user) {
  const container = document.getElementById('homework-checklist');
  if (!container) return;

  if (!user) {
    container.innerHTML = '<p class="muted">Sign in to view your homework.</p>';
    return;
  }

  // Add homework form (only rendered once)
  const formId = 'hw-add-form';
  if (!document.getElementById(formId)) {
    const formDiv = document.createElement('div');
    formDiv.innerHTML = `
      <div class="hw-form" id="${formId}">
        <input class="hw-input" id="hw-new-text" type="text" placeholder="Add a homework task or link..." autocomplete="off">
        <button class="hw-add-btn" id="hw-add-btn" type="button">+ Add</button>
      </div>
    `;
    container.parentElement.insertBefore(formDiv, container);
    document.getElementById('hw-add-btn').addEventListener('click', addHomeworkItem);
    document.getElementById('hw-new-text').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addHomeworkItem(); }
    });
  }

  if (!hw.length) {
    container.innerHTML = '<p class="muted">No homework assignments yet. Add one above or wait for your tutor to assign tasks.</p>';
    return;
  }

  const pending = hw.filter(h => !h.completed);
  const done    = hw.filter(h =>  h.completed);

  container.innerHTML = [...pending, ...done].slice(0, 20).map(h => {
    const isDone  = h.completed;
    const dueStr  = h.due_date ? new Date(h.due_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
    const isLink  = h.description && (h.description.startsWith('http://') || h.description.startsWith('https://'));
    const descHtml = h.description
      ? (isLink
          ? `<a href="${h.description}" target="_blank" rel="noopener" class="hw-meta" style="color:#4F46E5;word-break:break-all;">${h.description}</a>`
          : `<div class="hw-meta">${h.description}</div>`)
      : '';
    return `
      <div class="hw-item${isDone ? ' done' : ''}" id="hw-item-${h.id}">
        <input class="hw-cb" type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleHomework('${h.id}', this.checked)" title="Mark completed">
        <div class="hw-text-wrap">
          <div class="hw-text">${h.title || 'Homework Task'}</div>
          ${dueStr ? `<div class="hw-meta">Due: ${dueStr}</div>` : ''}
          ${descHtml}
        </div>
        <button class="hw-del" onclick="deleteHomework('${h.id}')" title="Delete task">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    `;
  }).join('');
}

// ── Toggle homework completion ──
async function toggleHomework(id, isCompleted) {
  const sb = getSupabase();
  if (!sb) return;
  const item = document.getElementById(`hw-item-${id}`);
  if (item) {
    if (isCompleted) item.classList.add('done');
    else item.classList.remove('done');
  }
  try {
    const { error } = await sb.from('homework').update({ completed: isCompleted }).eq('id', id);
    if (error) {
      console.error('HW toggle error:', error);
      if (item) { if (isCompleted) item.classList.remove('done'); else item.classList.add('done'); }
    }
  } catch (e) { console.error('HW toggle failed:', e); }
}
window.toggleHomework = toggleHomework;

// ── Delete homework task ──
async function deleteHomework(id) {
  if (!confirm('Delete this homework task?')) return;
  const sb = getSupabase();
  if (!sb) return;
  const item = document.getElementById(`hw-item-${id}`);
  if (item) { item.style.opacity = '0.4'; item.style.pointerEvents = 'none'; }
  try {
    const { error } = await sb.from('homework').delete().eq('id', id);
    if (error) { if (item) { item.style.opacity = '1'; item.style.pointerEvents = ''; } return; }
    if (item) item.remove();
  } catch (e) { console.error('HW delete failed:', e); if (item) { item.style.opacity='1'; item.style.pointerEvents=''; } }
}
window.deleteHomework = deleteHomework;

// ── Add new homework item ──
async function addHomeworkItem() {
  const input = document.getElementById('hw-new-text');
  const btn   = document.getElementById('hw-add-btn');
  if (!input) return;
  const text = input.value.trim();
  if (!text) { input.focus(); return; }

  const sb = getSupabase();
  if (!sb) { alert('Not connected to Supabase.'); return; }

  // Get current user
  let userId = null;
  try {
    const { data: { session } } = await sb.auth.getSession();
    userId = session && session.user ? session.user.id : null;
  } catch {}
  if (!userId) { alert('Sign in to add homework tasks.'); return; }

  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  input.disabled = true;

  const isLink = text.startsWith('http://') || text.startsWith('https://');
  const record = {
    student_id:  userId,
    title:       isLink ? 'Resource Link' : text,
    description: isLink ? text : null,
    completed:   false,
    created_at:  new Date().toISOString(),
  };

  try {
    const { data, error } = await sb.from('homework').insert(record).select().maybeSingle();
    if (error) { console.error('HW insert error:', error); alert('Could not save task.'); return; }
    input.value = '';
    // Prepend new item to checklist
    const container = document.getElementById('homework-checklist');
    if (container) {
      const noMsg = container.querySelector('p.muted');
      if (noMsg) noMsg.remove();
      const newEl = document.createElement('div');
      newEl.className = 'hw-item fade-in-up';
      newEl.id = `hw-item-${data.id}`;
      newEl.innerHTML = `
        <input class="hw-cb" type="checkbox" onchange="toggleHomework('${data.id}', this.checked)" title="Mark completed">
        <div class="hw-text-wrap">
          <div class="hw-text">${record.title}</div>
          ${record.description ? `<a href="${record.description}" target="_blank" rel="noopener" class="hw-meta" style="color:#4F46E5;word-break:break-all;">${record.description}</a>` : ''}
        </div>
        <button class="hw-del" onclick="deleteHomework('${data.id}')" title="Delete task">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      `;
      container.insertBefore(newEl, container.firstChild);
    }
  } catch (e) { console.error('HW add failed:', e); alert('Error saving task.'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '+ Add'; } input.disabled = false; input.focus(); }
}
window.addHomeworkItem = addHomeworkItem;

document.addEventListener('DOMContentLoaded', () => {

  const burger = document.querySelector('.nav-burger');
  const menu = document.querySelector('.nav-menu');
  if (burger && menu) {
    burger.addEventListener('click', () => {
      burger.classList.toggle('open');
      menu.classList.toggle('open');
    });
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      burger.classList.remove('open');
      menu.classList.remove('open');
    }));
  }

  // ── Auth-aware header ──
  // When signed in: hide any [data-auth="guest"] links (Student Login)
  // and show [data-auth="user"] links (Dashboard + Sign Out). The
  // Dashboard link is pointed at the right portal for the user's role.
  const navSb = (typeof getSupabase === 'function') ? getSupabase() : null;

  function applyAuthNav(loggedIn) {
    document.querySelectorAll('[data-auth="guest"]').forEach(el => {
      el.style.display = loggedIn ? 'none' : '';
    });
    document.querySelectorAll('[data-auth="user"]').forEach(el => {
      el.style.display = loggedIn ? '' : 'none';
    });
    const chip = document.querySelector('[data-nav="user-chip"]');
    if (chip) {
      chip.style.display = loggedIn ? 'inline-flex' : 'none';
      chip.style.pointerEvents = 'none';
    }
  }

  async function refreshAuthNav() {
    if (!navSb) { applyAuthNav(false); return; }
    try {
      const { data } = await navSb.auth.getSession();
      const loggedIn = !!(data.session && data.session.access_token);
      applyAuthNav(loggedIn);
      if (loggedIn) {
        const dash = document.querySelector('[data-nav="dashboard"]');
        const chip = document.querySelector('[data-nav="user-chip"]');
        let href = 'student.html';
        try {
          const { data: { user } } = await navSb.auth.getUser();
          if (user) {
            const { data: prof } = await navSb.from('profiles').select('role, full_name').eq('id', user.id).maybeSingle();
            if (prof && prof.role === 'admin') href = 'admin.html';
            else if (prof && prof.role === 'tutor') href = 'dashboard.html';
            if (chip) {
              const name = (prof && prof.full_name) ? prof.full_name.split(' ')[0] : (user.email || '').split('@')[0];
              chip.textContent = name;
            }
          }
        } catch { /* keep default */ }
        if (dash) dash.href = href;
      }
    } catch { applyAuthNav(false); }
  }
  refreshAuthNav();
  if (navSb && navSb.auth) {
    navSb.auth.onAuthStateChange(() => refreshAuthNav());
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        if (entry.target.parentElement && entry.target.parentElement.classList.contains('stagger')) {
          const kids = Array.from(entry.target.parentElement.children);
          entry.target.style.transitionDelay = (kids.indexOf(entry.target) * 60) + 'ms';
        }
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => io.observe(el));
  document.querySelectorAll('.stagger').forEach(parent => {
    Array.from(parent.children).forEach(c => io.observe(c));
  });

  const counters = document.querySelectorAll('[data-count]');

  function animateCounter(el) {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    if (isNaN(target)) return;
    const dur = 1600;
    const isInt = Number.isInteger(target);
    const start = performance.now();
    function fmt(v) {
      return (isInt ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)) + suffix;
    }
    function tick(now) {
      if (!document.body.contains(el)) return;
      if (now === undefined) now = performance.now();
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * eased);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = fmt(target);
    }
    requestAnimationFrame(tick);
    if (el.dataset.count === '0' || target === 0) el.textContent = '0';
  }

  function isInView(el) {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  }

  function checkNow() {
    counters.forEach(el => { if (isInView(el)) animateCounter(el); });
  }

  if ('IntersectionObserver' in window) {
    const cio = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { animateCounter(entry.target); cio.unobserve(entry.target); }
      });
    }, { threshold: 0.2 });
    counters.forEach(el => cio.observe(el));
  }
  checkNow();
  window.addEventListener('scroll', () => { checkNow(); }, { passive: true });
  window.addEventListener('resize', () => { checkNow(); }, { passive: true });
  setTimeout(checkNow, 600);
  setTimeout(checkNow, 1500);

  window.addEventListener('scroll', () => {
    const nav = document.querySelector('.nav');
    if (nav) nav.style.boxShadow = window.scrollY > 20 ? 'var(--shadow-md)' : 'var(--shadow-sm)';
  }, { passive: true });
});

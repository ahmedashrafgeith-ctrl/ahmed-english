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

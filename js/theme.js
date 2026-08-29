const THEMES = {
  warm: {
    name: 'Warm Coral',
    accent: '#E8724A', accent2: '#F0944D',
    hero: 'linear-gradient(135deg, #E8724A 0%, #F0944D 50%, #F4B95E 100%)',
    soft: 'linear-gradient(135deg, #FFF4EC 0%, #FFE8DA 100%)',
    bg: '#FBF7F4', softC: '#FFF1E8', surface: '#FFFFFF', sidebar: '#FFFFFF',
    ink: '#19140F', ink2: '#5B4F45', ink3: '#9B8D82',
    border: '#EFE4DB', cardBorder: '#EEE3DA',
    glow: 'rgba(232,114,74,0.28)', nav: 'rgba(255,255,255,0.82)',
    dot: '#E8724A'
  },
  ocean: {
    name: 'Ocean Blue',
    accent: '#2563EB', accent2: '#3B82F6',
    hero: 'linear-gradient(135deg, #1D4ED8 0%, #2563EB 50%, #06B6D4 100%)',
    soft: 'linear-gradient(135deg, #EEF5FF 0%, #E2EDFF 100%)',
    bg: '#F4F8FF', softC: '#E4EFFF', surface: '#FFFFFF', sidebar: '#FFFFFF',
    ink: '#0A1626', ink2: '#3A506E', ink3: '#7A91AC',
    border: '#DFEBFA', cardBorder: '#E3EEFC',
    glow: 'rgba(37,99,235,0.25)', nav: 'rgba(255,255,255,0.82)',
    dot: '#2563EB'
  },
  forest: {
    name: 'Forest Green',
    accent: '#059669', accent2: '#10B981',
    hero: 'linear-gradient(135deg, #047857 0%, #059669 50%, #34D399 100%)',
    soft: 'linear-gradient(135deg, #EFFAF3 0%, #DFF6EA 100%)',
    bg: '#F3FBF6', softC: '#E1F6EA', surface: '#FFFFFF', sidebar: '#FFFFFF',
    ink: '#071A10', ink2: '#2F5340', ink3: '#6D927C',
    border: '#D6EFE0', cardBorder: '#DFF2E7',
    glow: 'rgba(5,150,105,0.24)', nav: 'rgba(255,255,255,0.82)',
    dot: '#059669'
  },
  royal: {
    name: 'Royal Purple',
    accent: '#7C3AED', accent2: '#8B5CF6',
    hero: 'linear-gradient(135deg, #6D28D9 0%, #7C3AED 50%, #A78BFA 100%)',
    soft: 'linear-gradient(135deg, #F6F1FF 0%, #EDE5FF 100%)',
    bg: '#F6F2FD', softC: '#EFE8FC', surface: '#FFFFFF', sidebar: '#FFFFFF',
    ink: '#160B27', ink2: '#44356B', ink3: '#8176A3',
    border: '#E2D9F5', cardBorder: '#E8E0FA',
    glow: 'rgba(124,58,237,0.24)', nav: 'rgba(255,255,255,0.82)',
    dot: '#7C3AED'
  },
  coral: {
    name: 'Rose Pink',
    accent: '#E11D48', accent2: '#F43F5E',
    hero: 'linear-gradient(135deg, #BE123C 0%, #E11D48 50%, #FB7185 100%)',
    soft: 'linear-gradient(135deg, #FFF0F4 0%, #FFE5EB 100%)',
    bg: '#FFF5F7', softC: '#FFE9EE', surface: '#FFFFFF', sidebar: '#FFFFFF',
    ink: '#20080F', ink2: '#6B3448', ink3: '#A8687E',
    border: '#F7D6DE', cardBorder: '#F9DFE6',
    glow: 'rgba(225,29,72,0.24)', nav: 'rgba(255,255,255,0.82)',
    dot: '#E11D48'
  },
  dark: {
    name: 'Dark Mode',
    accent: '#FB923C', accent2: '#F97316',
    hero: 'linear-gradient(135deg, #EA580C 0%, #F97316 50%, #FBBF24 100%)',
    soft: 'linear-gradient(135deg, #171C2E 0%, #1D2438 100%)',
    bg: '#0C0F1A', softC: '#161C2C', surface: '#181E31', sidebar: '#141824',
    ink: '#F2F4FB', ink2: '#AAB4CC', ink3: '#66708B',
    border: '#262F47', cardBorder: '#1F283E',
    glow: 'rgba(249,115,22,0.26)', nav: 'rgba(20,24,36,0.82)',
    dot: '#FB923C'
  }
};

let currentTheme = localStorage.getItem('ahmed-theme') || 'warm';

function applyTheme(id) {
  const t = THEMES[id];
  if (!t) return;
  currentTheme = id;
  const r = document.documentElement.style;
  r.setProperty('--c-accent', t.accent);
  r.setProperty('--c-accent-2', t.accent2);
  r.setProperty('--c-hero', t.hero);
  r.setProperty('--c-hero-soft', t.soft);
  r.setProperty('--c-bg', t.bg);
  r.setProperty('--c-soft', t.softC);
  r.setProperty('--c-surface', t.surface);
  r.setProperty('--c-sidebar', t.sidebar);
  r.setProperty('--c-ink', t.ink);
  r.setProperty('--c-ink-2', t.ink2);
  r.setProperty('--c-ink-3', t.ink3);
  r.setProperty('--c-border', t.border);
  r.setProperty('--c-card-border', t.cardBorder);
  r.setProperty('--c-glow', t.glow);
  r.setProperty('--nav-bg', t.nav);
  localStorage.setItem('ahmed-theme', id);
  document.querySelectorAll('[data-theme]').forEach(o => o.classList.toggle('active', o.dataset.theme === id));
  const dot = document.getElementById('theme-dot');
  if (dot) dot.style.background = t.accent;
}

function buildThemeWidget() {
  if (document.getElementById('theme-widget')) return;
  const el = document.createElement('div');
  el.id = 'theme-widget';
  el.innerHTML = `
    <button class="theme-toggle" id="theme-toggle-btn" aria-label="Change color theme">
      <span class="theme-dot" id="theme-dot"></span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>
      </svg>
    </button>
    <div class="theme-pop" id="theme-pop">
      <div class="theme-pop-title">Color Theme</div>
      ${Object.entries(THEMES).map(([id, t]) => `
        <button class="theme-opt" data-theme="${id}">
          <span class="theme-swatch" style="background:${t.accent}"></span>
          <span>${t.name}</span>
        </button>`).join('')}
    </div>`;
  // Place the widget inline in the nav as its own flex child between the
  // menu ("Student Login") and the CTA ("Book Free Trial") so it sits evenly
  // centered between both; otherwise fall back to a fixed corner widget.
  var nav = document.querySelector('.nav');
  var cta = document.querySelector('.nav-cta');
  var placed = false;
  if (nav && cta) {
    nav.insertBefore(el, cta);
    el.classList.add('in-nav');
    placed = true;
  } else {
    document.body.appendChild(el);
    el.classList.add('floating');
  }

  var btn = document.getElementById('theme-toggle-btn');
  const pop = document.getElementById('theme-pop');
  btn.addEventListener('click', e => { e.stopPropagation(); pop.classList.toggle('open'); });
  document.addEventListener('click', e => {
    if (!el.contains(e.target)) pop.classList.remove('open');
  });
  el.querySelectorAll('.theme-opt').forEach(o => {
    o.addEventListener('click', () => { applyTheme(o.dataset.theme); pop.classList.remove('open'); });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  buildThemeWidget();
  applyTheme(currentTheme);
});

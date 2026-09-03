// ============================================================
// TutorEnglishPro — Internal Booking System (slot picker + My Bookings)
// ------------------------------------------------------------
// Talks to the Supabase Edge Function `book-lesson`, which reads
// Ahmed's real Cal.com calendar (free slots) and creates the booking
// directly on Cal.com (POST /v2/bookings) with the server-side API
// key. Cal.com itself emails the student + host the confirmation and
// calendar invite. Booking is ONE-TAP — the student confirms in-app
// and is shown a success state; there is no second Cal.com step.
// ============================================================
(function () {
  const BOOKING = (window.APP_CONFIG && window.APP_CONFIG.booking) || {};
  const FN_URL = BOOKING.functionUrl || "";

  const EVENTS = [
    { key: "30min-trial", label: "Free Trial", minutes: 30 },
    { key: "30min", label: "30-Min Lesson", minutes: 30 },
    { key: "60min", label: "60-Min Lesson", minutes: 60 },
  ];
  const EVENT_COLOR = { "30min-trial": "var(--c-accent)", "30min": "#2563EB", "60min": "#059669" };

  let sb = null;
  let accessToken = "";
  let selectedEvent = "60min";
  let weekStart = null; // Monday of the displayed week (local)
  let monthCursor = null; // 1st of the displayed month (local)
  let viewMode = "week"; // "week" | "month"
  let activeDay = null; // YYYY-MM-DD of the picked day in the agenda view
  let myTab = "upcoming"; // "upcoming" | "history"
  const SLUG_LABEL = {
    "30min-trial": "Free Trial",
    "30min": "30-Min Lesson",
    "60min": "60-Min Lesson",
  };
  const SLUG_ICON = {
    "30min-trial": "⚡",
    "30min": "🗓",
    "60min": "🎓",
  };
  function lessonLabel(b) {
    const s = (b.event_slug || "").toLowerCase();
    if (SLUG_LABEL[s]) return SLUG_LABEL[s];
    const t = (b.title || "").replace(/ between .*$/i, "").replace(/-/g, " ").trim();
    if (t) return t.charAt(0).toUpperCase() + t.slice(1);
    return "Lesson";
  }
  let user = null;
  let packLeft = null;
  let busyChanel = null;
  let lastPick = null; // summary for the success modal

  const els = {};

  function q(sel) { return document.querySelector(sel); }
  function qs(sel) { return Array.from(document.querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymdLocal(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function startOfWeek(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = (x.getDay() + 6) % 7; // Monday-first
    x.setDate(x.getDate() - dow);
    return x;
  }
  function fmtTime(iso, tz) {
    const d = new Date(iso);
    try { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz }); }
    catch { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }); }
  }
  function fmtDayLine(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString([], { weekday: "short" });
  }
  function fmtDateLong(iso, tz) {
    const d = new Date(iso);
    const date = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    return { date, time: fmtTime(iso, tz) };
  }
  function fmtWeekRange(start) {
    const a = startOfWeek(start);
    const b = addDays(a, 6);
    const fa = a.toLocaleDateString([], { month: "short", day: "numeric" });
    const fb = b.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    return `${fa} – ${fb}`;
  }
  function monthStart(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  function fmtMonthLabel(d) {
    const c = monthStart(d);
    return c.toLocaleDateString([], { month: "long", year: "numeric" });
  }

  // ---- toasts ----
  function toast(text, ok) {
    let wrap = q(".bk-toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "bk-toast-wrap";
      document.body.appendChild(wrap);
    }
    const t = document.createElement("div");
    t.className = "bk-toast " + (ok ? "ok" : "err");
    t.textContent = text;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), 5200);
    if (wrap.children.length > 4) wrap.firstChild.remove();
  }

  // ---- modal helpers (own markup, stylesheet in styles.css) ----
  function openModal(html) {
    closeModal();
    const ov = document.createElement("div");
    ov.className = "bk-overlay";
    ov.id = "bk-overlay";
    ov.setAttribute("role", "dialog");
    const card = document.createElement("div");
    card.className = "bk-modal";
    card.innerHTML = html;
    card.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeModal));
    ov.appendChild(card);
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov) closeModal(); });
    return ov;
  }
  function closeModal() {
    const ov = q("#bk-overlay");
    if (ov) ov.remove();
  }
  function setModal(html) {
    const ov = q("#bk-overlay");
    const card = ov && ov.firstElementChild;
    if (card) card.innerHTML = html;
    if (card) card.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeModal));
  }

  async function ensureAuth() {
    sb = getSupabase();
    if (!sb) return false;
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.access_token) return false;
    accessToken = session.access_token;
    const { data: { user: u } } = await sb.auth.getUser();
    if (!u) return false;
    user = u;
    return true;
  }

  async function callFn(path, options) {
    const res = await fetch(FN_URL + path, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken, ...(options.headers || {}) },
    });
    let out = {};
    try { out = await res.json(); } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, ...out };
  }

  // ---- UI ----
  function buildUI(container) {
    const photo = (window.TUTOR_PHOTO) || "";
    const hostLine = (user && user.user_metadata && user.user_metadata.full_name) ? "" : "";
    const activeEvent = EVENTS.find(e => e.key === selectedEvent) || EVENTS[0];
    container.innerHTML = `
      <div class="bk-cal">
        <div class="bk-cal-side">
          <div class="bk-cal-avatar"><img src="${esc(photo)}" alt="Tutor" onerror="this.style.display='none'"><span>${esc("TG")}</span></div>
          <p class="bk-cal-who">Ahmed Ghaith · English Tutor</p>
          <h2 class="bk-cal-title" id="bk-cal-title">${esc(activeEvent.label)}</h2>
          <div class="bk-cal-meta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>${activeEvent.minutes} min</span>
          </div>
          <div class="bk-cal-select" id="bk-cal-pack"></div>

          <div class="bk-cal-events">
            <span class="bk-cal-events-label">Select a type</span>
            ${EVENTS.map(e => `
              <button type="button" class="bk-cal-event ${e.key === selectedEvent ? 'is-active' : ''}" data-type="${e.key}">
                <span class="bk-cal-event-name">${esc(e.label)}</span>
                <span class="bk-cal-event-dur">${e.minutes} min</span>
                <svg class="bk-cal-event-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>`).join('')}
          </div>

          <p class="bk-cal-powered">Confirmed instantly · invite by email</p>
        </div>

        <div class="bk-cal-main">
          <div class="bk-cal-head">
            <div class="bk-cal-left">
              <span class="muted" style="font-size:.8rem;font-weight:600;" id="bk-range"></span>
              <span class="badge badge-acc" id="bk-tz-label" style="font-size:.6rem;font-weight:700;"></span>
            </div>
            <div class="bk-mid">
              <button type="button" class="btn btn-soft btn-sm" id="bk-prev" title="Previous"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;"><polyline points="15 18 9 12 15 6"/></svg></button>
              <button type="button" class="btn btn-soft btn-sm" id="bk-now" title="Jump to current">Today</button>
              <button type="button" class="btn btn-soft btn-sm" id="bk-next" title="Next"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;"><polyline points="9 18 15 12 9 6"/></svg></button>
            </div>
            <div class="bk-mode" role="tablist" aria-label="Calendar view">
              <button type="button" class="bk-mode-btn is-on" id="bk-mode-week" role="tab" aria-selected="true">Week</button>
              <button type="button" class="bk-mode-btn" id="bk-mode-month" role="tab" aria-selected="false">Month</button>
            </div>
          </div>

          <div class="bk-cal-body">
            <div class="bk-cal-caption">Select a Date &amp; Time</div>
            <div id="bk-tz-note" style="display:none;align-items:center;gap:6px;margin:2px 0 10px;font-size:.78rem;font-weight:600;color:var(--c-accent,#0b3b2c);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>&#9881; Shown in your local timezone: <span id="bk-tz-note-name" style="font-weight:800;">&hellip;</span></span>
            </div>
            <div id="bk-slots" style="min-height:140px;">
              <div class="muted" style="padding:24px;text-align:center;">Loading available times…</div>
            </div>
            <div id="bk-day-detail" style="display:none;"></div>
          </div>
          <div id="bk-msg" style="margin-top:10px;font-size:.85rem;font-weight:600;display:none;"></div>
        </div>
      </div>

      <div style="margin-top:26px;border-top:1px solid var(--c-card-border);padding-top:18px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <h3 style="margin:0;font-size:1.1rem;">My Bookings</h3>
          <span class="muted" style="font-size:.78rem;">Your upcoming lessons appear here.</span>
        </div>
        <div id="bk-mybookings" style="margin-top:12px;"><p class="muted">Loading…</p></div>
      </div>`;

    els.range = q("#bk-range");
    els.slots = q("#bk-slots");
    els.prev = q("#bk-prev");
    els.next = q("#bk-next");
    els.now = q("#bk-now");
    els.dayDetail = q("#bk-day-detail");
    els.modeWeek = q("#bk-mode-week");
    els.modeMonth = q("#bk-mode-month");
    els.msg = q("#bk-msg");
    els.mybookings = q("#bk-mybookings");
    els.pack = q("#bk-cal-pack");
    els.tzLabel = q("#bk-tz-label");
    els.tzNote = q("#bk-tz-note");
    els.tzNoteName = q("#bk-tz-note-name");
  }

  // ---- package info ----
  async function loadPack() {
    if (!sb || !user) return;
    try {
      const { data: sub } = await sb.from("subscriptions").select("*").eq("student_id", user.id).eq("status", "active").maybeSingle();
      if (sub) {
        packLeft = Math.max((sub.lessons_total || 0) - (sub.lessons_used || 0), 0);
        els.pack.innerHTML = `<span class="badge badge-acc">${esc(sub.package_name || "Plan")} · <span id="pack-left">${packLeft}</span> / ${sub.lessons_total || 0} lessons left</span>`;
      } else {
        packLeft = null;
        els.pack.innerHTML = `<span class="muted">No active plan — pay-as-you-go trial available</span>`;
      }
    } catch { /* ignore */ }
  }

  // ---- availability ----
  function currentRange() {
    if (viewMode === "month") {
      const a = monthStart(monthCursor);
      const b = new Date(a.getFullYear(), a.getMonth() + 1, 0); // last day of month
      return { start: a, end: b, label: fmtMonthLabel(a) };
    }
    const a = startOfWeek(weekStart);
    return { start: a, end: addDays(a, 6), label: fmtWeekRange(a) };
  }

  async function loadSlots() {
    els.slots.innerHTML = `<div class="muted" style="padding:40px;text-align:center;">Loading available times…</div>`;
    els.dayDetail.style.display = "none";
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const { start, end, label } = currentRange();
    const r = await callFn(`?eventSlug=${encodeURIComponent(selectedEvent)}&start=${ymdLocal(start)}&end=${ymdLocal(end)}&tz=${encodeURIComponent(tz)}`, { method: "GET" });

    els.tzLabel.textContent = tz;
    els.range.textContent = label;
    if (els.tzNote) {
      els.tzNote.style.display = "flex";
      if (els.tzNoteName) els.tzNoteName.textContent = tz;
    }

    if (!r.ok) {
      els.slots.innerHTML = `<div class="muted" style="padding:20px;text-align:center;">Could not load availability. ${esc(r.message || "")}</div>`;
      return;
    }
    const data = r.data || {};
    if (viewMode === "month") renderMonth(data, tz);
    else renderWeek(data, tz);
  }

  function renderWeek(data, tz) {
    const nowMs = Date.now();
    const todayYmd = ymdLocal(new Date());

    const days = [];
    let totalFree = 0;
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      const key = ymdLocal(day);
      const slots = (data[key] || []).filter(s => s && s.start && new Date(s.start) > nowMs).sort((a, b) => new Date(a.start) - new Date(b.start));
      days.push({ key, day, slots, today: key === todayYmd });
      totalFree += slots.length;
    }

    if (!totalFree) {
      els.slots.innerHTML = `
        <div style="padding:28px;text-align:center;" class="muted">
          No open slots this week.
          <button type="button" class="btn btn-soft btn-sm" id="bk-jump-next" style="margin-left:6px;">next week →</button>
        </div>`;
      const jump = q("#bk-jump-next");
      if (jump) jump.addEventListener("click", () => { weekStart = addDays(weekStart, 7); activeDay = null; loadSlots(); });
      return;
    }

    if (!activeDay || !data[activeDay] || !data[activeDay].some(s => new Date(s.start) > nowMs)) {
      const today = days.find(d => d.today && d.slots.length);
      activeDay = (today || days.find(d => d.slots.length)).key;
    }
    const active = days.find(d => d.key === activeDay);
    const activeSlots = active ? active.slots : [];

    // Day selector chips (Cal.com style) across the top of the right pane.
    const dayChips = days.map(d => {
      const count = d.slots.length;
      return `<button type="button" class="bk-chip ${d.key === activeDay ? 'is-selected' : ''} ${d.today ? 'today' : ''} ${!count ? 'empty' : ''}" data-day="${esc(d.key)}" ${count ? "" : "disabled"}>
        <span class="bk-chip-wd">${fmtDayLine(d.day.toISOString())}</span>
        <span class="bk-chip-d">${d.day.getDate()}</span>
        <span class="bk-chip-n">${count ? count : ''}</span>
      </button>`;
    }).join("");

    const activeEvent = EVENTS.find(e => e.key === selectedEvent) || EVENTS[0];
    const timeList = activeSlots.length
      ? activeSlots.map(s => `
          <button type="button" class="bk-time" data-start="${esc(s.start)}" data-end="${esc(s.end || '')}">
            <span class="bk-time-h">${esc(fmtTime(s.start, tz))}</span>
            <span class="bk-time-sub">${activeEvent.minutes} min</span>
          </button>`).join("")
      : `<div class="bk-empty2 muted">No free times on this day.</div>`;

    els.slots.innerHTML = `
      <div class="bk-days">${dayChips}</div>
      <div class="bk-times-head">
        <span class="bk-times-date">${active ? active.day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : ''}</span>
        <span class="muted" style="font-size:.8rem;">${totalFree} free ${totalFree === 1 ? 'slot' : 'slots'} this week</span>
      </div>
      <div class="bk-times">${timeList}</div>`;

    qs(".bk-chip:not(:disabled)").forEach(btn => {
      btn.addEventListener("click", () => { activeDay = btn.dataset.day; renderWeek(data, tz); });
    });
    qs(".bk-time").forEach(btn => {
      btn.addEventListener("click", () => openConfirm(btn.dataset.start, btn.dataset.end));
    });
  }

  function renderMonth(data, tz) {
    const nowMs = Date.now();
    const todayYmd = ymdLocal(new Date());
    const a = monthStart(monthCursor);
    const daysInMonth = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
    const lead = (a.getDay() + 6) % 7; // leading blank cells (Mon-first)
    const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      .map(d => `<div class="bk-wd">${d}</div>`).join("");

    let cells = "";
    let totalFree = 0;
    for (let i = 0; i < lead; i++) cells += `<div class="bk-mcell bk-blank"></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(a.getFullYear(), a.getMonth(), d);
      const key = ymdLocal(day);
      const slots = (data[key] || []).filter(s => s && new Date(s.start) > nowMs).sort((x, y) => new Date(x.start) - new Date(y.start));
      const isToday = key === todayYmd;
      const isPast = day.getTime() < new Date(todayYmd + "T00:00:00").getTime();
      if (slots.length) totalFree += slots.length;
      const pills = slots.slice(0, 3).map(s => `<span class="bk-mini">${esc(fmtTime(s.start, tz))}</span>`).join("");
      const more = slots.length > 3 ? `<span class="bk-mini bk-more">+${slots.length - 3}</span>` : "";
      cells += `
        <div class="bk-mcell ${isToday ? 'today' : ''} ${slots.length ? 'has' : ''}">
          <button type="button" class="bk-mbtn" ${slots.length ? `data-day="${esc(key)}"` : "disabled"}>
            <span class="bk-dn ${isPast ? 'past' : ''}">${d}</span>
            ${slots.length ? `<span class="bk-pills">${pills}${more}</span>` : ""}
          </button>
        </div>`;
    }

    if (!totalFree) {
      els.slots.innerHTML = `
        <div style="padding:28px;text-align:center;" class="muted">
          No open slots this month.
          <button type="button" class="btn btn-soft btn-sm" id="bk-jump-next" style="margin-left:6px;">next month →</button>
        </div>`;
      const jump = q("#bk-jump-next");
      if (jump) jump.addEventListener("click", () => { monthCursor = new Date(a.getFullYear(), a.getMonth() + 1, 1); loadSlots(); });
      return;
    }

    els.slots.innerHTML = `
      <div class="bk-month-grid">
        ${weekDays}
        ${cells}
      </div>
      <div class="muted" style="font-size:.8rem;margin-top:10px;">${totalFree} free slots in ${a.toLocaleDateString([], { month: "long" })}</div>`;

    qs(".bk-mbtn[data-day]").forEach(btn => {
      btn.addEventListener("click", () => showDayDetail(btn.dataset.day, data, tz));
    });
  }

  function showDayDetail(key, data, tz) {
    const slots = (data[key] || []).filter(s => s && s.start).sort((x, y) => new Date(x.start) - new Date(y.start));
    const d = new Date(key + "T00:00:00");
    const heading = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    const body = slots.length
      ? slots.map(s => {
          const past = new Date(s.start) <= Date.now();
          return `<button type="button" class="bk-dslot ${past ? 'is-past' : ''}" data-start="${esc(s.start)}" data-end="${esc(s.end || '')}">
            <span class="bk-dt">${esc(fmtTime(s.start, tz))}</span>
            <span class="bk-dm">${esc(s.start.slice(11, 16))} - ${esc((s.end || s.start).slice(11, 16))} <span class="muted">· ${esc(tz)}</span></span>
            ${past ? `<span class="bk-dtag">past</span>` : `<span class="bk-dtag bk-ok">select</span>`}
          </button>`;
        }).join("")
      : `<div class="muted" style="padding:10px 2px;">No free slots on this day.</div>`;
    els.dayDetail.style.display = "";
    els.dayDetail.innerHTML = `
      <div class="bk-day-card">
        <div class="bk-day-card-head">
          <strong>${esc(heading)}</strong>
          <button type="button" class="btn btn-ghost btn-sm" id="bk-detail-close">Close</button>
        </div>
        <div class="bk-dslot-list">${body}</div>
      </div>`;
    qs(".bk-dslot:not(.is-past)").forEach(btn => {
      btn.addEventListener("click", () => openConfirm(btn.dataset.start, btn.dataset.end));
    });
    q("#bk-detail-close").addEventListener("click", () => {
      els.dayDetail.style.display = "none";
      els.dayDetail.innerHTML = "";
    });
    const detailTop = els.dayDetail.getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top: detailTop, behavior: "smooth" });
  }

  // ---- booking confirm modal ----
  function openConfirm(start, end) {
    const event = EVENTS.find(e => e.key === selectedEvent) || EVENTS[0];
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const { date, time } = fmtDateLong(start, tz);
    const leftText = packLeft == null
      ? "You can book without a plan — pay when you're ready."
      : `Lessons remaining on your plan: <b>${packLeft}</b>`;
    lastPick = { event, date, time, leftText, tz };

    openModal(`
      <div class="bk-confirm">
        <div class="bk-confirm-head">
          <button type="button" class="bk-close-x" data-close aria-label="Close">✕</button>
          <h3>Confirm your booking</h3>
          <p>Books instantly — your invite arrives by email.</p>
        </div>

        <div class="bk-sum2">
          <div class="bk-cell"><span class="muted">Lesson</span><b id="bk-sum-type">${esc(event.label)}</b></div>
          <div class="bk-cell"><span class="muted">Date</span><b>${esc(date)}</b></div>
          <div class="bk-cell"><span class="muted">Time</span><b>${esc(time)}</b><small>· ${esc(tz)}</small></div>
          <div class="bk-cell"><span class="muted">Plan</span><b class="bk-plantext">${leftText}</b></div>
        </div>

        <div class="bk-type-row">
          ${EVENTS.map(e => `
            <button type="button" class="bk-type-btn ${e.key === selectedEvent ? 'is-active' : ''}" data-type="${e.key}">
              <span class="bk-type-l">${esc(e.label)}</span><span class="bk-type-d">${e.minutes}m</span>
            </button>`).join('')}
        </div>

        <div class="bk-actions">
          <button type="button" class="btn btn-secondary" data-close>Go back</button>
          <button type="button" class="btn btn-primary" id="bk-confirm">Confirm →</button>
        </div>
      </div>
    `);

    qs(".bk-type-btn").forEach(b => b.addEventListener("click", () => {
      selectedEvent = b.dataset.type;
      qs(".bk-type-btn").forEach(x => x.classList.toggle("is-active", x === b));
      const ev = EVENTS.find(e => e.key === selectedEvent) || EVENTS[0];
      lastPick.event = ev;
      const t = q("#bk-sum-type");
      if (t) t.textContent = ev.label;
    }));

    const btn = q("#bk-confirm");
    const finish = async () => {
      setModal(`
        <div class="bk-confirm">
          <div class="bk-confirm-head"><h3>Confirming</h3><p>Adding your Book - Check Your Email</p></div>
          <p class="bk-loading">Hang on a moment…</p>
        </div>
      `);
      const r = await callFn("", {
        method: "POST",
        body: JSON.stringify({ eventSlug: selectedEvent, start, timeZone: tz }),
      });
      if (!r.ok) {
        setModal(`
          <div class="bk-confirm">
            <div class="bk-confirm-head"><h3>Could not book this slot</h3><p>${esc(r.message || "Please try a different slot.")}</p></div>
            <div class="bk-actions"><button type="button" class="btn btn-primary" data-close>OK</button></div>
          </div>
        `);
        toast(r.message || "Booking failed — try another slot.", false);
        return;
      }
      const p = lastPick;
      const leftText2 = r.lessonsLeft != null && Number.isInteger(r.lessonsLeft)
        ? `${r.lessonsLeft} lesson${r.lessonsLeft === 1 ? "" : "s"} left`
        : p.leftText;
      setModal(`
        <div class="bk-confirm">
          <div class="bk-confirm-head">
            <div class="bk-ok-check">✓</div>
            <h3>Booked!</h3>
            <p>Confirmed — invite sent to ${esc((user && user.email) || "your email")}.</p>
          </div>
          <div class="bk-sum2">
            <div class="bk-cell"><span class="muted">Lesson</span><b>${esc(p.event.label)}</b></div>
            <div class="bk-cell"><span class="muted">Date</span><b>${esc(p.date)}</b></div>
            <div class="bk-cell"><span class="muted">Time</span><b>${esc(p.time)}</b><small>· ${esc(p.tz)}</small></div>
            <div class="bk-cell"><span class="muted">Plan</span><b class="bk-plantext">${leftText2}</b></div>
          </div>
          <div class="bk-actions"><button type="button" class="btn btn-primary" data-close>Done</button></div>
        </div>
      `);
      toast("✓ Lesson booked — confirmation email sent.", true);
      await loadSlots();
      await loadMyBookings();
      await loadPack();
    };
    btn.addEventListener("click", finish);
  }

  // ---- My Bookings ----
  async function loadMyBookings() {
    if (!sb || !user) {
      if (els.mybookings) els.mybookings.innerHTML = `<p class="muted">Sign in to see your upcoming lessons.</p>`;
      return;
    }
    try {
      const { data: rows } = await sb.from("bookings").select("*").eq("student_id", user.id).order("start_at", { ascending: true });
      const future = (rows || []).filter(b => (b.status === "booked" || b.status === "pending") && new Date(b.start_at) > new Date());
      const other = (rows || []).filter(b => !future.includes(b)).slice().sort((a, b) => new Date(b.start_at) - new Date(a.start_at)).slice(0, 8);
      if (!rows || !rows.length) {
        els.mybookings.innerHTML = `
          <div class="bk-books-empty">
            <div class="bk-books-empty-ic">📅</div>
            <strong>No lessons yet</strong>
            <p class="muted">Pick a free slot above to book your first lesson.</p>
          </div>`;
        return;
      }

      const upcomingHtml = future.length
        ? `<div class="bk-books-list">${future.map(b => bookingCard(b, true)).join("")}</div>`
        : `<div class="bk-books-empty"><strong>No upcoming lessons</strong><p class="muted">Your next booking will show up here.</p></div>`;
      const historyHtml = other.length
        ? `<div class="bk-books-list bk-books-history">${other.map(b => bookingCard(b, false)).join("")}</div>`
        : `<div class="bk-books-empty"><strong>No past bookings</strong><p class="muted">Your booking history will appear here.</p></div>`;

      els.mybookings.innerHTML = `
        <div class="bk-books-tabs">
          <button type="button" class="bk-btab ${myTab === 'upcoming' ? 'is-on' : ''}" data-tab="upcoming">Upcoming${future.length ? ` <span class="bk-btab-cnt">${future.length}</span>` : ''}</button>
          <button type="button" class="bk-btab ${myTab === 'history' ? 'is-on' : ''}" data-tab="history">History<span class="bk-btab-cnt">${other.length}</span></button>
        </div>
        <div id="bk-books-body">${myTab === 'upcoming' ? upcomingHtml : historyHtml}</div>`;

      const p = q("#pack-left");
      if (p) p.textContent = packLeft;
      qs(".bk-btab").forEach(btn => btn.addEventListener("click", () => {
        myTab = btn.dataset.tab === "history" ? "history" : "upcoming";
        loadMyBookings();
      }));
      qs("[data-cancel]").forEach(btn => btn.addEventListener("click", () => openCancelModal(btn.dataset.cancel)));
    } catch (e) {
      console.error("my bookings error:", e);
      els.mybookings.innerHTML = `<p class="muted">Could not load your bookings.</p>`;
    }
  }

  function bookingCard(b, upcoming) {
    const start = new Date(b.start_at);
    const end = b.end_at ? new Date(b.end_at) : null;
    const dateStr = start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const timeStr = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
      + (end ? " – " + end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }) : "");
    const label = lessonLabel(b);
    const icon = SLUG_ICON[(b.event_slug || "").toLowerCase()] || "🗓";
    const cancelled = b.status !== "booked" && b.status !== "pending";
    const badge = b.status === "pending"
      ? `<span class="bk-stat bk-stat-pend">Pending</span>`
      : (cancelled ? `<span class="bk-stat bk-stat-canc">Cancelled</span>` : `<span class="bk-stat bk-stat-ok">Booked</span>`);
    return `
      <div class="bk-book ${cancelled ? 'is-cancelled' : ''} ${upcoming ? '' : 'is-past'}">
        <div class="bk-book-dot"></div>
        <div class="bk-book-ic">${icon}</div>
        <div class="bk-book-main">
          <div class="bk-book-top">
            <strong>${esc(label)}</strong>
            ${badge}
          </div>
          <div class="bk-book-when">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>${esc(dateStr)}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>${esc(timeStr)}</span>
          </div>
        </div>
        ${upcoming ? `<button type="button" class="bk-book-cancel" data-cancel="${b.id}" title="Cancel this lesson">Cancel</button>` : ""}
      </div>`;
  }

  function openCancelModal(id) {
    openModal(`
      <h3>Cancel this lesson?</h3>
      <p class="bk-sub">If a lesson was used, it'll be credited straight back to your plan.</p>
      <div class="bk-actions">
        <button type="button" class="btn btn-secondary" data-close>Keep it</button>
        <button type="button" class="btn btn-primary" id="bk-cancel-yes" style="background:#9F1239;">Cancel lesson</button>
      </div>
    `);
    q("#bk-cancel-yes").addEventListener("click", async () => {
      setModal(`<h3>Cancelling…</h3><p class="bk-sub">Hold on a moment.</p>`);
      const r = await callFn("", { method: "POST", body: JSON.stringify({ action: "cancel", bookingId: id }) });
      if (!r.ok) {
        setModal(`
          <h3>Could not cancel</h3>
          <p class="bk-sub">${esc(r.message || "Please try again.")}</p>
          <div class="bk-actions"><button type="button" class="btn btn-primary" data-close>OK</button></div>
        `);
        toast(r.message || "Cancel failed.", false);
        return;
      }
      closeModal();
      toast("✓ Lesson cancelled and credited back.", true);
      await loadMyBookings();
      await loadPack();
      await loadSlots();
    });
  }

  // ---- realtime + refresh ----
  function subscribeBookings() {
    if (!sb || !user) return;
    try {
      if (busyChanel) sb.removeChannel(busyChanel);
      busyChanel = sb
        .channel("booking-sync")
        .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `student_id=eq.${user.id}` }, () => {
          loadMyBookings(); loadPack();
        })
        .subscribe();
    } catch { /* ignore */ }
    setInterval(() => { if (!document.hidden) { loadMyBookings(); loadPack(); } }, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadSlots(); loadMyBookings(); loadPack(); } });
  }

  // ---- init ----
  window.initBookingSystem = async function (mountSel) {
    const mount = q(mountSel);
    if (!mount) return;
    buildUI(mount);

    const loggedIn = await ensureAuth();
    weekStart = startOfWeek(new Date());
    monthCursor = monthStart(new Date());

    function setMode(mode) {
      viewMode = mode;
      els.modeWeek.classList.toggle("is-on", mode === "week");
      els.modeMonth.classList.toggle("is-on", mode === "month");
      els.modeWeek.setAttribute("aria-selected", mode === "week");
      els.modeMonth.setAttribute("aria-selected", mode === "month");
      loadSlots();
    }

    els.prev.addEventListener("click", () => {
      if (viewMode === "month") monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1);
      else { weekStart = addDays(weekStart, -7); activeDay = null; }
      loadSlots();
    });
    els.next.addEventListener("click", () => {
      if (viewMode === "month") monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1);
      else { weekStart = addDays(weekStart, 7); activeDay = null; }
      loadSlots();
    });
    els.now.addEventListener("click", () => {
      weekStart = startOfWeek(new Date());
      monthCursor = monthStart(new Date());
      activeDay = null;
      loadSlots();
    });
    els.modeWeek.addEventListener("click", () => setMode("week"));
    els.modeMonth.addEventListener("click", () => setMode("month"));

    qs(".bk-cal-event").forEach(b => b.addEventListener("click", () => {
      selectedEvent = b.dataset.type;
      const ev = EVENTS.find(e => e.key === selectedEvent) || EVENTS[0];
      qs(".bk-cal-event").forEach(x => x.classList.toggle("is-active", x === b));
      const title = q("#bk-cal-title");
      if (title) title.textContent = ev.label;
      const meta = q(".bk-cal-meta span");
      if (meta) meta.textContent = ev.minutes + " min";
      activeDay = null;
      loadSlots();
    }));

    if (!loggedIn) {
      els.slots.innerHTML = `<div style="padding:40px;text-align:center;" class="muted">
        Please <a href="login.html" style="color:var(--c-accent);font-weight:700;">log in to your student account</a> to book a lesson.
      </div>`;
      els.mybookings.innerHTML = `<p class="muted">Sign in to see your upcoming lessons.</p>`;
      return;
    }

    await loadPack();
    await loadSlots();
    await loadMyBookings();
    subscribeBookings();
  };
})();

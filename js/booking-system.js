// ============================================================
// Ahmed English — Internal Booking System (slot picker + My Bookings)
// ------------------------------------------------------------
// Talks to the Supabase Edge Function `book-lesson`, which proxies
// Cal.com availability and creates REAL Cal.com bookings on the
// tutor's calendar. The student's package lesson is auto-consumed.
// ============================================================
(function () {
  const BOOKING = (window.APP_CONFIG && window.APP_CONFIG.booking) || {};
  const FN_URL = BOOKING.functionUrl || "";

  const EVENTS = [
    { key: "30min-trial", label: "Free Trial", minutes: 30, color: "var(--c-accent)" },
    { key: "30min", label: "30-Min Lesson", minutes: 30, color: "#2563EB" },
    { key: "60min", label: "60-Min Lesson", minutes: 60, color: "#059669" },
  ];

  let sb = null;
  let accessToken = "";
  let selectedEvent = EVENTS[0].key;
  let currentStart = new Date();
  let currentEnd = new Date(Date.now() + 13 * 86400000); // 14-day window
  let slotsCache = {};

  const els = {};

  function q(sel) { return document.querySelector(sel); }
  function qs(sel) { return Array.from(document.querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fmtTime(iso, tz) {
    const d = new Date(iso);
    try { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz }); }
    catch { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  }
  function fmtDay(iso) {
    const d = new Date(iso);
    return { day: d.toLocaleDateString([], { weekday: "short" }), date: d.toLocaleDateString([], { day: "numeric", month: "short" }) };
  }
  function ymd(d) { return d.toISOString().slice(0, 10); }

  async function ensureAuth() {
    sb = getSupabase();
    if (!sb) return false;
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.access_token) return false;
    accessToken = session.access_token;
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

  function buildUI(container) {
    container.innerHTML = `
      <div class="card" style="padding:24px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:6px;">
          <div>
            <span class="eyebrow" style="margin-bottom:4px;"><span class="dot"></span> Schedule Your Lesson</span>
            <h2 style="margin:0;font-size:1.4rem;">Book Your <span class="grad-text">Lesson</span></h2>
            <p class="muted" style="margin:4px 0 0;font-size:.9rem;">Select a date and time that works for you. Sessions are 1-on-1 with Ahmed.</p>
          </div>
          <div id="bk-pack-badge" style="font-size:.85rem;font-weight:700;color:var(--c-ink-3);"></div>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 4px;">
          ${EVENTS.map((e, i) => `
            <button type="button" class="btn btn-sm ${i === 0 ? 'btn-primary' : 'btn-secondary'}" data-evt="${e.key}">
              ${esc(e.label)} · ${e.minutes}m
            </button>`).join('')}
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0 10px;flex-wrap:wrap;">
          <span class="muted" style="font-size:.9rem;" id="bk-range"></span>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn btn-soft btn-sm" id="bk-prev">← Earlier</button>
            <button type="button" class="btn btn-soft btn-sm" id="bk-next">Later →</button>
          </div>
        </div>

        <div id="bk-slots" style="min-height:120px;">
          <div class="muted" style="padding:24px;text-align:center;">Loading available times…</div>
        </div>

        <div id="bk-msg" style="margin-top:14px;font-size:.9rem;font-weight:600;display:none;"></div>

        <div style="margin-top:28px;border-top:1px solid var(--c-card-border);padding-top:18px;">
          <h3 style="margin:0 0 12px;font-size:1.1rem;">My Bookings</h3>
          <div id="bk-mybookings"><p class="muted">Sign in to see your upcoming lessons.</p></div>
        </div>
      </div>`;

    els.range = q("#bk-range");
    els.slots = q("#bk-slots");
    els.prev = q("#bk-prev");
    els.next = q("#bk-next");
    els.msg = q("#bk-msg");
    els.mybookings = q("#bk-mybookings");
    els.pack = q("#bk-pack-badge");
  }

  function showMsg(text, ok) {
    els.msg.style.display = "block";
    els.msg.style.color = ok ? "#059669" : "#DC2626";
    els.msg.textContent = text;
    setTimeout(() => { els.msg.style.display = "none"; }, 5000);
  }

  async function loadPack() {
    if (!sb) return;
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data: sub } = await sb.from("subscriptions").select("*").eq("student_id", user.id).eq("status", "active").maybeSingle();
      if (sub) {
        const left = Math.max((sub.lessons_total || 0) - (sub.lessons_used || 0), 0);
        els.pack.innerHTML = `<span style="display:inline-flex;gap:6px;align-items:center;"><span style="color:var(--c-accent);">${esc(sub.package_name || "Plan")}</span> · ${left} / ${sub.lessons_total || 0} lessons left</span>`;
      } else {
        els.pack.innerHTML = `<span class="muted">No active plan</span>`;
      }
    } catch { /* ignore */ }
  }

  async function loadSlots() {
    els.slots.innerHTML = `<div class="muted" style="padding:24px;text-align:center;">Loading available times…</div>`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const r = await callFn(`?eventSlug=${encodeURIComponent(selectedEvent)}&start=${ymd(currentStart)}&end=${ymd(currentEnd)}&tz=${encodeURIComponent(tz)}`, { method: "GET" });
    if (!r.ok) {
      els.slots.innerHTML = `<div class="muted" style="padding:20px;text-align:center;">Could not load availability. ${esc(r.message || "")}</div>`;
      return;
    }
    const data = r.data || {};
    const tzLabel = tz.replace("_", " ");
    els.range.textContent = `${fmtDay(currentStart.toISOString()).date} – ${fmtDay(currentEnd.toISOString()).date} · ${esc(tzLabel)}`;

    const dates = Object.keys(data).sort().filter(d => new Date(d) >= new Date(ymd(new Date())));
    if (!dates.length) {
      els.slots.innerHTML = `<div class="muted" style="padding:24px;text-align:center;">No open slots in this window. Try a later range.</div>`;
      return;
    }

    els.slots.innerHTML = dates.map(date => {
      const slots = (data[date] || []).filter(s => s && s.start);
      if (!slots.length) return "";
      const d = fmtDay(date + "T00:00:00");
      return `
        <div style="margin-bottom:16px;">
          <div style="font-weight:800;font-size:.85rem;color:var(--c-ink-2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
            ${esc(d.day)} · ${esc(d.date)}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${slots.map(s => `
              <button type="button" class="btn btn-soft btn-sm bk-slot" data-start="${esc(s.start)}" data-end="${esc(s.end || "")}">
                ${esc(fmtTime(s.start, tz))}
              </button>`).join('')}
          </div>
        </div>`;
    }).join('');

    qs(".bk-slot").forEach(btn => btn.addEventListener("click", () => pickSlot(btn.dataset.start, btn.dataset.end)));
  }

  async function pickSlot(start, end) {
    if (!confirm(`Open Cal.com to book this ${EVENTS.find(e => e.key === selectedEvent)?.label}?\n\n${new Date(start).toLocaleString()}\n\nYou'll confirm the exact slot on Cal.com — your lesson is counted from your plan once confirmed.`)) return;
    showMsg("Opening Cal.com to confirm…", true);
    const r = await callFn("", {
      method: "POST",
      body: JSON.stringify({ eventSlug: selectedEvent, start, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }),
    });
    if (!r.ok) { showMsg(r.message || "Could not open Cal.com.", false); return; }
    if (r.bookingUrl) window.open(r.bookingUrl, "_blank", "noopener");
    showMsg(r.message || "Confirm your lesson on the opened Cal.com page — your lesson is counted from your plan once confirmed.", true);
    await loadSlots();
    await loadMyBookings();
    await loadPack();
  }

  async function loadMyBookings() {
    if (!sb) { return; }
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { els.mybookings.innerHTML = `<p class="muted">Sign in to see your upcoming lessons.</p>`; return; }
      const { data: rows } = await sb.from("bookings").select("*").eq("student_id", user.id).order("start_at", { ascending: true });
      const future = (rows || []).filter(b => b.status === "booked" && new Date(b.start_at) > new Date());
      const past = (rows || []).filter(b => b.status !== "booked" || new Date(b.start_at) <= new Date());
      if (!future.length) {
        els.mybookings.innerHTML = `<p class="muted">No upcoming lessons booked.</p>`;
        return;
      }
      els.mybookings.innerHTML = future.map(b => `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px solid var(--c-card-border);border-radius:12px;padding:10px 14px;margin-bottom:8px;flex-wrap:wrap;">
          <div>
            <strong style="font-size:.95rem;">${esc(b.title || b.event_slug)}</strong>
            <div class="muted" style="font-size:.85rem;">${new Date(b.start_at).toLocaleString()}</div>
            <span class="badge badge-ok" style="font-size:.7rem;">${b.consumed_lesson ? "lesson used" : "booked"}</span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-cancel="${b.id}">Cancel</button>
        </div>`).join('');
      qs("[data-cancel]").forEach(btn => btn.addEventListener("click", () => cancelBooking(btn.dataset.cancel)));
    } catch (e) { console.error("my bookings error:", e); }
  }

  async function cancelBooking(id) {
    if (!confirm("Cancel this lesson? Your lesson will be credited back to your plan.")) return;
    const r = await callFn("", { method: "POST", body: JSON.stringify({ action: "cancel", bookingId: id }) });
    if (!r.ok) { showMsg(r.message || "Could not cancel.", false); return; }
    showMsg("✓ Lesson cancelled and credited back.", true);
    await loadMyBookings();
    await loadPack();
  }

  window.initBookingSystem = async function (mountSel) {
    const mount = q(mountSel);
    if (!mount) return;
    buildUI(mount);

    const loggedIn = await ensureAuth();

    qs("[data-evt]").forEach(b => b.addEventListener("click", () => {
      selectedEvent = b.dataset.evt;
      qs("[data-evt]").forEach(x => x.className = "btn btn-sm " + (x === b ? "btn-primary" : "btn-secondary"));
      loadSlots();
    }));
    els.prev.addEventListener("click", () => { currentStart = new Date(currentStart.getTime() - 14 * 86400000); currentEnd = new Date(currentEnd.getTime() - 14 * 86400000); loadSlots(); });
    els.next.addEventListener("click", () => { currentStart = new Date(currentStart.getTime() + 14 * 86400000); currentEnd = new Date(currentEnd.getTime() + 14 * 86400000); loadSlots(); });

    if (!loggedIn) {
      els.slots.innerHTML = `<div style="padding:24px;text-align:center;" class="muted">
        Please <a href="login.html" style="color:var(--c-accent);font-weight:700;">log in to your student account</a> to book a lesson on your plan.
      </div>`;
      els.mybookings.innerHTML = `<p class="muted">Sign in to see your upcoming lessons.</p>`;
      return;
    }

    loadPack();
    await loadSlots();
    await loadMyBookings();
  };
})();

// ============================================================
// Ahmed English — Internal Booking System (slot picker + My Bookings)
// ------------------------------------------------------------
// Talks to the Supabase Edge Function `book-lesson`, which reads
// Ahmed's real Cal.com calendar (free slots) and hands the student
// to Cal.com's own booking page to finish. Once confirmed there,
// the `cal-webhook` function stores the booking, consumes a lesson
// and both student + admin get Cal.com's confirmation email.
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
  let selectedEvent = EVENTS[0].key;
  let weekStart = null; // Monday of the displayed week (local)
  let user = null;
  let packLeft = null;
  let busyChanel = null;

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
    try { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz }); }
    catch { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
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
    container.innerHTML = `
      <div class="card" style="padding:24px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:6px;">
          <div>
            <span class="eyebrow" style="margin-bottom:4px;"><span class="dot"></span> Schedule Your Lesson</span>
            <h2 style="margin:0;font-size:1.4rem;">Book Your <span class="grad-text">Lesson</span></h2>
            <p class="muted" style="margin:4px 0 0;font-size:.9rem;">Check Ahmed's live calendar and lock in a free slot. Confirmed bookings show below and in your account.</p>
          </div>
          <div id="bk-pack-badge" style="font-size:.85rem;font-weight:700;color:var(--c-ink-3);"></div>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 0;">
          ${EVENTS.map((e, i) => `
            <button type="button" class="btn btn-sm ${i === 0 ? 'btn-primary' : 'btn-secondary'}" data-evt="${e.key}">
              ${esc(e.label)} · ${e.minutes}m
            </button>`).join('')}
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:20px 0 4px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="muted" style="font-size:.9rem;font-weight:600;" id="bk-range"></span>
            <span class="badge badge-acc" id="bk-tz-label" style="font-size:.68rem;font-weight:700;"></span>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn btn-soft btn-sm" id="bk-prev" title="Previous week">←</button>
            <button type="button" class="btn btn-soft btn-sm" id="bk-now" title="Jump to this week">This week</button>
            <button type="button" class="btn btn-soft btn-sm" id="bk-next" title="Next week">→</button>
          </div>
        </div>

        <div id="bk-slots" style="min-height:120px;">
          <div class="muted" style="padding:24px;text-align:center;">Loading available times…</div>
        </div>

        <div id="bk-msg" style="margin-top:14px;font-size:.9rem;font-weight:600;display:none;"></div>

        <div style="margin-top:28px;border-top:1px solid var(--c-card-border);padding-top:18px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <h3 style="margin:0;font-size:1.1rem;">My Bookings</h3>
            <span class="muted" style="font-size:.78rem;">Bookings confirm here once you finish on Cal.com</span>
          </div>
          <div id="bk-mybookings" style="margin-top:12px;"><p class="muted">Loading…</p></div>
        </div>
      </div>`;

    els.range = q("#bk-range");
    els.slots = q("#bk-slots");
    els.prev = q("#bk-prev");
    els.next = q("#bk-next");
    els.now = q("#bk-now");
    els.msg = q("#bk-msg");
    els.mybookings = q("#bk-mybookings");
    els.pack = q("#bk-pack-badge");
    els.tzLabel = q("#bk-tz-label");
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
  async function loadSlots() {
    els.slots.innerHTML = `<div class="muted" style="padding:40px;text-align:center;">Loading available times…</div>`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const start = ymdLocal(weekStart);
    const end = ymdLocal(addDays(weekStart, 6));
    const r = await callFn(`?eventSlug=${encodeURIComponent(selectedEvent)}&start=${start}&end=${end}&tz=${encodeURIComponent(tz)}`, { method: "GET" });

    els.tzLabel.textContent = tz;
    els.range.textContent = fmtWeekRange(weekStart);

    if (!r.ok) {
      els.slots.innerHTML = `<div class="muted" style="padding:20px;text-align:center;">Could not load availability. ${esc(r.message || "")}</div>`;
      return;
    }
    const data = r.data || {};
    renderWeek(data, tz);
  }

  function renderWeek(data, tz) {
    const nowMs = Date.now();
    const todayYmd = ymdLocal(new Date());

    let columns = "";
    let any = false;
    let totalFree = 0;
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      const key = ymdLocal(day);
      const slots = (data[key] || []).filter(s => s && s.start).sort((a, b) => new Date(a.start) - new Date(b.start));
      const today = key === todayYmd;
      const freeToday = slots.filter(s => new Date(s.start) > nowMs).length;
      if (freeToday) { any = true; totalFree += freeToday; }

      columns += `
        <div class="bk-day ${today ? 'today' : ''}">
          <div class="bk-day-head">
            <div class="dw">${fmtDayLine(key + "T00:00:00")}</div>
            <div class="dd">${new Date(key + "T00:00:00").getDate()}</div>
            ${today ? '<div class="dw" style="color:var(--c-accent);">Today</div>' : ""}
          </div>
          ${slots.length
            ? slots.map(s => {
                const past = new Date(s.start) <= nowMs;
                return `<button type="button" class="btn btn-sm bk-slot ${past ? 'is-past' : ''}" data-start="${esc(s.start)}" data-end="${esc(s.end || '')}" style="${past ? '' : 'background:var(--c-soft);color:var(--c-ink);border:1px solid var(--c-card-border);'}">
                  ${esc(fmtTime(s.start, tz))}
                </button>`;
              }).join("")
            : `<div class="bk-empty">No free slot</div>`}
        </div>`;
    }

    if (!any) {
      els.slots.innerHTML = `
        <div style="padding:28px;text-align:center;" class="muted">
          No open slots in this week.
          <button type="button" class="btn btn-soft btn-sm" id="bk-jump-next" style="margin-left:6px;">next week →</button>
        </div>`;
      const jump = q("#bk-jump-next");
      if (jump) jump.addEventListener("click", () => { weekStart = addDays(weekStart, 7); loadSlots(); });
      return;
    }

    els.slots.innerHTML = `
      <div class="bk-week">${columns}</div>
      <div class="muted" style="font-size:.8rem;margin-top:10px;">
        ${totalFree} free ${totalFree === 1 ? "slot" : "slots"} this week · ${esc(tz)} · slots greyed out have already passed
      </div>`;

    qs(".bk-slot").forEach(btn => {
      if (!btn.classList.contains("is-past")) btn.addEventListener("click", () => openConfirm(btn.dataset.start, btn.dataset.end));
    });
  }

  // ---- booking confirm modal ----
  function openConfirm(start, end) {
    const event = EVENTS.find(e => e.key === selectedEvent) || EVENTS[0];
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const { date, time } = fmtDateLong(start, tz);
    const leftText = packLeft == null
      ? "You can book without a plan — pay when you're ready."
      : `Lessons remaining on your plan: <b>${packLeft}</b>`;

    openModal(`
      <h3>Confirm this slot?</h3>
      <p class="bk-sub">One last step — lock it in on the shared calendar.</p>
      <div class="bk-sum">
        <div><span class="muted">Lesson</span><b>${esc(event.label)}</b></div>
        <div><span class="muted">Date</span><b>${esc(date)}</b></div>
        <div><span class="muted">Time</span><b>${esc(time)} (${esc(tz)})</b></div>
        <div><span class="muted">Plan</span><b>${leftText}</b></div>
      </div>
      <div class="bk-actions">
        <button type="button" class="btn btn-secondary" data-close>Go back</button>
        <button type="button" class="btn btn-primary" id="bk-confirm">Confirm</button>
      </div>
      <p class="bk-note">You'll finish on Cal.com (Ahmed's calendar) to make it official — that keeps the shared calendar accurate for everyone.</p>
    `);

    const btn = q("#bk-confirm");
    const finish = async () => {
      setModal(`
        <h3>Booking…</h3>
        <p class="bk-sub">Reserving your slot…</p>
      `);
      const r = await callFn("", {
        method: "POST",
        body: JSON.stringify({ eventSlug: selectedEvent, start, timeZone: tz }),
      });
      if (!r.ok) {
        setModal(`
          <h3>Could not reserve this slot</h3>
          <p class="bk-sub">${esc(r.message || "Please try a different slot.")}</p>
          <div class="bk-actions"><button type="button" class="btn btn-primary" data-close>OK</button></div>
        `);
        toast(r.message || "Booking failed — try another slot.", false);
        return;
      }
      if (r.bookingUrl) {
        setModal(`
          <h3 style="color:#059669;">Almost there! ✓</h3>
          <p class="bk-sub" style="margin-top:10px;">Your slot is reserved. Finish on Cal.com so it lands on the shared calendar — then it appears below and in both of your accounts.</p>
          <div class="bk-actions">
            <button type="button" class="btn btn-secondary" data-close>Done</button>
            <button type="button" class="btn btn-primary" id="bk-open-cal">
              Open Cal.com <span style="font-size:.8rem;">↗</span>
            </button>
          </div>
        `);
        q("#bk-open-cal").addEventListener("click", () => {
          window.open(r.bookingUrl, "_blank", "noopener");
          toast("Opened Cal.com — confirm there to finish.", true);
        });
      } else {
        setModal(`
          <h3>Booking confirmed</h3>
          <p class="bk-sub">${esc(r.message || "")}</p>
          <div class="bk-actions"><button type="button" class="btn btn-primary" data-close>Done</button></div>
        `);
      }
      toast("Slot reserved — finish on Cal.com to confirm.", true);
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
      const future = (rows || []).filter(b => b.status === "booked" && new Date(b.start_at) > new Date());
      const other = (rows || []).filter(b => !future.includes(b));
      if (!rows || !rows.length) {
        els.mybookings.innerHTML = `<p class="muted">Nothing booked yet — pick a free slot above.</p>`;
        return;
      }
      const upcoming = future.length ? future.map(b => bookingRow(b, true)).join("") : `<p class="muted" style="margin:6px 0;">No upcoming lessons.</p>`;
      const history = other.length
        ? other.slice().sort((a, b) => new Date(b.start_at) - new Date(a.start_at)).slice(0, 5).map(b => bookingRow(b, false)).join("")
        : "";
      els.mybookings.innerHTML = upcoming + (history ? `<div class="muted" style="font-size:.78rem;font-weight:700;margin:14px 0 8px;">PAST / CANCELLED</div>${history}` : "");
      const p = q("#pack-left");
      if (p) p.textContent = packLeft;
      qs("[data-cancel]").forEach(btn => btn.addEventListener("click", () => openCancelModal(btn.dataset.cancel)));
    } catch (e) {
      console.error("my bookings error:", e);
      els.mybookings.innerHTML = `<p class="muted">Could not load your bookings.</p>`;
    }
  }

  function bookingRow(b, upcoming) {
    const when = new Date(b.start_at).toLocaleString([], {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
    const badge = b.status === "booked"
      ? (b.consumed_lesson ? `<span class="badge badge-ok">Booked · lesson used</span>` : `<span class="badge badge-acc">Pending confirmation</span>`)
      : `<span class="badge badge-warn">${esc(b.status)}</span>`;
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px solid var(--c-card-border);border-radius:12px;padding:11px 14px;margin-bottom:8px;flex-wrap:wrap;">
        <div style="min-width:0;">
          <strong style="font-size:.95rem;">${esc(b.title || b.event_slug || "Lesson")}</strong>
          <div class="muted" style="font-size:.84rem;margin-top:2px;">${when}</div>
          <div style="margin-top:6px;">${badge}</div>
        </div>
        ${upcoming ? `<button type="button" class="btn btn-ghost btn-sm" data-cancel="${b.id}">Cancel</button>` : ""}
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

    qs("[data-evt]").forEach(b => b.addEventListener("click", () => {
      selectedEvent = b.dataset.evt;
      qs("[data-evt]").forEach(x => x.className = "btn btn-sm " + (x === b ? "btn-primary" : "btn-secondary"));
      loadSlots();
    }));
    els.prev.addEventListener("click", () => { weekStart = addDays(weekStart, -7); loadSlots(); });
    els.next.addEventListener("click", () => { weekStart = addDays(weekStart, 7); loadSlots(); });
    els.now.addEventListener("click", () => { weekStart = startOfWeek(new Date()); loadSlots(); });

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
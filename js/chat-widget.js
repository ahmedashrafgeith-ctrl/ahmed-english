// ============================================================
// TutorEnglishPro — Live Chat Widget (student + guest)
// ------------------------------------------------------------
// Floating action button on all public/student pages. Hovering or
// tapping it reveals two options:
//   • Chat with us          → live 1-on-1 chat with Ahmed
//   • We'll get back to you → short contact form
//
// Chat works with or without an account:
//   • signed-in students use their account automatically
//   • guests just type their name + email (no password, no sign-up)
// The widget's colors follow the site theme (js/theme.js CSS vars),
// and the chat pane fills the whole screen on phones.
// ============================================================
(function () {
  var cfg = (window.APP_CONFIG && window.APP_CONFIG.booking) || {};
  var FN = cfg.chatUrl || "";
  var CONTACT_FN = cfg.contactUrl || "";
  if (!FN) return;

  var sb = null;
  var accessToken = "";
  var signedIn = false;
  var guest = null; // { name, email } persisted in localStorage
  var myId = null;
  var myRole = "student";
  var currentChat = null;
  var channel = null;

  var GUEST_KEY = "ahm-guest";
  var OPEN_KEY = "ahm-chat-open";

  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:26px;height:26px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_FORM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><rect x="3" y="4" width="18" height="18" rx="3"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="14" y2="13"/><line x1="7" y1="17" x2="11" y2="17"/></svg>';
  var ICON_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m22 7-10 6L2 7"/></svg>';
  var CLOSE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" style="width:20px;height:20px;"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

  function css() {
    var s = document.createElement("style");
    s.textContent = `
#ahm-chat-root{position:fixed;bottom:20px;right:20px;z-index:9999;font-family:var(--font,"DM Sans",-apple-system,sans-serif)}
#ahm-chat-root *{box-sizing:border-box}

/* ---- floating action button ---- */
#ahm-chat-fab{width:60px;height:60px;border-radius:50%;border:2.5px solid var(--c-surface,#fff);cursor:pointer;background:var(--c-accent,#0b3b2c);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px var(--c-glow,rgba(0,0,0,.3)),0 2px 8px rgba(0,0,0,.18);transition:transform .16s ease;position:relative}
#ahm-chat-fab:hover{transform:scale(1.07)}
#ahm-chat-fab:active{transform:scale(.96)}
#ahm-chat-fab .fab-pulse{position:absolute;inset:-6px;border-radius:50%;border:2.5px solid var(--c-accent,#0b3b2c);opacity:.55;animation:ahmPulse 2.4s ease-out infinite;pointer-events:none}
@keyframes ahmPulse{0%{transform:scale(.9);opacity:.6}70%{transform:scale(1.25);opacity:0}100%{opacity:0}}
#ahm-chat-fab .open-x{display:none}
#ahm-chat-root.menu #ahm-chat-fab .fab-open{display:none}
#ahm-chat-root.menu #ahm-chat-fab .open-x{display:flex}
#ahm-chat-badge{position:absolute;top:-3px;right:-3px;min-width:22px;height:22px;border-radius:22px;background:#e5484d;color:#fff;font-size:.72rem;font-weight:800;display:none;align-items:center;justify-content:center;padding:0 6px;border:2px solid var(--c-surface,#fff)}

/* ---- hover / tap action menu ---- */
#ahm-actions{position:absolute;right:0;bottom:70px;display:flex;flex-direction:column;gap:10px;align-items:flex-end;opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .18s ease,transform .18s ease}
#ahm-chat-root:hover #ahm-actions:not(.hide),#ahm-chat-root.menu #ahm-actions:not(.hide),#ahm-chat-root.pin #ahm-actions:not(.hide){opacity:1;transform:none;pointer-events:auto}
.ahm-act{display:inline-flex;align-items:center;gap:8px;background:var(--c-surface,#fff);color:var(--c-ink,#111);border:1px solid var(--c-card-border,#e5e7eb);border-radius:999px;padding:10px 14px 10px 10px;font-size:.85rem;font-weight:700;font-family:inherit;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.14);transition:background .15s,transform .15s;white-space:nowrap}
.ahm-act .ahm-ic{width:28px;height:28px;min-width:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;background:var(--c-accent,#0b3b2c);flex-shrink:0}
.ahm-act .ahm-ic svg{width:16px;height:16px}
.ahm-act:hover{background:var(--c-soft,#fff1e8);transform:translateX(-4px)}

/* ---- chat panel ---- */
#ahm-chat-panel{position:fixed;right:20px;bottom:92px;width:min(372px,calc(100vw - 40px));max-height:min(560px,calc(100dvh - 130px));background:var(--c-surface,#fff);color:var(--c-ink,#111);border:1px solid var(--c-border,#e5e5e5);border-radius:20px;box-shadow:0 22px 60px rgba(0,0,0,.24);display:none;flex-direction:column;overflow:hidden}
#ahm-chat-panel.open{display:flex}
#ahm-chat-head{background:var(--c-hero,linear-gradient(135deg,#0b3b2c,#0f5c45));color:#fff;padding:14px 16px;display:flex;align-items:center;gap:11px}
#ahm-chat-head .ahm-avatar{width:36px;height:36px;border-radius:50%;background:#fff;color:var(--c-accent,#0b3b2c);font-weight:800;display:flex;align-items:center;justify-content:center;font-size:1rem}
#ahm-chat-head .ahm-name{font-weight:800;font-size:.98rem}
#ahm-chat-head .ahm-name small{display:block;font-weight:600;font-size:.72rem;opacity:.85}
#ahm-chat-close{flex:0 0 auto;margin-left:auto;background:rgba(255,255,255,.2);border:none;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;padding:0;transition:background .15s}
#ahm-chat-close:hover{background:rgba(255,255,255,.38)}
#ahm-chat-body{flex:1;overflow-y:auto;padding:14px;min-height:170px;background:var(--c-soft,#fff1e8);display:flex;flex-direction:column;gap:8px}
#ahm-chat-msg{display:flex;flex-direction:column;gap:2px;max-width:82%}
#ahm-chat-msg.s{align-self:flex-end;align-items:flex-end}
#ahm-chat-msg.a{align-self:flex-start;align-items:flex-start}
#ahm-chat-msg .bubble{padding:9px 13px;border-radius:15px;font-size:.88rem;line-height:1.5;color:var(--c-ink,#111);white-space:pre-wrap;word-break:break-word}
#ahm-chat-msg.s .bubble{background:var(--c-accent,#0b3b2c);color:#fff;border-bottom-right-radius:4px}
#ahm-chat-msg.a .bubble{background:var(--c-surface,#fff);border:1px solid var(--c-card-border,#e5e7eb);border-bottom-left-radius:4px}
#ahm-chat-msg .t{font-size:.66rem;color:var(--c-ink-3,#9ca3af)}
#ahm-chat-empty,#ahm-chat-cta{color:var(--c-ink-3,#9ca3af);font-size:.85rem;text-align:center;padding:26px 12px}
#ahm-chat-cta a{color:var(--c-accent,#0b3b2c);font-weight:800;text-decoration:none}

/* ---- guest start form ---- */
.ahm-guest{display:flex;flex-direction:column;gap:10px;padding:14px}
.ahm-guest h4{margin:0 0 2px;font-size:1.02rem;color:var(--c-ink,#111)}
.ahm-guest p{margin:0 0 4px;font-size:.82rem;color:var(--c-ink-3,#9ca3af)}
.ahm-in{flex:1;resize:none;border:1px solid var(--c-border,#dfe3e8);border-radius:11px;padding:11px 13px;font-size:.9rem;font-family:inherit;outline:none;background:var(--c-surface,#fff);color:var(--c-ink,#111)}
.ahm-in:focus{border-color:var(--c-accent,#0b3b2c)}
.ahm-btn{background:var(--c-accent,#0b3b2c);color:#fff;border:none;border-radius:11px;padding:12px 16px;font-size:.92rem;font-weight:700;font-family:inherit;cursor:pointer;transition:opacity .15s}
.ahm-btn:hover{opacity:.9}
.ahm-btn:disabled{opacity:.5;cursor:default}

/* ---- chat input ---- */
#ahm-chat-input{display:flex;gap:8px;padding:10px;border-top:1px solid var(--c-border,#eef0f2);background:var(--c-surface,#fff)}
#ahm-chat-input textarea{flex:1;resize:none;border:1px solid var(--c-border,#dfe3e8);border-radius:11px;padding:9px 12px;font-size:.88rem;font-family:inherit;outline:none;line-height:1.45;max-height:90px;background:var(--c-surface,#fff);color:var(--c-ink,#111)}
#ahm-chat-input textarea:focus{border-color:var(--c-accent,#0b3b2c)}
#ahm-chat-send{background:var(--c-accent,#0b3b2c);color:#fff;border:none;border-radius:11px;width:48px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.1rem}
#ahm-chat-send:disabled{opacity:.5;cursor:default}
#ahm-chat-note{padding:6px 14px;font-size:.68rem;color:var(--c-ink-3,#9ca3af);background:var(--c-surface,#fff);text-align:center}

/* ---- contact form modal ---- */
#ahm-contact{position:fixed;inset:0;z-index:10001;display:none;align-items:center;justify-content:center;padding:20px}
#ahm-contact.open{display:flex}
.ahm-cov{position:absolute;inset:0;background:rgba(10,14,20,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
.ahm-cmodal{position:relative;background:var(--c-surface,#fff);color:var(--c-ink,#111);border:1px solid var(--c-border,#e5e5e5);border-radius:20px;width:100%;max-width:400px;padding:24px;box-shadow:0 22px 60px rgba(0,0,0,.25)}
.ahm-cmodal .ahm-cbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.ahm-cmodal h3{margin:0;font-size:1.15rem}
.ahm-cclose{background:var(--c-soft,#f1f1f1);border:none;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:var(--c-ink,#111);cursor:pointer}
.ahm-cmodal .ahm-csub{color:var(--c-ink-3,#9ca3af);font-size:.84rem;margin:4px 0 16px}
.ahm-cmodal .ahm-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.ahm-cmodal .ahm-field label{font-size:.76rem;font-weight:700;color:var(--c-ink-2,#555)}
.ahm-cmodal .ahm-cok{display:flex;gap:8px;align-items:center;justify-content:center;padding:16px;background:var(--c-soft,#fff1e8);border:1px solid var(--c-border,#e5e5e5);border-radius:14px;color:var(--c-ink,#111);font-size:.9rem;text-align:center}

@media (max-width:640px){
  #ahm-chat-panel{right:0;bottom:0;left:0;top:0;width:100vw;max-width:100vw;height:100dvh;max-height:none;border-radius:0;border:none}
  #ahm-chat-root{bottom:14px;right:14px}
  #ahm-actions{bottom:74px}
  #ahm-contact{padding:0}
  .ahm-cmodal{height:100dvh;max-width:100vw;border-radius:0;display:flex;flex-direction:column;padding:20px}
  .ahm-cmodal .w{max-width:420px;width:100%;margin:0 auto}
  #ahm-chat-fab{width:58px;height:58px}
}`;
    document.head.appendChild(s);
  }

  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch { return iso; }
  }

  function build() {
    var root = document.createElement("div");
    root.id = "ahm-chat-root";
    root.innerHTML = `
      <div id="ahm-contact">
        <div class="ahm-cov"></div>
        <div class="ahm-cmodal">
          <div class="w">
            <div class="ahm-cbar">
              <h3>We'll get back to you</h3>
              <button class="ahm-cclose" id="ahm-cclose" aria-label="Close" title="Close">${CLOSE_SVG}</button>
            </div>
            <p class="ahm-csub">Leave your details and Ahmed will contact you shortly.</p>
            <div id="ahm-cform">
              <div class="ahm-field"><label for="ahm-cname">Your name</label><input class="ahm-in" id="ahm-cname" placeholder="e.g. Sara" autocomplete="name"></div>
              <div class="ahm-field"><label for="ahm-cemail">Email</label><input class="ahm-in" id="ahm-cemail" type="email" placeholder="you@example.com" autocomplete="email"></div>
              <div class="ahm-field"><label for="ahm-cmsg">Message</label><textarea class="ahm-in" id="ahm-cmsg" rows="4" placeholder="What would you like to know about lessons?"></textarea></div>
              <button class="ahm-btn" id="ahm-csend" type="button">Send request</button>
            </div>
            <div id="ahm-cdone" style="display:none;"></div>
          </div>
        </div>
      </div>

      <div id="ahm-chat-panel">
        <div id="ahm-chat-head">
          <div class="ahm-avatar">A</div>
          <div>
            <div class="ahm-name">TutorEnglishPro</div>
            <small id="ahm-state">Connecting…</small>
          </div>
          <button id="ahm-chat-close" title="Close chat" aria-label="Close chat">${CLOSE_SVG}</button>
        </div>
        <div id="ahm-chat-body"></div>
        <div id="ahm-chat-note">Messages go straight to Ahmed's inbox</div>
        <div id="ahm-chat-input"></div>
      </div>

      <div id="ahm-actions">
        <button class="ahm-act" data-a="chat"><span class="ahm-ic">${ICON_CHAT}</span>Chat with us</button>
        <button class="ahm-act" data-a="form"><span class="ahm-ic">${ICON_FORM}</span>Leave a message!</button>
      </div>

      <button id="ahm-chat-fab" title="Chat with us" aria-label="Chat with us" aria-expanded="false">
        <span class="fab-pulse"></span>
        <span class="fab-open">${ICON_CHAT}</span>
        <span class="open-x">${CLOSE_SVG}</span>
        <span id="ahm-chat-badge">0</span>
      </button>`;
    document.body.appendChild(root);

    var fab = document.getElementById("ahm-chat-fab");
    var panel = document.getElementById("ahm-chat-panel");
    var actions = document.getElementById("ahm-actions");
    var rootEl = root;

    fab.addEventListener("click", function (e) {
      e.stopPropagation();
      if (panel.classList.contains("open")) { closeChat(); return; }
      var open = rootEl.classList.toggle("menu");
      fab.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // Keep the hover action menu visible for a moment after the mouse leaves
    // the widget so it's easier to click an option.
    var pinTimer = null;
    rootEl.addEventListener("mouseenter", function () {
      if (pinTimer) { clearTimeout(pinTimer); pinTimer = null; }
    });
    rootEl.addEventListener("mouseleave", function () {
      if (pinTimer) clearTimeout(pinTimer);
      rootEl.classList.add("pin");
      pinTimer = setTimeout(function () {
        rootEl.classList.remove("pin");
        pinTimer = null;
      }, 5000);
    });

    // outside click closes the action menu
    document.addEventListener("click", function (e) {
      if (!rootEl.contains(e.target)) closeMenu();
    });

    document.querySelectorAll("[data-a]").forEach(function (b) {
      b.addEventListener("click", function () {
        var kind = b.dataset.a;
        closeMenu();
        if (kind === "form") openContact();
        else openChat();
      });
    });

    var closeBtn = document.getElementById("ahm-chat-close");
    if (closeBtn) closeBtn.addEventListener("click", closeChat);

    var cclose = document.getElementById("ahm-cclose");
    if (cclose) cclose.addEventListener("click", closeContact);
    var cov = root.querySelector(".ahm-cov");
    if (cov) cov.addEventListener("click", closeContact);
    var cSend = document.getElementById("ahm-csend");
    if (cSend) cSend.addEventListener("click", submitContact);

    window.__ahmCloseChat = closeChat;
  }

  function closeMenu() {
    var r = document.getElementById("ahm-chat-root");
    if (!r) return;
    r.classList.remove("menu");
    r.classList.remove("pin");
    var fab = document.getElementById("ahm-chat-fab");
    if (fab) fab.setAttribute("aria-expanded", "false");
  }

  function closeChat() {
    var panel = document.getElementById("ahm-chat-panel");
    if (panel) panel.classList.remove("open");
    var fab = document.getElementById("ahm-chat-fab");
    if (fab) fab.style.display = "flex";
    var actions = document.getElementById("ahm-actions");
    if (actions) actions.classList.remove("hide");
    if (window.location.hash) {
      try { history.replaceState(null, "", location.pathname + location.search); } catch { /* ignore */ }
    }
    if (localStorage) localStorage.setItem(OPEN_KEY, "0");
  }

  function openChat() {
    var panel = document.getElementById("ahm-chat-panel");
    if (!panel) return;
    panel.classList.add("open");
    var fab = document.getElementById("ahm-chat-fab");
    if (fab) fab.style.display = "none";
    var actions = document.getElementById("ahm-actions");
    if (actions) actions.classList.add("hide");
    if (localStorage) localStorage.setItem(OPEN_KEY, "1");
    refreshBadge(0);
    startChat();
  }

  function setFabVisible(show) {
    var fab = document.getElementById("ahm-chat-fab");
    if (!fab) return;
    fab.style.display = show ? "flex" : "none";
  }

  // ---------- guest identity ----------
  function loadGuest() {
    if (!localStorage) return null;
    try {
      var g = JSON.parse(localStorage.getItem(GUEST_KEY) || "null");
      if (g && g.email) return g;
    } catch {}
    return null;
  }
  function saveGuest(name, email) {
    guest = { name: name, email: email };
    if (localStorage) localStorage.setItem(GUEST_KEY, JSON.stringify(guest));
  }

  async function ensureAuth() {
    sb = getSupabase ? getSupabase() : null;
    if (!sb) return;
    try {
      var { data: { session } } = await sb.auth.getSession();
      if (session && session.access_token) {
        accessToken = session.access_token;
        var { data } = await sb.auth.getUser();
        signedIn = !!data.user;
        if (data && data.user) {
          myId = data.user.id;
          myRole = "student";
          guest = null;
          try {
            var { data: prof } = await sb.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
            if (prof && (prof.role === "admin" || prof.role === "staff")) myRole = prof.role;
          } catch {}
        }
        return;
      }
    } catch {}
    signedIn = false;
    accessToken = "";
    guest = guest || loadGuest();
  }

  async function callFn(action, payload) {
    try {
      var url = FN + (action ? "?action=" + encodeURIComponent(action) : "");
      var headers = { "Content-Type": "application/json" };
      if (accessToken) headers.Authorization = "Bearer " + accessToken;
      var body = payload || {};
      if (!signedIn && guest && !body.visitor) body.visitor = guest;
      var res = await fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body),
      });
      var out = await res.json().catch(function () { return {}; });
      return res.ok ? out : { status: "error", message: out.message || ("Error " + res.status) };
    } catch (e) {
      return { status: "error", message: e && e.message || "Network error" };
    }
  }

  // ---------- chat flow ----------
  async function startChat() {
    await ensureAuth();
    var bodyEl = document.getElementById("ahm-chat-body");
    var input = document.getElementById("ahm-chat-input");
    if (!bodyEl) return;

    if (!signedIn && !guest) {
      setState("No account needed");
      bodyEl.innerHTML = "";
      input.innerHTML = guestFormHtml();
      var btn = input.querySelector("#ahm-gstart");
      if (btn) btn.addEventListener("click", onGuestStart);
      input.querySelectorAll(".ahm-in").forEach(function (f) {
        f.addEventListener("keydown", function (e) { if (e.key === "Enter") onGuestStart(); });
      });
      return;
    }

    input.innerHTML = chatInputHtml();
    wireChatInput();

    bodyEl.innerHTML = `<div id="ahm-chat-empty">Loading…</div>`;
    var r = await callFn("chats", { action: "chats" });
    if (r.status !== "success") {
      setState("Could not load chat");
      bodyEl.innerHTML = `<div id="ahm-chat-empty">${esc(r.message || "Could not load chat.")}</div>`;
      return;
    }
    var chats = r.chats || [];
    var unreadTotal = chats.reduce(function (n, c) { return n + (c.unread_student || 0); }, 0);
    setBadge(unreadTotal);

    var target = chats.length ? chats[0] : null;
    if (!target) {
      setState(signedIn ? "Send a message to Ahmed" : "Hi " + (guest && guest.name ? guest.name.split(" ")[0] : "") + "!");
      bodyEl.innerHTML = `<div id="ahm-chat-empty">Ask anything — Ahmed replies usually the same day.</div>`;
      currentChat = null;
      return;
    }
    currentChat = target.id;
    setState("Ahmed typically replies the same day");
    await openThread(target.id);
  }

  function guestFormHtml() {
    return `
      <div class="ahm-guest">
        <h4>Start chatting</h4>
        <p>No account needed — just your name and email.</p>
        <input class="ahm-in" id="ahm-gname" placeholder="Your name" autocomplete="name">
        <input class="ahm-in" id="ahm-gmail" type="email" placeholder="you@example.com" autocomplete="email">
        <button class="ahm-btn" id="ahm-gstart" type="button">Start chatting</button>
      </div>`;
  }

  function onGuestStart() {
    var name = (document.getElementById("ahm-gname").value || "").trim();
    var gmail = (document.getElementById("ahm-gmail").value || "").trim();
    var okMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmail);
    if (!name) { document.getElementById("ahm-gname").focus(); return; }
    if (!okMail) { document.getElementById("ahm-gmail").focus(); return; }
    saveGuest(name, gmail.toLowerCase());
    startChat();
  }

  function chatInputHtml() {
    return `
      <textarea class="ahm-in" id="ahm-field" placeholder="Type your message…" rows="1"></textarea>
      <button class="ahm-btn" id="ahm-send" title="Send" style="width:48px;padding:0;flex:0 0 auto;">&rarr;</button>`;
  }

  function wireChatInput() {
    var field = document.getElementById("ahm-field");
    var send = document.getElementById("ahm-send");
    if (!field || !send) return;
    function autosize() {
      field.style.height = "auto";
      field.style.height = Math.min(field.scrollHeight, 90) + "px";
    }
    field.addEventListener("input", autosize);
    field.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); }
    });
    send.addEventListener("click", sendMsg);
  }

  function addBubble(msg) {
    var bodyEl = document.getElementById("ahm-chat-body");
    if (!bodyEl) return;
    var sender = msg.sender === "admin" ? "a" : "s";
    var node = el(`<div id="ahm-chat-msg" class="${sender}"><div class="bubble">${esc(msg.body)}</div><div class="t">${fmtTime(msg.created_at)}</div></div>`);
    bodyEl.appendChild(node);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function setState(t) {
    var s = document.getElementById("ahm-state");
    if (s) s.textContent = t;
  }

  var seenIds = {};

  async function openThread(chatId) {
    seenIds = {};
    await renderThread(chatId);
    if (signedIn) subscribe(chatId);
    await callFn("read", { action: "read", chatId: chatId });
    var r2 = await callFn("chats", { action: "chats" });
    if (r2.status === "success") {
      var total = (r2.chats || []).reduce(function (n, c) { return n + (c.unread_student || 0); }, 0);
      setBadge(total);
    }
    if (!signedIn && guest && window.__ahmGuestPoll === undefined) {
      window.__ahmGuestPoll = setInterval(async function () {
        var panel = document.getElementById("ahm-chat-panel");
        if (!panel || !panel.classList.contains("open")) {
          clearInterval(window.__ahmGuestPoll);
          window.__ahmGuestPoll = undefined;
          return;
        }
        if (currentChat) await renderThread(currentChat, true);
      }, 15000);
    }
  }

  async function renderThread(chatId, silent) {
    var bodyEl = document.getElementById("ahm-chat-body");
    if (!bodyEl) return;
    if (!silent) bodyEl.innerHTML = `<div id="ahm-chat-empty">Loading…</div>`;
    var msgs = null;
    if (signedIn && sb) {
      var { data, error } = await sb
        .from("chat_messages").select("*")
        .eq("chat_id", chatId).order("created_at", { ascending: true });
      if (!error) msgs = data;
    } else {
      var r = await callFn("thread", { action: "thread", chatId: chatId });
      if (r.status === "success") msgs = r.messages || [];
    }
    if (!msgs) {
      if (!silent) bodyEl.innerHTML = `<div id="ahm-chat-empty">Could not load messages.</div>`;
      return;
    }
    if (silent) {
      var added = false;
      msgs.forEach(function (m) {
        if (!seenIds[m.id]) {
          seenIds[m.id] = 1;
          addBubble({ sender: m.sender, body: m.body, created_at: m.created_at });
          added = true;
        }
      });
      if (added) bodyEl.scrollTop = bodyEl.scrollHeight;
      return;
    }
    seenIds = {};
    bodyEl.innerHTML = "";
    msgs.forEach(function (m) {
      seenIds[m.id] = 1;
      addBubble({ sender: m.sender, body: m.body, created_at: m.created_at });
    });
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function subscribe(chatId) {
    if (channel) { try { sb.removeChannel(channel); } catch {} }
    channel = null;
    if (!sb || !chatId) return;
    channel = sb
      .channel("chat-thread-" + chatId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: "chat_id=eq." + chatId }, function (payload) {
        var m = payload.new;
        addBubble({ sender: m.sender, body: m.body, created_at: m.created_at });
        if (m.sender === "admin") {
          var panel = document.getElementById("ahm-chat-panel");
          if (!panel || !panel.classList.contains("open")) setBadge(1 + getBadge());
        }
      })
      .subscribe();
  }

  function getBadge() {
    var b = document.getElementById("ahm-chat-badge");
    if (!b) return 0;
    var v = parseInt(b.textContent || "0", 10);
    return isNaN(v) ? 0 : v;
  }

  function setBadge(n) {
    var b = document.getElementById("ahm-chat-badge");
    if (!b) return;
    b.style.display = n > 0 ? "flex" : "none";
    b.textContent = n > 99 ? "99+" : n;
  }
  function refreshBadge(n) { setBadge(n); }

  async function sendMsg() {
    var field = document.getElementById("ahm-field");
    var send = document.getElementById("ahm-send");
    var text = (field.value || "").trim();
    if (!text) return;
    if (send) send.disabled = true;
    var r = await callFn("send", { action: "send", chatId: currentChat || null, body: text });
    if (send) send.disabled = false;
    if (r.status !== "success") {
      var note = document.getElementById("ahm-chat-note");
      if (note) note.textContent = r.message || "Could not send — try again.";
      setState("Could not send");
      return;
    }
    field.value = "";
    field.style.height = "auto";
    if (!currentChat && r.chatId) {
      currentChat = r.chatId;
      if (signedIn) subscribe(currentChat);
    }
    var m = r.message || { sender: "student", body: text, created_at: new Date().toISOString() };
    if (m.id) seenIds[m.id] = 1;
    addBubble({ sender: m.sender, body: m.body, created_at: m.created_at });
    setState("Sent — Ahmed will reply soon");
  }

  // ---------- contact form ----------
  function openContact() {
    var c = document.getElementById("ahm-contact");
    if (!c) return;
    c.classList.add("open");
    var name = document.getElementById("ahm-cname");
    var email = document.getElementById("ahm-cemail");
    try {
      if (signedIn && sb) {
        sb.auth.getUser().then(function ({ data }) {
          if (data && data.user) {
            if (name && !name.value) name.value = data.user.user_metadata && data.user.user_metadata.full_name || data.user.email || "";
            if (email && !email.value) email.value = data.user.email || "";
          }
        });
      } else if (guest) {
        if (name && !name.value) name.value = guest.name || "";
        if (email && !email.value) email.value = guest.email || "";
      }
    } catch {}
    var msg = document.getElementById("ahm-cmsg");
    if (msg) msg.focus();
  }

  function closeContact() {
    var c = document.getElementById("ahm-contact");
    if (c) c.classList.remove("open");
  }

  async function submitContact() {
    if (!CONTACT_FN) return;
    var name = (document.getElementById("ahm-cname").value || "").trim();
    var email = (document.getElementById("ahm-cemail").value || "").trim();
    var message = (document.getElementById("ahm-cmsg").value || "").trim();
    var err = document.getElementById("ahm-cerr");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (err) err.textContent = "Please enter a valid email.";
      document.getElementById("ahm-cemail").focus();
      return;
    }
    if (!message) {
      if (err) err.textContent = "Please write a short message.";
      document.getElementById("ahm-cmsg").focus();
      return;
    }
    var btn = document.getElementById("ahm-csend");
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    try {
      var res = await fetch(CONTACT_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, email: email, message: message }),
      });
      var out = await res.json().catch(function () { return {}; });
      if (res.ok && out.status === "success") {
        var form = document.getElementById("ahm-cform");
        var done = document.getElementById("ahm-cdone");
        if (form) form.style.display = "none";
        if (done) {
          done.style.display = "block";
          done.innerHTML = `<div class="ahm-cok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" style="width:22px;height:22px;color:var(--c-accent,#0b3b2c)"><path d="M20 6 9 17l-5-5"/></svg><span>Request sent — Ahmed will get back to you shortly.</span></div>`;
        }
      } else {
        if (err) err.textContent = out.message || "Could not send — please try again.";
      }
    } catch {
      if (err) err.textContent = "Could not send — please try again.";
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Send request"; }
    }
  }

  // ---------- init ----------
  css();
  document.addEventListener("DOMContentLoaded", function () {
    build();
    ensureAuth().then(function () {
      // auto-open when the page was reached via a chat link
      if (window.location.hash && window.location.hash.toLowerCase().indexOf("chat") !== -1) {
        setTimeout(openChat, 500);
        return;
      }
      // keep the unread badge fresh in the background
      setInterval(function () {
        var panel = document.getElementById("ahm-chat-panel");
        if (!panel || panel.classList.contains("open")) return;
        ensureAuth().then(function () {
          if ((!signedIn && !guest)) return;
          callFn("chats", { action: "chats" }).then(function (r) {
            if (r.status === "success") {
              var total = (r.chats || []).reduce(function (n, c) { return n + (c.unread_student || 0); }, 0);
              setBadge(total);
            }
          });
        });
      }, 40000);
    });
  });
})();

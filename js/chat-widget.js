// ============================================================
// Ahmed English — Live Chat Widget (student-facing)
// ------------------------------------------------------------
// Floating chat bubble shown on public + student pages. Lets a
// signed-in student message Ahmed directly; replies come back
// live (Supabase Realtime) and the admin is notified by email.
//
// Requires: config.js, supabase-js CDN, supabase-client.js to be
// loaded first on the page (this script is included after them).
// ============================================================
(function () {
  var cfg = (window.APP_CONFIG && window.APP_CONFIG.booking) || {};
  var FN = cfg.chatUrl || "";
  if (!FN) return;

  var sb = null;
  var accessToken = "";
  var myId = null;
  var myRole = "student";
  var currentChat = null;
  var channel = null;

  var OPEN_KEY = "ahm-chat-open";

  var ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:26px;height:26px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var CLOSE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" style="width:22px;height:22px;"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

  function css() {
    var s = document.createElement("style");
    s.textContent = `
#ahm-chat-root{position:fixed;bottom:22px;right:22px;z-index:9999;font-family:Arial,Helvetica,sans-serif}
#ahm-chat-fab{width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;background:#0b3b2c;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(11,59,44,.35);transition:transform .15s ease}
#ahm-chat-fab:hover{transform:scale(1.06)}
#ahm-chat-badge{position:absolute;top:-4px;right:-4px;min-width:22px;height:22px;border-radius:22px;background:#e5484d;color:#fff;font-size:.72rem;font-weight:800;display:none;align-items:center;justify-content:center;padding:0 6px;border:2px solid #fff}
#ahm-chat-panel{position:fixed;bottom:92px;right:22px;width:min(360px,calc(100vw - 32px));max-height:min(540px,calc(100vh - 130px));background:#fff;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.22);display:none;flex-direction:column;overflow:hidden}
#ahm-chat-panel.open{display:flex}
#ahm-chat-head{background:#0b3b2c;color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}
#ahm-chat-head .ahm-avatar{width:34px;height:34px;border-radius:50%;background:#fff;color:#0b3b2c;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:.95rem}
#ahm-chat-head .ahm-name{font-weight:800;font-size:.95rem}
#ahm-chat-head .ahm-status{font-size:.72rem;opacity:.85}
#ahm-chat-close{flex:0 0 auto;margin-left:auto;background:rgba(255,255,255,.16);border:none;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;padding:0;transition:background .15s}
#ahm-chat-close:hover{background:rgba(255,255,255,.32)}
#ahm-chat-body{flex:1;overflow-y:auto;padding:14px;min-height:160px;background:#f8fafb;display:flex;flex-direction:column;gap:8px}
#ahm-chat-msg{display:flex;flex-direction:column;gap:2px;max-width:82%}
#ahm-chat-msg.s{align-self:flex-end;align-items:flex-end}
#ahm-chat-msg.a{align-self:flex-start;align-items:flex-start}
#ahm-chat-msg .bubble{padding:9px 12px;border-radius:14px;font-size:.86rem;line-height:1.45;color:#111;white-space:pre-wrap;word-break:break-word}
#ahm-chat-msg.s .bubble{background:#0b3b2c;color:#fff;border-bottom-right-radius:4px}
#ahm-chat-msg.a .bubble{background:#fff;border:1px solid #e2e5e9;border-bottom-left-radius:4px}
#ahm-chat-msg .t{font-size:.66rem;color:#9ca3af}
#ahm-chat-empty{color:#9ca3af;font-size:.85rem;text-align:center;padding:30px 12px}
#ahm-chat-cta{color:#111;font-size:.88rem;text-align:center;padding:24px 12px}
#ahm-chat-cta a{color:#0b3b2c;font-weight:800;text-decoration:none}
#ahm-chat-input{display:flex;gap:8px;padding:10px;border-top:1px solid #eef0f2;background:#fff}
#ahm-chat-input textarea{flex:1;resize:none;border:1px solid #dfe3e8;border-radius:10px;padding:9px 12px;font-size:.86rem;font-family:inherit;outline:none;line-height:1.4;max-height:90px}
#ahm-chat-input textarea:focus{border-color:#0b3b2c}
#ahm-chat-send{background:#0b3b2c;color:#fff;border:none;border-radius:10px;width:48px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.1rem}
#ahm-chat-send:disabled{opacity:.5;cursor:default}
#ahm-chat-note{padding:6px 14px;font-size:.68rem;color:#9ca3af;background:#fff;text-align:center}
@media (max-width:520px){#ahm-chat-panel{right:12px;bottom:82px;width:calc(100vw - 24px)}
#ahm-chat-root{bottom:16px;right:12px}}
`;
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
      <div id="ahm-chat-panel">
        <div id="ahm-chat-head">
          <div class="ahm-avatar">A</div>
          <div style="flex:1;">
            <div class="ahm-name">Ahmed English</div>
            <div class="ahm-status" id="ahm-state">Connecting…</div>
          </div>
          <button id="ahm-chat-close" title="Close chat" aria-label="Close chat">${CLOSE_SVG}</button>
        </div>
        <div id="ahm-chat-body"></div>
        <div id="ahm-chat-note">Messages go straight to Ahmed's inbox</div>
        <div id="ahm-chat-input">
          <textarea id="ahm-field" placeholder="Type your message…" rows="1"></textarea>
          <button id="ahm-send" title="Send">&rarr;</button>
        </div>
      </div>
      <button id="ahm-chat-fab" title="Chat with Ahmed">${ICON_SVG}<span id="ahm-chat-badge">0</span></button>`;
    document.body.appendChild(root);

    var panel = document.getElementById("ahm-chat-panel");
    var fab = document.getElementById("ahm-chat-fab");
    var badge = document.getElementById("ahm-chat-badge");

    fab.addEventListener("click", function () {
      if (panel.classList.contains("open")) close(); else open();
    });

    var closeBtn = document.getElementById("ahm-chat-close");
    if (closeBtn) closeBtn.addEventListener("click", close);

    var field = document.getElementById("ahm-field");
    var send = document.getElementById("ahm-send");

    function autosize() {
      field.style.height = "auto";
      field.style.height = Math.min(field.scrollHeight, 90) + "px";
    }
    field.addEventListener("input", autosize);
    field.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); }
    });
    send.addEventListener("click", sendMsg);

    function close() {
      panel.classList.remove("open");
      setFab(true);
      if (localStorage) localStorage.setItem(OPEN_KEY, "0");
    }
    function open() {
      panel.classList.add("open");
      setFab(false);
      if (localStorage) localStorage.setItem(OPEN_KEY, "1");
      refreshBadge(0);
      loadChat();
    }
    window.__ahmCloseChat = close;
    return { panel, badge };
  }

  function setFab(show) {
    var fab = document.getElementById("ahm-chat-fab");
    if (!fab) return;
    if (show) { fab.style.display = "flex"; } else { fab.style.display = "none"; }
  }

  function addBubble(msg) {
    var bodyEl = document.getElementById("ahm-chat-body");
    if (!bodyEl) return;
    var sender = msg.sender === "admin" ? "a" : "s";
    var mine = sender === "s" && +msg.sender_is_me === 1;
    var node = el(`<div id="ahm-chat-msg" class="${mine ? "s" : "a"}"><div class="bubble">${esc(msg.body)}</div><div class="t">${fmtTime(msg.created_at)}</div></div>`);
    bodyEl.appendChild(node);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function setState(t) {
    var s = document.getElementById("ahm-state");
    if (s) s.textContent = t;
  }

  async function ensureAuth() {
    sb = getSupabase ? getSupabase() : null;
    if (!sb) return false;
    try {
      var { data } = await sb.auth.getUser();
      if (!data || !data.user) return false;
      myId = data.user.id;
      var { data: { session } } = await sb.auth.getSession();
      accessToken = session && session.access_token ? session.access_token : "";
      if (!accessToken) return false;
      return true;
    } catch { return false; }
  }

  async function callFn(path, options) {
    try {
      var res = await fetch(FN + path, {
        ...options,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken, ...(options.headers || {}) },
      });
      return await res.json();
    } catch (e) { return { status: "error", message: e && e.message }; }
  }

  async function loadChat() {
    var bodyEl = document.getElementById("ahm-chat-body");
    var input = document.getElementById("ahm-chat-input");
    if (!bodyEl) return;

    if (!(await ensureAuth())) {
      setState("Student sign-in required");
      bodyEl.innerHTML = `<div id="ahm-chat-cta">Please <a href="login.html">sign in</a> to chat with Ahmed.<br><span style="font-size:.8rem;color:#9ca3af;">New students: create a free account.</span></div>`;
      if (input) input.style.display = "none";
      return;
    }
    if (input) input.style.display = "flex";

    var r = await callFn("?action=chats", { method: "GET" });
    if (r.status !== "success") {
      setState("Could not load chat");
      bodyEl.innerHTML = `<div id="ahm-chat-empty">${esc(r.message || "Could not load chat.")}</div>`;
      return;
    }
    var chats = r.chats || [];
    var unreadTotal = chats.reduce(function (n, c) { return n + (c.unread_student || 0); }, 0);
    setBadge(unreadTotal);

    var target = chats.length ? chats[0] : null;
    currentChat = target ? target.id : null;
    bodyEl.innerHTML = "";
    if (!target) {
      setState("Send a message to Ahmed");
      bodyEl.innerHTML = `<div id="ahm-chat-empty">Hi! Send a message below and Ahmed will get back to you.</div>`;
      return;
    }
    setState("Ahmed typically replies within a day");

    // existing thread
    await openThread(target.id);
  }

  async function openThread(chatId) {
    var bodyEl = document.getElementById("ahm-chat-body");
    bodyEl.innerHTML = `<div id="ahm-chat-empty">Loading…</div>`;
    var { data: msgs, error } = await sb
      .from("chat_messages").select("*")
      .eq("chat_id", chatId).order("created_at", { ascending: true });
    if (error) {
      bodyEl.innerHTML = `<div id="ahm-chat-empty">Could not load messages.</div>`;
      return;
    }
    bodyEl.innerHTML = "";
    (msgs || []).forEach(function (m) {
      addBubble({ sender: m.sender, body: m.body, created_at: m.created_at });
    });

    // live subscription
    subscribe(chatId);

    // mark read (student side)
    await callFn("", { method: "POST", body: JSON.stringify({ action: "read", chatId }) });
    // re-query unread for badge accuracy
    var r2 = await callFn("?action=chats", { method: "GET" });
    if (r2.status === "success") {
      var total = (r2.chats || []).reduce(function (n, c) { return n + (c.unread_student || 0); }, 0);
      setBadge(total);
    }
  }

  function subscribe(chatId) {
    if (channel) { try { sb.removeChannel(channel); } catch {} }
    channel = null;
    if (!sb || !chatId) return;
    channel = sb
      .channel("chat-thread-" + chatId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: "chat_id=eq." + chatId }, function (payload) {
        var m = payload.new;
        if ((m.sender === "admin") || (m.sender === "student")) {
          addBubble({ sender: m.sender, body: m.body, created_at: m.created_at });
          if (m.sender === "admin" && !document.getElementById("ahm-chat-panel").classList.contains("open")) {
            setBadge(1 + getBadge());
          }
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
    var r = await callFn("", { method: "POST", body: JSON.stringify({ action: "send", chatId: currentChat || null, body: text }) });
    if (send) send.disabled = false;
    if (r.status !== "success") {
      setState("Could not send");
      var note = document.getElementById("ahm-chat-note");
      if (note) note.textContent = r.message || "Could not send — try again.";
      return;
    }
    field.value = "";
    field.style.height = "auto";
    if (!currentChat && r.chatId) {
      currentChat = r.chatId;
      subscribe(currentChat);
    }
    var m = r.message || { sender: "student", body: text, created_at: new Date().toISOString() };
    addBubble({ sender: m.sender, body: m.body, created_at: m.created_at });
    setState("Sent — Ahmed will reply soon");
  }

  css();

  document.addEventListener("DOMContentLoaded", function () {
    build();
    // auto-open if the page was reached via an email/chat link
    if (window.location.hash && window.location.hash.toLowerCase().indexOf("chat") !== -1) {
      var p = document.getElementById("ahm-chat-panel");
      if (p) setTimeout(function () {
        p.classList.add("open");
        setFab(false);
      }, 500);
    }
    // periodic unread refresh while not open
    setInterval(function () {
      var p = document.getElementById("ahm-chat-panel");
      if (p && !p.classList.contains("open")) {
        ensureAuth().then(function (ok) {
          if (!ok) return;
          callFn("?action=chats", { method: "GET" }).then(function (r) {
            if (r.status === "success") {
              var total = (r.chats || []).reduce(function (n, c) { return n + (c.unread_student || 0); }, 0);
              setBadge(total);
            }
          });
        });
      }
    }, 40000);
  });
})();
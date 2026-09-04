// ============================================================
// TutorEnglishPro — AdSense slots + visitor tracking
// ------------------------------------------------------------
// Reads ad settings with priority:
//   1. localStorage['ahm_ads']  (set by the Dashboard → Ads control tab)
//   2. window.APP_CONFIG.adsense (defaults in js/config.js)
//
// Renders each [data-ad-zone] container as a real AdSense unit when
// the zone+client are configured and enabled, or hides it entirely
// (no placeholder box / "Advertisements" label) otherwise. Visitor
// page views are logged to Supabase (best effort) when tracking is on.
// ============================================================
(function () {
  var SB = (window.APP_CONFIG && window.APP_CONFIG.supabase) || {};
  var DEFAULTS = (window.APP_CONFIG && window.APP_CONFIG.adsense) || {};

  var KEY = "ahm_ads";

  function settings() {
    var s = {
      client: DEFAULTS.client || "",
      slots: DEFAULTS.slots || {},
      code: DEFAULTS.code || {},
      zones: DEFAULTS.zones || {},
      tracking: DEFAULTS.tracking !== false
    };
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && typeof saved === "object") {
        if (typeof saved.client === "string") s.client = saved.client;
        if (saved.slots) for (var k in saved.slots) if (saved.slots[k]) s.slots[k] = saved.slots[k];
        if (saved.code) for (var c in saved.code) if (saved.code[c]) s.code[c] = saved.code[c];
        if (saved.zones) for (var z in saved.zones) if (typeof saved.zones[z] === "boolean") s.zones[z] = saved.zones[z];
        if (typeof saved.tracking === "boolean") s.tracking = saved.tracking;
      }
    } catch (e) {}
    return s;
  }
  var cfg = settings();

  var slug = "ca-pub-" + (cfg.client || "");

  // Re-run any <script> tags so pasted AdSense/tracking code actually executes.
  function runScripts(container) {
    var scripts = container.querySelectorAll("script");
    for (var i = 0; i < scripts.length; i++) {
      var sc = scripts[i];
      var n = document.createElement("script");
      if (sc.src) n.src = sc.src;
      if (sc.innerHTML) n.innerHTML = sc.innerHTML;
      n.async = sc.async || true;
      if (sc.parentNode) sc.parentNode.replaceChild(n, sc);
    }
  }

  function renderZone(el) {
    var zone = el.getAttribute("data-ad-zone") || "banner";
    var enabled = cfg.zones[zone] === true;
    var custom = ((cfg.code && cfg.code[zone]) || "").trim();
    var slot = cfg.slots[zone] || "";

    el.classList.remove("ad-placeholder", "ad-rendered");

    // 1) WordPress-style: pasted raw ad code takes priority for this zone
    if (custom) {
      el.innerHTML = custom;
      runScripts(el);
      el.classList.add("ad-rendered");
      if (window.adsbygoogle) {
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
      }
      return;
    }

    // 2) Managed AdSense unit (client + slot)
    if (enabled && cfg.client && slot) {
      el.innerHTML =
        '<ins class="adsbygoogle" style="display:block" ' +
        'data-ad-client="' + slug + '" ' +
        'data-ad-slot="' + slot + '" ' +
        'data-ad-format="auto" data-full-width-responsive="true"></ins>';
      el.classList.add("ad-rendered");
      if (window.adsbygoogle) {
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
      }
      return;
    }

    // 3) Off / not fully configured → hide the area entirely
    //    (no "Advertisements" label or empty box should ever appear on the site)
    el.innerHTML = "";
    el.style.display = "none";
  }

  function mount() {
    // find any AdSense client id referenced across zones (managed or custom code)
    var clientId = cfg.client || "";
    var zones = document.querySelectorAll("[data-ad-zone]");
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i].getAttribute("data-ad-zone") || "banner";
      var c = ((cfg.code && cfg.code[z]) || "");
      if (!clientId && c.indexOf("data-ad-client=") !== -1) {
        var m = c.match(/data-ad-client\s*=\s*["']?(ca-pub-[^"'\s>]+)/);
        if (m) clientId = m[1];
      }
    }

    if (clientId) {
      if (!document.getElementById("adsbygoogle-loader") && !window.adsbygoogle) {
        var s = document.createElement("script");
        s.id = "adsbygoogle-loader";
        s.async = true;
        s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(clientId);
        s.crossOrigin = "anonymous";
        document.head.appendChild(s);
      }
    }

    for (var j = 0; j < zones.length; j++) renderZone(zones[j]);
  }

  function track() {
    if (!cfg.tracking) return;
    if (!SB.url || !SB.anonKey) return;
    try {
      var url = SB.url.replace(/\/$/, "");
      var row = {
        path: location.pathname + location.search,
        title: document.title ? document.title.replace(/\s*-\s*TutorEnglishPro.*$/i, '').trim() : "",
        referrer: document.referrer || "",
        created_at: new Date().toISOString()
      };
      fetch(url + "/rest/v1/visitor_views", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SB.anonKey,
          "Authorization": "Bearer " + SB.anonKey,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify(row)
      }).catch(function () {});
    } catch (e) {}
  }

  function expose() {
    window.__ahmAds = {
      get: settings,
      save: function (next) {
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { mount(); track(); expose(); });
  } else {
    mount(); track(); expose();
  }
})();

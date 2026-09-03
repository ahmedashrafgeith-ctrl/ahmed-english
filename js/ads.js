// ============================================================
// TutorEnglishPro — AdSense slots + visitor tracking
// ------------------------------------------------------------
// Reads ad settings with priority:
//   1. localStorage['ahm_ads']  (set by the Dashboard → Ads control tab)
//   2. window.APP_CONFIG.adsense (defaults in js/config.js)
//
// Renders each [data-ad-zone] container as a real AdSense unit when
// the zone+client are configured and enabled, or as a labeled
// "Advertisements" placeholder otherwise. Visitor page views are
// logged to Supabase (best effort) when tracking is on.
// ============================================================
(function () {
  var SB = (window.APP_CONFIG && window.APP_CONFIG.supabase) || {};
  var DEFAULTS = (window.APP_CONFIG && window.APP_CONFIG.adsense) || {};

  var KEY = "ahm_ads";

  function settings() {
    var s = {
      client: DEFAULTS.client || "",
      slots: DEFAULTS.slots || {},
      zones: DEFAULTS.zones || {},
      tracking: DEFAULTS.tracking !== false
    };
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && typeof saved === "object") {
        if (typeof saved.client === "string") s.client = saved.client;
        if (saved.slots) for (var k in saved.slots) if (saved.slots[k]) s.slots[k] = saved.slots[k];
        if (saved.zones) for (var z in saved.zones) if (typeof saved.zones[z] === "boolean") s.zones[z] = saved.zones[z];
        if (typeof saved.tracking === "boolean") s.tracking = saved.tracking;
      }
    } catch (e) {}
    return s;
  }
  var cfg = settings();

  var slug = "ca-pub-" + (cfg.client || "");

  function renderZone(el) {
    var zone = el.getAttribute("data-ad-zone") || "banner";
    var enabled = cfg.zones[zone] === true;
    var slot = cfg.slots[zone] || "";
    var useAd = enabled && cfg.client && slot;

    if (useAd) {
      el.innerHTML =
        '<ins class="adsbygoogle" style="display:block" ' +
        'data-ad-client="' + slug + '" ' +
        'data-ad-slot="' + slot + '" ' +
        'data-ad-format="auto" data-full-width-responsive="true"></ins>';
      if (window.adsbygoogle) {
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
      }
    } else {
      el.classList.add("ad-placeholder");
      el.innerHTML =
        '<div class="ad-ph"><span>Advertisements</span></div>';
    }
  }

  function mount() {
    if (cfg.client) {
      if (!document.getElementById("adsbygoogle-loader") && !window.adsbygoogle) {
        var s = document.createElement("script");
        s.id = "adsbygoogle-loader";
        s.async = true;
        s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(slug);
        s.crossOrigin = "anonymous";
        document.head.appendChild(s);
      } else if (window.adsbygoogle) {
        // loader present
      }
    }

    var zones = document.querySelectorAll("[data-ad-zone]");
    for (var i = 0; i < zones.length; i++) renderZone(zones[i]);
  }

  function track() {
    if (!cfg.tracking) return;
    if (!SB.url || !SB.anonKey) return;
    try {
      var url = SB.url.replace(/\/$/, "");
      var row = {
        path: location.pathname + location.search,
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

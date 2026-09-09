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

  function validFormat(v) {
    return v === "horizontal" || v === "vertical" || v === "rectangle" || v === "fluid" ? v : "auto";
  }

  function settings() {
    var s = {
      client: DEFAULTS.client || "",
      slots: DEFAULTS.slots || {},
      code: DEFAULTS.code || {},
      zones: DEFAULTS.zones || {},
      formats: DEFAULTS.formats || {},
      auto: DEFAULTS.auto !== false,
      tracking: DEFAULTS.tracking !== false
    };
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && typeof saved === "object") {
        if (typeof saved.client === "string") s.client = saved.client;
        if (saved.slots) for (var k in saved.slots) if (saved.slots[k]) s.slots[k] = saved.slots[k];
        if (saved.code) for (var c in saved.code) if (saved.code[c]) s.code[c] = saved.code[c];
        if (saved.zones) for (var z in saved.zones) if (typeof saved.zones[z] === "boolean") s.zones[z] = saved.zones[z];
        if (saved.formats) for (var f in saved.formats) if (validFormat(saved.formats[f])) s.formats[f] = saved.formats[f];
        if (typeof saved.auto === "boolean") s.auto = saved.auto;
        if (typeof saved.tracking === "boolean") s.tracking = saved.tracking;
      }
    } catch (e) {}
    return s;
  }
  var cfg = settings();
  var autoActivated = false;

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
      var fmt = validFormat(cfg.formats[zone]);
      el.innerHTML =
        '<ins class="adsbygoogle" style="display:block" ' +
        'data-ad-client="' + slug + '" ' +
        'data-ad-slot="' + slot + '" ' +
        'data-ad-format="' + fmt + '" data-full-width-responsive="true"></ins>';
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
      // The AdSense loader may already be on the page (either the one a page
      // author pasted in <head>, or one we injected). Only inject when neither
      // an existing loader <script> nor the loaded adsbygoogle global is present.
      var hasLoader = document.getElementById("adsbygoogle-loader") ||
        document.querySelector('script[src*="adsbygoogle.js"], script[id="adsbygoogle-loader"]');
      if (!hasLoader && !window.adsbygoogle) {
        var s = document.createElement("script");
        s.id = "adsbygoogle-loader";
        s.async = true;
        s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(clientId);
        s.crossOrigin = "anonymous";
        document.head.appendChild(s);
      }
      // Google Auto ads (dashboard: AdSense -> Settings -> Auto ads): with the
      // loader present, this canonical push makes AdSense auto-place its units
      // across the page based on the account's Auto ads selections. It does not
      // create manual <ins> units, so slot-based zones below still work as before.
      if (cfg.auto !== false && !autoActivated) {
        autoActivated = true;
        try { (window.adsbygoogle = window.adsbygoogle || []).push({ google_enable_auto_ads: true }); } catch (e) {}
      }
    }

    for (var j = 0; j < zones.length; j++) renderZone(zones[j]);
  }

  // Best-effort device fingerprint: no cookies, works from the browser only.
  function uaInfo() {
    var ua = navigator.userAgent || "";
    var browser = "Other";
    if (/Edg\//.test(ua)) browser = "Edge";
    else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
    else if (/SamsungBrowser/.test(ua)) browser = "Samsung Internet";
    else if (/Firefox\//.test(ua)) browser = "Firefox";
    else if (/Chrome\/|CriOS\//.test(ua)) browser = "Chrome";
    else if (/Safari\//.test(ua)) browser = "Safari";
    var os = "Other";
    if (/Windows/.test(ua)) os = "Windows";
    else if (/Android/.test(ua)) os = "Android";
    else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
    else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
    else if (/Linux/.test(ua)) os = "Linux";
    else if (/CrOS/.test(ua)) os = "Chrome OS";
    var device = "desktop";
    if (/Mobi|Android|iPhone|iPod/.test(ua)) device = "mobile";
    else if (/iPad|Tablet|Silk/.test(ua)) device = "tablet";
    else if (navigator.platform && /Mac|Win|Linux/.test(navigator.platform) && "ontouchstart" in window) device = "tablet";
    var country = "Unknown";
    try {
      var tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || "").toUpperCase();
      var c = tzMatch(tz);
      if (!c) {
        var lang = (navigator.language || "");
        var ll = lang.split("-")[1] || lang.split("_")[1] || "";
        if (/^[A-Z]{2}$/.test(ll)) c = ll;
      }
      if (c) country = c;
    } catch (e) {}
    return {
      device: device,
      browser: browser,
      os: os,
      country: country,
      screen: (screen.width || 0) + "x" + (screen.height || 0)
    };
  }

  function tzMatch(tz) {
    var known = {
      "AFRICA/CAIRO":"EG","AFRICA/JOHANNESBURG":"ZA","AFRICA/LAGOS":"NG","AFRICA/NAIROBI":"KE",
      "AFRICA/CASABLANCA":"MA","AFRICA/ABIDJAN":"CI","AFRICA/ALGIERS":"DZ","AFRICA/ACCRA":"GH","AFRICA/TUNIS":"TN",
      "ASIA/KOLKATA":"IN","ASIA/DUBAI":"AE","ASIA/KARACHI":"PK","ASIA/DHAKA":"BD","ASIA/RIYADH":"SA",
      "ASIA/SINGAPORE":"SG","ASIA/KUALA_LUMPUR":"MY","ASIA/JAKARTA":"ID","ASIA/BANGKOK":"TH","ASIA/HO_CHI_MINH":"VN",
      "ASIA/MANILA":"PH","ASIA/SHANGHAI":"CN","ASIA/HONG_KONG":"HK","ASIA/TAIPEI":"TW","ASIA/TOKYO":"JP",
      "ASIA/SEOUL":"KR","ASIA/BEIRUT":"LB","ASIA/AMMAN":"JO","ASIA/KUWAIT":"KW","ASIA/QATAR":"QA",
      "ASIA/BAGHDAD":"IQ","ASIA/ISTANBUL":"TR","ASIA/TEL_AVIV":"IL","ASIA/COLOMBO":"LK","ASIA/KATHMANDU":"NP",
      "ASIA/RANGOON":"MM","ASIA/PHNOM_PENH":"KH","ASIA/TASHKENT":"UZ","ASIA/ALMATY":"KZ","ASIA/TBILISI":"GE", 
      "AMERICA/NEW_YORK":"US","AMERICA/CHICAGO":"US","AMERICA/LOS_ANGELES":"US","AMERICA/DENVER":"US",
      "AMERICA/PHOENIX":"US","AMERICA/ANCHORAGE":"US","AMERICA/HONOLULU":"US","AMERICA/TORONTO":"CA",
      "AMERICA/VANCOUVER":"CA","AMERICA/MEXICO_CITY":"MX","AMERICA/BOGOTA":"CO","AMERICA/LIMA":"PE",
      "AMERICA/SANTIAGO":"CL","AMERICA/BUENOS_AIRES":"AR","AMERICA/SAO_PAULO":"BR","AMERICA/CARACAS":"VE",
      "AMERICA/LA_PAZ":"BO","AMERICA/GUAYAQUIL":"EC","AMERICA/MANAGUA":"NI","AMERICA/GUATEMALA":"GT",
      "EUROPE/LONDON":"GB","EUROPE/PARIS":"FR","EUROPE/BERLIN":"DE","EUROPE/MADRID":"ES","EUROPE/LISBON":"PT",
      "EUROPE/ROME":"IT","EUROPE/AMSTERDAM":"NL","EUROPE/BRUSSELS":"BE","EUROPE/ZURICH":"CH","EUROPE/VIENNA":"AT",
      "EUROPE/STOCKHOLM":"SE","EUROPE/OSLO":"NO","EUROPE/COPENHAGEN":"DK","EUROPE/HELSINKI":"FI",
      "EUROPE/PRAGUE":"CZ","EUROPE/WARSAW":"PL","EUROPE/BUDAPEST":"HU","EUROPE/BUCHAREST":"RO",
      "EUROPE/ATHENS":"GR","EUROPE/DUBLIN":"IE","EUROPE/KYIV":"UA","EUROPE/MOSCOW":"RU",
      "AUSTRALIA/SYDNEY":"AU","AUSTRALIA/MELBOURNE":"AU","AUSTRALIA/BRISBANE":"AU","AUSTRALIA/PERTH":"AU",
      "PACIFIC/AUCKLAND":"NZ","PACIFIC/FIJI":"FJ"
    };
    return known[tz] || "";
  }

  var post = function (payload) {
    fetch(SB.url.replace(/\/$/, "") + "/rest/v1/visitor_views", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SB.anonKey,
        "Authorization": "Bearer " + SB.anonKey,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(payload)
    }).catch(function () {});
  };

  function track() {
    if (!cfg.tracking) return;
    if (!SB.url || !SB.anonKey) return;
    try {
      var info = uaInfo();
      var row = {
        path: location.pathname + location.search,
        referrer: document.referrer || "",
        title: (document.title || "").replace(/\s*-\s*TutorEnglishPro.*$/i, "").trim(),
        device: info.device,
        browser: info.browser,
        os: info.os,
        country: info.country,
        screen: info.screen,
        created_at: new Date().toISOString()
      };
      // Requires: ALTER TABLE visitor_views ADD COLUMN IF NOT EXISTS title text;
      // and the device/browser/os/country/screen columns (see supabase-visitor-views.sql).
      // If the migration isn't applied yet, retry on 400 with fewer columns so the
      // POST still succeeds with no console errors.
      fetch(SB.url.replace(/\/$/, "") + "/rest/v1/visitor_views", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SB.anonKey,
          "Authorization": "Bearer " + SB.anonKey,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify(row)
      }).then(function (res) {
        if (res.status !== 400) return;
        post({ path: row.path, referrer: row.referrer, title: row.title, created_at: row.created_at })
          .then(function (r2) {
            if (r2 && r2.status === 400) {
              post({ path: row.path, created_at: row.created_at });
            }
          });
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

(function () {
  var SECRET = 'AHMEDENC2026!';

  function b64decode(str) {
    if (typeof atob === 'function') return atob(str);
    var bin = '';
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    str = str.replace(/=+$/, '');
    for (var i = 0; i < str.length; i += 4) {
      var c1 = chars.indexOf(str[i]);
      var c2 = chars.indexOf(str[i + 1]);
      var c3 = chars.indexOf(str[i + 2]);
      var c4 = chars.indexOf(str[i + 3]);
      bin += String.fromCharCode((c1 << 2) | (c2 >> 4));
      if (c3 !== -1) bin += String.fromCharCode(((c2 & 15) << 4) | (c3 >> 2));
      if (c4 !== -1) bin += String.fromCharCode(((c3 & 3) << 6) | c4);
    }
    return bin;
  }

  function decode(enc) {
    var key = [];
    for (var j = 0; j < SECRET.length; j++) key.push(SECRET.charCodeAt(j));
    var raw = b64decode(enc);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      out.push(String.fromCharCode(raw.charCodeAt(i) ^ key[i % key.length]));
    }
    return out.join('');
  }

  var SUPABASE_URL = decode('KTw5NTd/YWxVV1VMSCQ/NCA1NiA2W0hFXlcuLWM2MTUvIVNDVxhCLg==');
  var SUPABASE_KEY = decode('JDEHLSYCLSp9WXh/dDsBfAstDD0KXGIHVWIIfgQuNB0YAHgJHFNYCzgudgksASp4SlZuYykRIAM+Hx0KQXlcfE0bIQRzDSgqLWgDQkZ7GSx4HxwDNCFcZkJTaSUnKSh9KQcqRVlRWxgyEh4McgwjBUdSAAJIDQsHNR0dHyp9WncFbgUrNAoQEDcMdltBf0wXfC4GDXMDKXdHf1xGcgUZDHAKFnMcSXBybjV6YCQQDngHSEZ5AGYxOzgoFR17LWh9VwJoAj8cMQYoGSJASEtlbA==');

  window.APP_CONFIG = {
    supabase: {
      url: SUPABASE_URL,
      anonKey: SUPABASE_KEY
    },
    cal: {
      base: "https://cal.com",
      username: "ahmed-ghaith-fbjoax",
      trialEvent: "30min-trial",
      lessonEvent: "30min",
      lessonEvent60: "60min",
      dashboardUrl: "https://cal.com/ahmed-ghaith-fbjoax"
    },
    stripe: {
      starterPaymentLink: "https://book.stripe.com/5kQaEW6WKeUi3J51hKgrS09",
      progressPaymentLink: "https://book.stripe.com/cNieVcch43bAgvR4tWgrS0a",
      intensivePaymentLink: "https://book.stripe.com/cNi8wO94SeUi0wT6C4grS0b",
      dashboardUrl: "https://dashboard.stripe.com"
    },
    booking: {
      // Non-secret booking config. CAL_API_KEY lives only in the Supabase
      // Edge Function secrets, never here (it must not be exposed publicly).
      username: "ahmed-ghaith-fbjoax",
      evtTrial: "30min-trial",
      evt30: "30min",
      evt60: "60min",
      durationMinutes: { "30min-trial": 30, "30min": 30, "60min": 60 },
      functionUrl: "https://gggziewyeqsnuixwhvoe.supabase.co/functions/v1/book-lesson",
      chatUrl: "https://gggziewyeqsnuixwhvoe.supabase.co/functions/v1/chat",
      contactUrl: "https://gggziewyeqsnuixwhvoe.supabase.co/functions/v1/contact"
    },
    story: {},
    adsense: {
      // Owner can paste these here OR via the Dashboard → Ads control tab.
      // Left empty → a labeled "Advertisements" placeholder box is shown.
      client: "",
      // per-zone slot ids (types & locations):
      // { banner(header), in-content(in article), in-article(article body), sidebar, footer, mobile }
      slots: { banner: "", "in-content": "", "in-article": "", sidebar: "", footer: "", mobile: "" },
      // zones turned on by default (boolean)
      zones: { banner: false, "in-content": false, "in-article": false, sidebar: false, footer: false, mobile: false },
      // visitor tracking on/off
      tracking: true
    },
    drive: "https://drive.google.com",
    contactEmail: "ahmedashrafgeith@gmail.com"
  };
})();

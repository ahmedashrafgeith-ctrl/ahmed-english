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
      starterPaymentLink: "https://book.stripe.com/5kQ14mch4eUibbxgcEgrS06",
      progressPaymentLink: "https://book.stripe.com/6oUfZgepc8vUcfB1hKgrS07",
      intensivePaymentLink: "https://book.stripe.com/00w00i4OC5jIcfBd0sgrS08",
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
      functionUrl: "https://gggziewyeqsnuixwhvoe.supabase.co/functions/v1/book-lesson"
    },
    drive: "https://drive.google.com",
    contactEmail: "contact@ahmedenglish.com"
  };
})();

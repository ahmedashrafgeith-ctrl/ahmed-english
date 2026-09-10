(function () {
  'use strict';

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function cfg() {
    return (window.APP_CONFIG && APP_CONFIG.referral) || {};
  }

  function supabase() {
    return (window.APP_CONFIG && APP_CONFIG.supabase) || {};
  }

  function $(id) { return document.getElementById(id); }

  function setStatus(msg, cls, html) {
    var s = $('rl-status');
    if (!s) return;
    s.className = cls || '';
    s.innerHTML = html ? (html + ' ' + msg) : msg;
  }

  function markInvalid(input) {
    if (!input) return;
    input.classList.add('invalid-pending');
    input.addEventListener('input', function clear() {
      input.classList.remove('invalid-pending');
      input.removeEventListener('input', clear);
    }, { once: false });
  }

  function validate() {
    var v = {}, firstBad = null;
    var name = $('rf-rname'), rem = $('rf-remail'), fname = $('rf-fname'), fem = $('rf-femail'), rel = $('rf-rel');

    if (!name.value.trim()) { markInvalid(name); if (!firstBad) firstBad = name; }
    if (!EMAIL_RE.test(rem.value.trim())) { markInvalid(rem); if (!firstBad) firstBad = rem; }
    if (!fname.value.trim()) { markInvalid(fname); if (!firstBad) firstBad = fname; }
    if (!EMAIL_RE.test(fem.value.trim())) { markInvalid(fem); if (!firstBad) firstBad = fem; }

    if (firstBad) {
      setStatus('Please fill in the required fields (name, email and your friend\'s name and email).', 'rl-err');
      firstBad.focus();
      return null;
    }
    return {
      referrer_name: name.value.trim(),
      referrer_email: rem.value.trim().toLowerCase(),
      referrer_phone: ($('rf-rphone').value || '').trim() || null,
      friend_name: fname.value.trim(),
      friend_email: fem.value.trim().toLowerCase(),
      relationship: rel.value || '',
      message: ($('rf-msg').value || '').trim() || null,
      source: 'site'
    };
  }

  function postSheet(payload) {
    var url = cfg().sheetUrl;
    if (!url) return Promise.reject({ _fallback: true });
    // Apps Script Web App (deployed "Anyone"): returns CORS-enabled JSON.
    return fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('sheet http ' + r.status);
      return r;
    });
  }

  function postSupabase(payload) {
    var sb = supabase();
    if (!sb.url || !sb.anonKey) return Promise.reject(new Error('no supabase config'));
    return fetch(sb.url + '/rest/v1/referrals', {
      method: 'POST',
      headers: {
        'apikey': sb.anonKey,
        'Authorization': 'Bearer ' + sb.anonKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('db http ' + r.status);
    });
  }

  function submit(payload) {
    var btn = $('rf-submit');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    setStatus('Sending your referral…', 'rl-loading', '<b>One moment</b>');

    postSheet(payload).catch(function (err) {
      // No sheet URL configured, or the sheet endpoint failed -> also/write to Supabase.
      if (err && err._fallback === true) return postSupabase(payload);
      return postSupabase(payload).then(function () { return { _usedDb: true }; });
    }).then(function () {
      setStatus('Referral received! We\'ll email your friend a personal welcome from Ahmed.', 'rl-ok',
        '<b>Thank you!</b>');
      var form = $('referral-form');
      if (form) {
        form.reset();
        var focus = $('rf-fname');
        if (focus) focus.focus();
      }
    }).catch(function () {
      setStatus('Something went wrong. Please try again in a moment, or email ahmedashrafgeith@gmail.com.', 'rl-err');
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = 'Send referral';
    });
  }

  function init() {
    var form = $('referral-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var payload = validate();
      if (payload) submit(payload);
    });
    var clear = $('rf-clear');
    if (clear) {
      clear.addEventListener('click', function () {
        setStatus('', '');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
(function () {
  'use strict';

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var link = '';
  var shareMsg = '';

  function cfg() {
    return (window.APP_CONFIG && APP_CONFIG.referral) || {};
  }

  function supabase() {
    return (window.APP_CONFIG && APP_CONFIG.supabase) || {};
  }

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

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
    var name = $('rf-rname'), rem = $('rf-remail'), rphone = $('rf-rphone'), fname = $('rf-fname'), fem = $('rf-femail'), rel = $('rf-rel');

    if (!name.value.trim()) { markInvalid(name); if (!firstBad) firstBad = name; }
    if (!EMAIL_RE.test(rem.value.trim())) { markInvalid(rem); if (!firstBad) firstBad = rem; }
    if (!rphone.value.trim()) { markInvalid(rphone); if (!firstBad) firstBad = rphone; }
    if (!fname.value.trim()) { markInvalid(fname); if (!firstBad) firstBad = fname; }
    if (!EMAIL_RE.test(fem.value.trim())) { markInvalid(fem); if (!firstBad) firstBad = fem; }
    if (!rel.value) { markInvalid(rel); if (!firstBad) firstBad = rel; }

    if (firstBad) {
      setStatus('Please fill in every required field - your name, email, phone, your friend\'s name and email, and how you know them.', 'rl-err');
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
    btn.textContent = 'Sending...';
    setStatus('Sending your referral...', 'rl-loading', '<b>One moment</b>');

    postSheet(payload).catch(function (err) {
      // No sheet URL configured, or the sheet endpoint failed -> also/write to Supabase.
      if (err && err._fallback === true) return postSupabase(payload);
      return postSupabase(payload).then(function () { return { _usedDb: true }; });
    }).then(function () {
      setStatus('', '');
      var form = $('referral-form');
      var h3 = document.querySelector('.rl-grid');
      var thank = $('rl-thankyou');
      if (thank) {
        thank.style.display = 'block';
        var fn = $('rf-fname');
        var friendName = fn && fn.value.trim() ? fn.value.trim() : 'your friend';
        var tmsg = $('rl-thankyou-msg');
        if (tmsg) tmsg.innerHTML = '<b>Thank you!</b> Your referral for <b>' + esc(friendName) + '</b> is on its way - we\'ll email them a personal welcome from Ahmed. Share your personalized link below to refer more friends:';
        var thankLink = $('rl-thankyou-link');
        if (thankLink) thankLink.value = link;
        var thankWa = $('rl-thankyou-wa');
        if (thankWa) thankWa.setAttribute('href', 'https://wa.me/?text=' + encodeURIComponent(shareMsg));
        var thankCopy = $('rl-thankyou-copy');
        if (thankCopy) {
          thankCopy.addEventListener('click', function () {
            function doneC() { thankCopy.textContent = 'Copied!'; setTimeout(function () { thankCopy.textContent = 'Copy'; }, 2200); }
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(link).then(doneC, function () { fallbackCopy(link, doneC); });
            } else { fallbackCopy(link, doneC); }
          });
        }
      }
      if (form) form.reset();
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

    // share strip
    link = (cfg().url) || 'https://www.proenglishtutor.online/referral.html';
    try {
      var locQs = window.location.search;
      if (locQs && locQs.length > 1 && (locQs.indexOf('email=') !== -1 || locQs.indexOf('name=') !== -1)) {
        link = link.split('?')[0] + locQs;
      }
    } catch (e) {}
    shareMsg = 'I\'m learning English 1-on-1 with Ahmed at TutorEnglishPro. When you book your first lesson package we both get a free 30-minute lesson. Start with a free trial here: ' + link;
    var wa = $('ref-share-wa');
    if (wa) wa.setAttribute('href', 'https://wa.me/?text=' + encodeURIComponent(shareMsg));
    var mail = $('ref-share-mail');
    if (mail) mail.setAttribute('href', 'mailto:?subject=' + encodeURIComponent('Free trial English lesson with Ahmed') + '&body=' + encodeURIComponent(shareMsg));
    var copy = $('ref-share-copy');
    if (copy) {
      copy.addEventListener('click', function () {
        function done() { copy.textContent = 'Copied!'; setTimeout(function () { copy.textContent = 'Copy link'; }, 2200); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link).then(done, function () { fallbackCopy(link, done); });
        } else { fallbackCopy(link, done); }
      });
    }

    // Referral attribution: prefill referrer fields when the visitor arrived
    // via a student's personalized share link (?email=&name=).
    try {
      var params = new URLSearchParams(window.location.search);
      var refName = params.get('name');
      var refEmail = params.get('email');
      if (refName || refEmail) {
        var rem = $('rf-remail');
        var rname = $('rf-rname');
        if (rem && refEmail && EMAIL_RE.test(String(refEmail).trim())) rem.value = String(refEmail).trim();
        if (rname && refName) rname.value = String(refName).trim();
        var banner = $('rl-referred-banner');
        if (banner) {
          banner.style.display = 'block';
          banner.innerHTML = (refName
            ? '<b>' + esc(refName) + '</b> invited you to try a free lesson with Ahmed!'
            : 'You were invited by a friend who is already learning with Ahmed!') +
            ' Your name and email below are already filled in - just add your friend\'s details and send.';
          var gf = $('rf-fname');
          if (gf) setTimeout(function () { gf.focus(); }, 250);
        }
      }
    } catch (e) { /* attribution is optional */ }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    if (done) done();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
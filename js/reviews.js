(function () {
  'use strict';

  var sbPromise = null;
  function getSB() {
    if (!sbPromise) sbPromise = (async function () {
      var sb = getSupabase();
      if (!sb) return null;
      try {
        var u = await (await sb.auth.getSession()).data.session;
        return { sb: sb, user: u ? u.user : null };
      } catch (e) { return null; }
    })();
    return sbPromise;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function stars(n) {
    n = Math.max(1, Math.min(5, Math.round(n)));
    var out = '<span class="rv-stars" aria-label="' + n + ' out of 5 stars">';
    for (var i = 1; i <= 5; i++) {
      out += '<svg viewBox="0 0 24 24" class="' + (i <= n ? 'on' : '') + '"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    }
    return out + '</span>';
  }

  function initials(name) {
    var parts = String(name || 'S').trim().split(/\s+/);
    var f = (parts[0] || 'S').charAt(0);
    var l = parts.length > 1 ? parts[parts.length - 1].charAt(0) : (parts[0] || 'S').charAt(1);
    return esc((f + (l || '')).toUpperCase());
  }

  function timeAgo(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var day = Math.floor(h / 24); if (day < 7) return day + (day === 1 ? ' day ago' : ' days ago');
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---------------------------------------------------------------
  // PUBLIC REVIEWS SECTION
  // ---------------------------------------------------------------
  async function initPublic() {
    var root = document.getElementById('reviews-section');
    if (!root) return;
    var listEl = document.getElementById('reviews-list');
    var metaEl = document.getElementById('reviews-summary');
    if (!listEl) return;

    listEl.innerHTML = '<p class="muted" style="padding:30px;text-align:center;">Loading reviews&hellip;</p>';

    var ctx = await getSB();
    var rows = [];
    if (ctx && ctx.sb) {
      try {
        var res = await ctx.sb.from('reviews').select('*').eq('status', 'approved').order('created_at', { ascending: false }).limit(50);
        rows = res.data || [];
      } catch (e) { rows = []; }
    }

    if (!rows.length) {
      listEl.innerHTML = '<p class="muted" style="padding:30px;text-align:center;">No student reviews yet &mdash; be the first to share your experience!</p>';
      if (metaEl) metaEl.style.display = 'none';
      return;
    }

    var sum = rows.reduce(function (a, r) { return a + r.rating; }, 0);
    var avg = sum / rows.length;
    var fives = rows.filter(function (r) { return r.rating === 5; }).length;

    if (metaEl) {
      metaEl.innerHTML =
        '<div class="rv-sum-big">' + avg.toFixed(1) + '</div>' +
        '<div class="rv-sum-right">' +
          stars(avg) +
          '<span class="rv-sum-count"><strong>' + rows.length + '</strong> verified review' + (rows.length === 1 ? '' : 's') + '</span>' +
          '<span class="rv-sum-sub">' + Math.round((fives / rows.length) * 100) + '% of students rated 5&#9733;</span>' +
        '</div>';
    }

    function cardHTML(r) {
      return '' +
      '<article class="rv-card rv-card-on">' +
        '<div class="rv-avatar">' + initials(r.student_name) + '</div>' +
        '<div class="rv-body">' +
          '<div class="rv-head">' +
            '<strong class="rv-name">' + esc(r.student_name) + (r.verified ? ' <span class="rv-vbadge">&#10003; Verified</span>' : '') + '</strong>' +
            '<span class="rv-date">' + timeAgo(r.created_at) + '</span>' +
          '</div>' +
          '<div class="rv-rating">' + stars(r.rating) + '</div>' +
          '<p class="rv-text">' + esc(r.review) + '</p>' +
        '</div>' +
      '</article>';
    }

    var controls = document.getElementById('reviews-controls');
    var dotsEl = document.getElementById('rv-dots');
    var prevBtn = document.getElementById('rv-prev');
    var nextBtn = document.getElementById('rv-next');
    var idx = 0;

    function show(i) {
      idx = (i + rows.length) % rows.length;
      listEl.innerHTML = cardHTML(rows[idx]);
      if (dotsEl) {
        dotsEl.innerHTML = rows.map(function (_, k) {
          return '<button type="button" class="rv-dot' + (k === idx ? ' on' : '') + '" data-i="' + k + '" aria-label="Go to review ' + (k + 1) + '"></button>';
        }).join('');
        dotsEl.querySelectorAll('.rv-dot').forEach(function (d) {
          d.addEventListener('click', function () { show(parseInt(d.getAttribute('data-i'), 10)); });
        });
      }
      if (prevBtn) prevBtn.disabled = rows.length < 2;
      if (nextBtn) nextBtn.disabled = rows.length < 2;
    }

    if (controls) {
      controls.style.display = rows.length > 1 ? 'flex' : 'none';
      if (prevBtn) prevBtn.addEventListener('click', function () { show(idx - 1); });
      if (nextBtn) nextBtn.addEventListener('click', function () { show(idx + 1); });
    }
    show(0);
  }

  // ---------------------------------------------------------------
  // STUDENT REVIEW FORM
  // ---------------------------------------------------------------
  async function initStudent() {
    var form = document.getElementById('student-review-form');
    if (!form) return;
    var starsWrap = document.getElementById('review-stars-picker');
    var reviewInput = document.getElementById('review-textarea');
    var sendBtn = document.getElementById('review-submit');
    var msgEl = document.getElementById('review-msg');
    var rating = 0;

    // Star picker
    if (starsWrap) {
      var win = starsWrap.querySelectorAll('.rv-pick');
      win.forEach(function (b, i) {
        b.addEventListener('click', function () {
          rating = i + 1;
          win.forEach(function (x, j) { x.classList.toggle('on', j <= i); });
          sendBtn.disabled = false;
        });
      });
    }

    function setMsg(text, ok) {
      msgEl.style.display = 'block';
      msgEl.textContent = text;
      msgEl.style.color = ok ? '#059669' : '#DC2626';
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var ctx = await getSB();
      if (!ctx || !ctx.user) { setMsg('Please sign in to leave a review.', false); return; }
      if (!rating) { setMsg('Please select a star rating.', false); return; }
      var text = reviewInput ? reviewInput.value.trim() : '';
      if (text.length < 10) { setMsg('Please write a short review (at least 10 characters).', false); return; }

      sendBtn.disabled = true;
      sendBtn.textContent = 'Submitting&hellip;';
      setMsg('');

      // student_name snapshot for display, marked verified if they have taken a lesson
      var name = 'Student';
      var verified = false;
      try {
        var p = await ctx.sb.from('profiles').select('full_name').eq('id', ctx.user.id).maybeSingle();
        if (p.data && p.data.full_name) name = p.data.full_name;
        var subs = await ctx.sb.from('subscriptions').select('id').eq('student_id', ctx.user.id).limit(1);
        verified = (subs.data && subs.data.length > 0);
      } catch (err) {}

      var insert = {
        student_id: ctx.user.id,
        student_name: name,
        rating: rating,
        review: text,
        status: 'pending',
        verified: !!verified
      };

      var res = await ctx.sb.from('reviews').insert(insert).select().maybeSingle();
      if (res.error) {
        setMsg('Could not submit your review. ' + (res.error.message || ''), false);
        sendBtn.disabled = false;
        sendBtn.textContent = 'Submit Review';
        return;
      }
      setMsg('Thank you! Your review has been submitted and will appear after approval.', true);
      form.querySelectorAll('.rv-pick').forEach(function (x) { x.classList.remove('on'); });
      reviewInput.value = '';
      rating = 0;
      sendBtn.disabled = true;
      sendBtn.textContent = 'Submit Review';
    });
  }

  // ---------------------------------------------------------------
  // ADMIN REVIEW MODERATION
  // ---------------------------------------------------------------
  var adminTab = 'pending';
  var adminRows = [];

  function renderAdmin(listEl, msgEl) {
    var rows = adminRows.filter(function (r) { return r.status === adminTab; });
    if (!rows.length) {
      listEl.innerHTML = '<p class="muted" style="padding:22px;text-align:center;">No ' + adminTab + ' reviews.</p>';
      return;
    }
    listEl.innerHTML = rows.map(function (r) {
      var badge = r.status === 'pending' ? 'rv-stat-pend' : (r.status === 'approved' ? 'rv-stat-ok' : 'rv-stat-rej');
      return '' +
      '<div class="rv-adm" data-id="' + r.id + '">' +
        '<div class="rv-adm-top">' +
          '<strong>' + esc(r.student_name) + '</strong>' +
          '<span class="rv-stat ' + badge + '">' + r.status + '</span>' +
        '</div>' +
        '<div class="rv-adm-meta"><span class="rv-stars">' + renderSolidStars(r.rating) + '</span>' +
          (r.verified ? ' <span class="rv-vbadge">&#10003; Verified</span>' : ' <span class="rv-vbadge none">Not verified</span>') +
          ' <span class="rv-date">' + timeAgo(r.created_at) + '</span></div>' +
        '<p class="rv-text">' + esc(r.review) + '</p>' +
        '<div class="rv-adm-actions">' +
          (r.status !== 'approved' ? '<button class="btn btn-sm btn-primary" data-act="approve">Approve</button>' : '') +
          (r.status !== 'rejected' ? '<button class="btn btn-sm btn-ghost" data-act="reject">Reject</button>' : '') +
          (r.status !== 'pending' ? '<button class="btn btn-sm btn-ghost" data-act="pending">Mark Pending</button>' : '') +
          '<button class="btn btn-sm btn-ghost" data-act="delete" style="color:#DC2626;">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');

    listEl.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var act = b.getAttribute('data-act');
        var id = b.closest('.rv-adm').getAttribute('data-id');
        var ctx = await getSB();
        if (!ctx || !ctx.sb) return;

        var statusMap = { approve: 'approved', reject: 'rejected', pending: 'pending' };
        b.disabled = true;

        var err = null;
        try {
          if (act === 'delete') {
            if (!confirm('Delete this review permanently?')) { b.disabled = false; return; }
            var r1 = await ctx.sb.from('reviews').delete().eq('id', id);
            if (r1.error) err = r1.error.message;
          } else {
            var r2 = await ctx.sb.from('reviews').update({ status: statusMap[act] }).eq('id', id);
            if (r2.error) err = r2.error.message;
          }
        } catch (e) { err = (e && e.message) || 'Unknown error'; }

        if (err) {
          b.disabled = false;
          if (msgEl) {
            msgEl.style.display = 'block';
            msgEl.style.color = '#DC2626';
            msgEl.textContent = 'Action failed: ' + err;
          }
          return;
        }
        await loadAdmin(msgEl, listEl);
      });
    });
  }

  function renderSolidStars(n) {
    var out = '';
    for (var i = 1; i <= 5; i++) {
      out += '<svg viewBox="0 0 24 24" class="' + (i <= n ? 'on' : '') + '"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    }
    return out;
  }

  async function loadAdmin(msgEl, listEl) {
    var ctx = await getSB();
    if (!ctx || !ctx.sb) { listEl.innerHTML = '<p class="muted" style="padding:22px;text-align:center;">Unable to connect.</p>'; return; }
    try {
      var res = await ctx.sb.from('reviews').select('*').order('created_at', { ascending: false }).limit(200);
      adminRows = res.data || [];
    } catch (e) { adminRows = []; }

    var pending = adminRows.filter(function (r) { return r.status === 'pending'; }).length;
    var badge = document.getElementById('rv-badge');
    if (badge) {
      badge.textContent = pending;
      badge.style.display = pending ? 'inline-flex' : 'none';
    }
    renderAdmin(listEl, msgEl);
  }

  async function initAdmin() {
    var panel = document.getElementById('reviews-panel');
    if (!panel) return;
    var listEl = document.getElementById('reviews-admin-list');
    var msgEl = document.getElementById('reviews-admin-msg');
    if (!listEl) return;
    var tabs = document.querySelectorAll('[data-rvtab]');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        adminTab = t.getAttribute('data-rvtab');
        tabs.forEach(function (x) {
          var on = x === t;
          x.classList.toggle('is-on', on);
          if (on) x.setAttribute('aria-selected', 'true'); else x.removeAttribute('aria-selected');
        });
        renderAdmin(listEl, msgEl);
      });
    });
    await loadAdmin(msgEl, listEl);
  }

  // ---------------------------------------------------------------
  // BOOT
  // ---------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    initPublic();
    initStudent();
    initAdmin();
  });
})();

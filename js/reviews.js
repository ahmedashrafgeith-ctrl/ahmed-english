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

  var STAR_PATH = 'M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2';

  // Fractional star engine: renders 5 half-star layers so ratings like
  // 3.5 or 4.5 render exactly, using a CSS mask fill per star.
  function mkStars(n, extra) {
    n = Math.max(0, Math.min(5, +n || 0));
    var label = (Math.round(n * 10) / 10) + ' out of 5 stars';
    var out = '<span class="rv-stars' + (extra ? ' ' + extra : '') + '" aria-label="' + label + '">';
    for (var i = 1; i <= 5; i++) {
      var fill = Math.max(0, Math.min(1, n - (i - 1))) * 100;
      out += '<span class="rv-st">' +
        '<svg class="rv-st-bg" viewBox="0 0 24 24" aria-hidden="true"><polygon points="' + STAR_PATH + '"/></svg>' +
        '<span class="rv-st-fill" style="width:' + fill + '%">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="' + STAR_PATH + '"/></svg>' +
        '</span>' +
      '</span>';
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

  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  var PALETTE = [
    ['#E8724A', '#F0944D'],
    ['#7C3AED', '#A855F7'],
    ['#0EA5E9', '#6366F1'],
    ['#059669', '#10B981'],
    ['#DC2626', '#F59E0B'],
    ['#334155', '#64748B']
  ];

  function avatarGrad(name) {
    var g = PALETTE[hashStr(name) % PALETTE.length];
    return 'linear-gradient(135deg,' + g[0] + ',' + g[1] + ')';
  }
  function accentColor(name) {
    return PALETTE[hashStr(name + '!') % PALETTE.length][0];
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

    var sum = rows.reduce(function (a, r) { return a + (Number(r.rating) || 0); }, 0);
    var avg = sum / rows.length;

    function distRows() {
      var buckets = {};
      rows.forEach(function (r) {
        var k = Number(r.rating) || 0;
        buckets[k] = (buckets[k] || 0) + 1;
      });
      return Object.keys(buckets).map(Number).sort(function (a, b) { return b - a; }).map(function (k) {
        var w = Math.round((buckets[k] / rows.length) * 100);
        return '<div class="rv-dist-row">' +
          '<span class="rv-dist-label">' + k + '</span>' +
          '<div class="rv-dist-track"><span class="rv-dist-fill" style="width:' + w + '%"></span></div>' +
          '<span class="rv-dist-num">' + buckets[k] + '</span>' +
        '</div>';
      }).join('');
    }

    if (metaEl) {
      metaEl.innerHTML =
        '<div class="rv-sum-big">' + avg.toFixed(2) + '<span class="rv-sum-of">of 5</span></div>' +
        '<div class="rv-sum-right">' +
          '<span class="rv-sum-rate">' + mkStars(avg) + '</span>' +
          '<span class="rv-sum-based"><strong>' + rows.length + '</strong> verified review' + (rows.length === 1 ? '' : 's') + '</span>' +
          '<div class="rv-dist">' + distRows() + '</div>' +
          '<span class="rv-sum-sub">Every review comes from a real student who booked a lesson on this site.</span>' +
        '</div>';
    }

    function quoteSVG() {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.6 5.2C6.4 6.7 4.2 9.3 4.2 12.7c0 2.9 2 4.9 4.6 4.9 2.4 0 4.2-1.8 4.2-4.1 0-2.2-1.6-3.8-3.7-3.8-.4 0-.9.1-1.1.2.3-1.8 1.7-3.6 3.3-4.5L9.6 5.2zm9.4 0c-3.2 1.5-5.4 4.1-5.4 7.5 0 2.9 2 4.9 4.6 4.9 2.4 0 4.2-1.8 4.2-4.1 0-2.2-1.6-3.8-3.7-3.8-.4 0-.9.1-1.1.2.3-1.8 1.7-3.6 3.3-4.5L19 5.2z"/></svg>';
    }
    function cardInner(r) {
      var verified = r.verified === true;
      return '' +
        '<span class="rv-quote">' + quoteSVG() + '</span>' +
        '<div class="rv-top">' +
          '<div class="rv-rating">' + mkStars(r.rating) + '</div>' +
          '<span class="rv-date">' + timeAgo(r.created_at) + '</span>' +
        '</div>' +
        '<p class="rv-text">' + esc(r.review) + '</p>' +
        '<div class="rv-author">' +
          '<div class="rv-avatar-wrap">' +
            (verified ? '<span class="rv-avatar-dot" aria-hidden="true"></span>' : '') +
            '<div class="rv-avatar" style="background:' + avatarGrad(r.student_name) + '">' + initials(r.student_name) + '</div>' +
          '</div>' +
          '<div class="rv-meta">' +
            '<div class="rv-name">' + esc(r.student_name) + (verified ? ' <span class="rv-vbadge">&#10003; Verified</span>' : '') + '</div>' +
            '<span class="rv-date-sub">' + (verified ? 'Verified student review' : 'Student review') + '</span>' +
          '</div>' +
        '</div>';
    }

    var controls = document.getElementById('reviews-controls');
    var dotsEl = document.getElementById('rv-dots');
    var prevBtn = document.getElementById('rv-prev');
    var nextBtn = document.getElementById('rv-next');
    var carouselEl = document.getElementById('reviews-carousel');
    var idx = 0;
    var vc = 1;                  // cards per view, recomputed on load/resize
    var enabled = false;
    var paused = false;
    var timer = null;
    var snapTimer = null;
    var cards = [];
    var track = null;
    var step = 1;
    var dragStart = null;
    var dragDx = 0;
    var dragging = false;

    function stopTimer() { if (timer) { clearTimeout(timer); timer = null; } }
    function stopSnap() { if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; } }

    function vcForWidth() {
      var w = window.innerWidth || document.documentElement.clientWidth;
      if (w >= 1100) return 4;
      if (w >= 700) return 2;
      return 1;
    }

    // Build the sliding track: all cards + clones of the first view so the
    // last card can wrap seamlessly back to the first.
    function renderCards() {
      listEl.innerHTML = '';
      cards = rows.map(function (r) {
        var el = document.createElement('article');
        el.className = 'rv-card';
        el.style.setProperty('--rv-top', accentColor(r.student_name));
        el.innerHTML = cardInner(r);
        return el;
      });
      track = document.createElement('div');
      track.className = 'rv-track';
      cards.forEach(function (c) { track.appendChild(c); });
      for (var c = 0; c < Math.min(vc, rows.length); c++) {
        track.appendChild(cards[c].cloneNode(true));
      }
      listEl.appendChild(track);
    }

    function updateDots() {
      if (!dotsEl) return;
      var pages = Math.max(1, Math.ceil(rows.length / vc));
      var cur = Math.min(pages - 1, Math.floor(idx / vc));
      if (pages > 12) {
        dotsEl.innerHTML = '<span class="rv-dots-count">' + (cur + 1) + ' / ' + pages + '</span>';
        return;
      }
      dotsEl.innerHTML = '';
      for (var p = 0; p < pages; p++) {
        (function (pi) {
          var d = document.createElement('button');
          d.type = 'button';
          d.className = 'rv-dot' + (pi === cur ? ' on' : '');
          d.setAttribute('aria-label', 'Go to review page ' + (pi + 1));
          d.setAttribute('aria-pressed', String(pi === cur));
          d.addEventListener('click', function () { go(pi * vc); });
          dotsEl.appendChild(d);
        })(p);
      }
    }

    function moveTo(i, smooth) {
      i = Math.max(0, Math.min(rows.length, i));
      idx = i;
      if (smooth === false) track.style.transition = 'none';
      track.style.transform = 'translateX(-' + (i * step) + 'px)';
      if (smooth === false) { void track.offsetWidth; track.style.transition = ''; }
      updateDots();
    }

    function go(i) {
      if (i < 0 || i >= rows.length) return;
      stopSnap();
      moveTo(i);
      startAutoplay();
    }

    function stepNext() {
      if (!rows.length) return;
      if (idx >= rows.length - 1) {
        moveTo(rows.length);               // slide into the clones…
        stopSnap();
        snapTimer = setTimeout(function () { moveTo(0, false); }, 720);  // …then snap home
      } else {
        moveTo(idx + 1);
      }
      startAutoplay();
    }

    function stepPrev() {
      if (!rows.length) return;
      if (idx === 0) {
        moveTo(rows.length, false);        // jump invisibly to the clone end…
        moveTo(rows.length - 1);           // …then glide back onto the last card
      } else {
        moveTo(idx - 1);
      }
      startAutoplay();
    }

    // Self-correcting autoplay: recomputes against the real clock each
    // second so the rhythm holds even after a backgrounded tab and it
    // never gets stuck "paused until refresh".
    function startAutoplay() {
      stopTimer();
      if (!enabled || paused) return;
      var at = Date.now() + 5200;
      var tick = function () {
        if (!enabled || paused) { stopTimer(); return; }
        if (Date.now() >= at) { stepNext(); return; }
        timer = setTimeout(tick, Math.min(1000, at - Date.now()));
      };
      timer = setTimeout(tick, 5200);
    }

    function hold() { paused = true; stopTimer(); stopSnap(); }
    function release() { paused = false; startAutoplay(); }

    // Pointer drag / touch-swipe with momentum-free snap. Works with the
    // track's CSS transition disabled while dragging for direct control.
    function onDragStart(e) {
      if (!enabled) return;
      if (e.target && e.target.closest && e.target.closest('button')) return;
      dragging = true;
      dragDx = 0;
      dragStart = (e.touches ? e.touches[0].clientX : e.clientX);
      hold();
      stopSnap();
      listEl.classList.add('rv-grabbing');
      track.classList.add('rv-drag');
    }
    function onDragMove(e) {
      if (!dragging) return;
      dragDx = (e.touches ? e.touches[0].clientX : e.clientX) - dragStart;
      track.style.transform = 'translateX(calc(-' + (idx * step) + 'px + ' + dragDx + 'px))';
    }
    function onDragEnd() {
      if (!dragging) return;
      dragging = false;
      listEl.classList.remove('rv-grabbing');
      track.classList.remove('rv-drag');
      var d = dragDx;
      dragDx = 0;
      if (Math.abs(d) > 42) {
        if (d < 0) stepNext(); else stepPrev();
      } else {
        moveTo(idx);
        release();
      }
    }

    function relayout() {
      vc = vcForWidth();
      enabled = rows.length > vc;
      stopTimer(); stopSnap();
      renderCards();
      step = listEl.clientWidth / vc;
      moveTo(0, false);
      if (controls) {
        controls.style.display = enabled ? 'flex' : 'none';
        if (prevBtn) prevBtn.disabled = false;
        if (nextBtn) nextBtn.disabled = false;
      }
      if (enabled && !paused) startAutoplay();
    }

    if (controls) {
      if (prevBtn) prevBtn.addEventListener('click', function () { stepPrev(); });
      if (nextBtn) nextBtn.addEventListener('click', function () { stepNext(); });
    }
    if (carouselEl) {
      carouselEl.setAttribute('role', 'group');
      carouselEl.setAttribute('aria-roledescription', 'carousel');
      carouselEl.addEventListener('mouseenter', hold);
      carouselEl.addEventListener('mouseleave', release);
      carouselEl.addEventListener('touchstart', hold, { passive: true });
      carouselEl.addEventListener('touchend', release, { passive: true });
      carouselEl.addEventListener('touchcancel', release, { passive: true });
    }
    if (listEl) {
      listEl.setAttribute('aria-live', 'polite');
      listEl.addEventListener('pointerdown', onDragStart);
      listEl.addEventListener('pointermove', onDragMove);
      listEl.addEventListener('pointerup', onDragEnd);
      listEl.addEventListener('pointercancel', onDragEnd);
      listEl.addEventListener('pointerleave', onDragEnd);
    }
    window.addEventListener('resize', function () {
      clearTimeout(relayout.__t);
      relayout.__t = setTimeout(relayout, 150);
    });
    relayout();
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
        '<div class="rv-adm-meta">' + mkStars(r.rating) +
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
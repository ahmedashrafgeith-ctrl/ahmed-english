document.addEventListener('DOMContentLoaded', async () => {
  const sb = getSupabase();
  if (!sb) return;

  const auth = await requireAdmin();
  if (!auth || !auth.profile) return;

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString([], { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // -- Persist ad account IDs in Supabase site_settings (localStorage fallback) --
  const A_KEY = 'tep_adaccounts';
  const SKEY = { fb: 'ads_fb_account', ggl: 'ads_ggl_account', pixel: 'ads_pixel_id' };
  let adAccounts = {};
  try { adAccounts = JSON.parse(localStorage.getItem(A_KEY)) || {}; } catch (e) {}

  async function loadAccountStore() {
    try {
      const { data } = await sb.from('site_settings').select('key,value').in('key', Object.values(SKEY));
      const s = {};
      (data || []).forEach((r) => { s[r.key] = r.value; });
      if (s[SKEY.fb]) adAccounts.fb = s[SKEY.fb];
      if (s[SKEY.ggl]) adAccounts.ggl = s[SKEY.ggl];
      if (s[SKEY.pixel]) adAccounts.pixel = s[SKEY.pixel];
    } catch (e) { /* keep localStorage copy */ }
  }

  async function persistAccounts(values) {
    const rows = Object.keys(values).map((k) => ({ key: SKEY[k], value: values[k] || '' }));
    try {
      await sb.from('site_settings').upsert(rows, { onConflict: 'key' });
    } catch (e) { /* localStorage fallback only */ }
    localStorage.setItem(A_KEY, JSON.stringify(adAccounts));
  }

  const fbId = document.getElementById('ads-fb-account');
  const ggId = document.getElementById('ads-ggl-account');
  const pixelId = document.getElementById('ads-pixel-id');

  (async () => {
    await loadAccountStore();
    if (fbId) fbId.value = adAccounts.fb || '';
    if (ggId) ggId.value = adAccounts.ggl || '';
    if (pixelId) pixelId.value = adAccounts.pixel || '';
  })();

  if (document.getElementById('ads-save-accounts')) {
    document.getElementById('ads-save-accounts').addEventListener('click', async () => {
      adAccounts.fb = (fbId ? fbId.value.trim() : '');
      adAccounts.ggl = (ggId ? ggId.value.trim() : '');
      adAccounts.pixel = (pixelId ? pixelId.value.trim() : '');
      await persistAccounts({ fb: adAccounts.fb, ggl: adAccounts.ggl, pixel: adAccounts.pixel });
    });
  }

  if (document.getElementById('ads-fb-open')) {
    document.getElementById('ads-fb-open').addEventListener('click', () => openAdPlatform(adAccounts.fb, 'fb'));
    document.getElementById('ads-ggl-open').addEventListener('click', () => openAdPlatform(adAccounts.ggl, 'ggl'));
  }
  function openAdPlatform(id, kind) {
    const url = kind === 'fb'
      ? (id ? ('https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=' + id) : 'https://adsmanager.facebook.com/adsmanager/manage/campaigns')
      : (id ? ('https://ads.google.com/aw/campaigns?ocid=' + id.replace(/-/g, '')) : 'https://ads.google.com/aw/campaigns');
    window.open(url, '_blank', 'noopener');
  }

  // -- UTM builder --
  const prettyBase = 'https://www.proenglishtutor.online/';
  const brandLabel = 'ProEng/';
  const SHORT_HOST = 'p.proenglishtutor.online';
  const SHORT_DOMAIN_LIVE = false;
  const shortBranded = (code) => 'https://' + SHORT_HOST + '/' + code;
  async function loadShortlinksForUtm() {
    const sel = document.getElementById('utm-shortlink');
    if (!sel) return;
    let opts = '<option value="">-- choose a short link (optional) --</option>';
    try {
      const { data } = await sb.from('shortlinks').select('code,label,url').order('created_at', { ascending: false }).limit(50);
      (data || []).forEach(r => {
        const name = r.label || r.code;
        opts += '<option value="' + prettyBase + r.code + '">' + esc(name) + ' - ' + esc(prettyBase + r.code) + '</option>';
      });
    } catch (e) { /* noop */ }
    sel.innerHTML = opts;
  }
  loadShortlinksForUtm();

  if (document.getElementById('utm-build')) {
    document.getElementById('utm-build').addEventListener('click', () => {
      const sel = document.getElementById('utm-shortlink');
      const urlInput = document.getElementById('utm-url');
      const base = (sel && sel.value) ? sel.value : urlInput.value.trim();
      const src = document.getElementById('utm-source').value.trim();
      const med = document.getElementById('utm-medium').value.trim();
      const cam = document.getElementById('utm-campaign').value.trim();
      const out = document.getElementById('utm-result');
      const cp = document.getElementById('utm-copy');
      if (!base) { out.value = 'Provide a short link OR a full URL.'; cp.style.display = 'none'; return; }
      const u = new URL(base.startsWith('http') ? base : 'https://www.proenglishtutor.online/' + base);
      if (src) u.searchParams.set('utm_source', src);
      if (med) u.searchParams.set('utm_medium', med);
      if (cam) u.searchParams.set('utm_campaign', cam);
      out.value = u.toString();
      cp.style.display = 'inline-flex';
    });
    document.getElementById('utm-copy').addEventListener('click', () => {
      const out = document.getElementById('utm-result');
      if (!out.value) return;
      const btn = document.getElementById('utm-copy');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(out.value).then(() => { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy link'; }, 2000); }, () => {});
      }
    });
  }

  // -- Campaign tracker --
  async function loadCampaigns() {
    const list = document.getElementById('cam-list');
    if (!list) return;
    let rows = [];
    try {
      const { data } = await sb.from('ad_campaigns').select('*').order('created_at', { ascending: false }).limit(200);
      rows = data || [];
    } catch (e) { list.innerHTML = '<p class="muted">Could not load campaigns.</p>'; return; }

    const kpis = document.getElementById('hub-kpis');
    if (kpis) {
      if (!rows.length) {
        kpis.innerHTML = '<div class="kpi-tile empty"><small>Nothing tracked yet</small><b>--</b><span>Add a campaign below</span></div>';
      } else {
        const totBudget = rows.reduce((a, r) => a + Number(r.budget || 0), 0);
        const totSpend = rows.reduce((a, r) => a + Number(r.spend || 0), 0);
        const totLeads = rows.reduce((a, r) => a + Number(r.leads || 0), 0);
        const cpl = totLeads > 0 ? totSpend / totLeads : 0;
        const active = rows.filter(r => r.status === 'active').length;
        kpis.innerHTML = [
          '<div class="kpi-tile accent"><small>Active</small><b>' + active + '</b></div>',
          '<div class="kpi-tile"><small>Budget</small><b>' + fmtMoney(totBudget) + '</b></div>',
          '<div class="kpi-tile"><small>Spend</small><b>' + fmtMoney(totSpend) + '</b></div>',
          '<div class="kpi-tile"><small>Leads</small><b>' + totLeads + '</b></div>',
          '<div class="kpi-tile"><small>Cost / lead</small><b>' + (cpl ? fmtMoney(cpl) : '--') + '</b></div>'
        ].join('');
      }
    }

    list.innerHTML = rows.length
      ? rows.map(r => {
          const st = r.status === 'paused' ? 'badge-warn' : (r.status === 'ended' ? 'badge-acc' : 'badge-ok');
          return `<div class="rv-adm" data-cam="${r.id}">
            <div class="rv-adm-top">
              <strong>${esc(r.name)}</strong>
              <span class="badge ${st}">${esc(r.status)}</span>
            </div>
            <div class="rv-adm-meta">${esc(r.platform)} &nbsp;|&nbsp; Budget ${fmtMoney(r.budget)} | Spend ${fmtMoney(r.spend)} | ${Number(r.leads || 0)} leads${r.notes ? ' | ' + esc(r.notes) : ''}</div>
            <div class="rv-adm-actions">
              ${r.status !== 'active' ? '<button class="btn btn-sm btn-ghost" data-camact="active">Activate</button>' : ''}
              ${r.status !== 'paused' ? '<button class="btn btn-sm btn-ghost" data-camact="paused">Pause</button>' : ''}
              ${r.status !== 'ended' ? '<button class="btn btn-sm btn-ghost" data-camact="ended">End</button>' : ''}
              <button class="btn btn-sm btn-ghost" data-camdel="1">Delete</button>
            </div>
          </div>`;
        }).join('')
      : '<p class="muted" style="padding:16px;text-align:center;">No campaigns yet. Add your first ad campaign above.</p>';

    list.querySelectorAll('[data-camact]').forEach(b => b.addEventListener('click', async () => {
      const id = b.closest('.rv-adm').getAttribute('data-cam');
      const act = b.getAttribute('data-camact');
      await sb.from('ad_campaigns').update({ status: act }).eq('id', id);
      loadCampaigns();
    }));
    list.querySelectorAll('[data-camdel]').forEach(b => b.addEventListener('click', async () => {
      const id = b.closest('.rv-adm').getAttribute('data-cam');
      if (!confirm('Delete this campaign?')) return;
      await sb.from('ad_campaigns').delete().eq('id', id);
      loadCampaigns();
    }));
  }
  loadCampaigns();

  if (document.getElementById('cam-add')) {
    document.getElementById('cam-add').addEventListener('click', async () => {
      const name = document.getElementById('cam-name');
      if (!name.value.trim()) { name.focus(); return; }
      const rec = {
        name: name.value.trim(),
        platform: document.getElementById('cam-platform').value,
        budget: Number(document.getElementById('cam-budget').value || 0),
        spend: Number(document.getElementById('cam-spend').value || 0),
        leads: Number(document.getElementById('cam-leads').value || 0),
        status: 'active',
        created_at: new Date().toISOString()
      };
      await sb.from('ad_campaigns').insert(rec);
      name.value = ''; document.getElementById('cam-budget').value = ''; document.getElementById('cam-spend').value = ''; document.getElementById('cam-leads').value = '';
      loadCampaigns();
    });
  }

  // -- Link shortener --
  const slList = document.getElementById('sl-list');
  const slMsg = document.getElementById('sl-msg');
  const shortBase = 'https://www.proenglishtutor.online/go.html?c=';

  function genCode(n) {
    const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function renderShortlinkStats(rows) {
    const band = document.getElementById('sl-stats');
    if (!band) return;
    if (!rows.length) {
      band.innerHTML = '<div class="kpi-tile empty"><small>No links yet</small><b>--</b></div>';
      return;
    }
    const total = rows.length;
    const clicks = rows.reduce((a, r) => a + Number(r.hits || 0), 0);
    const top = rows.reduce((best, r) => Number(r.hits || 0) > Number(best.hits || 0) ? r : best, rows[0]);
    band.innerHTML = [
      '<div class="kpi-tile accent"><small>Total links</small><b>' + total + '</b></div>',
      '<div class="kpi-tile"><small>Total clicks</small><b>' + clicks + '</b></div>',
      '<div class="kpi-tile"><small>Top link</small><b>' + (top.label || top.code || '--') + '</b><span>' + Number(top.hits || 0) + ' clicks</span></div>'
    ].join('');
  }

  async function loadShortlinks() {
    if (!slList) return;
    try {
      const { data } = await sb.from('shortlinks').select('*').order('created_at', { ascending: false }).limit(200);
      const rows = data || [];
      renderShortlinkStats(rows);
      slList.innerHTML = rows.length
        ? rows.map(r => {
            const code = r.code;
            const nb = Number(r.hits || 0);
            const displayUrl = SHORT_DOMAIN_LIVE ? shortBranded(code) : prettyBase + code;
            const shortLabel = SHORT_DOMAIN_LIVE ? shortBranded(code) : brandLabel + code;
            return '<div class="sl-row">'
              + '<div class="sl-row-main">'
              + '<div class="sl-row-short">' + esc(shortLabel) + '</div>'
              + '<div class="sl-row-target">' + esc(r.url) + '</div>'
              + (r.label ? '<div class="sl-row-label"><span class="badge badge-soft">' + esc(r.label) + '</span></div>' : '')
              + '<div class="sl-row-actions">'
              + '<button class="btn btn-sm btn-primary" data-slcp="' + esc(code) + '">Copy</button>'
              + '<button class="btn btn-sm btn-ghost" data-slqr="' + esc(displayUrl) + '">QR</button>'
              + '<button class="btn btn-sm btn-ghost" data-slcfull="' + esc(prettyBase + code) + '">Full URL</button>'
              + '<a class="btn btn-sm btn-ghost" href="' + esc(shortBase + code) + '" target="_blank" rel="noopener">Test</a>'
              + '<button class="btn btn-sm btn-ghost" data-sldel="' + esc(code) + '">Delete</button>'
              + '</div>'
              + '</div>'
              + '<div class="sl-row-stats">'
              + '<div class="sl-row-clicks">' + nb + '</div>'
              + '<div class="sl-row-stat-lbl">clicks</div>'
              + '</div>'
              + '</div>';
          }).join('')
        : '<div class="sl-empty">No short links yet. Create your first one above.</div>';

      slList.querySelectorAll('[data-slcp]').forEach(b => b.addEventListener('click', () => {
        const code = b.getAttribute('data-slcp');
        const url = SHORT_DOMAIN_LIVE ? shortBranded(code) : prettyBase + code;
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => flash('Copied: ' + url), () => {});
        else { const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); }
      }));
      slList.querySelectorAll('[data-slcfull]').forEach(b => b.addEventListener('click', () => {
        const url = b.getAttribute('data-slcfull');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => flash('Copied full URL'), () => {});
        else { const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); }
      }));
      slList.querySelectorAll('[data-slqr]').forEach(b => b.addEventListener('click', () => {
        const url = b.getAttribute('data-slqr');
        const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=' + encodeURIComponent(url);
        window.open(qr, '_blank', 'noopener');
      }));
      slList.querySelectorAll('[data-sldel]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this short link?')) return;
        await sb.from('shortlinks').delete().eq('code', b.getAttribute('data-sldel'));
        loadShortlinks();
      }));
    } catch (e) { slList.innerHTML = '<div class="sl-empty">Could not load short links.</div>'; }
  }
  loadShortlinks();

  // Live pretty-link preview while typing the custom code
  const codeInput = document.getElementById('sl-code');
  const previewEl = document.getElementById('sl-preview');
  if (codeInput && previewEl) {
    codeInput.addEventListener('input', () => {
      const c = codeInput.value.trim();
      previewEl.textContent = c ? brandLabel + c : '';
    });
  }

  // Generate a random 8-char code (sl1nk-style short link)
  const genBtn = document.getElementById('sl-gen');
  if (genBtn && codeInput && previewEl) {
    genBtn.addEventListener('click', () => {
      codeInput.value = genCode(8);
      previewEl.textContent = brandLabel + codeInput.value;
      codeInput.focus();
    });
  }

  function flash(msg, err) {
    if (!slMsg) return;
    slMsg.style.display = 'block';
    slMsg.className = 'sl-msg' + (err ? ' err' : ' ok');
    slMsg.textContent = msg;
    setTimeout(() => { slMsg.style.display = 'none'; }, 4000);
  }

  const shortenBtn = document.getElementById('sl-shorten') || document.getElementById('sl-create');
  if (shortenBtn) {
    shortenBtn.addEventListener('click', async () => {
      const url = document.getElementById('sl-url').value.trim();
      const label = document.getElementById('sl-label').value.trim();
      const code = document.getElementById('sl-code').value.trim() || genCode(6);
      if (!url) { flash('Please paste the long URL first.', true); document.getElementById('sl-url').focus(); return; }
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) { flash('Use only letters, numbers, dash or underscore in the code.', true); document.getElementById('sl-code').focus(); return; }
      let clean = url;
      if (!/^https?:\/\//i.test(clean)) clean = 'https://' + clean;
      const { error } = await sb.from('shortlinks').insert({ code, url: clean, label, hits: 0, created_at: new Date().toISOString() });
      if (error) {
        if (/duplicate|already exists/i.test(error.message)) flash('That code "' + code + '" is already taken - try another.', true);
        else flash('Failed: ' + error.message, true);
        return;
      }
      document.getElementById('sl-code').value = '';
      document.getElementById('sl-url').value = '';
      document.getElementById('sl-label').value = '';
      const previewEl = document.getElementById('sl-preview');
      if (previewEl) previewEl.textContent = '';
      const short = brandLabel + code;
      const full = prettyBase + code;
      const resultEl = document.getElementById('sl-result');
      const resultUrl = document.getElementById('sl-result-url');
      const testEl = document.getElementById('sl-test');
      const resultFull = document.getElementById('sl-result-full');
      if (resultUrl) resultUrl.value = short;
      if (testEl) testEl.href = full;
      if (resultFull) resultFull.textContent = 'Full working URL: ' + full;
      if (resultEl) {
        resultEl.style.display = '';
        try { resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      }
      flash('Short link created: ' + short);
      loadShortlinks();
      loadShortlinksForUtm();
    });
  }

  const copyBtn = document.getElementById('sl-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const resultUrl = document.getElementById('sl-result-url');
      const val = resultUrl ? resultUrl.value : '';
      if (!val) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).then(() => {
          copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 2000);
        }, () => {});
      } else {
        const ta = document.createElement('textarea'); ta.value = val; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta);
        copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 2000);
      }
    });
  }
});
document.addEventListener('DOMContentLoaded', async () => {
  const sb = getSupabase();
  if (!sb) return;

  const auth = await requireAdmin();
  if (!auth || !auth.profile) return;

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString([], { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ── Persist ad account IDs in Supabase site_settings (localStorage fallback) ──
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
      const m = document.getElementById('ads-platforms');
      renderPlatforms(m);
    });
  }

  function renderPlatforms(el) {
    if (!el) return;
    const cards = [
      {
        name: 'Meta Ads Manager', color: '#2563EB', icon: 'M', id: adAccounts.fb,
        href: adAccounts.fb ? ('https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=' + adAccounts.fb)
          : 'https://adsmanager.facebook.com/adsmanager/manage/campaigns',
        sub: 'Facebook & Instagram campaigns'
      },
      {
        name: 'Google Ads', color: '#4285F4', icon: 'G', id: adAccounts.ggl,
        href: adAccounts.ggl ? ('https://ads.google.com/aw/campaigns?ocid=' + adAccounts.ggl)
          : 'https://ads.google.com/aw/campaigns',
        sub: 'Search, YouTube & Display'
      },
      { name: 'TikTok Ads', color: '#111827', icon: 'T', id: '', href: 'https://ads.tiktok.com', sub: 'TikTok campaigns' }
    ];
    el.innerHTML = cards.map(c => `
      <div class="zone-card" style="padding:16px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="flex:0 0 auto;width:38px;height:38px;border-radius:10px;background:${c.color};color:#fff;display:grid;place-items:center;font-weight:800;">${c.icon}</div>
          <div style="min-width:0;">
            <div style="font-weight:700;">${c.name}</div>
            <div style="font-size:.78rem;color:var(--c-ink-3);">${c.sub}</div>
          </div>
        </div>
        <a class="btn btn-sm btn-ghost" style="width:100%;margin-top:12px;" href="${c.href}" target="_blank" rel="noopener">Open dashboard</a>
      </div>`).join('');
  }
  renderPlatforms(document.getElementById('ads-platforms'));

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

  // ── UTM builder ──
  const prettyBase = 'https://www.proenglishtutor.online/';
  async function loadShortlinksForUtm() {
    const sel = document.getElementById('utm-shortlink');
    if (!sel) return;
    let opts = '<option value="">-- choose a short link (optional) --</option>';
    try {
      const { data } = await sb.from('shortlinks').select('code,label,url').order('created_at', { ascending: false }).limit(50);
      (data || []).forEach(r => {
        const name = r.label || r.code;
        opts += '<option value="' + prettyBase + r.code + '">' + esc(name) + ' — ' + esc(prettyBase + r.code) + '</option>';
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

  // ── Campaign tracker ──
  async function loadCampaigns() {
    const list = document.getElementById('cam-list');
    if (!list) return;
    let rows = [];
    try {
      const { data } = await sb.from('ad_campaigns').select('*').order('created_at', { ascending: false }).limit(200);
      rows = data || [];
    } catch (e) { list.innerHTML = '<p class="muted">Could not load campaigns.</p>'; return; }

    const kpis = document.getElementById('cam-kpis');
    if (kpis) {
      const totBudget = rows.reduce((a, r) => a + Number(r.budget || 0), 0);
      const totSpend = rows.reduce((a, r) => a + Number(r.spend || 0), 0);
      const totLeads = rows.reduce((a, r) => a + Number(r.leads || 0), 0);
      const cpl = totLeads > 0 ? totSpend / totLeads : 0;
      const active = rows.filter(r => r.status === 'active').length;
      kpis.innerHTML = `
        <div class="p-stat"><small>Active</small><strong>${active}</strong></div>
        <div class="p-stat"><small>Budget</small><strong>${fmtMoney(totBudget)}</strong></div>
        <div class="p-stat"><small>Spend</small><strong>${fmtMoney(totSpend)}</strong></div>
        <div class="p-stat"><small>Leads</small><strong>${totLeads}</strong></div>
        <div class="p-stat"><small>Cost / lead</small><strong>${cpl ? fmtMoney(cpl) : '—'}</strong></div>`;
    }

    list.innerHTML = rows.length
      ? rows.map(r => {
          const st = r.status === 'paused' ? 'badge-warn' : (r.status === 'ended' ? 'badge-acc' : 'badge-ok');
          return `<div class="rv-adm" data-cam="${r.id}">
            <div class="rv-adm-top">
              <strong>${esc(r.name)}</strong>
              <span class="badge ${st}">${esc(r.status)}</span>
            </div>
            <div class="rv-adm-meta">${esc(r.platform)} &nbsp;·&nbsp; Budget ${fmtMoney(r.budget)} · Spend ${fmtMoney(r.spend)} · ${Number(r.leads || 0)} leads${r.notes ? ' · ' + esc(r.notes) : ''}</div>
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

  // ── Link shortener ──
  const slList = document.getElementById('sl-list');
  const slMsg = document.getElementById('sl-msg');
  const shortBase = 'https://www.proenglishtutor.online/go.html?c=';

  function genCode(n) {
    const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  async function loadShortlinks() {
    if (!slList) return;
    try {
      const { data } = await sb.from('shortlinks').select('*').order('created_at', { ascending: false }).limit(200);
      slList.innerHTML = (data || []).length
        ? (data || []).map(r => `
          <div class="rv-adm">
            <div class="rv-adm-top">
              <strong>${esc(r.label || r.code)}</strong>
              <span class="badge badge-acc">${Number(r.hits || 0)} clicks</span>
            </div>
            <div class="rv-adm-meta" style="word-break:break-all;">${prettyBase}${esc(r.code)} &nbsp;→&nbsp; ${esc(r.url)}</div>
            <div class="rv-adm-actions">
              <button class="btn btn-sm btn-primary" data-slcp2>Copy short link</button>
              <button class="btn btn-sm btn-ghost" data-slqr="${prettyBase + r.code}">QR</button>
              <a class="btn btn-sm btn-ghost" href="${shortBase + r.code}" target="_blank" rel="noopener">Test</a>
              <button class="btn btn-sm btn-ghost" data-sldel="${r.code}">Delete</button>
            </div>
          </div>`).join('')
        : '<p class="muted" style="padding:16px;text-align:center;">No short links yet. Create your first one above.</p>';

      slList.querySelectorAll('[data-slcp]').forEach(b => b.addEventListener('click', () => {
        const code = b.closest('.rv-adm').querySelector('[data-sldel]').getAttribute('data-sldel');
        const url = shortBase + code;
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => flash('Copied!'), () => {});
        else { const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); }
      }));
      slList.querySelectorAll('[data-slcp2]').forEach(b => b.addEventListener('click', () => {
        const code = b.closest('.rv-adm').querySelector('[data-sldel]').getAttribute('data-sldel');
        const url = prettyBase + code;
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => flash('Copied!'), () => {});
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
    } catch (e) { slList.innerHTML = '<p class="muted">Could not load short links.</p>'; }
  }
  loadShortlinks();

  // Live pretty-link preview while typing the custom code
  const codeInput = document.getElementById('sl-code');
  const previewEl = document.getElementById('sl-preview');
  if (codeInput && previewEl) {
    codeInput.addEventListener('input', () => {
      const c = codeInput.value.trim();
      previewEl.textContent = c ? prettyBase + c : '';
    });
  }

  function flash(msg, err) {
    if (!slMsg) return;
    slMsg.style.display = 'block';
    slMsg.style.color = err ? '#DC2626' : '#059669';
    slMsg.textContent = msg;
    setTimeout(() => { slMsg.style.display = 'none'; }, 4000);
  }

  if (document.getElementById('sl-create')) {
    document.getElementById('sl-create').addEventListener('click', async () => {
      const url = document.getElementById('sl-url').value.trim();
      const label = document.getElementById('sl-label').value.trim();
      const code = document.getElementById('sl-code').value.trim() || genCode(6);
      if (!url) { flash('Please enter the destination URL.', true); document.getElementById('sl-url').focus(); return; }
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) { flash('Use only letters, numbers, dash or underscore in the code.', true); document.getElementById('sl-code').focus(); return; }
      let clean = url;
      if (!/^https?:\/\//i.test(clean)) clean = 'https://' + clean;
      const { error } = await sb.from('shortlinks').insert({ code, url: clean, label, hits: 0, created_at: new Date().toISOString() });
      if (error) {
        if (/duplicate|already exists/i.test(error.message)) flash('That code "' + code + '" is already taken — try another.', true);
        else flash('Failed: ' + error.message, true);
        return;
      }
      document.getElementById('sl-code').value = '';
      document.getElementById('sl-url').value = '';
      document.getElementById('sl-label').value = '';
      flash('Short link created: ' + prettyBase + code);
      loadShortlinks();
      loadShortlinksForUtm();
    });
  }
});
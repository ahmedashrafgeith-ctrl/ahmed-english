/*
 * ads-ai.js
 * In-dashboard AI Chat Ads Manager for the Ads Hub.
 * Chat with a free LLM (Groq or OpenRouter) to manage real Meta ads through
 * Pipeboard's hosted remote MCP (streamable HTTP, token auth).
 * All credentials stay in the admin's own browser (localStorage) only.
 */
(function () {
  'use strict';

  var LM = 'tep_llm_model';
  var LP = 'tep_llm_provider';
  var AB = 'tep_ai_account';

  var HISTORY = [];      // OpenAI-style message history for the chat
  var TOOLCACHE = null;  // cached tools payload (dash tools + MCP tools)
  var RUNNING = false;
  var MAXT = 6;          // max follow-up turns after running a plan
  var sb = null;         // Supabase client (admin-only secrets live in app_secrets)
  var SECRETS = {};      // loaded once from public.app_secrets (admin RLS)

  // ---------- tiny helpers ----------
  function el(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(cents) {
    var n = Number(cents || 0);
    return '$' + (n / 100).toFixed(2);
  }
  function errMsg(e) {
    var s = String((e && e.message) || e);
    return s.length > 260 ? s.slice(0, 260) + '...' : s;
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }

  function ico(n, s) {
    var sz = s || 15;
    var paths = {
      chat: ['M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z'],
      zap: ['M13 2L3 14h9l-1 8 10-12h-9l1-8z'],
      bars: ['M18 20V10', 'M12 20V4', 'M6 20v-6'],
      feed: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
      plus: ['M12 5v14', 'M5 12h14'],
      refresh: ['M23 4v6h-6', 'M1 20v-6h6', 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10', 'M1 14l4.64 4.36A9 9 0 0 0 20.49 15'],
      link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
      shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
      spark: ['M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z'],
      check: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'],
      x: ['M18 6L6 18', 'M6 6l12 12'],
      warn: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 8v4', 'M12 16h.01'],
      eye: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
      user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
      logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
      key: ['M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4'],
      trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6'],
      send: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4 20-7z'],
      clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
      dollar: ['M12 1v22', 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'],
      robot: ['M7 9h10a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3z', 'M12 5v4', 'M9 12.5h.01', 'M15 12.5h.01']
    };
    var list = paths[n] || paths.spark;
    return '<svg class="ai-ico" width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + list.map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</svg>';
  }

  function mdLite(t) {
    var s = esc(t || '');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  // ---------- chat rendering ----------
  function chatBox() { return el('ai-chat'); }
  function scrollChat() { var b = chatBox(); if (b) b.scrollTop = b.scrollHeight; }

  function addBub(role, html) {
    var b = chatBox();
    if (!b) return;
    var d = document.createElement('div');
    d.className = 'ai-bub ai-' + (role === 'you' ? 'you' : 'me');
    if (role === 'you') d.textContent = html;
    else d.innerHTML = html;
    b.appendChild(d);
    scrollChat();
  }
  function addChip(text, cls) {
    var b = chatBox();
    if (!b) return;
    var d = document.createElement('div');
    d.className = 'ai-chip' + (cls ? ' ' + cls : '');
    d.textContent = text;
    b.appendChild(d);
    scrollChat();
  }
  function out(kind, html) {
    var b = chatBox();
    if (!b) return;
    var d = document.createElement('div');
    d.className = 'ai-line ai-' + kind;
    d.innerHTML = html;
    b.appendChild(d);
    scrollChat();
  }
  function outOk(html) { out('ok', html); }
  function outErr(e) { out('err', 'Error: ' + esc(errMsg(e))); }
  function outInfo(html) { out('info', html); }

  function toggleBusy(b) {
    RUNNING = !!b;
    var c = el('ai-connect-btn');
    if (c) c.disabled = !!b;
    var s = el('ai-send');
    if (s) s.disabled = !!b;
    var p = el('ai-prompt');
    if (p) p.disabled = !!b;
  }

  // ---------- keys + provider ----------
  function provider() {
    var p = load(LP) || 'groq';
    return (p === 'openrouter' || p === 'guided') ? p : 'groq';
  }
  function getKey(p) {
    p = p || provider();
    var k = (p === 'openrouter') ? (SECRETS.openrouter_key || '') : (SECRETS.groq_key || '');
    if (el('ai-key') && el('ai-key').value.trim()) k = el('ai-key').value.trim();
    return k;
  }
  function secretName(p) { return p === 'openrouter' ? 'openrouter_key' : 'groq_key'; }
  function saveKeyToSupabase(p, raw) {
    if (!sb) return Promise.resolve(false);
    var k = (String(raw || '').trim());
    if (!k) return Promise.resolve(false);
    var name = secretName(p);
    return sb.from('app_secrets').upsert([{ key: name, value: k }], { onConflict: 'key' })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        SECRETS[name] = k;
        var inp = el('ai-key');
        if (inp) inp.value = '';
        updateKeyNote();
        return true;
      });
  }
  function updateKeyNote() {
    var n = el('ai-key-note');
    if (!n) return;
    var p = provider();
    var has = p === 'openrouter' ? !!(SECRETS.openrouter_key) : !!(SECRETS.groq_key);
    n.className = has ? 'ai-key-note on' : 'ai-key-note';
    n.textContent = has
      ? 'A ' + (p === 'openrouter' ? 'OpenRouter' : 'Groq') + ' key is stored in Supabase (admin only). Type a new value to replace it - it is cleared from this page after saving.'
      : 'No key stored yet. Paste a free API key above and it saves to Supabase (admin only) - never to files or GitHub.';
  }
  function getModel() {
    var m = el('ai-model') ? el('ai-model').value : '';
    if (m) store(LM, m);
    return m || load(LM) || 'llama-3.3-70b-versatile';
  }
  function modelsFor(p) {
    if (p === 'openrouter') return [
      ['meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B (free)'],
      ['google/gemini-2.0-flash-exp:free', 'Gemini 2.0 Flash (free)'],
      ['qwen/qwen-2.5-72b-instruct:free', 'Qwen 2.5 72B (free)'],
      ['deepseek/deepseek-chat-v3-0324:free', 'DeepSeek V3 (free)']
    ];
    return [
      ['llama-3.3-70b-versatile', 'Llama 3.3 70B (free)'],
      ['llama-3.1-8b-instant', 'Llama 3.1 8B (fast)']
    ];
  }
  function renderModelOptions() {
    var sel = el('ai-model');
    if (!sel) return;
    var p = provider();
    var cur = load(LM);
    var html = modelsFor(p).map(function (m) {
      return '<option value="' + esc(m[0]) + '"' + (m[0] === cur ? ' selected' : '') + '>' + esc(m[1]) + '</option>';
    }).join('');
    sel.innerHTML = html;
    var hint = el('ai-key-hint');
    if (hint) {
      hint.textContent = (p === 'openrouter')
        ? 'OpenRouter free models. Get a free key at openrouter.ai/keys (free tier included).'
        : 'Groq free tier. Get a key at console.groq.com (free tier).';
    }
  }

  function getToken() { return (el('ai-token') && el('ai-token').value.trim()) || SECRETS.pipeboard_token || ''; }
  function getAccount() { return (el('ai-account') && el('ai-account').value) || ''; }
  function setStatus(text, on) {
    var s = el('ai-status');
    if (!s) return;
    s.textContent = text;
    s.className = 'ai-status' + (on ? ' on' : '');
  }

  // ---------- Pipeboard MCP helpers ----------
  function findTool(tools, suffix) {
    for (var i = 0; i < tools.length; i++) {
      if (String(tools[i].name).toLowerCase().indexOf(suffix.toLowerCase()) >= 0) return tools[i];
    }
    return null;
  }
  function contentsToText(content) {
    if (!Array.isArray(content)) return JSON.stringify(content);
    var parts = content.map(function (c) {
      if (c && c.type === 'text') return c.text || '';
      if (c && c.type === 'resource') return JSON.stringify(c.resource || c);
      return JSON.stringify(c || '');
    });
    return parts.join('\n').trim();
  }
  function parseRows(text) {
    try {
      var p = JSON.parse(text);
      if (Array.isArray(p)) return p;
      if (p && Array.isArray(p.data)) return p.data;
      if (p && Array.isArray(p.ads)) return p.ads;
      if (p && p.error) throw new Error(p.error);
    } catch (e) {}
    return [];
  }

  // ---------- dashboard (internal) tools the AI can call ----------
  var DASH = [
    { type: 'function', function: {
      name: 'dash_create_ad_form',
      description: 'Fill the on-page create-ad form from what the user described (all new items stay PAUSED until the user reviews and clicks Create).',
      parameters: { type: 'object', properties: {
        name: { type: 'string', description: 'Campaign/ad name' },
        objective: { type: 'string', description: 'OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_AWARENESS or OUTCOME_SALES' },
        budget_dollars: { type: 'number', description: 'Daily budget in whole US dollars' },
        page_id: { type: 'string', description: 'Facebook Page ID for the ad creative' },
        url: { type: 'string', description: 'Destination URL (must start with http)' },
        message: { type: 'string', description: 'Primary text ad copy' },
        headline: { type: 'string', description: 'Ad headline' },
        cta: { type: 'string', description: 'LEARN_MORE, SHOP_NOW, SIGN_UP, BOOK_TRAVEL or CONTACT_US' },
        country: { type: 'string', description: 'ISO country code, e.g. US' }
      } }
    } },
    { type: 'function', function: {
      name: 'dash_open_create_form',
      description: 'Scroll to and open the create-ad form on this page.',
      parameters: { type: 'object', properties: {} }
    } },
    { type: 'function', function: {
      name: 'dash_list_campaigns',
      description: 'Load the list of campaigns for the selected ad account into the dashboard below.',
      parameters: { type: 'object', properties: {} }
    } },
    { type: 'function', function: {
      name: 'dash_list_ads',
      description: 'Load the list of ads with pause/resume buttons for the selected ad account below.',
      parameters: { type: 'object', properties: {} }
    } },
    { type: 'function', function: {
      name: 'dash_account_spend',
      description: 'Fetch account-level spend, impressions, clicks and CTR insights for the selected ad account.',
      parameters: { type: 'object', properties: {} }
    } },
    { type: 'function', function: {
      name: 'dash_refresh_accounts',
      description: 'Refresh the list of ad accounts available for the connected Pipeboard token.',
      parameters: { type: 'object', properties: {} }
    } }
  ];

  function localRunDash(name, args) {
    args = args || {};
    switch (name) {
      case 'dash_create_ad_form': return applyWizard(args);
      case 'dash_open_create_form': openWizard(); return 'Opened the create-ad form.';
      case 'dash_list_campaigns': renderCampaigns(); return 'Campaigns list refreshed below.';
      case 'dash_list_ads': renderAds(); return 'Ads list refreshed below.';
      case 'dash_account_spend': accountInsights(); return 'Account insights requested - see the ops log.';
      case 'dash_refresh_accounts': reloadAccounts(); return 'Ad account list refreshed.';
    }
    return 'Unknown dashboard action: ' + name;
  }

  function applyWizard(args) {
    var map = { name: 'w-name', objective: 'w-objective', budget_dollars: 'w-budget', page_id: 'w-page', url: 'w-url', message: 'w-msg', headline: 'w-head', cta: 'w-cta', country: 'w-country' };
    var filled = [];
    Object.keys(map).forEach(function (k) {
      var v = args[k];
      if (v == null || v === '') return;
      var inp = el(map[k]);
      if (!inp) return;
      inp.value = String(v);
      filled.push(k);
    });
    openWizard();
    var out = 'Filled the create-ad form';
    out += filled.length ? ': ' + filled.join(', ') : ' (no fields provided)';
    out += '. Review, add an image if needed, then click "Create campaign + ad (starts PAUSED)".';
    return out;
  }

  function mapTools(tools) {
    return tools.map(function (t) {
      var props = (t.inputSchema && t.inputSchema.properties) || {};
      var req = (t.inputSchema && t.inputSchema.required) || [];
      var p = {};
      Object.keys(props).slice(0, 16).forEach(function (k) {
        p[k] = { type: props[k].type || 'string', description: String(props[k].description || '') };
      });
      return { type: 'function', function: { name: t.name, description: String(t.description || ''), parameters: { type: 'object', properties: p, required: req } } };
    }).slice(0, 30);
  }

  function getToolsPayload() {
    var token = getToken();
    if (!token) return Promise.resolve(DASH.slice());
    return AdsMCP.toolsList(AdsMCP.SERVERS.meta, token).then(function (tools) {
      TOOLCACHE = mapTools(tools);
      return DASH.concat(TOOLCACHE);
    }, function () { return DASH.slice(); });
  }

  function execStep(name, args) {
    if (String(name).indexOf('dash_') === 0) return Promise.resolve(localRunDash(name, args));
    var token = getToken();
    if (!token) return Promise.resolve('Not connected to Meta Ads (Pipeboard token missing) - ask to connect first.');
    return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, token, name, args || {}).then(contentsToText, function (e) { throw e; });
  }

  // ---------- LLM ----------
  function callLLM(history, cfg, tools) {
    var body = { model: cfg.model, messages: history, temperature: 0.4 };
    if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
    var url = cfg.kind === 'openrouter'
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.groq.com/openai/v1/chat/completions';
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key };
    if (cfg.kind === 'openrouter') {
      headers['HTTP-Referer'] = 'https://www.proenglishtutor.online/';
      headers['X-Title'] = 'TutorEnglishPro Ads Hub';
    }
    return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.error) throw new Error(String(d.error.message || d.error));
        return d;
      });
  }

  function sysPrompt() {
    var acct = getAccount();
    return 'You are the AI ads assistant inside the TutorEnglishPro (proenglishtutor.online) Ads Hub dashboard. ' +
      'The business owner runs 1-on-1 online English coaching. ' +
      'You manage their Meta ads, optionally through a connected MCP server. Rules: ' +
      '1) Always create things PAUSED - nothing goes live unless the user says so. ' +
      '2) Prefer dash_create_ad_form to pre-fill the create-ad form for the user instead of creating directly, unless they ask you to create it now. ' +
      '3) Use dash_* tools for dashboard tasks (list campaigns, list ads, account spend, open/nfill form, refresh accounts) and the MCP tools (get_ad_accounts, get_campaigns, get_ads, get_insights, update_ad, create_campaign, create_adset, create_ad_creative, create_ad, upload_ad_image) for real Meta work. ' +
      '4) Ask for anything missing (Facebook Page ID, image hash, or destination URL) instead of inventing it. ' +
      '5) MCP budget values are in cents (daily_budget). ' +
      '6) Today is 2026-09-15. Reply briefly and clearly, and always tell the user what you did or what they still need to do. ' +
      '7) If the user just wants info or a plan, answer directly without calling a tool. ' +
      'Connected ad account id: ' + (acct || 'not selected yet');
  }

  function sendChat() {
    var input = el('ai-prompt');
    var text = input.value;
    if (!text.trim() || RUNNING) return;
    input.value = '';
    addBub('you', text);
    var p = provider();
    toggleBusy(true);
    saveKeyToSupabase(p, el('ai-key') ? el('ai-key').value : '').then(function () {
      var key = getKey(p);
      if (p === 'guided' || !key) { toggleBusy(false); guidedReply(text); return; }
      var cfg = { kind: p, key: key, model: el('ai-model') ? el('ai-model').value : '' };
      if (!cfg.model) cfg.model = 'llama-3.3-70b-versatile';
      return getToolsPayload().then(function (tools) {
        HISTORY.push({ role: 'user', content: text });
        if (HISTORY.length > 24) HISTORY = HISTORY.slice(HISTORY.length - 24);
        return callLLM([{ role: 'system', content: sysPrompt() }].concat(HISTORY), cfg, tools);
      }).then(function (res) {
        toggleBusy(false);
        handleLLMReply(res, cfg, 0);
      });
    }).catch(function (e) {
      toggleBusy(false);
      addBub('me', 'Chat error: ' + errMsg(e));
    });
  }

  function handleLLMReply(res, cfg, turn) {
    var tools = null;
    getToolsPayload().then(function (t) { tools = t; return tools; }).then(function (t) { return t; }).then(function (t) {
      var msg = (res.choices && res.choices[0] && res.choices[0].message) || {};
      var text = String(msg.content || '');
      if (text) {
        addBub('me', mdLite(text));
        HISTORY.push({ role: 'assistant', content: text });
      }
      var calls = msg.tool_calls || [];
      if (!calls.length) return;
      var plan = calls.map(function (c) {
        var a = {};
        try { a = JSON.parse(c.function.arguments || '{}'); } catch (e) {}
        return { id: c.id, name: c.function.name, arguments: a };
      });
      showPlan(plan, function () { runPlan(plan, cfg, turn); }, function () {});
    });
  }

  function showPlan(plan, onRun, onCancel) {
    var box = el('ai-planbox');
    if (!box) return;
    box.style.display = '';
    var rows = plan.map(function (s, i) {
      return '<div class="st"><span>' + esc(i + 1) + ')</span><code>' + esc(s.name) + '</code><span class="muted" style="font-size:.78rem;">' + esc(JSON.stringify(s.arguments).slice(0, 120)) + '</span></div>';
    }).join('');
    box.innerHTML = '<div class="ai-plan"><div class="st" style="font-weight:700;">' + ico('zap', 13) + ' The AI proposes ' + plan.length + ' action(s). Review then run:</div>' +
      rows +
      '<div class="st"><button type="button" class="btn btn-primary btn-sm" data-plan-run>Run</button> <button type="button" class="btn btn-ghost btn-sm" data-plan-cancel>Cancel</button></div></div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    var rb = box.querySelector('[data-plan-run]');
    if (rb) rb.addEventListener('click', function () { box.style.display = 'none'; onRun(); });
    var cb = box.querySelector('[data-plan-cancel]');
    if (cb) cb.addEventListener('click', function () { box.style.display = 'none'; onCancel && onCancel(); });
  }

  function runPlan(plan, cfg, turn) {
    if (turn >= MAXT) {
      addChip('Reached the max follow-up turns - say "continue" and I will keep going.', 'err');
      toggleBusy(false);
      return;
    }
    toggleBusy(true);
    var tcalls = plan.map(function (s, i) {
      return { id: String(s.id || ('call' + turn + '_' + i)), type: 'function', function: { name: s.name, arguments: JSON.stringify(s.arguments || {}) } };
    });
    HISTORY.push({ role: 'assistant', content: null, tool_calls: tcalls });
    var results = [];
    var seq = plan.reduce(function (p, s, i) {
      return p.then(function () {
        return execStep(s.name, s.arguments).then(function (r) {
          results.push(String(r));
          return r;
        }, function (e) {
          results.push('FAILED: ' + errMsg(e));
          throw e;
        });
      });
    }, Promise.resolve());
    seq.then(function () {
      plan.forEach(function (s, i) {
        HISTORY.push({ role: 'tool', tool_call_id: String(s.id || ('call' + turn + '_' + i)), content: results[i] || 'ok' });
      });
      if (HISTORY.length > 40) HISTORY = HISTORY.slice(HISTORY.length - 40);
      return callLLM([{ role: 'system', content: sysPrompt() }].concat(HISTORY), cfg, getToolListForSend());
    }).then(function (res2) {
      toggleBusy(false);
      handleLLMReply(res2, cfg, turn + 1);
    }, function (e) {
      toggleBusy(false);
      addBub('me', 'Action failed: ' + errMsg(e));
    });
  }

  function getToolListForSend() { return TOOLCACHE || []; }

  // ---------- guided chat (no LLM key) ----------
  function guidedReply(t) {
    var low = t.toLowerCase();
    if (/create|new ad|new campaign|make an ad|set up an ad/.test(low)) {
      openWizard();
      addBub('me', 'Opened the create-ad form for you. Everything stays PAUSED until you launch it. To let the AI draft all the fields from your description, add a free LLM key in step 2 (Groq or OpenRouter).');
      return;
    }
    if (/spend|insight|stats|performance|ctr|cpc|cost|results/.test(low)) {
      accountInsights();
      addBub('me', 'Loading your account spend and performance - see the ops log above.');
      return;
    }
    if (/campaign|pause|resume|status|ads|list/.test(low)) {
      renderCampaigns(); renderAds();
      addBub('me', 'Loaded your campaigns and ads below - use Pause/Resume on each row.');
      return;
    }
    if (/account|token|connect/.test(low)) {
      reloadAccounts();
      addBub('me', 'Refreshed the ad-account selector. It needs the Pipeboard token connected (step 1) to list real accounts.');
      return;
    }
    if (/budget|money|price|how much/.test(low)) {
      accountInsights();
      addBub('me', 'Showing spend below. New ads are always created paused so nothing spends by itself.');
      return;
    }
    addBub('me', 'I can help with: list campaigns, show ads, account spend, pause/resume, or create an ad (paused). For full AI drafting, paste a free Groq or OpenRouter key in step 2 and just describe what you want.');
  }

  // ---------- accounts ----------
  function reloadAccounts() {
    var sel = el('ai-account');
    var token = getToken();
    if (!token) return;
    if (sel) sel.innerHTML = '<option value="">Loading ad accounts...</option>';
    AdsMCP.toolsList(AdsMCP.SERVERS.meta, token).then(function (tools) {
      var tool = findTool(tools, 'get_ad_accounts');
      TOOLCACHE = mapTools(tools);
      if (!tool) { if (sel) sel.innerHTML = '<option value="">Cannot list ad accounts (no tool).</option>'; return; }
      AdsMCP.toolsCall(AdsMCP.SERVERS.meta, token, tool.name, { user_id: 'me', limit: 100 }).then(function (content) {
        var text = contentsToText(content);
        var accounts = [];
        try {
          var p = JSON.parse(text);
          if (Array.isArray(p)) accounts = p;
          else if (p && Array.isArray(p.data)) accounts = p.data;
          else if (p && Array.isArray(p.accounts)) accounts = p.accounts;
        } catch (e) {}
        if (!accounts.length) {
          if (sel) sel.innerHTML = '<option value="">No ad accounts found for this token.</option>';
          outInfo('No ad accounts returned - make sure your Facebook Ads account is connected on pipeboard.co.');
          return;
        }
        var html = '<option value="">Select an ad account...</option>';
        var saved = load(AB);
        accounts.forEach(function (a) {
          var id = a.id || a.account_id || a.ad_account_id || '';
          var name = a.name || a.account_name || id;
          html += '<option value="' + esc(id) + '"' + (id === saved ? ' selected' : '') + '>' + esc(name + ' (' + id + ')') + '</option>';
        });
        if (sel) sel.innerHTML = html;
        renderCampaigns(); renderAds();
      }, function (e) { if (sel) sel.innerHTML = '<option value="">Account list failed</option>'; outErr(e); });
    }, function (e) { if (sel) sel.innerHTML = '<option value="">Account list failed</option>'; outErr(e); });
  }

  // ---------- campaigns / insights ----------
  function renderCampaigns() {
    var box = el('ai-campaigns');
    var acct = getAccount();
    var token = getToken();
    if (!acct) { box.innerHTML = '<p class="muted">Select an ad account above first.</p>'; return; }
    box.innerHTML = '<p class="muted">Loading campaigns...</p>';
    AdsMCP.toolsList(AdsMCP.SERVERS.meta, token).then(function (tools) {
      var c = findTool(tools, 'get_campaigns');
      if (!c) { box.innerHTML = '<p class="muted">Campaign tool unavailable in this server.</p>'; return; }
      return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, token, c.name, { account_id: acct, limit: 50 }).then(function (content) {
        var rows = parseRows(contentsToText(content));
        if (!rows.length) { box.innerHTML = '<p class="muted">No campaigns yet. Ask the AI chat or use Quick actions to create one (paused).</p>'; return; }
        var h = '<table class="tbl"><thead><tr><th>Name</th><th>Status</th><th>Budget/day</th><th>Actions</th></tr></thead><tbody>';
        rows.forEach(function (r) {
          var budget = (r.daily_budget || r.lifetime_budget) ? money(r.daily_budget || r.lifetime_budget) + (r.daily_budget ? '' : ' total') : '-';
          h += '<tr><td>' + esc(r.name || r.id) + '</td><td>' + esc(r.status || '?') + '</td><td>' + esc(budget) + '</td>' +
            '<td><button class="btn btn-sm btn-ghost" data-ai-ins="' + esc(r.id || '') + '">' + ico('bars', 12) + ' Insights</button></td></tr>';
        });
        h += '</tbody></table>';
        box.innerHTML = h;
        box.querySelectorAll('[data-ai-ins]').forEach(function (b) {
          b.addEventListener('click', function () { runCampaignInsights(b.getAttribute('data-ai-ins')); });
        });
      });
    }, function (e) { box.innerHTML = ''; outErr(e); });
  }

  function renderInsights(objectId, level, token) {
    AdsMCP.toolsList(AdsMCP.SERVERS.meta, token).then(function (tools) {
      var ins = findTool(tools, 'get_insights');
      if (!ins) { outErr('Insights tool unavailable.'); return; }
      AdsMCP.toolsCall(AdsMCP.SERVERS.meta, token, ins.name, { object_id: objectId, level: level || 'account', action_attribution_windows: ['7d_click'] }).then(function (content) {
        outOk('<b>Insights (' + esc(objectId) + ')</b><br><pre>' + esc(contentsToText(content).slice(0, 1200)) + '</pre>');
        var sum = summarizeInsights(contentsToText(content));
        if (sum) outInfo(sum);
      }, outErr);
    }, outErr);
  }

  function summarizeInsights(text) {
    try {
      var p = JSON.parse(text);
      if (Array.isArray(p)) p = p[0] || {};
      if (!p || !p.date_start) return '';
      return 'Spent ' + money(p.spend) + ' | Impressions ' + (p.impressions || 0) + ' | Clicks ' + (p.clicks || 0) +
        ' | CPC ' + money(p.cpc) + ' | CTR ' + (p.ctr ? (Number(p.ctr) * 100).toFixed(2) + '%' : '-');
    } catch (e) { return ''; }
  }
  function runCampaignInsights(cid) { renderInsights(cid, 'campaign', getToken()); }
  function accountInsights() {
    var acct = getAccount();
    if (!acct) { addBub('me', 'Select an ad account first (step 1).'); return; }
    renderInsights(acct, 'account', getToken());
  }

  // ---------- ads / pause-resume ----------
  function renderAds() {
    var box = el('ai-ads');
    if (!box) return;
    var acct = getAccount();
    var token = getToken();
    if (!acct) { box.innerHTML = '<p class="muted">Select an ad account above first.</p>'; return; }
    box.innerHTML = '<p class="muted">Loading ads...</p>';
    AdsMCP.toolsList(AdsMCP.SERVERS.meta, token).then(function (tools) {
      var a = findTool(tools, 'get_ads');
      var upd = findTool(tools, 'update_ad');
      if (!a) { box.innerHTML = '<p class="muted">Ads tool unavailable.</p>'; return; }
      AdsMCP.toolsCall(AdsMCP.SERVERS.meta, token, a.name, { account_id: acct, limit: 50 }).then(function (content) {
        var rows = parseRows(contentsToText(content));
        if (!rows.length) { box.innerHTML = '<p class="muted">No ads yet. Create one through the AI chat or the form below.</p>'; return; }
        var html = '<table class="tbl"><thead><tr><th>Name</th><th>Status</th><th>Type</th><th>Actions</th></tr></thead><tbody>';
        rows.forEach(function (r) {
          var id = r.id || '';
          var status = r.status || '?';
          html += '<tr><td>' + esc(r.name || id) + '</td><td>' + esc(status) + '</td><td>' + esc(r.effective_status || '-') + '</td><td>' +
            (upd && status !== 'ACTIVE' ? '<button class="btn btn-sm btn-ghost" data-ai-status="ACTIVE" data-ai-ad="' + esc(id) + '">Resume</button> ' : '') +
            (upd && status !== 'PAUSED' ? '<button class="btn btn-sm btn-ghost" data-ai-status="PAUSED" data-ai-ad="' + esc(id) + '">Pause</button> ' : '') +
            '<button class="btn btn-sm btn-ghost" data-ai-adins="' + esc(id) + '">Stats</button></td></tr>';
        });
        html += '</tbody></table>';
        box.innerHTML = html;
        if (upd) {
          box.querySelectorAll('[data-ai-status]').forEach(function (b) {
            b.addEventListener('click', function () {
              var id = b.getAttribute('data-ai-ad');
              var status = b.getAttribute('data-ai-status');
              AdsMCP.toolsCall(AdsMCP.SERVERS.meta, getToken(), upd.name, { ad_id: id, status: status }).then(function (c) {
                outOk('Ad <b>' + esc(id) + '</b> -> ' + esc(status) + '. ' + esc(contentsToText(c).slice(0, 200)));
                renderAds(); renderCampaigns();
              }, outErr);
            });
          });
        }
        box.querySelectorAll('[data-ai-adins]').forEach(function (b) {
          b.addEventListener('click', function () { renderInsights(b.getAttribute('data-ai-adins'), 'ad', getToken()); });
        });
      }, function (e) { box.innerHTML = ''; outErr(e); });
    }, function (e) { box.innerHTML = ''; outErr(e); });
  }

  // ---------- create ad wizard ----------
  function openWizard() {
    var w = el('ai-wizard');
    if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function createWizard() {
    var box = el('ai-wizard');
    if (!box) return;
    box.innerHTML = [
      '<label class="kpi-label">Campaign name</label>',
      '<input class="field" id="w-name" placeholder="e.g. Spring traffic campaign">',
      '<div class="grid-2" style="gap:10px;">',
      '<div><label class="kpi-label">Objective</label><select class="field" id="w-objective">',
      '<option value="OUTCOME_TRAFFIC">Traffic</option><option value="OUTCOME_ENGAGEMENT">Engagement</option>',
      '<option value="OUTCOME_LEADS">Leads</option><option value="OUTCOME_AWARENESS">Awareness</option>',
      '<option value="OUTCOME_SALES">Sales</option></select></div>',
      '<div><label class="kpi-label">Daily budget (USD)</label><input class="field" id="w-budget" type="number" min="1" step="1" value="10"></div>',
      '</div>',
      '<label class="kpi-label">Facebook Page ID (for the ad)</label>',
      '<input class="field" id="w-page" placeholder="e.g. 102930123456789">',
      '<label class="kpi-label">Destination URL</label>',
      '<input class="field" id="w-url" placeholder="https://www.proenglishtutor.online/packages.html">',
      '<label class="kpi-label">Primary text (ad copy)</label>',
      '<input class="field" id="w-msg" placeholder="Personal 1-on-1 English coaching. Book a trial today.">',
      '<label class="kpi-label">Headline</label>',
      '<input class="field" id="w-head" placeholder="Private English Lessons">',
      '<label class="kpi-label">CTA</label>',
      '<select class="field" id="w-cta"><option value="LEARN_MORE">Learn More</option><option value="SHOP_NOW">Shop Now</option>',
      '<option value="SIGN_UP">Sign Up</option><option value="BOOK_TRAVEL">Book</option><option value="CONTACT_US">Contact Us</option></select>',
      '<label class="kpi-label">Image (optional). Pick a file OR paste an existing image hash.</label>',
      '<input class="field" id="w-image" type="file" accept="image/*">',
      '<input class="field" id="w-hash" placeholder="or existing image hash" style="margin-top:8px;">',
      '<label class="kpi-label">Country targeting (ISO code, e.g. US, GB)</label>',
      '<input class="field" id="w-country" value="US" placeholder="US">',
      '<div style="margin-top:12px;"><button class="btn btn-primary btn-sm" id="w-submit">Create campaign + ad (starts PAUSED)</button> ',
      '<span class="muted" style="font-size:.8rem;">Everything is created paused - you review before it goes live.</span></div>'
    ].join('');
    el('w-submit').addEventListener('click', runWizard);
  }

  function runWizard() {
    var acct = getAccount();
    if (!acct) { outErr('Select an ad account first.'); return; }
    var name = (el('w-name').value || 'New campaign').trim();
    var objective = el('w-objective').value;
    var budgetCents = Math.round(Number(el('w-budget').value || 10) * 100);
    var page = el('w-page').value.trim();
    var url = el('w-url').value.trim();
    var msg = el('w-msg').value.trim();
    var head = el('w-head').value.trim();
    var cta = el('w-cta').value;
    var country = el('w-country').value.trim().toUpperCase();
    if (!page) { outErr('A Facebook Page ID is required for the ad creative.'); return; }
    if (!/^https?:\/\//i.test(url)) { outErr('Destination URL must start with http(s)://'); return; }
    toggleBusy(true);
    AdsMCP.toolsList(AdsMCP.SERVERS.meta, getToken()).then(function (tools) {
      var tc = findTool(tools, 'create_campaign');
      var ta = findTool(tools, 'create_adset');
      var ti = findTool(tools, 'create_ad_creative');
      var tad = findTool(tools, 'create_ad');
      var tu = findTool(tools, 'upload_ad_image');
      if (!tc || !ta || !ti || !tad) { toggleBusy(false); outErr('This server does not expose all the create tools needed.'); return; }
      return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, getToken(), tc.name, {
        account_id: acct, name: name, objective: objective, status: 'PAUSED',
        daily_budget: budgetCents, bid_strategy: 'LOWEST_COST_WITHOUT_CAP', buying_type: 'AUCTION'
      }).then(function (c1) {
        var cid = extractIdFromText(contentsToText(c1), 'campaign');
        outOk('Campaign created (paused): <b>' + esc(cid || 'see result') + '</b>');
        return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, getToken(), ta.name, {
          account_id: acct, campaign_id: cid, name: name + ' - Ad set',
          status: 'PAUSED', daily_budget: String(budgetCents),
          optimization_goal: 'LINK_CLICKS', billing_event: 'IMPRESSIONS',
          targeting: { geo_locations: { countries: [country] } }
        }).then(function (c2) {
          var asid = extractIdFromText(contentsToText(c2), 'adset');
          outOk('Ad set created (paused): <b>' + esc(asid || 'see result') + '</b>');
          var file = el('w-image').files && el('w-image').files[0];
          var hash = el('w-hash').value.trim();
          if (file && tu && !hash) {
            return readFileAsDataUrl(file).then(function (dataUrl) {
              return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, getToken(), tu.name, { account_id: acct, name: name, image_path: dataUrl })
                .then(function (iu) { hash = extractHashFromText(contentsToText(iu)); outInfo('Image upload returned hash: <b>' + esc(hash || 'none') + '</b>'); return hash; },
                  function () { outErr('Image upload failed (server-side path needed) - provide an existing image hash instead.'); return ''; });
            });
          }
          return Promise.resolve(hash);
        }).then(function (hash) {
          if (!hash) { outErr('No image hash available - the ad needs an image. Provide an existing image hash and retry.'); toggleBusy(false); return; }
          return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, getToken(), ti.name, {
            account_id: acct, name: name + ' - Creative', image_hash: hash,
            page_id: page, link_url: url, message: msg, headline: head, call_to_action_type: cta
          }).then(function (c3) {
            var crid = extractIdFromText(contentsToText(c3), 'creative');
            outOk('Creative created: <b>' + esc(crid || 'see result') + '</b>');
            return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, getToken(), tad.name, {
              account_id: acct, name: name + ' - Ad', adset_id: asid, creative_id: crid, status: 'PAUSED'
            }).then(function (c4) {
              outOk('Ad created (paused): <b>' + esc(extractIdFromText(contentsToText(c4), 'ad') || 'see result') + '</b>');
              outOk('All paused, nothing is spending. Review at Meta and press resume when ready.');
              renderCampaigns(); renderAds(); toggleBusy(false);
            });
          });
        });
      });
    }).catch(function (e) { toggleBusy(false); outErr(e); });
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(new Error('Could not read image.')); };
      r.readAsDataURL(file);
    });
  }
  function extractIdFromText(text, kind) {
    var m = text.match(/[A-Za-z0-9_\/]+\d{6,}/);
    if (m) return m[0];
    try {
      var p = JSON.parse(text);
      if (p && p.id) return String(p.id);
      if (Array.isArray(p)) return String((p[0] && p[0].id) || '');
    } catch (e) {}
    return '';
  }
  function extractHashFromText(text) {
    try {
      var p = JSON.parse(text);
      return String(p.hash || p.image_hash || (p.image && p.image.hash) || '');
    } catch (e) {}
    var m = text.match(/hash[":=\s]+([A-Za-z0-9\-]+)/i);
    return m ? m[1] : '';
  }

  // ---------- connect ----------
  function connect() {
    var inp = el('ai-token');
    var typed = inp ? inp.value.trim() : '';
    if (!sb) { outErr('Supabase is not ready - reload the page.'); return; }
    var proceed = function (token) {
      if (!token) {
        outErr('No Pipeboard token found. Paste it above - it saves to Supabase (admin only), never to this site\'s files or localStorage.');
        if (inp) inp.focus();
        return;
      }
      toggleBusy(true);
      outInfo('Connecting to the Meta ads MCP server...');
      AdsMCP.ensureMeta(token, 'TEP Ads Hub').then(function (init) {
        SECRETS.pipeboard_token = token;
        setStatus('Connected', true);
        var dc = el('ai-disconnect');
        if (dc) dc.style.display = '';
        var cb = el('ai-connect-btn');
        if (cb) cb.textContent = 'Reconnect';
        var ra = el('ai-accounts-refresh');
        if (ra) ra.style.display = '';
        outOk('Connected - session ' + esc(init.protocol) + '. Loading ad accounts...');
        reloadAccounts();
      }, function (e) {
        outErr(e);
        outInfo('If this mentions auth, check your token at pipeboard.co/api-tokens and make sure your Facebook Ads account is connected on pipeboard.co.');
      }).then(function () { try { toggleBusy(false); } catch (e) {} }, function () { try { toggleBusy(false); } catch (e) {} });
    };
    if (typed) {
      // store first so the token never ends up in files, GitHub, or localStorage
      sb.from('app_secrets').upsert([
        { key: 'pipeboard_token', value: typed },
        { key: 'google_pipeboard_token', value: typed }
      ], { onConflict: 'key' }).then(function (res) {
        if (res.error) { outErr('Could not save the token to Supabase: ' + errMsg(res.error)); return; }
        SECRETS.pipeboard_token = typed;
        if (inp) inp.value = '';
        proceed(typed);
      }, function (e) { outErr(e); });
    } else {
      proceed(SECRETS.pipeboard_token || '');
    }
  }

  function disconnect() {
    TOOLCACHE = null;
    var t = el('ai-token');
    if (t) t.value = '';
    var dc = el('ai-disconnect');
    if (dc) dc.style.display = 'none';
    var cb = el('ai-connect-btn');
    if (cb) cb.textContent = 'Connect';
    var ra = el('ai-accounts-refresh');
    if (ra) ra.style.display = 'none';
    var sel = el('ai-account');
    if (sel) sel.innerHTML = '<option value="">Connect first</option>';
    setStatus('Not connected', false);
    try { AdsMCP.clearSession(AdsMCP.SERVERS.meta); } catch (e) {}
    addChip('Disconnected from the Meta server. The token stays stored in Supabase (admin only).', 'err');
  }

  function hydrateSecrets() {
    if (!sb) { setStatus('Sign in as admin', false); return; }
    sb.from('app_secrets').select('key,value').then(function (res) {
      if (res.error) { setStatus('Secrets unavailable', false); return; }
      (res.data || []).forEach(function (r) { SECRETS[r.key] = r.value; });
      updateKeyNote();
      var tok = SECRETS.pipeboard_token || '';
      if (tok) {
        try {
          el('ai-disconnect').style.display = '';
          el('ai-connect-btn').textContent = 'Reconnect';
          el('ai-accounts-refresh').style.display = '';
        } catch (e) {}
        setStatus('Connected', true);
        AdsMCP.ensureMeta(tok, 'TEP Ads Hub').then(function () {
          reloadAccounts();
        }, function () { setStatus('Check token', false); });
      } else {
        setStatus('Not connected', false);
      }
    });
  }

  // ---------- boot ----------
  function boot() {
    var app = el('ads-ai-app');
    if (!app) return;
    app.innerHTML = [
      '<div class="ai-card">',
      '<div class="ai-head">',
      '<span class="ai-avatar">' + ico('robot', 20) + '</span>',
      '<label class="kpi-label" style="margin:0;">AI Ads Assistant</label>',
      '<span id="ai-status" class="ai-status">Not connected</span>',
      '</div>',
      '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">',
      '<input class="field" id="ai-token" type="password" placeholder="Pipeboard API token (pipeboard.co/api-tokens)" style="flex:1;min-width:220px;" autocomplete="off">',
      '<button class="btn btn-primary btn-sm" id="ai-connect-btn">' + ico('link', 13) + ' Connect</button>',
      '<button class="btn btn-ghost btn-sm" id="ai-disconnect" style="display:none;">' + ico('logout', 13) + ' Disconnect</button>',
      '</div>',
      '<p class="muted" style="margin:8px 0 0;font-size:.78rem;">Pipeboard is a Meta Business Partner with a free plan: sign up at pipeboard.co, connect your Facebook Ads account, copy the API token from pipeboard.co/api-tokens. The token is stored in Supabase (admin only) - never in the site files, GitHub, or localStorage.</p>',
      '<label class="kpi-label" style="margin-top:14px;">Ad account</label>',
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">',
      '<select class="field" id="ai-account" style="flex:1;"><option value="">Connect first</option></select>',
      '<button class="btn btn-ghost btn-sm" id="ai-accounts-refresh" title="Reload ad accounts" style="display:none;">' + ico('refresh', 13) + ' Accounts</button>',
      '</div>',
      '</div>',

      '<div class="ai-card" style="margin-top:14px;">',
      '<div class="ai-head">',
      '<span class="ai-avatar">' + ico('spark', 20) + '</span>',
      '<label class="kpi-label" style="margin:0;">AI chat <span class="muted" style="font-weight:400;">- free LLM, no Pipeboard needed to chat</span></label>',
      '</div>',
      '<div class="grid-2" style="gap:8px;margin-top:12px;">',
      '<div><label class="kpi-label">Provider</label><select class="field" id="ai-provider">',
      '<option value="groq">Groq (free)</option>',
      '<option value="openrouter">OpenRouter (free)</option>',
      '<option value="guided">Guided chat (no key)</option>',
      '</select></div>',
      '<div><label class="kpi-label">Model</label><select class="field" id="ai-model"></select></div>',
      '</div>',
      '<label class="kpi-label" style="margin-top:8px;">API key (free tier) - saved to Supabase, never to files</label>',
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">',
      '<input class="field" id="ai-key" type="password" placeholder="Paste the free API key" autocomplete="off" style="flex:1;min-width:180px;">',
      '<button class="btn btn-ghost btn-sm" type="button" id="ai-key-save">Save key</button>',
      '</div>',
      '<p class="muted" id="ai-key-hint" style="margin:6px 0 0;font-size:.76rem;"></p>',
      '<p id="ai-key-note" class="ai-key-note"></p>',
      '<div id="ai-chat" class="ai-chat" style="margin-top:12px;"></div>',
      '<div id="ai-planbox" style="display:none;margin-top:8px;"></div>',
      '<div style="display:flex;gap:8px;margin-top:10px;">',
      '<input class="field" id="ai-prompt" placeholder="Ask anything, e.g. create a spring campaign for 10 dollars a day in the US" style="flex:1;">',
      '<button class="btn btn-primary btn-sm" id="ai-send">' + ico('send', 13) + ' Send</button>',
      '</div>',
      '<div id="ai-quick" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">',
      '<button class="btn btn-sm btn-ghost" data-q="list">' + ico('bars', 12) + ' List campaigns</button>',
      '<button class="btn btn-sm btn-ghost" data-q="spend">' + ico('dollar', 12) + ' Account spend</button>',
      '<button class="btn btn-sm btn-ghost" data-q="ads">' + ico('feed', 12) + ' Ads + pause/resume</button>',
      '<button class="btn btn-sm btn-ghost" data-q="create">' + ico('plus', 12) + ' New ad (paused)</button>',
      '</div>',
      '</div>',

      '<div class="ai-card" style="margin-top:14px;">',
      '<div class="ai-head"><span class="ai-avatar">' + ico('bars', 18) + '</span><label class="kpi-label" style="margin:0;">Campaigns</label></div>',
      '<div id="ai-campaigns" style="margin-top:8px;"></div>',
      '</div>',
      '<div class="ai-card" style="margin-top:14px;">',
      '<div class="ai-head"><span class="ai-avatar">' + ico('feed', 18) + '</span><label class="kpi-label" style="margin:0;">Ads</label></div>',
      '<div id="ai-ads" style="margin-top:8px;"></div>',
      '</div>',
      '<div class="ai-card" style="margin-top:14px;">',
      '<div class="ai-head"><span class="ai-avatar">' + ico('shield', 18) + '</span><label class="kpi-label" style="margin:0;">Create ad (safe - all new items start PAUSED)</label></div>',
      '<div id="ai-wizard" style="margin-top:8px;"></div>',
      '</div>'
    ].join('');

    // restore provider/model choices (not secrets)
    var lp = load(LP) || 'groq';
    if (lp === 'openrouter' || lp === 'guided') el('ai-provider').value = lp;
    renderModelOptions();

    // load admin-only secrets from Supabase (never localStorage, never files)
    try { sb = getSupabase(); } catch (e) {}
    hydrateSecrets();

    // bindings
    el('ai-connect-btn').addEventListener('click', connect);
    el('ai-disconnect').addEventListener('click', disconnect);
    el('ai-accounts-refresh').addEventListener('click', function () { reloadAccounts(); });
    el('ai-provider').addEventListener('change', function () {
      store(LP, el('ai-provider').value);
      if (el('ai-key')) el('ai-key').value = '';
      renderModelOptions();
      updateKeyNote();
    });
    el('ai-model').addEventListener('change', function () { store(LM, el('ai-model').value); });
    el('ai-send').addEventListener('click', sendChat);
    var ks = el('ai-key-save');
    if (ks) ks.addEventListener('click', function () {
      var p = provider();
      if (p === 'guided') { addChip('Guided chat does not use a key.', 'err'); return; }
      saveKeyToSupabase(p, el('ai-key') ? el('ai-key').value : '').then(function (saved) {
        if (saved) addChip('Key saved to Supabase (admin only).', 'ok');
        else if (el('ai-key') && !el('ai-key').value.trim()) addChip('No key typed - nothing to save.', 'err');
      }, function (e) { addChip('Could not save the key: ' + errMsg(e), 'err'); });
    });
    el('ai-prompt').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
    });
    el('ai-account').addEventListener('change', function () {
      store(AB, el('ai-account').value);
      renderCampaigns(); renderAds();
    });
    el('ai-quick').querySelectorAll('[data-q]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var q = btn.getAttribute('data-q');
        if (q === 'list') { renderCampaigns(); addChip('Campaigns loaded below.', 'ok'); }
        else if (q === 'spend') { accountInsights(); }
        else if (q === 'ads') { renderAds(); addChip('Ads loaded below - use Pause/Resume.', 'ok'); }
        else if (q === 'create') { openWizard(); }
      });
    });

    createWizard();
    addBub('me', 'Hi! I am your ads assistant. I can list campaigns, show ads, pull account spend, pause/resume, and create new ads (always paused). <b>Tip:</b> add a free API key above (saved to Supabase) and I can draft and fill everything from your description - for example: <i>"Create a spring campaign for 10 dollars a day targeting the US"</i>.');
  }

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(boot, 150);
  });
})();
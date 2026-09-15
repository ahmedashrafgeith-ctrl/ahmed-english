/*
 * ads-ai.js
 * In-dashboard AI Ads Manager for the Ads Hub.
 * Uses Pipeboard's hosted remote MCP (Meta), streamable HTTP, token auth.
 * All credentials stay in the admin's own browser (localStorage) only.
 */
(function () {
  'use strict';

  var TB = 'tep_pipeboard_token';
  var AK = 'tep_groq_key';
  var AB = 'tep_ai_account';
  var LOG = []; // pending run steps (for the AI planner confirm flow)

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

  function out(kind, html, pre) {
    var box = el('ai-log');
    if (!box) return;
    var d = document.createElement('div');
    d.className = 'ai-line ai-' + kind;
    if (pre) { var c = document.createElement('pre'); c.textContent = html; d.appendChild(c); }
    else { d.innerHTML = html; }
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }
  function outErr(msg) { out('err', 'Error: ' + esc(errMsg(msg))); }
  function outOk(html) { out('ok', html); }
  function outInfo(html) { out('info', html); }

  function toggleBusy(b) {
    var btn = el('ai-connect-btn');
    if (btn) btn.disabled = !!b;
    var send = el('ai-send');
    if (send) send.disabled = !!b;
  }

  function getToken() { return (el('ai-token') && el('ai-token').value.trim()) || ''; }
  function getSavedToken() { try { return localStorage.getItem(TB) || ''; } catch (e) { return ''; } }
  function getAccount() { return (el('ai-account') && el('ai-account').value) || ''; }

  function saveToken(t) {
    try { if (t) localStorage.setItem(TB, t); else localStorage.removeItem(TB); } catch (e) {}
    if (el('ai-token')) el('ai-token').value = t || '';
  }
  function saveKey(k) {
    try { if (k) localStorage.setItem(AK, k); else localStorage.removeItem(AK); } catch (e) {}
  }

  function runTools(chain, label) {
    // chain: array of {name, arguments} - executes sequentially with confirmation
    var i = 0;
    function next() {
      if (i >= chain.length) { outOk(label ? ('Done: ' + label) : 'Done.'); toggleBusy(false); return; }
      var step = chain[i++];
      outInfo('Running <b>' + esc(step.name) + '</b>...');
      AdsMCP.toolsCall(AdsMCP.SERVERS.meta, getToken(), step.name, step.arguments).then(function (content) {
        var text = contentsToText(content);
        outOk('<b>' + esc(step.name) + '</b> -> ' + esc(text.slice(0, 400)));
        next();
      }, function (e) {
        outErr(e);
        toggleBusy(false);
      });
    }
    toggleBusy(true);
    next();
  }

  function loadAccountSelect(tools, token) {
    var sel = el('ai-account');
    if (!sel) return;
    sel.innerHTML = '<option value="">Loading ad accounts...</option>';
    var tool = findTool(tools, 'get_ad_accounts');
    if (!tool) { sel.innerHTML = '<option value="">Cannot list ad accounts (no tool).</option>'; return; }
    var args = { user_id: 'me', limit: 100 };
    try { args.access_token = token; /* server may cache anyway */ } catch (e) {}
    AdsMCP.toolsCall(AdsMCP.SERVERS.meta, token, tool.name, args).then(function (content) {
      var text = contentsToText(content);
      var accounts = [];
      try {
        var parsed = JSON.parse(text);
        if (Array.isArray(parsed)) accounts = parsed;
        else if (parsed && Array.isArray(parsed.data)) accounts = parsed.data;
        else if (parsed && Array.isArray(parsed.accounts)) accounts = parsed.accounts;
        else if (parsed && parsed.error) throw new Error(parsed.error);
      } catch (e) { accounts = []; }
      if (!accounts.length) {
        sel.innerHTML = '<option value="">No ad accounts found for this token.</option>';
        outInfo('No ad accounts returned. If your Facebook account has one, verify the token has ads_management access.');
        return;
      }
      var html = '<option value="">Select an ad account...</option>';
      var saved = '';
      try { saved = localStorage.getItem(AB) || ''; } catch (e) {}
      accounts.forEach(function (a) {
        var id = a.id || a.account_id || a.ad_account_id || '';
        var name = a.name || a.account_name || id;
        html += '<option value="' + esc(id) + '"' + (id === saved ? ' selected' : '') + '>' + esc(name + ' (' + id + ')') + '</option>';
      });
      sel.innerHTML = html;
    }, function (e) { sel.innerHTML = '<option value="">Account list failed</option>'; outErr(e); });
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
      var ins = findTool(tools, 'get_insights');
      if (!c) { box.innerHTML = '<p class="muted">Campaign tool unavailable in this server.</p>'; return; }
      return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, token, c.name, { account_id: acct, limit: 50 }).then(function (content) {
        var text = contentsToText(content);
        var rows = [];
        try {
          var parsed = JSON.parse(text);
          if (Array.isArray(parsed)) rows = parsed;
          else if (parsed && Array.isArray(parsed.data)) rows = parsed.data;
          else if (parsed && Array.isArray(parsed.campaigns)) rows = parsed.campaigns;
          else if (parsed && parsed.error) throw new Error(parsed.error);
        } catch (e) { rows = []; }
        if (!rows.length) {
          box.innerHTML = '<p class="muted">No campaigns yet. Use the chat or Quick actions to create one.</p>';
          return;
        }
        var h = '<table class="tbl"><thead><tr><th>Name</th><th>Status</th><th>Budget/day</th><th>Actions</th></tr></thead><tbody>';
        rows.forEach(function (r) {
          var name = r.name || r.id;
          var status = r.status || '?';
          var budget = (r.daily_budget || r.lifetime_budget) ? money(r.daily_budget || r.lifetime_budget) + (r.daily_budget ? '' : ' total') : '-';
          var cid = r.id || '';
          h += '<tr><td>' + esc(name) + '</td><td>' + esc(status) + '</td><td>' + esc(budget) + '</td>' +
            '<td><button class="btn btn-sm btn-ghost" data-ai-ins="' + esc(cid) + '">Insights</button></td></tr>';
        });
        h += '</tbody></table>';
        box.innerHTML = h;
        box.querySelectorAll('[data-ai-ins]').forEach(function (b) {
          b.addEventListener('click', function () {
            var cid = b.getAttribute('data-ai-ins');
            runCampaignInsights(cid);
          });
        });
      });
    }, function (e) { box.innerHTML = ''; outErr(e); });
  }

  function renderInsights(objectId, level, token) {
    AdsMCP.toolsList(AdsMCP.SERVERS.meta, token).then(function (tools) {
      var ins = findTool(tools, 'get_insights');
      if (!ins) { outErr('Insights tool unavailable.'); return; }
      AdsMCP.toolsCall(AdsMCP.SERVERS.meta, token, ins.name, {
        object_id: objectId, level: level || 'account', action_attribution_windows: ['7d_click']
      }).then(function (content) {
        outOk('<b>Insights (' + esc(objectId) + ')</b><br><pre>' + esc(contentsToText(content).slice(0, 1200)) + '</pre>');
        // refresh quick summary
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
      return 'Spent ' + money(p.spend) + ' | Impressions ' + (p.impressions || 0) +
        ' | Clicks ' + (p.clicks || 0) +
        ' | CPC ' + money(p.cpc) +
        ' | CTR ' + (p.ctr ? (Number(p.ctr) * 100).toFixed(2) + '%' : '-');
    } catch (e) { return ''; }
  }
  function runCampaignInsights(cid) { renderInsights(cid, 'campaign', getToken()); }
  function accountInsights() {
    var acct = getAccount();
    if (!acct) { outInfo('Select an ad account first.'); return; }
    renderInsights(acct, 'account', getToken());
  }

  // ---------- pause / resume ads ----------
  function renderAds() {
    var box = el('ai-ads');
    box.innerHTML = '<p class="muted">Loading ads...</p>';
    AdsMCP.toolsList(AdsMCP.SERVERS.meta, getToken()).then(function (tools) {
      var a = findTool(tools, 'get_ads');
      var upd = findTool(tools, 'update_ad');
      if (!a) { box.innerHTML = '<p class="muted">Ads tool unavailable.</p>'; return; }
      AdsMCP.toolsCall(AdsMCP.SERVERS.meta, getToken(), a.name, { account_id: getAccount(), limit: 50 }).then(function (content) {
        var rows = parseRows(contentsToText(content));
        if (!rows.length) { box.innerHTML = '<p class="muted">No ads yet.</p>'; return; }
        var html = '<table class="tbl"><thead><tr><th>Name</th><th>Status</th><th>Type</th><th>Actions</th></tr></thead><tbody>';
        rows.forEach(function (r) {
          var id = r.id || '';
          var status = r.status || '?';
          html += '<tr><td>' + esc(r.name || id) + '</td><td>' + esc(status) + '</td><td>' + esc(r.effective_status || '-') + '</td>' +
            '<td>' +
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
    }, outErr);
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

  // ---------- create ad wizard ----------
  function createWizard() {
    var box = el('ai-wizard');
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

      // step 1: campaign (paused)
      return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, getToken(), tc.name, {
        account_id: acct, name: name, objective: objective, status: 'PAUSED',
        daily_budget: budgetCents, bid_strategy: 'LOWEST_COST_WITHOUT_CAP', buying_type: 'AUCTION'
      }).then(function (c1) {
        var cid = extractIdFromText(contentsToText(c1), 'campaign');
        outOk('Campaign created (paused): <b>' + esc(cid || 'see result') + '</b>');
        // step 2: ad set (paused)
        return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, getToken(), ta.name, {
          account_id: acct, campaign_id: cid, name: name + ' - Ad set',
          status: 'PAUSED', daily_budget: String(budgetCents),
          optimization_goal: 'LINK_CLICKS', billing_event: 'IMPRESSIONS',
          targeting: { geo_locations: { countries: [country] } }
        }).then(function (c2) {
          var asid = extractIdFromText(contentsToText(c2), 'adset');
          outOk('Ad set created (paused): <b>' + esc(asid || 'see result') + '</b>');
          // step 3: image (optional)
          var file = el('w-image').files && el('w-image').files[0];
          var hash = el('w-hash').value.trim();
          if (file && tu && !hash) {
            return readFileAsDataUrl(file).then(function (dataUrl) {
              return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, getToken(), tu.name, { account_id: acct, name: name, image_path: dataUrl })
                .then(function (iu) { hash = extractHashFromText(contentsToText(iu)); outInfo('Image upload attempt returned hash: <b>' + esc(hash || 'none') + '</b>'); return hash; },
                  function (e) { outErr('Image upload failed (server-side path needed) - provide an existing image hash instead.'); return ''; });
            });
          }
          return Promise.resolve(hash);
        }).then(function (hash) {
          if (!hash) { outErr('No image hash available - the ad will need an image. Provide an existing image hash and retry, or skip the create for now.'); toggleBusy(false); return; }
          // step 4: creative
          return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, getToken(), ti.name, {
            account_id: acct, name: name + ' - Creative', image_hash: hash,
            page_id: page, link_url: url, message: msg, headline: head, call_to_action_type: cta
          }).then(function (c3) {
            var crid = extractIdFromText(contentsToText(c3), 'creative');
            outOk('Creative created: <b>' + esc(crid || 'see result') + '</b>');
            // step 5: ad (paused)
            return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, getToken(), tad.name, {
              account_id: acct, name: name + ' - Ad', adset_id: asid, creative_id: crid, status: 'PAUSED'
            }).then(function (c4) {
              outOk('Ad created (paused): <b>' + esc(extractIdFromText(contentsToText(c4), 'ad') || 'see result') + '</b>');
              outOk('All paused, nothing is spending. Review at Meta and press resume when ready.');
              renderCampaigns(); renderAds(); toggleBusy(false);
            });
          });
        });
      }).catch(function (e) { outErr(e); toggleBusy(false); });
    }, function (e) { toggleBusy(false); outErr(e); });
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

  // ---------- AI planner ----------
  function aiPrompt(text) {
    text = (text || '').trim();
    if (!text) return;
    LOG.length = 0;
    if (text.toLowerCase().indexOf('create') >= 0 || text.toLowerCase().indexOf('new ad') >= 0 || text.toLowerCase().indexOf('new campaign') >= 0) {
      outInfo('Opening the create-ad wizard (everything stays paused).');
      el('ai-wizard').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (text.toLowerCase().indexOf('spend') >= 0 || text.toLowerCase().indexOf('insight') >= 0 || text.toLowerCase().indexOf('performance') >= 0 || text.toLowerCase().indexOf('stats') >= 0) {
      accountInsights();
      return;
    }
    if (text.toLowerCase().indexOf('campaign') >= 0 || text.toLowerCase().indexOf('pause') >= 0 || text.toLowerCase().indexOf('resume') >= 0 || text.toLowerCase().indexOf('status') >= 0) {
      renderCampaigns(); renderAds();
      outInfo('Loaded campaigns and ads below - use the Pause/Resume buttons there.');
      return;
    }
    if (text.toLowerCase().indexOf('account') >= 0 || text.toLowerCase().indexOf('token') >= 0) {
      outInfo('To find the accounts tied to this token, the account selector was refreshed.');
      loadAccountSelect(['...'], getToken());
      renderCampaigns();
      return;
    }
    outInfo('I understand the Ads Hub tools but the prompt was not specific enough. Try: "list campaigns", "show account spend", "create a new ad", or use the Quick actions.');
  }

  function groqPlan(prompt) {
    var key = '';
    try { key = localStorage.getItem(AK) || ''; } catch (e) {}
    if (!key) return Promise.resolve(null);
    return AdsMCP.toolsList(AdsMCP.SERVERS.meta, getToken()).then(function (tools) {
      var mapped = tools.map(function (t) {
        var input = (t.inputSchema && t.inputSchema.properties) || {};
        var required = (t.inputSchema && t.inputSchema.required) || [];
        var props = {};
        Object.keys(input).slice(0, 20).forEach(function (k) {
          props[k] = { type: (input[k] && input[k].type) || 'string', description: (input[k] && input[k].description) || '' };
        });
        return { type: 'function', function: { name: t.name, description: t.description || '', parameters: { type: 'object', properties: props, required: required } } };
      }).slice(0, 30);
      return fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are an assistant inside a Meta Ads dashboard connected via MCP. The user gives a plain-language request. Respond ONLY with a tool call (or tool calls) that would satisfy it. Account id is ' + (getAccount() || 'UNKNOWN') + '. Use the correct tool names from the list.' },
            { role: 'user', content: prompt }
          ],
          tools: mapped,
          tool_choice: 'auto'
        })
      }).then(function (res) { return res.json(); }).then(function (data) {
        if (data && data.error) throw new Error(data.error.message);
        var calls = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.tool_calls) || [];
        return calls.map(function (c) { return { name: c.function.name, arguments: safeArgs(c.function.arguments) }; });
      });
    }).catch(function (e) { return { error: e }; });
  }

  function safeArgs(s) {
    try { return JSON.parse(s); } catch (e) { return {}; }
  }

  function sendPrompt() {
    var input = el('ai-prompt');
    var text = input.value;
    if (!text.trim()) return;
    input.value = '';
    outInfo('<b>You:</b> ' + esc(text));
    var key = '';
    try { key = localStorage.getItem(AK) || ''; } catch (e) {}
    if (key) {
      groqPlan(text).then(function (plan) {
        if (plan && plan.error) { outErr(plan.error); aiPrompt(text); return; }
        if (plan && plan.length) {
          LOG = plan;
          outInfo('AI proposes ' + plan.length + ' step(s). Review the code below, then click <b>Run</b>.');
          out('plan', LOG.map(function (s) { return s.name + ' ' + JSON.stringify(s.arguments); }).join('\n\n'), true);
          var run = el('ai-run');
          if (run) run.style.display = '';
        } else {
          aiPrompt(text);
        }
      });
    } else {
      aiPrompt(text);
    }
  }

  // ---------- boot ----------
  function boot() {
    var app = el('ads-ai-app');
    if (!app) return;
    app.innerHTML = [
      '<div class="ai-card">',
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">',
      '<label class="kpi-label" style="margin:0;">Connect the ads AI (Pipeboard MCP)</label>',
      '</div>',
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">',
      '<input class="field" id="ai-token" type="password" placeholder="Paste your Pipeboard API token (pipeboard.co/api-tokens)" style="flex:1;min-width:220px;" autocomplete="off">',
      '<button class="btn btn-primary btn-sm" id="ai-connect-btn">Connect</button>',
      '<button class="btn btn-ghost btn-sm" id="ai-disconnect" style="display:none;">Disconnect</button>',
      '</div>',
      '<p class="muted" style="margin:8px 0 0;font-size:.78rem;">No Pipeboard account yet? It is a Meta Business Partner with a free plan - sign up at pipeboard.co, connect your Facebook Ads account, and copy the API token. The token stays only in this browser (localStorage), never uploaded.</p>',
      '<div class="ai-card" style="margin-top:14px;">',
      '<label class="kpi-label">Ad account</label>',
      '<select class="field" id="ai-account" style="margin-top:6px;"><option value="">Connect first</option></select>',
      '</div>',
      '<div class="ai-card" style="margin-top:14px;">',
      '<label class="kpi-label">AI chat (<span class="muted" style="font-weight:400;">optional Groq key for AI planning, otherwise guided mode works</span>)</label>',
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">',
      '<input class="field" id="ai-ai-key" type="password" placeholder="Groq API key (optional) - groq.com offers a free tier" style="flex:1;min-width:200px;" autocomplete="off">',
      '</div>',
      '<div id="ai-log" style="max-height:240px;overflow:auto;background:var(--c-soft);border:1px solid var(--c-card-border);border-radius:8px;padding:10px;margin-top:10px;font-size:.85rem;"></div>',
      '<div style="display:flex;gap:8px;margin-top:10px;">',
      '<input class="field" id="ai-prompt" placeholder="e.g. Show account spend for last 7 days, or: create a new ad" style="flex:1;">',
      '<button class="btn btn-primary btn-sm" id="ai-send">Send</button>',
      '<button class="btn btn-ghost btn-sm" id="ai-run" style="display:none;">Run</button>',
      '</div>',
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;" id="ai-quick">',
      '<button class="btn btn-sm btn-ghost" data-q="list">List campaigns</button>',
      '<button class="btn btn-sm btn-ghost" data-q="spend">Account spend</button>',
      '<button class="btn btn-sm btn-ghost" data-q="ads">Ads + pause/resume</button>',
      '<button class="btn btn-sm btn-ghost" data-q="create">Create ad (paused)</button>',
      '</div>',
      '</div>',
      '<div class="ai-card" style="margin-top:14px;">',
      '<label class="kpi-label">Campaigns</label>',
      '<div id="ai-campaigns" style="margin-top:8px;"></div>',
      '</div>',
      '<div class="ai-card" style="margin-top:14px;">',
      '<label class="kpi-label">Ads</label>',
      '<div id="ai-ads" style="margin-top:8px;"></div>',
      '</div>',
      '<div class="ai-card" style="margin-top:14px;">',
      '<label class="kpi-label">Create ad (safe - all new items start PAUSED)</label>',
      '<div id="ai-wizard" style="margin-top:8px;"></div>',
      '</div>'
    ].join('');

    // restore saved values
    var t = getSavedToken();
    if (t) {
      el('ai-token').value = t;
      el('ai-connect-btn').textContent = 'Reconnect';
      try { el('ai-disconnect').style.display = ''; } catch (e) {}
    }
    var k = '';
    try { k = localStorage.getItem(AK) || ''; } catch (e) {}
    if (k && el('ai-ai-key')) el('ai-ai-key').value = k;

    el('ai-connect-btn').addEventListener('click', connect);
    el('ai-disconnect').addEventListener('click', function () {
      saveToken(''); saveKey(localStorage.getItem(AK));
      try { localStorage.removeItem(AK); } catch (e) {}
      try { el('ai-disconnect').style.display = 'none'; } catch (e) {}
      try { el('ai-connect-btn').textContent = 'Connect'; } catch (e) {}
      try { el('ai-account').innerHTML = '<option value="">Connect first</option>'; } catch (e) {}
      AdsMCP.clearSession(AdsMCP.SERVERS.meta);
      outInfo('Disconnected. Token removed from this browser.');
    });
    el('ai-send').addEventListener('click', function () {
      var kk = el('ai-ai-key') ? el('ai-ai-key').value.trim() : '';
      saveKey(kk);
      sendPrompt();
    });
    el('ai-run').addEventListener('click', function () {
      el('ai-run').style.display = 'none';
      runTools(LOG.slice(), 'AI plan (all steps reviewed)');
    });
    el('ai-prompt').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); el('ai-send').click(); }
    });
    el('ai-account').addEventListener('change', function () {
      try { localStorage.setItem(AB, el('ai-account').value); } catch (e) {}
      renderCampaigns(); renderAds();
    });
    el('ai-account').addEventListener('change', function () {
      try { localStorage.setItem(AB, el('ai-account').value); } catch (e) {}
      renderCampaigns(); renderAds();
    });

    el('ai-quick').querySelectorAll('[data-q]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var q = btn.getAttribute('data-q');
        if (q === 'list') { renderCampaigns(); outInfo('Campaigns loaded below.'); }
        else if (q === 'spend') { accountInsights(); }
        else if (q === 'ads') { renderAds(); outInfo('Ads loaded below - use Pause/Resume.'); }
        else if (q === 'create') { el('ai-wizard').scrollIntoView({ behavior: 'smooth' }); }
      });
    });

    createWizard();
  }

  function connect() {
    var token = getToken();
    if (!token) { outErr('Paste your Pipeboard API token first.'); el('ai-token').focus(); return; }
    toggleBusy(true);
    outInfo('Connecting to the Meta ads MCP server...');
    var key = el('ai-ai-key') ? el('ai-ai-key').value.trim() : '';
    saveKey(key);
    AdsMCP.ensureMeta(token, 'TEP Ads Hub').then(function (init) {
      saveToken(token);
      try { el('ai-disconnect').style.display = ''; el('ai-connect-btn').textContent = 'Reconnect'; } catch (e) {}
      return AdsMCP.toolsList(AdsMCP.SERVERS.meta, token).then(function (tools) {
        var count = tools ? tools.length : 0;
        outOk('Connected. The ad server exposes <b>' + count + '</b> tools (session ' + esc(init.protocol) + ').');
        // load accounts using the documented tool
        var sel = el('ai-account');
        var tool = findTool(tools, 'get_ad_accounts');
        if (tool) {
          sel.innerHTML = '<option value="">Loading...</option>';
          return AdsMCP.toolsCall(AdsMCP.SERVERS.meta, token, tool.name, { user_id: 'me', limit: 100 }).then(function (content) {
            var text = contentsToText(content);
            var accounts = [];
            try {
              var p = JSON.parse(text);
              if (Array.isArray(p)) accounts = p;
              else if (p && Array.isArray(p.data)) accounts = p.data;
              else if (p && Array.isArray(p.accounts)) accounts = p.accounts;
            } catch (e) {}
            if (!accounts.length) {
              sel.innerHTML = '<option value="">No ad accounts found for this token</option>';
              outInfo('Tip: on pipeboard.co make sure your Facebook Ads account is connected.');
              return;
            }
            var html = '<option value="">Select an ad account...</option>';
            var saved = '';
            try { saved = localStorage.getItem(AB) || ''; } catch (e) {}
            accounts.forEach(function (a) {
              var id = a.id || a.account_id || '';
              var name = a.name || a.account_name || id;
              html += '<option value="' + esc(id) + '"' + (id === saved ? ' selected' : '') + '>' + esc(name + ' (' + id + ')') + '</option>';
            });
            sel.innerHTML = html;
            renderCampaigns(); renderAds();
            outInfo('Select an ad account above to load its campaigns.');
          }, function (e) { sel.innerHTML = '<option value="">Account list failed</option>'; outErr(e); });
        } else {
          sel.innerHTML = '<option value="">Ad account tool not exposed by server</option>';
          outInfo('Connected, but this server does not expose get_ad_accounts. Fill the account id in the select or use the account input at the top of this panel.');
        }
      });
    }, function (e) {
      outErr(e);
      outInfo('If the error is about a token or auth, create an API token at pipeboard.co/api-tokens and connect your Facebook Ads account on pipeboard.co first.');
    }).then(function () { try { toggleBusy(false); } catch (e) {} }, function () { try { toggleBusy(false); } catch (e) {} });
  }

  document.addEventListener('DOMContentLoaded', function () {
    // allow admin-tools.js to finish storing accounts first
    setTimeout(boot, 150);
  });
})();
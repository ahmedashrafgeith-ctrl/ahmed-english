/*
 * ads-mcp.js
 * Minimal Model Context Protocol (MCP) client for the Ads Hub.
 * Talks JSON-RPC over the MCP "streamable HTTP" transport to Pipeboard's
 * hosted remote MCP servers (Meta + Google), using the token auth pattern
 * documented by Pipeboard: https://<platform>.mcp.pipeboard.co/?token=...
 */
(function () {
  'use strict';

  var SERVERS = {
    meta: 'https://meta-ads.mcp.pipeboard.co/',
    google: 'https://google-ads.mcp.pipeboard.co/'
  };
  var PROTOCOL = '2025-06-18';
  var PROTOCOL_FALLBACK = '2025-03-26';

  var sessions = {}; // url -> mcp-session-id

  function endpoint(url, token) {
    if (!token) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(token);
  }

  function extractId() {
    return Math.floor(Math.random() * 1e9);
  }

  function parseSseText(text) {
    var payload = null;
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.lastIndexOf('data:', 0) === 0) {
        var data = line.slice(5).trim();
        if (data) {
          try { payload = JSON.parse(data); } catch (e) { /* keep last valid */ }
        }
      }
    }
    if (!payload) throw new Error('Empty or unreadable response from the ad server.');
    return payload;
  }

  function post(url, body, sessionId, token) {
    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
    if (sessionId) headers['MCP-Session-Id'] = sessionId;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(endpoint(url, token), {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }).then(function (res) {
      var ct = (res.headers.get('content-type') || '').toLowerCase();
      var sid = res.headers.get('mcp-session-id');
      if (sid) sessions[url] = sid;
      return res.text().then(function (text) {
        var parsed;
        try {
          parsed = ct.indexOf('text/event-stream') >= 0 ? parseSseText(text) : JSON.parse(text);
        } catch (e) {
          throw new Error('Bad response (' + res.status + '): ' + String(text).slice(0, 200));
        }
        if (!res.ok) {
          var m = (parsed && (parsed.error && parsed.error.message)) || (parsed && parsed.error) || ('HTTP ' + res.status);
          throw new Error(typeof m === 'string' ? m : 'Request failed with HTTP ' + res.status);
        }
        if (parsed.error) {
          throw new Error(parsed.error.message || 'The ad server returned an error.');
        }
        return parsed.result;
      });
    });
  }

  function call(url, token, method, params) {
    var body = { jsonrpc: '2.0', id: extractId(), method: method };
    if (params !== undefined && params !== null) body.params = params;
    var sid = sessions[url];
    return post(url, body, sid, token).catch(function (err) {
      // A session may have expired: retry once without the stale session id.
      if (sid && /session|connection|disconnect/i.test(String(err && err.message))) {
        delete sessions[url];
        return post(url, body, null, token);
      }
      throw err;
    });
  }

  function initOnce(url, token, label) {
    var sid = sessions[url];
    if (sid) return Promise.resolve({ session: sid, protocol: PROTOCOL });
    var body = {
      jsonrpc: '2.0', id: extractId(), method: 'initialize',
      params: {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: label || 'TEP Ads Hub', version: '1.0' }
      }
    };
    return post(url, body, sid, token).then(function (result) {
      var then = result || {};
      var got = sessions[url];
      // notify the server that we are initialized (fire and forget)
      try {
        fetch(endpoint(url, token), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'MCP-Session-Id': got || '',
            'Authorization': token ? ('Bearer ' + token) : ''
          },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
        }).catch(function () {});
      } catch (e) {}
      return { session: got, protocol: (then.protocolVersion || PROTOCOL) };
    }).catch(function (err) {
      // version negotiation fallback
      if (/protocol|version/i.test(String(err && err.message))) {
        var fb = {
          jsonrpc: '2.0', id: extractId(), method: 'initialize',
          params: { protocolVersion: PROTOCOL_FALLBACK, capabilities: {}, clientInfo: { name: 'TEP Ads Hub', version: '1.0' } }
        };
        return post(url, fb, sessions[url], token).then(function (result) {
          return { session: sessions[url], protocol: PROTOCOL_FALLBACK };
        });
      }
      throw err;
    });
  }

  function ensureInit(token, label) {
    // inits one (Meta) server for now; google is separate through SERVERS.google
    return initOnce(SERVERS.meta, token, label);
  }

  window.AdsMCP = {
    SERVERS: SERVERS,
    endpoint: endpoint,
    initialize: initOnce,
    ensureMeta: ensureInit,
    toolsList: function (url, token) {
      return call(url, token, 'tools/list').then(function (r) { return (r && r.tools) || []; });
    },
    toolsCall: function (url, token, name, args) {
      if (!name) return Promise.reject(new Error('No tool selected.'));
      return call(url, token, 'tools/call', { name: name, arguments: args || {} }).then(function (r) {
        return (r && r.content) || [];
      });
    },
    clearSession: function (url) { delete sessions[url]; }
  };
})();
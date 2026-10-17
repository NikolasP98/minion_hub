/**
 * The `window.minion` bridge, as source text injected into every element's
 * srcdoc (contract §4). It runs at a null origin inside
 * `<iframe sandbox="allow-scripts">`, so it has no imports, no module scope and
 * no access to the hub: every byte of data arrives by `postMessage` from the
 * host, which performs the actual API call with the user's session.
 *
 * Config (element id, vendor URLs, theme vars, box size) is read from
 * `window.__MINION_SANDBOX__`, which `buildSrcdoc` writes immediately before
 * this script — so this stays one constant with nothing interpolated into it.
 */
export const BRIDGE_SCRIPT = String.raw`
(function () {
  var cfg = window.__MINION_SANDBOX__ || {};
  var elementId = cfg.elementId;
  var vendor = cfg.vendor || {};
  var nextId = 0;
  var pending = {};
  var readyFns = [];
  var started = false;
  var loaders = {};

  function post(type, payload, requestId) {
    parent.postMessage(
      { minion: 1, elementId: elementId, requestId: requestId || null, type: type, payload: payload },
      '*'
    );
  }

  function showError(message) {
    var pre = document.querySelector('pre.minion-error');
    if (!pre) {
      pre = document.createElement('pre');
      pre.className = 'minion-error';
      (document.body || document.documentElement).appendChild(pre);
    }
    pre.textContent = pre.textContent ? pre.textContent + '\n' + message : message;
  }

  function applyTheme(vars) {
    if (!vars) return;
    minion.theme = vars;
    for (var name in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, name)) {
        document.documentElement.style.setProperty(name, vars[name]);
      }
    }
  }

  var minion = {
    theme: cfg.theme || {},
    size: cfg.size || { w: 0, h: 0 },
    query: function (spec) {
      return new Promise(function (resolve, reject) {
        var requestId = 'q' + ++nextId;
        pending[requestId] = { resolve: resolve, reject: reject };
        post('query', spec, requestId);
      });
    },
    ready: function (fn) {
      if (typeof fn !== 'function') return;
      if (started) runOne(fn);
      else readyFns.push(fn);
    },
    load: function (name) {
      var url = vendor[name];
      if (!url) return Promise.reject(new Error('library "' + name + '" is not allowlisted'));
      if (loaders[name]) return loaders[name];
      loaders[name] = new Promise(function (resolve, reject) {
        var tag = document.createElement('script');
        tag.src = url;
        tag.onload = function () {
          var lib = window[name];
          if (lib) resolve(lib);
          else reject(new Error('library "' + name + '" did not define window.' + name));
        };
        tag.onerror = function () {
          reject(new Error('could not load library "' + name + '"'));
        };
        (document.head || document.documentElement).appendChild(tag);
      });
      return loaders[name];
    },
  };

  // Lazy: the vendor script tag is appended on first read, never on load.
  // Charts initialised before the frame has its final box render as a flat
  // strip (proof run 2026-10-16), so every ECharts instance is resized whenever
  // the element box changes — authors never have to wire this themselves.
  var echartsReady = null;
  function resizeAllCharts(ec) {
    var nodes = document.querySelectorAll('[_echarts_instance_]');
    for (var i = 0; i < nodes.length; i++) {
      var inst = ec.getInstanceByDom(nodes[i]);
      if (inst) inst.resize();
    }
  }
  Object.defineProperty(minion, 'echarts', {
    get: function () {
      if (!echartsReady) {
        echartsReady = minion.load('echarts').then(function (ec) {
          var kick = function () { requestAnimationFrame(function () { resizeAllCharts(ec); }); };
          window.addEventListener('resize', kick);
          if (typeof ResizeObserver === 'function') new ResizeObserver(kick).observe(document.body);
          kick();
          return ec;
        });
      }
      return echartsReady;
    },
  });
  // echarts-gl is a UMD that registers its 3D series/components into the
  // echarts global at load, so it resolves to the same echarts object:
  // const echarts = await minion.echartsGl, then type: 'bar3D' etc.
  var echartsGlReady = null;
  Object.defineProperty(minion, 'echartsGl', {
    get: function () {
      if (!echartsGlReady) {
        echartsGlReady = minion.echarts.then(function (ec) {
          return minion.load('echarts-gl').then(function () { return ec; });
        });
      }
      return echartsGlReady;
    },
  });
  Object.defineProperty(minion, 'd3', {
    get: function () { return minion.load('d3'); },
  });

  function runOne(fn) {
    try {
      var out = fn();
      if (out && typeof out.catch === 'function') out.catch(reportError);
    } catch (err) {
      reportError(err);
    }
  }

  function reportError(err) {
    showError(err && err.message ? err.message : String(err));
  }

  function start() {
    if (started) return;
    started = true;
    var fns = readyFns;
    readyFns = [];
    // One frame later: the iframe's box is laid out, so 100%-height containers measure.
    requestAnimationFrame(function () {
      for (var i = 0; i < fns.length; i++) runOne(fns[i]);
      post('ready', { elementId: elementId });
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.minion !== 1) return;
    if (data.elementId && data.elementId !== elementId) return;
    if (data.type === 'theme') return applyTheme(data.payload);
    if (data.type === 'resize') {
      minion.size = data.payload || minion.size;
      window.dispatchEvent(new Event('resize'));
      return;
    }
    var entry = pending[data.requestId];
    if (!entry) return;
    delete pending[data.requestId];
    if (data.type === 'result') entry.resolve(data.payload);
    else if (data.type === 'error') {
      entry.reject(new Error((data.payload && data.payload.error) || 'sandbox query failed'));
    }
  });

  window.onerror = function (message) {
    showError(String(message));
    return false;
  };
  window.addEventListener('unhandledrejection', function (event) {
    reportError(event.reason);
  });

  window.minion = minion;
  applyTheme(minion.theme);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    setTimeout(start, 0);
  }
})();
`;

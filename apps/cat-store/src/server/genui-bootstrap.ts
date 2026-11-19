import { GENUI_DIAGNOSTIC_MARKER } from "../shared/genui-diagnostics.js";

/** The bootstrap that runs as the FIRST script of the frame document.
 *
 *  It must be inline and first. Patching `contentWindow.console` from the
 *  parent was measured to fail: the initial about:blank window is reused, so
 *  the patch is gone on the second load and every agent retry goes dark
 *. Attaching at `load` misses parse-time output. */
export function renderGenuiBootstrapScript(): string {
  return `
(function () {
  var MARKER = ${JSON.stringify(GENUI_DIAGNOSTIC_MARKER)};
  var ORIGIN = window.location.origin;

  function send(entry) {
    entry.time = Date.now();
    try {
      window.parent.postMessage({ marker: MARKER, entry: entry }, ORIGIN);
    } catch (e) {
      /* A closed or cross-origin parent must never break the mounted code. */
    }
  }

  /* instanceof is false across realms, so duck-type .stack and .message. */
  function isErrorLike(v) {
    return !!v && typeof v.stack === "string" && typeof v.message === "string";
  }

  function serialize(v) {
    if (v === null) return null;
    var t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v;
    if (t === "undefined") return "undefined";
    if (t === "function") return String(v);
    if (isErrorLike(v)) {
      return {
        type: "error",
        name: String(v.name || "Error"),
        message: String(v.message),
        stack: String(v.stack)
      };
    }
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }

  var LEVELS = ["log", "info", "warn", "error", "debug"];
  for (var i = 0; i < LEVELS.length; i++) {
    (function (level) {
      var original = console[level] ? console[level].bind(console) : null;
      console[level] = function () {
        var args = [];
        for (var j = 0; j < arguments.length; j++) {
          args.push(serialize(arguments[j]));
        }
        send({ kind: "console", level: level, args: args });
        if (original) original.apply(null, arguments);
      };
    })(LEVELS[i]);
  }

  /* Capture phase: a resource error fires on the element and does not bubble. */
  window.addEventListener("error", function (ev) {
    var target = ev.target;
    if (target && target !== window && target.tagName) {
      send({
        kind: "resource",
        tag: String(target.tagName).toLowerCase(),
        url: String(target.src || target.href || "")
      });
      return;
    }
    var err = ev.error;
    send({
      kind: "exception",
      message: String(ev.message || (err && err.message) || ""),
      stack: isErrorLike(err) ? String(err.stack) : "",
      source: String(ev.filename || ""),
      line: typeof ev.lineno === "number" ? ev.lineno : 0,
      column: typeof ev.colno === "number" ? ev.colno : 0
    });
  }, true);

  window.addEventListener("unhandledrejection", function (ev) {
    var reason = ev.reason;
    send({
      kind: "rejection",
      message: isErrorLike(reason) ? String(reason.message) : String(reason),
      stack: isErrorLike(reason) ? String(reason.stack) : ""
    });
  });
})();
`;
}

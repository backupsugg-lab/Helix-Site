/* vibecoded proxy CORS base (shared by sw.js and sj/sw.js).
   Everything that decides how CORS is answered lives in CFG below, so you only edit this one file.

   What it does
   - wrap(response, request)   adds the CORS response headers to a response the service worker is about to return
   - apply(headers, request)   the same, for a Headers object you are still building (the lite engine uses this)
   - preflight(request)        answers an OPTIONS preflight itself with a 204, without asking the site
   - every decision is sent to the shell's Logs panel (source "cors") when CFG.debug is true

   Why headers are replaced and not merged: the real site's Access-Control-* headers are written for the
   site's own origin and never match this page's origin, so the original ones are dropped and rebuilt here. */
(function (g) {
  const CFG = {
    enabled: true,
    allowOrigin: "echo",          /* "echo" = repeat the request's Origin (needed when credentials are used), "*" = wildcard, or one fixed origin */
    allowCredentials: true,
    allowMethods: "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
    allowHeaders: "echo",         /* "echo" = repeat Access-Control-Request-Headers, "*" = wildcard, or a fixed list */
    exposeHeaders: "*",
    maxAge: 600,
    corp: "cross-origin",         /* Cross-Origin-Resource-Policy; set to "" to leave it alone */
    answerPreflight: true,
    debug: true,
    debugMax: 200                 /* log at most this many distinct requests per worker start */
  };

  const seen = new Set();
  let bc = null;
  function note(msg) {
    if (!CFG.debug) return;
    try { if (!bc) bc = new BroadcastChannel("hzlog"); bc.postMessage({ lvl: "net", src: "cors", msg }); } catch (e) {}
  }
  function once(key, msg) {
    if (seen.has(key) || seen.size >= CFG.debugMax) return;
    seen.add(key); note(msg);
  }
  const originOf = r => { try { return (r && r.headers && r.headers.get("origin")) || ""; } catch (e) { return ""; } };

  function rules(request) {
    const o = originOf(request), h = {};
    h["access-control-allow-origin"] = CFG.allowOrigin === "echo" ? (o || "*") : CFG.allowOrigin;
    if (CFG.allowCredentials && h["access-control-allow-origin"] !== "*") h["access-control-allow-credentials"] = "true";
    h["access-control-expose-headers"] = CFG.exposeHeaders;
    if (CFG.allowOrigin === "echo" && o) h["vary"] = "Origin";
    if (CFG.corp) h["cross-origin-resource-policy"] = CFG.corp;
    return h;
  }

  function apply(headers, request) {
    if (!CFG.enabled) return headers;
    for (const k of [...headers.keys()]) if (/^access-control-/i.test(k)) headers.delete(k);
    const h = rules(request);
    for (const k in h) { if (k === "vary") { const v = headers.get("vary"); headers.set("vary", v && !/\borigin\b/i.test(v) ? v + ", Origin" : (v || h[k])); } else headers.set(k, h[k]); }
    return headers;
  }

  function wrap(response, request) {
    if (!CFG.enabled || !response || response.type === "opaque" || response.type === "error" || response.status === 0) return response;
    try {
      const headers = apply(new Headers(response.headers), request);
      const o = originOf(request);
      if (o) once("w|" + o + "|" + (request.url || "").split("?")[0], "response for " + (request.url || "").slice(0, 160) + " from origin " + o + ": added " + headers.get("access-control-allow-origin"));
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (e) { note("could not add CORS headers: " + e.message); return response; }
  }

  function preflight(request) {
    if (!CFG.enabled || !CFG.answerPreflight || !request || request.method !== "OPTIONS" || !request.headers.get("access-control-request-method")) return null;
    const h = rules(request);
    h["access-control-allow-methods"] = CFG.allowMethods;
    h["access-control-allow-headers"] = CFG.allowHeaders === "echo" ? (request.headers.get("access-control-request-headers") || "*") : CFG.allowHeaders;
    h["access-control-max-age"] = String(CFG.maxAge);
    note("answered preflight " + request.headers.get("access-control-request-method") + " " + (request.url || "").slice(0, 160) + " from origin " + (originOf(request) || "(none)"));
    return new Response(null, { status: 204, headers: h });
  }

  /* Leak detector. A request from a proxied page that is NOT routed through Scramjet goes straight to the real site
     with this page's origin, so the real site's CORS rules apply and usually reject it. Those are the requests behind
     most "blocked by CORS policy" errors. Each address is logged once in the Logs panel (source "cors").
     This is the place to continue: route these requests through the proxy instead of only reporting them. */
  function leak(request) {
    if (!CFG.debug || !request) return;
    try {
      const u = new URL(request.url);
      if (u.origin === self.location.origin || !/^https?:$/.test(u.protocol)) return;
      if (request.mode === "navigate" || request.destination === "document" || request.destination === "iframe") return;
      if (!/\/service\//.test(request.referrer || "")) return;               /* only requests that came from a proxied page */
      once("l|" + u.origin + "|" + request.destination, "ESCAPED THE PROXY: " + request.method + " " + request.url.slice(0, 180) +
        " (" + (request.destination || "fetch") + ", mode " + request.mode + ", from " + (request.referrer || "").slice(0, 120) + ") - the browser will apply the real site's CORS rules to this");
    } catch (e) {}
  }

  g.HzCors = { CFG, apply, wrap, preflight, leak };
})(self);

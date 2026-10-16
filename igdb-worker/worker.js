/**
 * ReelTaste IGDB proxy — Cloudflare Worker.
 *
 * Holds the Twitch Client ID / Client Secret server-side (as Worker secrets)
 * so the public web app — and the future iPhone app — never sees them.
 *
 * The app POSTs raw IGDB "Apicalypse" queries to /igdb/<endpoint>, e.g.
 *   POST https://<worker>.workers.dev/igdb/games
 *   Body: search "Zelda"; fields name,cover.image_id,summary,genres.name; limit 10;
 *
 * The worker attaches auth (fetching/caching the Twitch OAuth token itself),
 * forwards to api.igdb.com, and caches responses at the edge for an hour to
 * stay comfortably inside IGDB's rate limits.
 *
 * Setup (dashboard, no command line):
 *   1. Cloudflare dashboard → Workers & Pages → Create → Create Worker → Deploy
 *   2. Edit code → replace everything with this file → Deploy
 *   3. Settings → Variables → add Secrets:
 *        TWITCH_CLIENT_ID     = your Twitch app Client ID
 *        TWITCH_CLIENT_SECRET = your Twitch app Client Secret
 *   4. Copy the worker URL (https://<name>.<subdomain>.workers.dev)
 */

const IGDB_API = "https://api.igdb.com/v4";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const CACHE_TTL = 3600; // seconds

// Only these IGDB endpoints are reachable through the proxy.
const ALLOWED = new Set([
  "games",
  "covers",
  "artworks",
  "screenshots",
  "videos",
  "genres",
  "themes",
  "platforms",
  "age_ratings",
  "companies",
]);

let tokenCache = { token: null, exp: 0 };

async function getToken(env) {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const u =
    `${TOKEN_URL}?client_id=${encodeURIComponent(env.TWITCH_CLIENT_ID)}` +
    `&client_secret=${encodeURIComponent(env.TWITCH_CLIENT_SECRET)}` +
    `&grant_type=client_credentials`;
  const r = await fetch(u, { method: "POST" });
  if (!r.ok) throw new Error("twitch-token-" + r.status);
  const d = await r.json();
  // Refresh 5 minutes before expiry; tokens last ~60 days.
  tokenCache = { token: d.access_token, exp: Date.now() + (d.expires_in - 300) * 1000 };
  return tokenCache.token;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function withCors(res) {
  const h = new Headers(res.headers);
  const c = corsHeaders();
  for (const k in c) h.set(k, c[k]);
  return new Response(res.body, { status: res.status, headers: h });
}

function jsonError(status, message) {
  return withCors(
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const m = url.pathname.match(/^\/igdb\/([a-z_]+)\/?$/);
    if (request.method !== "POST" || !m || !ALLOWED.has(m[1])) {
      return jsonError(404, "Use POST /igdb/<endpoint>, e.g. /igdb/games");
    }
    const endpoint = m[1];

    const body = await request.text();
    if (body.length > 4000) return jsonError(413, "query too long");
    if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
      return jsonError(500, "worker secrets TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not configured");
    }

    // Edge cache. The Cache API only stores GET, so use a synthetic GET key
    // derived from the endpoint + query body.
    const keyUrl = new URL(request.url);
    keyUrl.pathname = "/_cache/" + endpoint;
    keyUrl.search = "?q=" + encodeURIComponent(body).slice(0, 2000);
    const cacheKey = new Request(keyUrl.toString(), { method: "GET" });
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return withCors(hit);

    const doQuery = (token) =>
      fetch(`${IGDB_API}/${endpoint}`, {
        method: "POST",
        headers: {
          "Client-ID": env.TWITCH_CLIENT_ID,
          Authorization: "Bearer " + token,
          Accept: "application/json",
          "Content-Type": "text/plain",
        },
        body,
      });

    let token;
    try {
      token = await getToken(env);
    } catch (e) {
      return jsonError(502, "could not get Twitch token: " + e.message);
    }
    let ig = await doQuery(token);
    if (ig.status === 401 || ig.status === 403) {
      tokenCache = { token: null, exp: 0 }; // force refresh, retry once
      try {
        token = await getToken(env);
      } catch (e) {
        return jsonError(502, "token refresh failed: " + e.message);
      }
      ig = await doQuery(token);
    }

    const data = await ig.text();
    const res = new Response(data, {
      status: ig.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_TTL}`,
      },
    });
    if (ig.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return withCors(res);
  },
};

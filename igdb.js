/* IGDB client (game enrichment) via the Cloudflare Worker proxy.
   The Worker holds the Twitch Client ID / Secret server-side; the app only
   ever talks to the Worker URL. Users never enter anything.
   A personal Worker URL can be set in Profile settings (stored locally,
   overrides the built-in one). All lookups are cached locally to stay
   within IGDB's rate limits. */
const IGDB = (function () {
  "use strict";
  const CACHE_KEY = "mmr_igdb_cache";
  const URL_KEY = "mmr_igdb_worker_url";
  const BUILT_IN_WORKER = "https://odd-frog-61fc.crader326.workers.dev";
  const IMG = "https://images.igdb.com/igdb/image/upload/";
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (e) { cache = {}; }

  function saveCache() {
    try {
      const keys = Object.keys(cache).slice(-400); // keep the freshest 400
      const slim = {};
      keys.forEach(k => { slim[k] = cache[k]; });
      localStorage.setItem(CACHE_KEY, JSON.stringify(slim));
    } catch (e) { /* storage full: keep going without cache */ }
  }
  function userURL() { try { return localStorage.getItem(URL_KEY) || ""; } catch (e) { return ""; } }
  function setWorkerURL(u) { try { localStorage.setItem(URL_KEY, (u || "").trim()); } catch (e) {} }
  function workerURL() { return userURL().trim() || BUILT_IN_WORKER; }

  async function query(endpoint, apicalypse) {
    const r = await fetch(workerURL() + "/igdb/" + endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: apicalypse
    });
    if (!r.ok) throw new Error("igdb-" + r.status);
    return r.json();
  }

  const FIELDS = "name,summary,genres.name,cover.image_id,first_release_date,aggregated_rating,videos.video_id,age_ratings.category,age_ratings.rating";

  function norm(s) {
    return (s || "").toLowerCase()
      .replace(/^(the|a|an)\s+/, "")
      .replace(/[^a-z0-9]/g, "");
  }

  /* Pick the best search result: exact title match wins, then title
     containment, then release-year proximity. Filters out editions/DLCs
     server-side via `where version_parent = null`. */
  function pickBest(results, title, year) {
    const nt = norm(title);
    let best = null, bestScore = -1;
    for (const g of results || []) {
      let s = 0;
      const ng = norm(g.name);
      if (ng === nt) s += 100;
      else if (ng.indexOf(nt) === 0 || nt.indexOf(ng) === 0) s += 40;
      else if (ng.indexOf(nt) >= 0 || nt.indexOf(ng) >= 0) s += 15;
      if (g.first_release_date && year) {
        const gy = new Date(g.first_release_date * 1000).getFullYear();
        const d = Math.abs(gy - year);
        s += Math.max(0, 30 - d * 6);
      }
      if (g.cover && g.cover.image_id) s += 10;
      if (s > bestScore) { bestScore = s; best = g; }
    }
    return bestScore > 0 ? best : null;
  }

  /* IGDB age_ratings are numeric enums. category 1 = ESRB, 2 = PEGI. */
  const ESRB = { 1: "RP", 2: "EC", 3: "E", 4: "E10", 5: "T", 6: "M", 7: "AO" };
  const PEGI = { 1: "3", 2: "7", 3: "12", 4: "16", 5: "18" };
  function ageRating(g) {
    const ars = g.age_ratings || [];
    const esrb = ars.find(a => a.category === 1 && ESRB[a.rating]);
    if (esrb) return ESRB[esrb.rating];
    const pegi = ars.find(a => a.category === 2 && PEGI[a.rating]);
    if (pegi) return "PEGI " + PEGI[pegi.rating];
    return "";
  }

  /* Cover art, summary, genres, rating, trailer (YouTube id), age rating. */
  async function lookup(title, year) {
    const ck = "g|" + title + "|" + (year || "");
    if (ck in cache) return cache[ck];
    let out = null;
    try {
      const q = 'search "' + String(title).replace(/"/g, "") + '"; fields ' +
        FIELDS + '; where version_parent = null; limit 10;';
      const res = await query("games", q);
      const g = pickBest(res, title, year);
      if (g) {
        out = {
          id: g.id,
          name: g.name,
          cover: g.cover && g.cover.image_id ? IMG + "t_cover_big/" + g.cover.image_id + ".jpg" : null,
          summary: g.summary || "",
          genres: (g.genres || []).map(x => x.name),
          rating: g.aggregated_rating ? Math.round(g.aggregated_rating) : null,
          trailer: g.videos && g.videos[0] ? g.videos[0].video_id : null,
          esrb: ageRating(g)
        };
      }
    } catch (e) { /* offline / worker down: fall back to generated art */ }
    cache[ck] = out;
    saveCache();
    return out;
  }

  return { lookup, workerURL, userURL, setWorkerURL };
})();
if (typeof module !== "undefined") module.exports = IGDB;

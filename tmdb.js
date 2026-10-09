/* TMDB client (optional enrichment): posters + synopses.
   Needs a free API key from https://www.themoviedb.org/settings/api
   Entered by the user in Profile settings; stored in localStorage.
   All lookups are cached locally to stay within TMDB's free rate limits. */
const TMDB = (function () {
  "use strict";
  const API = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p/";
  const CACHE_KEY = "mmr_tmdb_cache";
  const KEY_KEY = "mmr_tmdb_key";
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
  function getKey() { try { return localStorage.getItem(KEY_KEY) || ""; } catch (e) { return ""; } }
  function setKey(k) { try { localStorage.setItem(KEY_KEY, (k || "").trim()); } catch (e) {} }

  async function api(path) {
    const key = getKey();
    if (!key) throw new Error("no-key");
    const sep = path.indexOf("?") >= 0 ? "&" : "?";
    const r = await fetch(API + path + sep + "api_key=" + encodeURIComponent(key));
    if (!r.ok) throw new Error("tmdb-" + r.status);
    return r.json();
  }

  /* Poster + overview for a title. imdbId (tt...) preferred when known. */
  async function lookup(title, year, imdbId, mediaType) {
    const ck = "q|" + title + "|" + (year || "") + "|" + (mediaType || "");
    if (ck in cache) return cache[ck];
    let best = null;
    try {
      if (imdbId) {
        const f = await api("/find/" + imdbId + "?external_source=imdb_id");
        const arr = (f.movie_results || []).concat(f.tv_results || []);
        if (arr.length) best = arr[0];
      }
      if (!best) {
        const mt = mediaType === "tv" ? "tv" : "movie";
        const yq = year ? (mt === "tv" ? "&first_air_date_year=" + year : "&year=" + year) : "";
        const s = await api("/search/" + mt + "?query=" + encodeURIComponent(title) + yq);
        const res = s.results || [];
        best = res.find(r => r.poster_path) || res[0] || null;
      }
    } catch (e) { /* offline / bad key / rate limit: fall back to generated art */ }
    const out = best ? {
      poster: best.poster_path ? IMG + "w500" + best.poster_path : null,
      overview: best.overview || ""
    } : null;
    cache[ck] = out;
    saveCache();
    return out;
  }

  return { getKey, setKey, lookup, hasKey: function () { return !!getKey(); } };
})();

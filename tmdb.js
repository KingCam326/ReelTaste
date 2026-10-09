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
  // Built-in shared key so users never have to enter one. If it ever stops
  // working, a personal key can be set in Profile settings (stored locally,
  // overrides this one). Note: this key is visible in the public repo source.
  const BUILT_IN_KEY = "bbefc409fba6d4169268805515795649";
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
  function userKey() { try { return localStorage.getItem(KEY_KEY) || ""; } catch (e) { return ""; } }
  function setKey(k) { try { localStorage.setItem(KEY_KEY, (k || "").trim()); } catch (e) {} }
  function getKey() { return userKey() || BUILT_IN_KEY; }

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
    let best = null, mt = mediaType === "tv" ? "tv" : "movie";
    try {
      if (imdbId) {
        const f = await api("/find/" + imdbId + "?external_source=imdb_id");
        if (f.movie_results && f.movie_results.length) { best = f.movie_results[0]; mt = "movie"; }
        else if (f.tv_results && f.tv_results.length) { best = f.tv_results[0]; mt = "tv"; }
      }
      if (!best) {
        const yq = year ? (mt === "tv" ? "&first_air_date_year=" + year : "&year=" + year) : "";
        const s = await api("/search/" + mt + "?query=" + encodeURIComponent(title) + yq);
        const res = s.results || [];
        best = res.find(r => r.poster_path) || res[0] || null;
      }
    } catch (e) { /* offline / bad key / rate limit: fall back to generated art */ }
    let out = null;
    if (best) {
      out = {
        id: best.id, mediaType: mt,
        poster: best.poster_path ? IMG + "w500" + best.poster_path : null,
        overview: best.overview || "",
        certification: await getCertification(best.id, mt)
      };
    }
    cache[ck] = out;
    saveCache();
    return out;
  }

  /* US content rating: "PG-13", "R", "TV-MA", ... ("" when unknown) */
  async function getCertification(tmdbId, mt) {
    const ck = "cert|" + mt + "|" + tmdbId;
    if (ck in cache) return cache[ck];
    let cert = "";
    try {
      if (mt === "tv") {
        const c = await api("/tv/" + tmdbId + "/content_ratings");
        const us = (c.results || []).find(r => r.iso_3166_1 === "US");
        cert = us ? (us.rating || "") : "";
      } else {
        const r = await api("/movie/" + tmdbId + "/release_dates");
        const us = (r.results || []).find(x => x.iso_3166_1 === "US");
        const rel = us ? (us.release_dates || []).find(d => d.certification) : null;
        cert = rel ? rel.certification : "";
      }
    } catch (e) {}
    cache[ck] = cert;
    saveCache();
    return cert;
  }

  /* YouTube trailer key, or null. */
  async function getTrailer(tmdbId, mt) {
    const ck = "videos|" + mt + "|" + tmdbId;
    if (ck in cache) return cache[ck];
    let key = null;
    try {
      const v = await api("/" + mt + "/" + tmdbId + "/videos");
      const res = v.results || [];
      const t = res.find(r => r.site === "YouTube" && r.type === "Trailer") ||
                res.find(r => r.site === "YouTube");
      key = t ? t.key : null;
    } catch (e) {}
    cache[ck] = key;
    saveCache();
    return key;
  }

  return { getKey, setKey, userKey, lookup, getTrailer, hasKey: function () { return true; } };
})();

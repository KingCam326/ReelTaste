/* Taste-profile engine: framework-free, works in browser and Node.
   Ratings: [{key, title, year, type:'movie'|'tv', rating (1-10), genres[], directors[]}]
   Catalog entries: {t, y, k:'m'|'tv', g[], d} */

function normTitle(s) {
  return (s || "").toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}
function makeKey(title, year) {
  return normTitle(title) + "|" + (year || "");
}

/* Parse an IMDb ratings CSV export into rating objects.
   Expected columns include: Title, Your Rating, Title Type, Year, Genres, Directors */
function parseIMDbCSV(text) {
  const rows = [];
  let cur = [], val = "", inQ = false;
  const pushRow = () => { rows.push(cur); cur = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { val += '"'; i++; }
        else inQ = false;
      } else val += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { cur.push(val); val = ""; }
    else if (c === "\n") { cur.push(val); val = ""; pushRow(); }
    else if (c === "\r") { /* skip */ }
    else val += c;
  }
  if (val !== "" || cur.length) { cur.push(val); pushRow(); }
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  const idx = n => header.indexOf(n);
  const iTitle = idx("Title"), iRate = idx("Your Rating"), iType = idx("Title Type"),
        iYear = idx("Year"), iGenres = idx("Genres"), iDir = idx("Directors");
  if (iTitle < 0 || iRate < 0) return [];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rating = parseFloat(row[iRate]);
    if (!row[iTitle] || isNaN(rating)) continue;
    const typeRaw = iType >= 0 ? row[iType] : "";
    const type = /^tv/i.test(typeRaw) ? "tv" : "movie";
    const year = iYear >= 0 ? parseInt(row[iYear], 10) || null : null;
    const genres = iGenres >= 0 && row[iGenres]
      ? row[iGenres].split(",").map(s => s.trim()).filter(Boolean) : [];
    const directors = iDir >= 0 && row[iDir]
      ? row[iDir].split(",").map(s => s.trim()).filter(Boolean) : [];
    out.push({
      key: makeKey(row[iTitle], year),
      title: row[iTitle].trim(), year, type, rating, genres, directors
    });
  }
  return out;
}

/* Build a taste profile from ratings. Uses shrinkage toward the global mean
   so genres/directors with few data points don't dominate. */
function buildProfile(ratings) {
  const profile = {
    count: ratings.length, globalAvg: 0,
    genreAvg: {}, directorAvg: {}, genreCount: {}, typeAvg: {}
  };
  if (!ratings.length) return profile;
  let sum = 0;
  const gSum = {}, gN = {}, dSum = {}, dN = {}, tSum = {}, tN = {};
  for (const r of ratings) {
    sum += r.rating;
    for (const g of r.genres || []) { gSum[g] = (gSum[g] || 0) + r.rating; gN[g] = (gN[g] || 0) + 1; }
    for (const d of r.directors || []) { dSum[d] = (dSum[d] || 0) + r.rating; dN[d] = (dN[d] || 0) + 1; }
    tSum[r.type] = (tSum[r.type] || 0) + r.rating; tN[r.type] = (tN[r.type] || 0) + 1;
  }
  const global = sum / ratings.length;
  profile.globalAvg = global;
  const KG = 6, KD = 3;
  for (const g in gSum) {
    profile.genreAvg[g] = (gSum[g] + KG * global) / (gN[g] + KG);
    profile.genreCount[g] = gN[g];
  }
  for (const d in dSum) profile.directorAvg[d] = (dSum[d] + KD * global) / (dN[d] + KD);
  for (const t in tSum) profile.typeAvg[t] = tSum[t] / tN[t];
  return profile;
}

/* Score one catalog candidate against a profile. Returns {score (1-10 scale), match (0-100), reasons[]}. */
function scoreCandidate(c, profile) {
  const reasons = [];
  const g = profile.globalAvg || 5;
  let gSum = 0, gCount = 0;
  const ranked = [];
  for (const genre of c.g || []) {
    const v = profile.genreAvg[genre] !== undefined ? profile.genreAvg[genre] : g;
    gSum += v; gCount++;
    ranked.push([genre, v]);
  }
  const genreScore = gCount ? gSum / gCount : g;
  ranked.sort((a, b) => b[1] - a[1]);
  for (const [genre, v] of ranked.slice(0, 2)) {
    if (v >= g + 0.35) reasons.push("You rate " + genre + " highly");
  }
  let dirScore = g, dirHit = false;
  if (c.d && profile.directorAvg[c.d] !== undefined) {
    dirScore = profile.directorAvg[c.d];
    if (dirScore >= g + 0.4) { reasons.push("You like " + c.d + "'s work"); dirHit = true; }
  }
  if (!dirHit && c.d) {
    // partial credit when the director is unknown but genres carry the score
  }
  const score = 0.72 * genreScore + 0.28 * dirScore;
  const match = Math.max(1, Math.min(99, Math.round(((score - 1) / 9) * 100)));
  if (!reasons.length) reasons.push("Close to your overall taste");
  return { score, match, reasons: reasons.slice(0, 3) };
}

/* Rank catalog candidates the user hasn't rated. */
function recommend(profile, seenKeys, catalog, opts) {
  opts = opts || {};
  const n = opts.limit || 20;
  const typeFilter = opts.type || "all"; // 'all' | 'movie' | 'tv'
  const seen = new Set(seenKeys);
  const out = [];
  for (const c of catalog) {
    if (typeFilter !== "all" && (typeFilter === "movie" ? c.k !== "m" : c.k !== "tv")) continue;
    if (seen.has(makeKey(c.t, c.y))) continue;
    const s = scoreCandidate(c, profile);
    out.push({ item: c, score: s.score, match: s.match, reasons: s.reasons });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, n);
}

/* Merge freshly parsed ratings into a profile's rating map (key -> rating object). */
function mergeRatings(existing, fresh) {
  const map = Object.assign({}, existing);
  for (const r of fresh) map[r.key] = r;
  return map;
}

if (typeof module !== "undefined") {
  module.exports = { normTitle, makeKey, parseIMDbCSV, buildProfile, scoreCandidate, recommend, mergeRatings };
}

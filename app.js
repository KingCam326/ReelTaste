/* ReelTaste app UI. Two modes:
     movies: CATALOG + TMDB enrichment (posters, synopses, trailers, certs)
     games:  GAMES_CATALOG + IGDB enrichment via Worker proxy (covers, summaries, trailers, ESRB)
   Depends on catalog.js (CATALOG), games-catalog.js (GAMES_CATALOG),
   engine.js, tmdb.js, igdb.js. */
(function () {
  "use strict";
  const LS_KEY = "mmr_v1";
  const MODE_KEY = "mmr_mode_v1";
  const LIKE = 8, DISLIKE = 3;
  let mode = "movies"; // 'movies' | 'games'

  /* ---------------- store ---------------- */
  function blankModeData() { return { ratings: {}, hidden: [], unseen: [], interested: [] }; }
  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY));
      if (s && s.profiles) {
        // migrate older profiles: ensure newer array fields exist
        Object.values(s.profiles).forEach(p => {
          if (!Array.isArray(p.unseen)) p.unseen = [];
          if (!Array.isArray(p.interested)) p.interested = [];
          if (!Array.isArray(p.hidden)) p.hidden = [];
          if (!p.games || typeof p.games !== "object") p.games = blankModeData();
          const g = p.games;
          if (!g.ratings || typeof g.ratings !== "object") g.ratings = {};
          if (!Array.isArray(g.unseen)) g.unseen = [];
          if (!Array.isArray(g.interested)) g.interested = [];
          if (!Array.isArray(g.hidden)) g.hidden = [];
        });
        return s;
      }
    } catch (e) {}
    return { profiles: {}, active: null };
  }
  function saveStore() { localStorage.setItem(LS_KEY, JSON.stringify(store)); }
  let store = loadStore();
  function profile() { return store.active ? store.profiles[store.active] : null; }
  function ensureProfile(name) {
    name = (name || "").trim();
    if (!name) return null;
    if (!store.profiles[name]) store.profiles[name] = Object.assign({ ratings: {}, hidden: [], unseen: [], interested: [], created: Date.now() }, { games: blankModeData() });
    store.active = name;
    saveStore();
    return store.profiles[name];
  }
  // Per-mode data container: movie fields live on the profile itself,
  // game fields live on profile.games. Keeps the two taste profiles separate.
  function md() {
    const p = profile();
    if (!p) return null;
    if (mode === "games") {
      if (!p.games) p.games = blankModeData();
      return p.games;
    }
    return p;
  }
  function activeCatalog() { return mode === "games" ? GAMES_CATALOG : CATALOG; }
  function typeLabel(k) { return k === "m" ? "Movie" : k === "tv" ? "TV" : "Game"; }
  function ratingsList() {
    const d = md();
    return d ? Object.values(d.ratings) : [];
  }
  function baseSeenKeys() {
    const d = md();
    if (!d) return new Set();
    const s = new Set(Object.keys(d.ratings));
    (d.hidden || []).forEach(k => s.add(k));
    return s;
  }
  // Recommendations: rated/hidden titles are out, but "haven't seen"
  // titles stay eligible — they're exactly what recommendations are for.
  function recSeenKeys() { return baseSeenKeys(); }
  // Swipe deck: also exclude "haven't seen" so skipped titles don't loop.
  function deckSeenKeys() {
    const s = baseSeenKeys();
    const d = md();
    if (d) (d.unseen || []).forEach(k => s.add(k));
    return s;
  }

  /* ---------------- mode ---------------- */
  function applyModeChrome() {
    document.title = mode === "games"
      ? "ReelTaste — Video Game Recommendations"
      : "ReelTaste — Movie & TV Recommendations";
    const logo = document.querySelector(".logo");
    if (logo) logo.textContent = (mode === "games" ? "🎮" : "🎬") + " ReelTaste";
  }
  function setMode(m) {
    mode = m === "games" ? "games" : "movies";
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
    document.getElementById("modePicker").hidden = true;
    applyModeChrome();
    updateHeader();
    buildDeck();
    const cur = screens.find(s => document.getElementById("screen-" + s).classList.contains("active")) || "discover";
    go(cur);
  }

  /* ---------------- art ---------------- */
  const GENRE_HUES = { Action: 8, Adventure: 32, "Sci-Fi": 215, Drama: 265, Comedy: 48, Horror: 0, Thriller: 350, Crime: 220, Fantasy: 285, War: 25, History: 40, Mystery: 300, Romance: 330, Sport: 140, Sports: 140, Music: 180, Animation: 200, Family: 90, Western: 30, RPG: 280, Shooter: 0, Strategy: 210, Racing: 20, Fighting: 350, Platformer: 200, Puzzle: 45, Stealth: 260, Survival: 95, Simulation: 180, Roguelike: 300, Party: 330 };
  function artStyle(genres, title) {
    const h = GENRE_HUES[(genres || [])[0]] ?? 230;
    let hash = 0;
    for (const ch of (title || "")) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    const h2 = (h + 40 + (hash % 60)) % 360;
    return `background:linear-gradient(135deg,hsl(${h},55%,32%),hsl(${h2},60%,18%))`;
  }
  function initial(title) { return (title || "?").trim().charAt(0).toUpperCase(); }

  /* ---------------- filters ---------------- */
  function genreList() { return [...new Set(activeCatalog().flatMap(c => c.g))].sort(); }
  let discoverGenres = new Set();
  let swipeGenres = new Set();
  let swipeFilter = "all";
  /* Year ranges: multi-select buckets, 10 per mode, 70s → present. */
  const YEAR_RANGES = {
    movies: [
      { label: "70s", min: 1970, max: 1979 },
      { label: "80s", min: 1980, max: 1989 },
      { label: "1990–95", min: 1990, max: 1995 },
      { label: "1996–2000", min: 1996, max: 2000 },
      { label: "2001–05", min: 2001, max: 2005 },
      { label: "2006–10", min: 2006, max: 2010 },
      { label: "2011–14", min: 2011, max: 2014 },
      { label: "2015–18", min: 2015, max: 2018 },
      { label: "2019–21", min: 2019, max: 2021 },
      { label: "2022+", min: 2022, max: 2100 }
    ],
    games: [
      { label: "1990–96", min: 1990, max: 1996 },
      { label: "1997–2000", min: 1997, max: 2000 },
      { label: "2001–04", min: 2001, max: 2004 },
      { label: "2005–08", min: 2005, max: 2008 },
      { label: "2009–12", min: 2009, max: 2012 },
      { label: "2013–15", min: 2013, max: 2015 },
      { label: "2016–17", min: 2016, max: 2017 },
      { label: "2018–19", min: 2018, max: 2019 },
      { label: "2020–22", min: 2020, max: 2022 },
      { label: "2023+", min: 2023, max: 2100 }
    ]
  };
  let discoverYears = new Set();
  let swipeYears = new Set();
  function filteredCatalog(typeFilter, genreSet, yearSet) {
    const ranges = YEAR_RANGES[mode];
    return activeCatalog().filter(c => {
      const typeOk = typeFilter === "all" || (typeFilter === "movie" ? c.k === "m" : c.k === "tv");
      const genreOk = !genreSet.size || c.g.some(g => genreSet.has(g));
      const yearOk = !yearSet.size || [...yearSet].some(i => {
        const r = ranges[i];
        return r && c.y >= r.min && c.y <= r.max;
      });
      return typeOk && genreOk && yearOk;
    });
  }
  /* Multi-select chip rows: genres and year ranges share this renderer. */
  function chipRowHTML(rowLabel, selected, items, opt) {
    const clear = selected.size ? `<button class="chip clear" data-${opt.attr}clear title="Clear">✕</button>` : "";
    return `<span class="chip-label">${rowLabel}:</span>` + clear + items.map((it, i) => {
      const k = opt.key(it, i);
      return `<button class="chip${selected.has(k) ? " on" : ""}" data-${opt.attr}="${escapeHTML(String(k))}">${escapeHTML(opt.label(it, i))}</button>`;
    }).join("");
  }
  function bindChipRow(el, selected, attr, onChange) {
    el.querySelectorAll(`[data-${attr}]`).forEach(ch => ch.onclick = () => {
      const k = attr === "year" ? +ch.dataset[attr] : ch.dataset[attr];
      if (selected.has(k)) selected.delete(k); else selected.add(k);
      onChange();
    });
    const clr = el.querySelector(`[data-${attr}clear]`);
    if (clr) clr.onclick = () => { selected.clear(); onChange(); };
  }
  const GENRE_OPT = { attr: "genre", key: g => g, label: g => g };
  const YEAR_OPT = { attr: "year", key: (r, i) => i, label: r => r.label };
  function isInterested(c) {
    const d = md();
    return !!d && (d.interested || []).includes(makeKey(c.t, c.y));
  }
  // Poster/cover + content-rating enrichment for a rendered card element.
  function enrichCardEl(cardEl, c) {
    if (mode === "games") {
      IGDB.lookup(c.t, c.y).then(info => {
        if (!info || !cardEl.isConnected) return;
        if (info.cover) {
          const init = cardEl.querySelector(".card-initial");
          if (init) {
            const img = document.createElement("img");
            img.className = "card-poster"; img.alt = c.t; img.src = info.cover;
            img.onerror = () => img.remove();
            init.replaceWith(img);
          }
        }
        const certEl = cardEl.querySelector(".cert");
        if (certEl && info.esrb) certEl.textContent = info.esrb;
      });
      return;
    }
    TMDB.lookup(c.t, c.y, null, c.k === "m" ? "movie" : "tv").then(info => {
      if (!info || !cardEl.isConnected) return;
      if (info.poster) {
        const init = cardEl.querySelector(".card-initial");
        if (init) {
          const img = document.createElement("img");
          img.className = "card-poster"; img.alt = c.t; img.src = info.poster;
          img.onerror = () => img.remove();
          init.replaceWith(img);
        }
      }
      const certEl = cardEl.querySelector(".cert");
      if (certEl && info.certification) certEl.textContent = info.certification;
    });
  }

  /* ---------------- router ---------------- */
  const screens = ["discover", "swipe", "import", "interested", "profile"];
  function go(name) {
    screens.forEach(s => document.getElementById("screen-" + s).classList.toggle("active", s === name));
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.screen === name));
    if (name === "discover") renderDiscover();
    if (name === "swipe") renderSwipe();
    if (name === "import") renderImport();
    if (name === "interested") renderInterested();
    if (name === "profile") renderProfile();
    window.scrollTo(0, 0);
  }

  /* ---------------- discover ---------------- */
  let discoverFilter = "all";
  function renderDiscover() {
    const el = document.getElementById("screen-discover");
    const d = md(), list = ratingsList();
    if (!d) { el.innerHTML = emptyProfileHTML(); bindEmpty(el); return; }
    if (!list.length) { el.innerHTML = emptyRatingsHTML(); bindEmpty(el); return; }
    const prof = buildProfile(list);
    const pool = filteredCatalog(discoverFilter, discoverGenres, discoverYears);
    const recs = recommend(prof, [...recSeenKeys()], pool, { limit: 60 });
    const typeChips = mode === "movies"
      ? `<div class="chips">${[["all", "All"], ["movie", "Movies"], ["tv", "TV Shows"]]
          .map(([v, l]) => `<button class="chip${discoverFilter === v ? " on" : ""}" data-f="${v}">${l}</button>`).join("")}</div>`
      : "";
    const emptyMsg = (discoverGenres.size || discoverYears.size || discoverFilter !== "all")
      ? `<p class="muted">No titles match those filters — try fewer genres or another type.</p>`
      : `<p class="muted">No more unseen titles in the catalog. Swipe for more!</p>`;
    el.innerHTML = `
      ${typeChips}
      <div class="chips genres">${chipRowHTML("Genres", discoverGenres, genreList(), GENRE_OPT)}</div>
      <div class="chips years">${chipRowHTML("Years", discoverYears, YEAR_RANGES[mode], YEAR_OPT)}</div>
      <div class="rec-list">${recs.map((r, i) => cardHTML(r, i)).join("") || emptyMsg}</div>`;
    el.querySelectorAll("[data-f]").forEach(c => c.onclick = () => { discoverFilter = c.dataset.f; renderDiscover(); });
    bindChipRow(el, discoverGenres, "genre", renderDiscover);
    bindChipRow(el, discoverYears, "year", renderDiscover);
    el.querySelectorAll("[data-hide]").forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      md().hidden.push(b.dataset.hide); saveStore(); renderDiscover();
    });
    el.querySelectorAll("[data-heart]").forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const r = recs[+b.dataset.heart]; if (!r) return;
      const dd = md(); if (!dd) return;
      dd.interested = dd.interested || [];
      const key = makeKey(r.item.t, r.item.y);
      const ix = dd.interested.indexOf(key);
      if (ix >= 0) dd.interested.splice(ix, 1); else dd.interested.push(key);
      saveStore();
      b.classList.toggle("on", ix < 0);
    });
    el.querySelectorAll("[data-trailer]").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const r = recs[+b.dataset.trailer]; if (!r) return;
      const c = r.item, orig = b.textContent;
      b.textContent = "…"; b.disabled = true;
      let key = null;
      if (mode === "games") {
        const info = await IGDB.lookup(c.t, c.y);
        key = info && info.trailer;
      } else {
        const info = await TMDB.lookup(c.t, c.y, null, c.k === "m" ? "movie" : "tv");
        if (info && info.id) key = await TMDB.getTrailer(info.id, info.mediaType);
      }
      b.textContent = orig; b.disabled = false;
      if (key) openTrailerModal(c.t, key);
    });
    const enrichCard = (cardEl) => {
      const r = recs[+cardEl.dataset.idx];
      if (r) enrichCardEl(cardEl, r.item);
    };
    // Lazy-enrich cards as they scroll into view: posters + content ratings,
    // throttled naturally by scrolling so we stay inside the free rate limit.
    const cards = el.querySelectorAll(".card[data-idx]");
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          io.unobserve(en.target);
          enrichCard(en.target);
        });
      }, { rootMargin: "300px" });
      cards.forEach(cardEl => io.observe(cardEl));
    } else {
      cards.forEach((cardEl, i) => { if (i < 15) enrichCard(cardEl); });
    }
  }
  function openTrailerModal(title, youtubeKey) {
    closeTrailerModal();
    const ov = document.createElement("div");
    ov.className = "trailer-overlay"; ov.id = "trailerOverlay";
    ov.innerHTML = `<div class="trailer-box">
      <div class="trailer-head"><span>${escapeHTML(title)} — Trailer</span><button class="trailer-close" aria-label="Close">✕</button></div>
      <div class="trailer-loading muted">Loading trailer…</div>
    </div>`;
    ov.querySelector(".trailer-close").onclick = closeTrailerModal;
    ov.addEventListener("click", (e) => { if (e.target === ov) closeTrailerModal(); });
    document.body.appendChild(ov);
    const box = ov.querySelector(".trailer-box");
    if (!box || !box.isConnected) return;
    const loading = box.querySelector(".trailer-loading");
    const fr = document.createElement("iframe");
    fr.src = "https://www.youtube.com/embed/" + youtubeKey + "?autoplay=1&rel=0";
    fr.allow = "autoplay; encrypted-media; fullscreen";
    fr.allowFullscreen = true;
    loading.replaceWith(fr);
  }
  function closeTrailerModal() {
    const ov = document.getElementById("trailerOverlay");
    if (ov) ov.remove();
  }

  /* ---------------- interested ---------------- */
  function renderInterested() {
    const el = document.getElementById("screen-interested");
    const d = md();
    if (!d) { el.innerHTML = emptyProfileHTML(); bindEmpty(el); return; }
    const cat = activeCatalog();
    const items = (d.interested || [])
      .map(k => cat.find(c => makeKey(c.t, c.y) === k))
      .filter(Boolean);
    if (!items.length) {
      el.innerHTML = `<div class="empty"><h2>Nothing saved yet</h2>
        <p>Tap the ♥ on any For You card to save it here.</p>
        <button class="btn primary" data-go="discover">Find something</button></div>`;
      bindEmpty(el); return;
    }
    el.innerHTML = `<h2 class="screen-title">Interested ♥</h2>
      <div class="rec-list">${items.map(interestedCardHTML).join("")}</div>`;
    el.querySelectorAll("[data-unheart]").forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const dd = md(); if (!dd) return;
      dd.interested = (dd.interested || []).filter(k => k !== b.dataset.unheart);
      saveStore(); renderInterested();
    });
    el.querySelectorAll("[data-itrailer]").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const c = activeCatalog().find(x => makeKey(x.t, x.y) === b.dataset.itrailer); if (!c) return;
      const orig = b.textContent; b.textContent = "…"; b.disabled = true;
      let key = null;
      if (mode === "games") {
        const info = await IGDB.lookup(c.t, c.y);
        key = info && info.trailer;
      } else {
        const info = await TMDB.lookup(c.t, c.y, null, c.k === "m" ? "movie" : "tv");
        if (info && info.id) key = await TMDB.getTrailer(info.id, info.mediaType);
      }
      b.textContent = orig; b.disabled = false;
      if (key) openTrailerModal(c.t, key);
    });
    el.querySelectorAll(".card[data-tkey]").forEach(cardEl => {
      const c = activeCatalog().find(x => makeKey(x.t, x.y) === cardEl.dataset.tkey);
      if (c) enrichCardEl(cardEl, c);
    });
  }
  function interestedCardHTML(c) {
    const key = makeKey(c.t, c.y);
    return `<div class="card" data-tkey="${key}" style="${artStyle(c.g, c.t)}">
      <div class="card-initial">${initial(c.t)}</div>
      <div class="card-body">
        <div class="card-title">${escapeHTML(c.t)}</div>
        <div class="card-meta"><span class="cert"></span>${c.y} · ${typeLabel(c.k)} · ${c.g.slice(0, 3).join(" · ")}</div>
        <div class="card-actions"><button class="trailer-btn" data-itrailer="${key}">▶ Trailer</button></div>
      </div>
      <button class="hide" data-unheart="${key}" title="Remove">✕</button>
    </div>`;
  }
  function cardHTML(r, i) {
    const c = r.item;
    return `<div class="card" data-idx="${i}" style="${artStyle(c.g, c.t)}">
      <div class="card-initial">${initial(c.t)}</div>
      <div class="card-body">
        <div class="card-title">${escapeHTML(c.t)}</div>
        <div class="card-meta"><span class="cert"></span>${c.y} · ${typeLabel(c.k)} · ${c.g.slice(0, 3).join(" · ")}</div>
        <div class="card-why">${r.reasons.map(escapeHTML).join(" · ")}</div>
        <div class="card-actions">
          <button class="trailer-btn" data-trailer="${i}">▶ Trailer</button>
          <button class="heart-btn${isInterested(c) ? " on" : ""}" data-heart="${i}" title="Save to Interested">♥</button>
        </div>
      </div>
      <div class="match">${r.match}<span>%</span></div>
      <button class="hide" data-hide="${makeKey(c.t, c.y)}" title="Hide">✕</button>
    </div>`;
  }
  // hide key must match makeKey: store normalized key instead
  function emptyProfileHTML() {
    return `<div class="empty"><h2>Welcome 👋</h2><p>Create a profile to start getting recommendations.</p>
      <button class="btn primary" data-go="profile">Create profile</button></div>`;
  }
  function emptyRatingsHTML() {
    if (mode === "games") {
      return `<div class="empty"><h2>No ratings yet</h2><p>Swipe through games — I'll learn your taste from your picks.</p>
        <div class="row"><button class="btn primary" data-go="swipe">Start swiping</button></div></div>`;
    }
    return `<div class="empty"><h2>No ratings yet</h2><p>Import your IMDb ratings or swipe through titles — I'll learn your taste from either.</p>
      <div class="row"><button class="btn primary" data-go="import">Import IMDb</button>
      <button class="btn" data-go="swipe">Start swiping</button></div></div>`;
  }
  function bindEmpty(el) { el.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go)); }
  function escapeHTML(s) { return String(s).replace(/[&<>"']/g, m => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[m])); }

  /* ---------------- swipe ---------------- */
  let deck = [], deckIdx = 0, undoStack = [];
  function buildDeck() {
    const seen = deckSeenKeys();
    deck = filteredCatalog(swipeFilter, swipeGenres, swipeYears).filter(c => !seen.has(makeKey(c.t, c.y)));
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    deck = deck.slice(0, 60);
    deckIdx = 0; undoStack = [];
  }
  function renderSwipe() {
    const el = document.getElementById("screen-swipe");
    const d = md();
    if (!d) { el.innerHTML = emptyProfileHTML(); bindEmpty(el); return; }
    if (!deck.length || deckIdx >= deck.length) buildDeck();
    if (!deck.length) {
      const filtered = swipeFilter !== "all" || swipeGenres.size > 0 || swipeYears.size > 0;
      el.innerHTML = `<div class="empty"><h2>${filtered ? "No matches" : "All caught up 🎉"}</h2>
        <p>${filtered ? "No titles match those filters — try fewer genres or another type." : "You've rated everything in the catalog. Check your recommendations!"}</p>
        ${filtered ? `<button class="btn primary" id="clearSwipeFilters">Clear filters</button>`
                    : `<button class="btn primary" data-go="discover">See recommendations</button>`}</div>`;
      bindEmpty(el);
      const clr = document.getElementById("clearSwipeFilters");
      if (clr) clr.onclick = () => { swipeFilter = "all"; swipeGenres.clear(); swipeYears.clear(); buildDeck(); renderSwipe(); };
      return;
    }
    const c = deck[deckIdx];
    const n = ratingsList().length;
    const typeChips = mode === "movies"
      ? `<div class="chips">${[["all", "All"], ["movie", "Movies"], ["tv", "TV Shows"]]
          .map(([v, l]) => `<button class="chip${swipeFilter === v ? " on" : ""}" data-stype="${v}">${l}</button>`).join("")}</div>`
      : "";
    el.innerHTML = `
      <div class="swipe-top muted">${deck.length - deckIdx} left · ${n} rated</div>
      ${typeChips}
      <div class="chips genres">${chipRowHTML("Genres", swipeGenres, genreList(), GENRE_OPT)}</div>
      <div class="chips years">${chipRowHTML("Years", swipeYears, YEAR_RANGES[mode], YEAR_OPT)}</div>
      <div class="deck"><div class="swipe-card" id="swipeCard" style="${artStyle(c.g, c.t)}">
        <div class="swipe-initial">${initial(c.t)}</div>
        <div class="stamp like">LIKE</div><div class="stamp nope">NOPE</div><div class="stamp unseen">UNSEEN</div>
        <div class="swipe-info"><div class="swipe-title">${escapeHTML(c.t)}</div>
        <div class="swipe-meta">${c.y} · ${typeLabel(c.k)} · ${c.g.slice(0, 3).join(" · ")}</div></div>
      </div></div>
      <div class="swipe-btns">
        <button class="sbtn nope" id="btnNope" aria-label="Dislike">✕</button>
        <button class="sbtn undo" id="btnUndo" aria-label="Undo" ${undoStack.length ? "" : "disabled"}>↩</button>
        <button class="sbtn unseen" id="btnUnseen" aria-label="Haven't seen">?</button>
        <button class="sbtn like" id="btnLike" aria-label="Like">♥</button>
      </div>
      <div class="swipe-hint muted">drag &larr; nope &nbsp;·&nbsp; &uarr; haven't seen &nbsp;·&nbsp; &rarr; like &nbsp;·&nbsp; tap synopsis to expand</div>`;
    const card = document.getElementById("swipeCard");
    el.querySelectorAll("[data-stype]").forEach(ch => ch.onclick = () => { swipeFilter = ch.dataset.stype; buildDeck(); renderSwipe(); });
    bindChipRow(el, swipeGenres, "genre", () => { buildDeck(); renderSwipe(); });
    bindChipRow(el, swipeYears, "year", () => { buildDeck(); renderSwipe(); });
    document.getElementById("btnNope").onclick = () => rate(DISLIKE);
    document.getElementById("btnLike").onclick = () => rate(LIKE);
    document.getElementById("btnUnseen").onclick = () => markUnseen();
    document.getElementById("btnUndo").onclick = undo;
    enableDrag(card);
    enrichSwipeCard(card, c);
  }
  /* Swap in a real poster/cover + synopsis when enrichment is available. */
  function enrichSwipeCard(card, c) {
    if (mode === "games") {
      IGDB.lookup(c.t, c.y).then(info => {
        if (!info || !card.isConnected) return;
        if (info.cover) {
          const init = card.querySelector(".swipe-initial");
          const img = document.createElement("img");
          img.className = "poster"; img.alt = c.t; img.src = info.cover;
          img.onerror = () => img.remove();
          if (init) init.replaceWith(img); else card.prepend(img);
        }
        if (info.summary) appendOverview(card, info.summary);
      });
      return;
    }
    if (!TMDB.hasKey()) return;
    TMDB.lookup(c.t, c.y, null, c.k === "m" ? "movie" : "tv").then(info => {
      if (!info || !card.isConnected) return;
      if (info.poster) {
        const init = card.querySelector(".swipe-initial");
        const img = document.createElement("img");
        img.className = "poster"; img.alt = c.t; img.src = info.poster;
        img.onerror = () => img.remove();
        if (init) init.replaceWith(img); else card.prepend(img);
      }
      if (info.overview) appendOverview(card, info.overview);
    });
  }
  function appendOverview(card, text) {
    const infoBox = card.querySelector(".swipe-info");
    if (infoBox && !infoBox.querySelector(".swipe-overview")) {
      const ov = document.createElement("div");
      ov.className = "swipe-overview";
      ov.textContent = text;
      ov.title = "Tap to expand";
      ov.addEventListener("click", () => {
        if (card.dataset.dragged === "1") return; // was a swipe, not a tap
        ov.classList.toggle("expanded");
      });
      infoBox.appendChild(ov);
    }
  }
  function rate(v) {
    const c = deck[deckIdx];
    const d = md();
    const key = makeKey(c.t, c.y);
    undoStack.push({ kind: "rating", key, prev: d.ratings[key] || null });
    d.ratings[key] = {
      key, title: c.t, year: c.y,
      type: c.k === "m" ? "movie" : c.k === "tv" ? "tv" : "game",
      rating: v, genres: c.g, directors: c.d ? [c.d] : []
    };
    saveStore(); deckIdx++;
    renderSwipe();
  }
  function markUnseen() {
    const c = deck[deckIdx];
    const d = md();
    const key = makeKey(c.t, c.y);
    d.unseen = d.unseen || [];
    if (!d.unseen.includes(key)) { d.unseen.push(key); undoStack.push({ kind: "unseen", key }); }
    saveStore(); deckIdx++;
    renderSwipe();
  }
  function undo() {
    const last = undoStack.pop();
    if (!last) return;
    const d = md();
    if (last.kind === "unseen") {
      d.unseen = (d.unseen || []).filter(k => k !== last.key);
    } else if (last.prev) d.ratings[last.key] = last.prev; else delete d.ratings[last.key];
    saveStore(); deckIdx = Math.max(0, deckIdx - 1);
    renderSwipe();
  }
  function enableDrag(card) {
    let sx = 0, sy = 0, dx = 0, dy = 0, dragging = false;
    const like = card.querySelector(".stamp.like"), nope = card.querySelector(".stamp.nope"),
          unseen = card.querySelector(".stamp.unseen");
    card.addEventListener("pointerdown", e => { dragging = true; sx = e.clientX; sy = e.clientY; card.dataset.dragged = "0"; card.setPointerCapture(e.pointerId); });
    card.addEventListener("pointermove", e => {
      if (!dragging) return;
      dx = e.clientX - sx; dy = e.clientY - sy;
      card.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 12}deg)`;
      like.style.opacity = dx > 40 && dx > -dy ? Math.min(1, dx / 120) : 0;
      nope.style.opacity = dx < -40 && -dx > -dy ? Math.min(1, -dx / 120) : 0;
      unseen.style.opacity = dy < -40 && -dy > Math.abs(dx) ? Math.min(1, -dy / 120) : 0;
    });
    const end = () => {
      if (!dragging) return; dragging = false;
      card.dataset.dragged = (Math.abs(dx) > 12 || Math.abs(dy) > 12) ? "1" : "0";
      if (dy < -90 && -dy > Math.abs(dx)) markUnseen();
      else if (dx > 90) rate(LIKE);
      else if (dx < -90) rate(DISLIKE);
      else { card.style.transform = ""; like.style.opacity = 0; nope.style.opacity = 0; unseen.style.opacity = 0; }
      dx = 0; dy = 0;
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
  }

  /* ---------------- import ---------------- */
  function renderImport() {
    document.getElementById("importMovies").hidden = mode !== "movies";
    const g = document.getElementById("importGames");
    g.hidden = mode !== "games";
    bindEmpty(g);
  }
  function bindImportDropzone() {
    const dz = document.getElementById("dropzone"), fi = document.getElementById("fileInput");
    if (!dz || !fi) return;
    dz.onclick = () => fi.click();
    fi.onchange = () => fi.files[0] && handleFile(fi.files[0]);
    ["dragover", "dragenter"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  }
  function handleFile(file) {
    const rd = new FileReader();
    rd.onload = () => {
      const parsed = parseIMDbCSV(rd.result);
      const p = profile();
      if (!p) { alert("Create a profile first."); go("profile"); return; }
      const before = Object.keys(p.ratings).length;
      p.ratings = mergeRatings(p.ratings, parsed);
      saveStore();
      const added = Object.keys(p.ratings).length - before;
      const list = ratingsList(), prof = buildProfile(list);
      const topG = Object.entries(prof.genreAvg).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);
      const topD = Object.entries(prof.directorAvg).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([d]) => d);
      document.getElementById("importResult").innerHTML = `
        <div class="ok">✅ Imported ${parsed.length} titles (${added} new). You now have ${list.length} rated titles.</div>
        <div class="chips"><span class="muted">Your top genres:</span>${topG.map(g => `<span class="chip on">${escapeHTML(g)}</span>`).join("")}</div>
        ${topD.length ? `<div class="chips"><span class="muted">Top directors:</span>${topD.map(d => `<span class="chip">${escapeHTML(d)}</span>`).join("")}</div>` : ""}
        <button class="btn primary" id="toDiscover">See my recommendations</button>`;
      document.getElementById("toDiscover").onclick = () => go("discover");
    };
    rd.readAsText(file);
  }

  /* ---------------- profile screen ---------------- */
  function renderProfile() {
    const el = document.getElementById("screen-profile");
    const names = Object.keys(store.profiles);
    const d = md(), list = ratingsList();
    let stats = "";
    if (d && list.length) {
      const prof = buildProfile(list);
      const topG = Object.entries(prof.genreAvg).sort((a, b) => b[1] - a[1]).slice(0, 5);
      stats = `<div class="statgrid">
          <div class="stat"><b>${list.length}</b><span>${mode === "games" ? "games" : "titles"} rated</span></div>
          <div class="stat"><b>${prof.globalAvg.toFixed(1)}</b><span>avg rating</span></div>
        </div>
        <h3>Top genres</h3><div class="chips">${topG.map(([g, v]) => `<span class="chip on">${escapeHTML(g)} ${v.toFixed(1)}</span>`).join("")}</div>`;
    }
    const enrichSection = mode === "games" ? `
      <h3>Covers &amp; details</h3>
      <p class="muted small">Game data loads automatically through your IGDB proxy — no setup needed. Only change the Worker URL below if you deploy your own.</p>
      <div class="row"><input id="igdbUrl" placeholder="Worker URL" maxlength="120" value="${escapeHTML(IGDB.userURL())}" />
      <button class="btn sm" id="saveWorkerBtn">Save</button></div>
      <div id="keyMsg" class="muted small"></div>` : `
      <h3>Posters &amp; synopses</h3>
      <p class="muted small">Posters load automatically — no setup needed. Only enter your own TMDB key below if they ever stop loading.</p>
      <div class="row"><input id="tmdbKey" placeholder="Optional: your own TMDB key" maxlength="64" value="${escapeHTML(TMDB.userKey())}" />
      <button class="btn sm" id="saveKeyBtn">Save</button></div>
      <div id="keyMsg" class="muted small"></div>`;
    const gameCount = n => Object.keys(((store.profiles[n] || {}).games || {}).ratings || {}).length;
    el.innerHTML = `
      <h2>Profiles</h2>
      <div class="plist">${names.map(n => `
        <div class="prow${n === store.active ? " on" : ""}">
          <span class="pname">${escapeHTML(n)}</span>
          <span class="muted">${Object.keys(store.profiles[n].ratings).length}🎬 ${gameCount(n)}🎮</span>
          ${n === store.active ? `<span class="badge">active</span>` : `<button class="btn sm" data-switch="${escapeHTML(n)}">Switch</button>`}
          <button class="btn sm danger" data-del="${escapeHTML(n)}">Delete</button>
        </div>`).join("") || `<p class="muted">No profiles yet.</p>`}</div>
      <div class="row"><input id="newName" placeholder="New username" maxlength="24" />
      <button class="btn primary" id="createBtn">Create</button></div>
      ${stats}
      ${enrichSection}
      <h3>Data</h3>
      <div class="row"><button class="btn sm" id="exportBtn">Export ratings (JSON)</button>
      <button class="btn sm danger" id="wipeBtn">Clear this profile</button></div>`;
    document.getElementById("createBtn").onclick = () => {
      const n = document.getElementById("newName").value;
      if (ensureProfile(n)) { updateHeader(); renderProfile(); } else alert("Enter a username.");
    };
    const saveKeyBtn = document.getElementById("saveKeyBtn");
    if (saveKeyBtn) saveKeyBtn.onclick = () => {
      TMDB.setKey(document.getElementById("tmdbKey").value);
      document.getElementById("keyMsg").textContent = TMDB.userKey()
        ? "Saved ✓ — using your personal key."
        : "Cleared — using the built-in key.";
    };
    const saveWorkerBtn = document.getElementById("saveWorkerBtn");
    if (saveWorkerBtn) saveWorkerBtn.onclick = () => {
      IGDB.setWorkerURL(document.getElementById("igdbUrl").value);
      document.getElementById("keyMsg").textContent = IGDB.userURL()
        ? "Saved ✓ — using your Worker URL."
        : "Cleared — using the built-in Worker.";
    };
    el.querySelectorAll("[data-switch]").forEach(b => b.onclick = () => { store.active = b.dataset.switch; saveStore(); updateHeader(); buildDeck(); renderProfile(); });
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
      if (!confirm("Delete profile '" + b.dataset.del + "'?")) return;
      delete store.profiles[b.dataset.del];
      if (store.active === b.dataset.del) store.active = Object.keys(store.profiles)[0] || null;
      saveStore(); updateHeader(); buildDeck(); renderProfile();
    });
    document.getElementById("exportBtn").onclick = () => {
      const dd = md();
      if (!dd) return;
      const blob = new Blob([JSON.stringify({ profile: store.active, mode, ratings: dd.ratings }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = store.active + "-" + mode + "-ratings.json"; a.click();
    };
    document.getElementById("wipeBtn").onclick = () => {
      const dd = md();
      if (!dd || !confirm("Clear all " + (mode === "games" ? "game" : "movie/TV") + " ratings for '" + store.active + "'?")) return;
      dd.ratings = {}; dd.hidden = []; saveStore(); buildDeck(); renderProfile();
    };
  }
  function updateHeader() {
    document.getElementById("profileChip").textContent = store.active ? "👤 " + store.active : "👤 Guest";
    const mt = document.getElementById("modeToggle");
    if (mt) {
      mt.textContent = mode === "games" ? "🎮" : "🎬";
      mt.title = mode === "games" ? "Switch to Movies & TV" : "Switch to Games";
    }
  }

  /* ---------------- init ---------------- */
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".tab").forEach(b => b.onclick = () => go(b.dataset.screen));
    document.getElementById("profileChip").onclick = () => go("profile");
    document.getElementById("modeToggle").onclick = () => setMode(mode === "games" ? "movies" : "games");
    document.querySelectorAll("[data-modepick]").forEach(b => b.onclick = () => setMode(b.dataset.modepick));
    bindImportDropzone();
    let saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch (e) {}
    if (saved === "games" || saved === "movies") {
      mode = saved;
      document.getElementById("modePicker").hidden = true;
    } else {
      document.getElementById("modePicker").hidden = false;
    }
    applyModeChrome();
    updateHeader();
    if (!store.active) go("profile"); else go("discover");
  });
})();

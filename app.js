/* Movie Recommender app UI. Depends on catalog.js (CATALOG) and engine.js. */
(function () {
  "use strict";
  const LS_KEY = "mmr_v1";
  const LIKE = 8, DISLIKE = 3;

  /* ---------------- store ---------------- */
  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY));
      if (s && s.profiles) return s;
    } catch (e) {}
    return { profiles: {}, active: null };
  }
  function saveStore() { localStorage.setItem(LS_KEY, JSON.stringify(store)); }
  let store = loadStore();
  function profile() { return store.active ? store.profiles[store.active] : null; }
  function ensureProfile(name) {
    name = (name || "").trim();
    if (!name) return null;
    if (!store.profiles[name]) store.profiles[name] = { ratings: {}, hidden: [], created: Date.now() };
    store.active = name;
    saveStore();
    return store.profiles[name];
  }
  function ratingsList() {
    const p = profile();
    return p ? Object.values(p.ratings) : [];
  }
  function baseSeenKeys() {
    const p = profile();
    if (!p) return new Set();
    const s = new Set(Object.keys(p.ratings));
    (p.hidden || []).forEach(k => s.add(k));
    return s;
  }
  // Recommendations: rated/hidden titles are out, but "haven't seen"
  // titles stay eligible — they're exactly what recommendations are for.
  function recSeenKeys() { return baseSeenKeys(); }
  // Swipe deck: also exclude "haven't seen" so skipped titles don't loop.
  function deckSeenKeys() {
    const s = baseSeenKeys();
    const p = profile();
    if (p) (p.unseen || []).forEach(k => s.add(k));
    return s;
  }

  /* ---------------- art ---------------- */
  const GENRE_HUES = { Action: 8, Adventure: 32, "Sci-Fi": 215, Drama: 265, Comedy: 48, Horror: 0, Thriller: 350, Crime: 220, Fantasy: 285, War: 25, History: 40, Mystery: 300, Romance: 330, Sport: 140, Music: 180, Animation: 200, Family: 90, Western: 30 };
  function artStyle(genres, title) {
    const h = GENRE_HUES[(genres || [])[0]] ?? 230;
    let hash = 0;
    for (const ch of (title || "")) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    const h2 = (h + 40 + (hash % 60)) % 360;
    return `background:linear-gradient(135deg,hsl(${h},55%,32%),hsl(${h2},60%,18%))`;
  }
  function initial(title) { return (title || "?").trim().charAt(0).toUpperCase(); }

  /* ---------------- router ---------------- */
  const screens = ["discover", "swipe", "import", "profile"];
  function go(name) {
    screens.forEach(s => document.getElementById("screen-" + s).classList.toggle("active", s === name));
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.screen === name));
    if (name === "discover") renderDiscover();
    if (name === "swipe") renderSwipe();
    if (name === "profile") renderProfile();
    window.scrollTo(0, 0);
  }

  /* ---------------- discover ---------------- */
  let discoverFilter = "all";
  function renderDiscover() {
    const el = document.getElementById("screen-discover");
    const p = profile(), list = ratingsList();
    if (!p) { el.innerHTML = emptyProfileHTML(); bindEmpty(el); return; }
    if (!list.length) { el.innerHTML = emptyRatingsHTML(); bindEmpty(el); return; }
    const prof = buildProfile(list);
    const recs = recommend(prof, [...recSeenKeys()], CATALOG, { limit: 60, type: discoverFilter });
    const chips = [["all", "All"], ["movie", "Movies"], ["tv", "TV Shows"]]
      .map(([v, l]) => `<button class="chip${discoverFilter === v ? " on" : ""}" data-f="${v}">${l}</button>`).join("");
    el.innerHTML = `
      <div class="chips">${chips}</div>
      <div class="rec-list">${recs.map((r, i) => cardHTML(r, i)).join("") || `<p class="muted">No more unseen titles in the catalog. Swipe for more!</p>`}</div>`;
    el.querySelectorAll(".chip").forEach(c => c.onclick = () => { discoverFilter = c.dataset.f; renderDiscover(); });
    el.querySelectorAll("[data-hide]").forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      profile().hidden.push(b.dataset.hide); saveStore(); renderDiscover();
    });
    el.querySelectorAll("[data-trailer]").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const r = recs[+b.dataset.trailer]; if (!r) return;
      const c = r.item, orig = b.textContent;
      b.textContent = "…"; b.disabled = true;
      const info = await TMDB.lookup(c.t, c.y, null, c.k === "m" ? "movie" : "tv");
      b.textContent = orig; b.disabled = false;
      if (info && info.id) openTrailerModal(c.t, info.id, info.mediaType);
    });
    const enrichCard = (cardEl) => {
      const r = recs[+cardEl.dataset.idx]; if (!r) return;
      const c = r.item;
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
  function openTrailerModal(title, tmdbId, mt) {
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
    TMDB.getTrailer(tmdbId, mt).then(key => {
      const box = ov.querySelector(".trailer-box");
      if (!box || !box.isConnected) return;
      const loading = box.querySelector(".trailer-loading");
      if (key) {
        const fr = document.createElement("iframe");
        fr.src = "https://www.youtube.com/embed/" + key + "?autoplay=1&rel=0";
        fr.allow = "autoplay; encrypted-media; fullscreen";
        fr.allowFullscreen = true;
        loading.replaceWith(fr);
      } else {
        loading.textContent = "No trailer found for this title.";
      }
    });
  }
  function closeTrailerModal() {
    const ov = document.getElementById("trailerOverlay");
    if (ov) ov.remove();
  }
  function cardHTML(r, i) {
    const c = r.item;
    return `<div class="card" data-idx="${i}" style="${artStyle(c.g, c.t)}">
      <div class="card-initial">${initial(c.t)}</div>
      <div class="card-body">
        <div class="card-title">${escapeHTML(c.t)}</div>
        <div class="card-meta"><span class="cert"></span>${c.y} · ${c.k === "m" ? "Movie" : "TV"} · ${c.g.slice(0, 3).join(" · ")}</div>
        <div class="card-why">${r.reasons.map(escapeHTML).join(" · ")}</div>
        <button class="trailer-btn" data-trailer="${i}">▶ Trailer</button>
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
    deck = CATALOG.filter(c => !seen.has(makeKey(c.t, c.y)));
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    deck = deck.slice(0, 60);
    deckIdx = 0; undoStack = [];
  }
  function renderSwipe() {
    const el = document.getElementById("screen-swipe");
    const p = profile();
    if (!p) { el.innerHTML = emptyProfileHTML(); bindEmpty(el); return; }
    if (!deck.length || deckIdx >= deck.length) buildDeck();
    if (!deck.length) {
      el.innerHTML = `<div class="empty"><h2>All caught up 🎉</h2><p>You've rated everything in the catalog. Check your recommendations!</p>
        <button class="btn primary" data-go="discover">See recommendations</button></div>`;
      bindEmpty(el); return;
    }
    const c = deck[deckIdx];
    const n = ratingsList().length;
    el.innerHTML = `
      <div class="swipe-top muted">${deck.length - deckIdx} left · ${n} rated</div>
      <div class="deck"><div class="swipe-card" id="swipeCard" style="${artStyle(c.g, c.t)}">
        <div class="swipe-initial">${initial(c.t)}</div>
        <div class="stamp like">LIKE</div><div class="stamp nope">NOPE</div><div class="stamp unseen">UNSEEN</div>
        <div class="swipe-info"><div class="swipe-title">${escapeHTML(c.t)}</div>
        <div class="swipe-meta">${c.y} · ${c.k === "m" ? "Movie" : "TV"} · ${c.g.slice(0, 3).join(" · ")}</div></div>
      </div></div>
      <div class="swipe-btns">
        <button class="sbtn nope" id="btnNope" aria-label="Dislike">✕</button>
        <button class="sbtn undo" id="btnUndo" aria-label="Undo" ${undoStack.length ? "" : "disabled"}>↩</button>
        <button class="sbtn unseen" id="btnUnseen" aria-label="Haven't seen">?</button>
        <button class="sbtn like" id="btnLike" aria-label="Like">♥</button>
      </div>
      <div class="swipe-hint muted">drag &larr; nope &nbsp;·&nbsp; &uarr; haven't seen &nbsp;·&nbsp; &rarr; like &nbsp;·&nbsp; tap synopsis to expand</div>`;
    const card = document.getElementById("swipeCard");
    document.getElementById("btnNope").onclick = () => rate(DISLIKE);
    document.getElementById("btnLike").onclick = () => rate(LIKE);
    document.getElementById("btnUnseen").onclick = () => markUnseen();
    document.getElementById("btnUndo").onclick = undo;
    enableDrag(card);
    enrichSwipeCard(card, c);
  }
  /* Swap in a real poster + synopsis when a TMDB key is configured. */
  function enrichSwipeCard(card, c) {
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
      if (info.overview) {
        const infoBox = card.querySelector(".swipe-info");
        if (infoBox && !infoBox.querySelector(".swipe-overview")) {
          const ov = document.createElement("div");
          ov.className = "swipe-overview";
          ov.textContent = info.overview;
          ov.title = "Tap to expand";
          ov.addEventListener("click", () => {
            if (card.dataset.dragged === "1") return; // was a swipe, not a tap
            ov.classList.toggle("expanded");
          });
          infoBox.appendChild(ov);
        }
      }
    });
  }
  function rate(v) {
    const c = deck[deckIdx];
    const p = profile();
    const key = makeKey(c.t, c.y);
    undoStack.push({ kind: "rating", key, prev: p.ratings[key] || null });
    p.ratings[key] = {
      key, title: c.t, year: c.y,
      type: c.k === "m" ? "movie" : "tv", rating: v, genres: c.g, directors: c.d ? [c.d] : []
    };
    saveStore(); deckIdx++;
    renderSwipe();
  }
  function markUnseen() {
    const c = deck[deckIdx];
    const p = profile();
    const key = makeKey(c.t, c.y);
    p.unseen = p.unseen || [];
    if (!p.unseen.includes(key)) { p.unseen.push(key); undoStack.push({ kind: "unseen", key }); }
    saveStore(); deckIdx++;
    renderSwipe();
  }
  function undo() {
    const last = undoStack.pop();
    if (!last) return;
    const p = profile();
    if (last.kind === "unseen") {
      p.unseen = (p.unseen || []).filter(k => k !== last.key);
    } else if (last.prev) p.ratings[last.key] = last.prev; else delete p.ratings[last.key];
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
  function renderImport() { /* static HTML in index; nothing dynamic needed */ }
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
    const p = profile(), list = ratingsList();
    let stats = "";
    if (p && list.length) {
      const prof = buildProfile(list);
      const topG = Object.entries(prof.genreAvg).sort((a, b) => b[1] - a[1]).slice(0, 5);
      stats = `<div class="statgrid">
          <div class="stat"><b>${list.length}</b><span>titles rated</span></div>
          <div class="stat"><b>${prof.globalAvg.toFixed(1)}</b><span>avg rating</span></div>
        </div>
        <h3>Top genres</h3><div class="chips">${topG.map(([g, v]) => `<span class="chip on">${escapeHTML(g)} ${v.toFixed(1)}</span>`).join("")}</div>`;
    }
    el.innerHTML = `
      <h2>Profiles</h2>
      <div class="plist">${names.map(n => `
        <div class="prow${n === store.active ? " on" : ""}">
          <span class="pname">${escapeHTML(n)}</span>
          <span class="muted">${Object.keys(store.profiles[n].ratings).length} rated</span>
          ${n === store.active ? `<span class="badge">active</span>` : `<button class="btn sm" data-switch="${escapeHTML(n)}">Switch</button>`}
          <button class="btn sm danger" data-del="${escapeHTML(n)}">Delete</button>
        </div>`).join("") || `<p class="muted">No profiles yet.</p>`}</div>
      <div class="row"><input id="newName" placeholder="New username" maxlength="24" />
      <button class="btn primary" id="createBtn">Create</button></div>
      ${stats}
      <h3>Posters &amp; synopses</h3>
      <p class="muted small">Posters load automatically — no setup needed. Only enter your own TMDB key below if they ever stop loading.</p>
      <div class="row"><input id="tmdbKey" placeholder="Optional: your own TMDB key" maxlength="64" value="${escapeHTML(TMDB.userKey())}" />
      <button class="btn sm" id="saveKeyBtn">Save</button></div>
      <div id="keyMsg" class="muted small"></div>
      <h3>Data</h3>
      <div class="row"><button class="btn sm" id="exportBtn">Export ratings (JSON)</button>
      <button class="btn sm danger" id="wipeBtn">Clear this profile</button></div>`;
    document.getElementById("createBtn").onclick = () => {
      const n = document.getElementById("newName").value;
      if (ensureProfile(n)) { updateHeader(); renderProfile(); } else alert("Enter a username.");
    };
    document.getElementById("saveKeyBtn").onclick = () => {
      TMDB.setKey(document.getElementById("tmdbKey").value);
      document.getElementById("keyMsg").textContent = TMDB.userKey()
        ? "Saved ✓ — using your personal key."
        : "Cleared — using the built-in key.";
    };
    el.querySelectorAll("[data-switch]").forEach(b => b.onclick = () => { store.active = b.dataset.switch; saveStore(); updateHeader(); buildDeck(); renderProfile(); });
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
      if (!confirm("Delete profile '" + b.dataset.del + "'?")) return;
      delete store.profiles[b.dataset.del];
      if (store.active === b.dataset.del) store.active = Object.keys(store.profiles)[0] || null;
      saveStore(); updateHeader(); buildDeck(); renderProfile();
    });
    document.getElementById("exportBtn").onclick = () => {
      if (!p) return;
      const blob = new Blob([JSON.stringify({ profile: store.active, ratings: p.ratings }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = store.active + "-ratings.json"; a.click();
    };
    document.getElementById("wipeBtn").onclick = () => {
      if (!p || !confirm("Clear all ratings for '" + store.active + "'?")) return;
      p.ratings = {}; p.hidden = []; saveStore(); buildDeck(); renderProfile();
    };
  }
  function updateHeader() {
    document.getElementById("profileChip").textContent = store.active ? "👤 " + store.active : "👤 Guest";
  }

  /* ---------------- init ---------------- */
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".tab").forEach(b => b.onclick = () => go(b.dataset.screen));
    document.getElementById("profileChip").onclick = () => go("profile");
    const dz = document.getElementById("dropzone"), fi = document.getElementById("fileInput");
    dz.onclick = () => fi.click();
    fi.onchange = () => fi.files[0] && handleFile(fi.files[0]);
    ["dragover", "dragenter"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
    updateHeader();
    if (!store.active) go("profile"); else go("discover");
  });
})();

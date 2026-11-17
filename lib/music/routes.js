"use strict";
// HTTP routes shared by both modes: Deezer search, cover proxy, offline tones, health check.

const IMG_HOST = /(^|\.)(dzcdn\.net|deezer\.com)$/;
const SEARCH_TYPES = new Set(["album", "artist", "track"]);

function registerMusicRoutes(app, { deezer, mock = false }) {
  app.get("/health", (req, res) => res.json({ ok: true }));

  // GET /api/search?type=album|artist|track&q=...
  app.get("/api/search", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const q = String(req.query.q || "").trim().slice(0, 80);
    const type = SEARCH_TYPES.has(req.query.type) ? req.query.type : "album";
    if (!q) return res.json({ ok: true, items: [] });
    try {
      const items = type === "artist" ? await deezer.searchArtists(q)
        : type === "track" ? await deezer.searchTracks(q)
          : await deezer.searchAlbums(q);
      return res.json({ ok: true, items });
    } catch (error) {
      console.warn("[deezer] search failed", error.message);
      return res.json({ ok: false, error: "Deezer search is not answering. Try again" });
    }
  });

  // warm the featured covers cache at start so the first visitor does not wait for ~14 Deezer calls
  if (deezer.featuredAlbums) deezer.featuredAlbums().catch(() => {});

  // GET /api/featured: album covers for the home screen (hand-picked artists, the chart as a fallback)
  app.get("/api/featured", async (req, res) => {
    try {
      let items = deezer.featuredAlbums ? await deezer.featuredAlbums() : [];
      if (!items.length && deezer.chartAlbums) items = await deezer.chartAlbums();
      res.set("Cache-Control", "public, max-age=600");
      return res.json({ ok: true, items });
    } catch (error) {
      console.warn("[deezer] chart failed", error.message);
      return res.json({ ok: false, items: [] });
    }
  });

  // Cover proxy: the browser needs a same-origin image to read cover colours for the backdrop.
  app.get("/api/img", async (req, res) => {
    let target;
    try {
      target = new URL(String(req.query.u || ""));
    } catch {
      return res.status(400).end();
    }
    if (target.protocol !== "https:" || !IMG_HOST.test(target.hostname)) return res.status(403).end();
    try {
      const r = await fetch(target, { signal: AbortSignal.timeout(8000) });
      const type = r.headers.get("content-type") || "";
      if (!r.ok || !type.startsWith("image/")) return res.status(502).end();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 3 * 1024 * 1024) return res.status(413).end();
      res.set({ "Content-Type": type, "Cache-Control": "public, max-age=86400" });
      return res.end(buf);
    } catch {
      return res.status(502).end();
    }
  });

  if (mock && typeof deezer.toneWav === "function") {
    const toneCache = new Map();
    app.get("/mock/tone/:n", (req, res) => {
      const n = parseInt(req.params.n, 10) || 0;
      if (!toneCache.has(n)) toneCache.set(n, deezer.toneWav(n));
      res.set({ "Content-Type": "audio/wav", "Cache-Control": "public, max-age=3600" });
      res.end(toneCache.get(n));
    });
  }
}

module.exports = { registerMusicRoutes };

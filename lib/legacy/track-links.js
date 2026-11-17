"use strict";
// LEGACY: YouTube / SoundCloud track links for the Spy mode.
//
// The redesigned site plays Spy tracks from Deezer previews (lib/music/deezer.js) and no longer
// offers links. This code is kept on purpose, in case a "paste a link" fallback comes back for
// tracks that are missing from Deezer. The server still accepts a `url` in `playTrack` (used by
// the old interface at /old), so nothing here is dead yet.
//
// Old client side (for reference, see public/client.js on main): YouTube played through
// https://www.youtube.com/embed/<id>?autoplay=1&enablejsapi=1 and SoundCloud through
// https://w.soundcloud.com/player/?url=<url>&auto_play=true with the SC.Widget API for volume.

const youtubeSearchCache = new Map();
const YOUTUBE_SEARCH_CACHE_TTL_MS = 1000 * 60 * 30;

function extractFirstYouTubeVideoId(html = "") {
  const rendererMatch = html.match(/"videoRenderer"\s*:\s*\{[\s\S]{0,2400}?"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/);
  if (rendererMatch) return rendererMatch[1];
  const watchMatch = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
  return watchMatch ? watchMatch[1] : "";
}

async function resolveYouTubeSearchUrl(query, { fetchImpl = globalThis.fetch } = {}) {
  const normalizedQuery = String(query || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (normalizedQuery.length < 2 || typeof fetchImpl !== "function") return "";
  const cached = youtubeSearchCache.get(normalizedQuery.toLowerCase());
  if (cached && Date.now() - cached.createdAt < YOUTUBE_SEARCH_CACHE_TTL_MS) return cached.url;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetchImpl(`https://www.youtube.com/results?search_query=${encodeURIComponent(normalizedQuery)}`, {
      signal: controller.signal,
      headers: {
        "accept-language": "en;q=0.9",
        "user-agent": "Mozilla/5.0 (compatible; MusicSpyBot/1.0)"
      }
    });
    if (!response.ok) return "";
    const html = await response.text();
    const videoId = extractFirstYouTubeVideoId(html);
    if (!videoId) return "";
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    youtubeSearchCache.set(normalizedQuery.toLowerCase(), { url, createdAt: Date.now() });
    return url;
  } catch (error) {
    console.warn(`YouTube search failed for "${normalizedQuery}":`, error?.message || error);
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function isSupportedTrackUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)youtube\.com$/i.test(parsed.hostname)
      || /(^|\.)youtu\.be$/i.test(parsed.hostname)
      || /(^|\.)soundcloud\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizeTrackSubmission(input) {
  const raw = String(input || "").trim().replace(/\s+/g, " ");
  if (!raw) return { valid: false, url: "", searchQuery: "", source: "empty" };
  if (isSupportedTrackUrl(raw)) return { valid: true, url: raw, searchQuery: "", source: "url" };
  const looksLikeUnsupportedUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  if (looksLikeUnsupportedUrl) return { valid: false, url: raw, searchQuery: "", source: "unsupported-url" };
  const query = raw.slice(0, 120);
  if (query.length < 2) return { valid: false, url: raw, searchQuery: "", source: "short-query" };
  return {
    valid: true,
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    searchQuery: query,
    source: "library"
  };
}

module.exports = { extractFirstYouTubeVideoId, resolveYouTubeSearchUrl, isSupportedTrackUrl, normalizeTrackSubmission };

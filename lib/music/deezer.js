'use strict';
// Wrapper over the open Deezer API (no key needed). Gives 30-second track previews.
// Shared by both modes: Keep 5 Delete 5 (album / artist pools) and Spy (single track search).
const API = 'https://api.deezer.com';
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 400;
const MAX_CONCURRENT = 4;
const MAX_RELEASES = 40; // how many artist releases we scan for a "discography" pool

const cache = new Map();
const queue = [];
let active = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function limit(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const { fn, resolve, reject } = queue.shift();
    active += 1;
    fn().then(resolve, reject).finally(() => {
      active -= 1;
      pump();
    });
  }
}

async function rawGet(pathAndQuery) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      const res = await fetch(API + pathAndQuery, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw Object.assign(new Error(`Deezer HTTP ${res.status}`), { retry: res.status >= 500 });
      const json = await res.json();
      if (json && json.error) {
        // code 4 = rate limit (50 requests per 5 seconds)
        throw Object.assign(new Error(`Deezer: ${json.error.message || json.error.type}`), { retry: json.error.code === 4 });
      }
      return json;
    } catch (err) {
      lastErr = err;
      if (!(err.retry || err.name === 'AbortError' || err.name === 'TypeError') || attempt === 2) throw err;
      await sleep(900 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function get(pathAndQuery, ttl = CACHE_TTL_MS) {
  const hit = cache.get(pathAndQuery);
  if (hit && Date.now() - hit.t < ttl) return hit.data;
  const data = await limit(() => rawGet(pathAndQuery));
  cache.set(pathAndQuery, { t: Date.now(), data });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return data;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const tracksWord = (n) => plural(n, 'track', 'tracks');
const RECORD_TYPES = { album: 'Album', ep: 'EP', single: 'Single', compile: 'Compilation' };

const hasPreview = (t) => Boolean(t && t.preview && t.readable !== false);

function toTrack(t, album) {
  return {
    id: t.id,
    title: t.title_short || t.title || 'Untitled',
    version: t.title_version || '',
    artist: (t.artist && t.artist.name) || '',
    album: album.title || '',
    cover: album.cover || '',
    preview: t.preview,
  };
}

function normTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat|ft)\.?\s.*$/, ' ')
    .replace(/\s-\s.*$/, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

async function searchAlbums(q) {
  const json = await get(`/search/album?q=${encodeURIComponent(q)}&limit=24`);
  return (json.data || []).map((a) => ({
    id: a.id,
    title: a.title,
    subtitle: (a.artist && a.artist.name) || '',
    cover: a.cover_medium || a.cover || '',
    meta: [RECORD_TYPES[a.record_type] || a.record_type, a.nb_tracks ? tracksWord(a.nb_tracks) : ''].filter(Boolean).join(', '),
  }));
}

async function searchArtists(q) {
  const json = await get(`/search/artist?q=${encodeURIComponent(q)}&limit=24`);
  return (json.data || []).map((a) => ({
    id: a.id,
    title: a.name,
    subtitle: a.nb_fan ? `${Number(a.nb_fan).toLocaleString('en-US')} fans` : '',
    cover: a.picture_medium || a.picture || '',
    meta: a.nb_album ? plural(a.nb_album, 'release', 'releases') : '',
  }));
}

// Spy mode: the player on turn searches a single track.
async function searchTracks(q) {
  const json = await get(`/search/track?q=${encodeURIComponent(q)}&limit=24`);
  return (json.data || []).filter(hasPreview).map((t) => ({
    id: t.id,
    title: t.title_short || t.title || 'Untitled',
    subtitle: (t.artist && t.artist.name) || '',
    cover: (t.album && (t.album.cover_medium || t.album.cover)) || '',
    meta: (t.album && t.album.title) || '',
  }));
}

// Full track for playback: fresh signed preview link + big cover.
async function getTrack(id) {
  const t = await limit(() => rawGet(`/track/${encodeURIComponent(id)}`));
  if (!hasPreview(t)) return null;
  return toTrack(t, { title: (t.album && t.album.title) || '', cover: (t.album && (t.album.cover_big || t.album.cover_medium)) || '' });
}

async function albumPool(id) {
  const album = await get(`/album/${id}`);
  let tracks = (album.tracks && album.tracks.data) || [];
  if ((album.nb_tracks || 0) > tracks.length) {
    const more = await get(`/album/${id}/tracks?limit=500`);
    if (more.data && more.data.length) tracks = more.data;
  }
  const cover = album.cover_big || album.cover_medium || album.cover || '';
  return {
    source: {
      title: album.title,
      subtitle: (album.artist && album.artist.name) || '',
      cover,
      label: 'Album',
    },
    tracks: tracks.filter(hasPreview).map((t) => toTrack(t, { title: album.title, cover })),
  };
}

async function artistPool(id) {
  const [artist, albumsResp] = await Promise.all([get(`/artist/${id}`), get(`/artist/${id}/albums?limit=100`)]);
  const releases = albumsResp.data || [];
  const main = releases.filter((a) => a.record_type === 'album' || a.record_type === 'ep');
  const singles = releases.filter((a) => a.record_type === 'single');
  const pick = main.concat(singles).slice(0, MAX_RELEASES);
  const loaded = await Promise.all(
    pick.map((a) => get(`/album/${a.id}/tracks?limit=200`).then((r) => ({ a, tracks: r.data || [] })).catch(() => ({ a, tracks: [] }))),
  );
  const seen = new Set();
  const list = [];
  for (const { a, tracks } of loaded) {
    const cover = a.cover_big || a.cover_medium || a.cover || '';
    for (const t of tracks) {
      if (!hasPreview(t)) continue;
      const key = normTitle(t.title_short || t.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push(toTrack(t, { title: a.title, cover }));
    }
  }
  return {
    source: {
      title: artist.name,
      subtitle: plural(pick.length, 'release', 'releases'),
      cover: artist.picture_big || artist.picture_medium || '',
      label: 'Discography',
    },
    tracks: list,
  };
}

// Home screen of Keep 5 Delete 5: a fan of real album covers from the Deezer chart (cached for an hour).
async function chartAlbums() {
  const json = await get('/chart/0/albums?limit=16', 60 * 60 * 1000);
  return (json.data || []).map((a) => ({
    id: a.id,
    title: a.title,
    artist: (a.artist && a.artist.name) || '',
    cover: a.cover_big || a.cover_medium || a.cover || '',
  }));
}

// Home screen of Keep 5 Delete 5: a fan of album covers by a hand-picked set of artists
// (albums and EPs only, a few per artist, mixed so the same artist never sits twice in a row).
// `names` lists every name Deezer files the artist under (Homixide Gang's albums sit under "HXG").
const FEATURED_ARTISTS = [
  { name: 'Yeat', names: ['Yeat'] },
  { name: 'Playboi Carti', names: ['Playboi Carti'] },
  { name: 'Ken Carson', names: ['Ken Carson'] },
  { name: 'Lil Uzi Vert', names: ['Lil Uzi Vert'] },
  { name: 'Lucy Bedroque', names: ['Lucy Bedroque'] },
  { name: 'Destroy Lonely', names: ['Destroy Lonely'] },
  { name: 'Homixide Gang', names: ['Homixide Gang', 'HXG'] },
];
const FEATURED_TTL_MS = 6 * 60 * 60 * 1000;
const PER_ARTIST = 3;

// Several Deezer profiles can share a name: take the one with the most releases.
async function findArtistId(name) {
  const found = await get(`/search/artist?q=${encodeURIComponent(name)}&limit=10`, FEATURED_TTL_MS);
  const exact = (found.data || []).filter((a) => normTitle(a.name) === normTitle(name));
  exact.sort((a, b) => (b.nb_album || 0) - (a.nb_album || 0));
  return exact[0] ? exact[0].id : null;
}

async function featuredFor({ name, names }) {
  try {
    const ids = (await Promise.all(names.map(findArtistId))).filter(Boolean);
    const lists = await Promise.all(ids.map((id) => get(`/artist/${id}/albums?limit=60`, FEATURED_TTL_MS).then((r) => r.data || [])));
    const seen = new Set();
    return lists.flat()
      .filter((a) => (a.record_type === 'album' || a.record_type === 'ep') && (a.cover_big || a.cover_medium))
      .sort((a, b) => (b.fans || 0) - (a.fans || 0))
      .filter((a) => { const k = normTitle(a.title); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, PER_ARTIST)
      .map((a) => ({ id: a.id, title: a.title, artist: name, cover: a.cover_big || a.cover_medium || a.cover || '' }));
  } catch {
    return [];
  }
}

async function featuredAlbums() {
  const perArtist = await Promise.all(FEATURED_ARTISTS.map(featuredFor));
  const out = [];
  for (let i = 0; i < PER_ARTIST; i += 1) for (const list of perArtist) if (list[i]) out.push(list[i]);
  return out;
}

async function trackPreview(id) {
  const t = await limit(() => rawGet(`/track/${id}`));
  return hasPreview(t) ? t.preview : null;
}

module.exports = { searchAlbums, searchArtists, searchTracks, getTrack, albumPool, artistPool, chartAlbums, featuredAlbums, trackPreview, _normTitle: normTitle };

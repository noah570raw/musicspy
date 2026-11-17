'use strict';
// Offline stand-in for Deezer: start with MOCK_DEEZER=1 (no internet needed).
// Previews are generated tones served by the app at /mock/tone/<n>.wav.
const ALBUMS = [
  { id: 1001, title: 'Night Shift', artist: 'Test Band', color: 'c2410c', tracks: 12 },
  { id: 1002, title: 'Ocean Tapes', artist: 'Test Band', color: '0e7490', tracks: 10 },
  { id: 1003, title: 'Tiny EP', artist: 'Mini Duo', color: 'be185d', tracks: 5 },
  { id: 1004, title: 'Dust Roads', artist: 'Field Choir', color: 'a16207', tracks: 8 },
];
const ARTISTS = [
  { id: 2001, name: 'Test Band', albums: [1001, 1002] },
  { id: 2002, name: 'Mini Duo', albums: [1003] },
  { id: 2003, name: 'Field Choir', albums: [1004] },
];
const WORDS = ['Intro', 'Midnight', 'Gold', 'Static', 'Runaway', 'Echo', 'Paper Hearts', 'Satellite', 'Slow Motion', 'Fever', 'Outro', 'Lights', 'Drive', 'Glass'];

const cover = (a) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#${a.color}"/><stop offset="1" stop-color="#14110f"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="50" r="22" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3"/><text x="50" y="92" font-size="9" text-anchor="middle" fill="#fff" font-family="sans-serif">${a.title}</text></svg>`)}`;

function albumTracks(a) {
  return Array.from({ length: a.tracks }, (_, i) => ({
    id: a.id * 100 + i,
    title: `${WORDS[i % WORDS.length]}${i >= WORDS.length ? ' II' : ''}`,
    version: '',
    artist: a.artist,
    album: a.title,
    cover: cover(a),
    preview: `/mock/tone/${(a.id * 7 + i) % 24}.wav`,
  }));
}

const ALL_TRACKS = ALBUMS.flatMap(albumTracks);
const delay = (v) => new Promise((r) => setTimeout(() => r(v), 150));
const match = (q, s) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase()) || q.toLowerCase().includes('test');

module.exports = {
  searchAlbums: (q) => delay(ALBUMS.filter((a) => match(q, `${a.title} ${a.artist}`)).map((a) => ({ id: a.id, title: a.title, subtitle: a.artist, cover: cover(a), meta: `Album, ${a.tracks} tracks` }))),
  searchArtists: (q) => delay(ARTISTS.filter((a) => match(q, a.name)).map((a) => ({ id: a.id, title: a.name, subtitle: '1,234 fans', cover: cover(ALBUMS.find((x) => x.id === a.albums[0])), meta: `${a.albums.length} releases` }))),
  searchTracks: (q) => delay(ALL_TRACKS.filter((t) => match(q, `${t.title} ${t.artist} ${t.album}`)).slice(0, 24).map((t) => ({ id: t.id, title: t.title, subtitle: t.artist, cover: t.cover, meta: t.album }))),
  getTrack: (id) => delay(ALL_TRACKS.find((t) => t.id === Number(id)) || null),
  albumPool: (id) => {
    const a = ALBUMS.find((x) => x.id === Number(id));
    if (!a) return Promise.reject(new Error('no album'));
    return delay({ source: { title: a.title, subtitle: a.artist, cover: cover(a), label: 'Album' }, tracks: albumTracks(a) });
  },
  artistPool: (id) => {
    const ar = ARTISTS.find((x) => x.id === Number(id));
    if (!ar) return Promise.reject(new Error('no artist'));
    const albums = ar.albums.map((aid) => ALBUMS.find((x) => x.id === aid));
    return delay({ source: { title: ar.name, subtitle: `${albums.length} releases`, cover: cover(albums[0]), label: 'Discography' }, tracks: albums.flatMap(albumTracks) });
  },
  chartAlbums: () => delay(ALBUMS.map((a) => ({ id: a.id, title: a.title, artist: a.artist, cover: cover(a) }))),
  trackPreview: () => Promise.resolve(null),
};

// Simple WAV tone for previews: 30 seconds, its own note per track.
module.exports.toneWav = function toneWav(n) {
  const rate = 8000;
  const seconds = 30;
  const len = rate * seconds;
  const buf = Buffer.alloc(44 + len);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + len, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(len, 40);
  const base = 220 * 2 ** ((n % 24) / 12);
  for (let i = 0; i < len; i += 1) {
    const t = i / rate;
    const beat = (t * 2) % 1;
    const env = Math.max(0, 1 - beat * 1.6) * 0.5 + 0.1;
    const v = Math.sin(2 * Math.PI * base * t) * 0.6 + Math.sin(2 * Math.PI * base * 1.5 * t) * 0.25;
    buf[44 + i] = Math.round(128 + 70 * env * v);
  }
  return buf;
};

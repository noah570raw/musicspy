'use strict';
// "Pick the music" sheet shared by Keep 5 Delete 5 and King of the Hill: search Deezer for an album or a
// whole discography and hand the pick to the mode.
//   MS.picker.open({ current: () => ({ selected: 'album:123', loadingId: '456' }), onPick: async (type, id) => ok, hints })
(() => {
  const MS = window.MS;
  const { $, $$, esc } = MS;
  const SHEET = 'picker';
  const ui = { searchType: 'album', searchQ: '', results: null, searching: false, searchSeq: 0, searchTimer: null };
  let opts = null;

  const DEFAULT_HINTS = {
    album: 'The game deals random tracks from the album.',
    artist: 'Tracks come from every album, EP and single of the artist, without repeats.',
  };

  function open(o) {
    opts = { hints: DEFAULT_HINTS, ...o };
    const el = MS.sheet.open(SHEET, {
      title: 'Pick the music',
      cls: 'tall',
      body: `
        <div class="sheet-search">
          <div style="display:grid;gap:12px">
            <div class="tabs" role="tablist">
              <button data-pk="tab" data-v="album" role="tab">Album</button>
              <button data-pk="tab" data-v="artist" role="tab">Whole discography</button>
            </div>
            <form id="pkSearchForm" class="search"><input id="pkSearchInput" type="search" autocomplete="off" spellcheck="false" aria-label="Search"><button class="btn">Search</button></form>
          </div>
          <div id="pkResults" class="results-grid"></div>
        </div>`,
    });
    const input = $('#pkSearchInput');
    input.value = ui.searchQ;
    $('#pkSearchForm').addEventListener('submit', (e) => { e.preventDefault(); runSearch(input.value); });
    input.addEventListener('input', () => {
      clearTimeout(ui.searchTimer);
      ui.searchTimer = setTimeout(() => runSearch(input.value), 380);
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pk]');
      if (!b) return;
      if (b.dataset.pk === 'tab') {
        ui.searchType = b.dataset.v;
        renderTabs();
        runSearch(input.value);
      } else if (b.dataset.pk === 'pickSource') {
        b.classList.add('loading');
        const ok = await opts.onPick(b.dataset.type, b.dataset.id);
        if (ok) MS.sheet.close(SHEET);
        else b.classList.remove('loading');
      }
    });
    renderTabs();
    renderResults();
    setTimeout(() => input.focus(), 60);
  }

  function renderTabs() {
    $$('[data-pk="tab"]').forEach((b) => {
      b.classList.toggle('active', b.dataset.v === ui.searchType);
      b.setAttribute('aria-selected', b.dataset.v === ui.searchType ? 'true' : 'false');
    });
    const input = $('#pkSearchInput');
    if (input) input.placeholder = ui.searchType === 'album' ? 'Album title or artist' : 'Artist name';
  }

  async function runSearch(q) {
    q = String(q || '').trim();
    ui.searchQ = q;
    const seq = ++ui.searchSeq;
    if (!q) {
      ui.results = null;
      ui.searching = false;
      renderResults();
      return;
    }
    ui.searching = true;
    renderResults();
    let r;
    try {
      const res = await fetch(`/api/search?type=${ui.searchType}&q=${encodeURIComponent(q)}`);
      r = await res.json();
    } catch {
      r = { ok: false, error: 'Search is not answering. Try again' };
    }
    if (seq !== ui.searchSeq) return;
    ui.searching = false;
    if (!r.ok) {
      ui.results = [];
      MS.toast(r.error);
    } else ui.results = r.items;
    renderResults();
  }

  function renderResults() {
    const box = $('#pkResults');
    if (!box || !opts) return;
    if (ui.searching) {
      box.innerHTML = Array.from({ length: 6 }, () => '<div class="result ghost"><i></i><span><b></b><small></small></span></div>').join('');
      return;
    }
    if (ui.results === null) {
      box.innerHTML = `<p class="hint">${esc(opts.hints[ui.searchType] || '')}</p>`;
      return;
    }
    if (!ui.results.length) {
      box.innerHTML = '<p class="hint">Nothing found. Try another spelling.</p>';
      return;
    }
    const { selected = '', loadingId = '' } = opts.current ? opts.current() : {};
    box.innerHTML = ui.results.map((it) => `
      <button class="result ${`${ui.searchType}:${it.id}` === selected ? 'selected' : ''} ${String(it.id) === String(loadingId) ? 'loading' : ''} ${ui.searchType === 'artist' ? 'round' : ''}" data-pk="pickSource" data-type="${ui.searchType}" data-id="${esc(it.id)}">
        <img src="${esc(it.cover)}" alt="" loading="lazy">
        <span><b>${esc(it.title)}</b><small>${esc(it.subtitle)}</small>${it.meta ? `<small class="meta">${esc(it.meta)}</small>` : ''}</span>
      </button>`).join('');
  }

  MS.picker = {
    open,
    close: (instant) => MS.sheet.close(SHEET, instant),
  };
})();

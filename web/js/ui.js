'use strict';
// Shared visuals and sheets: the Spy suspect line-up, the K5D5 cover fan, "How to play" and the
// "Coming soon" sheets behind features that return in the next stage (shop, leaderboard, ...).
(() => {
  const MS = window.MS;
  const { esc } = MS;

  // ---------- Spy: suspect line-up (one of them is the spy, a scan line passes over them) ----------
  MS.ui = MS.ui || {};
  MS.ui.lineup = (n = 5, players = null) => {
    const people = players && players.length ? players.slice(0, 7) : Array.from({ length: n }, (_, i) => ({ name: '', id: `s${i}` }));
    // the dashed "?" figure only appears among anonymous placeholders, never on a real player
    const odd = players && players.some((p) => p.name) ? -1 : Math.min(people.length - 1, 2);
    return `
      <div class="lineup" aria-hidden="true" style="--n:${people.length}">
        <div class="lineup-wall"><i data-h="200"></i><i data-h="180"></i><i data-h="160"></i><i data-h="140"></i></div>
        <div class="lineup-row">
          ${people.map((p, i) => `
            <div class="suspect-fig ${i === odd ? 'odd' : ''}" style="--i:${i}">
              <span class="head">${p.name ? esc(p.name.charAt(0).toUpperCase()) : ''}</span><span class="body"></span>
              <small>${p.name ? esc(p.name) : `#${String(i + 1).padStart(2, '0')}`}</small>
            </div>`).join('')}
        </div>
        <div class="lineup-scan"></div>
        <span class="lineup-label">line-up · ${people.length} ${people.length === 1 ? 'suspect' : 'suspects'}</span>
      </div>`;
  };

  // ---------- screen build: parts assemble one by one when a screen first appears ----------
  const BUILD_PARTS = '.bar, .lob-cover, .lob-source, .settings, .start, .lob-foot, .shelf.keep, .stage, .shelf.del, .turns, .played, .vote-head, .suspects, .vote-foot, .res-hero, .res-boards, #guessMain';
  MS.ui.build = (screen) => {
    if (!screen) return;
    [...screen.querySelectorAll(BUILD_PARTS)].forEach((el, i) => {
      el.setAttribute('data-build', '');
      el.style.setProperty('--b', String(i));
    });
    screen.classList.add('building');
    setTimeout(() => screen.classList.remove('building'), 1700);
  };

  // ---------- K5D5: fan of album covers ----------
  MS.ui.coverFan = (items = []) => {
    // five visible covers plus a hidden sixth that fades in at the back when the fan shuffles
    const list = items.slice(0, 6);
    if (!list.length) return '<div class="cover-fan empty" aria-hidden="true">' + Array.from({ length: 5 }, (_, i) => `<span class="fan-card ph" style="--i:${i}"></span>`).join('') + '</div>';
    return `<div class="cover-fan" aria-hidden="true">${list.map((a, i) => `<span class="fan-card" style="--i:${i}"><img src="${esc(a.cover)}" alt=""></span>`).join('')}</div>`;
  };

  // ---------- How to play ----------
  const HOW = {
    spy: {
      title: 'How to play Spy',
      steps: [
        ['Get your theme', 'Everyone gets the same music theme, like “Drill” or “90s rock classics”. The spy gets nothing.'],
        ['Play a track', 'On your turn search Deezer and play a track that fits. Everyone hears the same 30-second preview.'],
        ['Read the room', 'React, skip bad picks, chat. The spy listens to your tracks and tries to blend in.'],
        ['Vote', 'After the rounds everyone votes. Catch the spy and the civilians win. Miss, and the spy wins.'],
      ],
    },
    k5: {
      title: 'How to play Keep 5 Delete 5',
      steps: [
        ['Pick the music', 'The host picks an album or a whole discography. Its cover sets the colours of the room.'],
        ['Keep or delete', 'A random track plays. Press Keep or Delete. There is room for half in each, and no changing your mind.'],
        ['Watch the others', 'After each track you see who kept it and who deleted it, or save it all for the end.'],
        ['Compare taste', 'The results show everyone’s lists, how much you matched and which tracks split the room.'],
      ],
    },
  };
  MS.ui.howTo = (mode) => {
    const h = HOW[mode] || HOW.spy;
    MS.sheet.open('howto', {
      title: h.title,
      cls: 'narrow',
      body: `<div class="sheet-body"><ol class="how-list">${h.steps.map(([t, d], i) => `<li style="--i:${i}"><b class="step-num">${String(i + 1).padStart(2, '0')}</b><div><b>${esc(t)}</b><p>${esc(d)}</p></div></li>`).join('')}</ol></div>`,
    });
  };

  // ---------- Coming soon ----------
  const tile = (label, rarity) => `<div class="soon-tile ${rarity}"><i></i><b>${esc(label)}</b><small>${esc(rarity)}</small></div>`;
  const STUBS = {
    shop: {
      title: 'Shop',
      text: 'Nickname colours, avatar frames, profile banners, chat and lobby effects. Pay with Vinyls you earn in games. Items you bought before stay yours.',
      preview: `<div class="soon-grid">${tile('Nickname colour', 'rare')}${tile('Avatar frame', 'epic')}${tile('Profile banner', 'legendary')}${tile('Chat effect', 'common')}${tile('Lobby effect', 'epic')}${tile('Player title', 'mythic')}</div>`,
    },
    leaderboard: {
      title: 'Leaderboard',
      text: 'Top players by games, win rate, wins as spy and as civilian, level and Keep 5 Delete 5 games. Your place shows even outside the top.',
      preview: `<ol class="soon-board">${[1, 2, 3, 4, 5].map((n) => `<li><b>${n}</b><i></i><span></span><em></em></li>`).join('')}</ol>`,
    },
    vinyls: {
      title: 'Vinyls',
      text: 'Vinyls are the coins of MusicSpy. You get them for games, wins, daily rewards and new levels, and spend them in the shop.',
      preview: '<div class="soon-coin"><span class="vinyl-coin big"></span></div>',
    },
    daily: {
      title: 'Daily reward',
      text: 'Come back every day for Vinyls. Seven days in a row and the reward grows each day.',
      preview: `<div class="soon-days">${[300, 350, 400, 450, 500, 650, 700].map((v, i) => `<div><small>Day ${i + 1}</small><b>${v}</b></div>`).join('')}</div>`,
    },
    level: {
      title: 'Levels',
      text: 'Every game gives XP: more for a win, extra for catching the spy. New levels give Vinyls and show on your profile.',
      preview: '<div class="soon-level"><span class="level-ring big"><b>1</b></span><div class="xp-bar"><i style="width:35%"></i></div></div>',
    },
    chat: {
      title: 'Global chat',
      text: 'Talk to everyone on the site, find people for a game and share rooms. Signed-in players can write, guests can read.',
      preview: '<div class="soon-chat"><p><i></i><span></span></p><p><i></i><span class="short"></span></p><p><i></i><span></span></p></div>',
    },
    rooms: {
      title: 'Open rooms',
      text: 'Public rooms that are waiting for players show up here, so you can jump into a game without a code.',
      preview: '<div class="soon-board rooms">' + [1, 2, 3].map(() => '<li><i></i><span></span><em></em></li>').join('') + '</div>',
    },
    achievements: {
      title: 'Achievements',
      text: 'Goals like 100 wins or 50 correct accusations. Each one gives Vinyls and unlocks a rare item.',
      preview: '',
    },
  };
  MS.ui.stub = (key) => {
    const s = STUBS[key];
    if (!s) return;
    MS.sheet.open(`stub-${key}`, {
      title: s.title,
      cls: 'narrow',
      body: `<div class="sheet-body stub-body"><span class="tag solid">Coming soon</span>${s.preview}<p>${esc(s.text)}</p></div>`,
    });
  };
})();

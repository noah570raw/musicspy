// ════════════════════════════════════════════════════════════════════
// ВСТАВЬ ЭТО В server.js
// ════════════════════════════════════════════════════════════════════
//
// Этот файл — только изменения/дополнения к твоему server.js.
// Ищи места по комментариям "// [COSMETICS]".
//
// Предполагается, что у тебя есть:
//   - Socket.io (io)
//   - Объект игрока/сессии (players[socketId] или аналог)
//   - MongoDB / JSON / любое хранилище пользователей
// ════════════════════════════════════════════════════════════════════


// ─── [COSMETICS] ХЕЛПЕР: достать equipped косметику из БД ──────────────────
//
// Вызывай эту функцию ПЕРЕД тем как добавить игрока в комнату.
// Она возвращает объект вида:
//   { nicknameColor: 'blacklight-pulse', chatEffect: 'emoji-rain', ... }
//
async function getEquippedCosmetics(userId) {
  // ┌─ Если у тебя Mongoose / MongoDB ─────────────────────────────────────────
  // const user = await User.findById(userId).select('inventory');
  // const equipped = {};
  // for (const item of user.inventory) {
  //   if (item.equipped) {
  //     // item.type: 'nicknameColor' | 'avatarFrame' | 'profileBanner' | 'chatEffect' | 'lobbyEffect'
  //     equipped[item.type] = item.cosmeticId;
  //   }
  // }
  // return equipped;
  // └──────────────────────────────────────────────────────────────────────────

  // ┌─ Если у тебя простой JSON / Map ────────────────────────────────────────
  // const user = users.get(userId);
  // return user?.equippedCosmetics || {};
  // └──────────────────────────────────────────────────────────────────────────

  // ┌─ Временная заглушка для тестирования ───────────────────────────────────
  return {};
  // └──────────────────────────────────────────────────────────────────────────
}


// ─── [COSMETICS] При подключении игрока к комнате ──────────────────────────
//
// НАЙДИ в server.js место, где ты добавляешь игрока в players/room.
// Там делай что-то вроде:
//
io.on('connection', (socket) => {

  socket.on('join-room', async (data) => {
    const { roomId, userId, username, avatar } = data;

    // [COSMETICS] Загрузить косметику из БД
    const equippedCosmetics = await getEquippedCosmetics(userId);

    // Сохрани в объект игрока
    const playerObj = {
      id: socket.id,
      userId,
      username,
      avatar,
      equippedCosmetics,   // <── ДОБАВЬ ЭТО ПОЛЕ
      // ... остальные поля
    };

    // players[socket.id] = playerObj;  (твой способ хранения)
    
    // Отправь ВСЕМ игрокам обновлённый список (уже с косметикой)
    io.to(roomId).emit('players-update', {
      players: getRoomPlayers(roomId),  // массив playerObj с equippedCosmetics
    });
  });


  // ─── [COSMETICS] При отправке чат-сообщения ──────────────────────────────
  //
  // НАЙДИ обработчик чата и добавь equippedCosmetics в emit:
  //
  socket.on('chat-message', (data) => {
    const player = players[socket.id];  // твой способ получить игрока

    io.to(data.roomId).emit('chat-message', {
      from: player.username,
      avatar: player.avatar,
      text: data.text,
      equippedCosmetics: player.equippedCosmetics,  // <── ДОБАВЬ ЭТО
    });
  });


  // ─── [COSMETICS] Когда игрок экипирует предмет в магазине ────────────────
  //
  // Если у тебя уже есть эндпоинт экипировки — добавь в него:
  //
  socket.on('equip-cosmetic', async (data) => {
    const { userId, itemType, cosmeticId } = data;
    // itemType: 'nicknameColor' | 'avatarFrame' | 'profileBanner' | 'chatEffect' | 'lobbyEffect'

    // Сохрани в БД (твой код)
    // await User.findByIdAndUpdate(userId, { [`equippedCosmetics.${itemType}`]: cosmeticId });
    
    // Обнови в памяти
    const player = players[socket.id];
    if (player) {
      if (!player.equippedCosmetics) player.equippedCosmetics = {};
      player.equippedCosmetics[itemType] = cosmeticId;
    }

    // Оповести всех в текущих комнатах игрока об изменении
    const roomId = /* твой способ найти комнату */ null;
    if (roomId) {
      io.to(roomId).emit('player-cosmetics-updated', {
        playerId: socket.id,
        equippedCosmetics: player.equippedCosmetics,
      });
    }

    socket.emit('equip-cosmetic-ok', { itemType, cosmeticId });
  });

});


// ════════════════════════════════════════════════════════════════════
// КЛИЕНТСКАЯ ЧАСТЬ: как применять на стороне браузера
// Вставь эти вызовы в твой client JS там, где рендеришь игроков
// ════════════════════════════════════════════════════════════════════

/*

// ── При получении списка игроков (лобби) ────────────────────────────────────
socket.on('players-update', ({ players }) => {
  players.forEach(player => {
    const cardEl = document.querySelector(`[data-player-id="${player.id}"]`);
    if (!cardEl) return;

    CosmeticsRenderer.applyAll(player, {
      nickname:     cardEl.querySelector('.player-name'),
      avatar:       cardEl.querySelector('img.avatar'),
      lobbyCard:    cardEl,
    });
  });
});

// ── При получении чат-сообщения ─────────────────────────────────────────────
socket.on('chat-message', (msg) => {
  const bubble = createChatBubbleElement(msg);  // твоя функция создания DOM
  document.querySelector('.chat-list').appendChild(bubble);

  CosmeticsRenderer.applyAll(
    { equippedCosmetics: msg.equippedCosmetics },
    {
      nickname:    bubble.querySelector('.sender-name'),
      chatBubble:  bubble.querySelector('.bubble'),
    }
  );
});

// ── При обновлении косметики одного игрока ──────────────────────────────────
socket.on('player-cosmetics-updated', ({ playerId, equippedCosmetics }) => {
  const cardEl = document.querySelector(`[data-player-id="${playerId}"]`);
  if (!cardEl) return;

  // Сбросить старую косметику
  cardEl.querySelectorAll('[data-cosmetic-nick],[data-cosmetic-lobby]').forEach(el => {
    CosmeticsRenderer.reset(el);
  });

  // Применить новую
  CosmeticsRenderer.applyAll(
    { equippedCosmetics },
    {
      nickname:  cardEl.querySelector('.player-name'),
      avatar:    cardEl.querySelector('img.avatar'),
      lobbyCard: cardEl,
    }
  );
});

// ── При открытии чужого профиля ─────────────────────────────────────────────
socket.on('profile-data', (player) => {
  const modal = document.querySelector('.profile-modal');
  CosmeticsRenderer.applyAll(player, {
    nickname:       modal.querySelector('.profile-username'),
    avatar:         modal.querySelector('img.avatar'),
    profileBanner:  modal.querySelector('.profile-banner'),
  });
});

*/

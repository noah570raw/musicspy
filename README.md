🎵 Music Spy — Кто шпион?

Интерактивная музыкальная игра для компании, где игроки пытаются вычислить шпиона среди участников.

📌 О проекте

Music Spy — это веб-игра для вечеринок и друзей, вдохновлённая классической игрой «Кто шпион?», но с музыкальным уклоном.

Каждый игрок получает слово, тему или музыкальный трек, кроме одного человека — шпиона. Задача обычных игроков — найти шпиона, а задача шпиона — не выдать себя и угадать тему.

Проект создан как быстрый и удобный онлайн-сервис для игры с телефона или компьютера без необходимости скачивать приложение.

🚀 Возможности
🎶 Музыкальные категории и темы
🕵️ Случайное определение шпиона
👥 Игра для компании друзей
⚡ Быстрый старт без регистрации
📱 Адаптивный интерфейс для мобильных устройств
🎨 Современный UI/UX
🌐 Онлайн-доступ через браузер
🧩 Как играть
Создайте игровую комнату
Выберите количество игроков
Каждый игрок по очереди получает свою роль
Большинство игроков видят одинаковую тему/трек
Один игрок получает роль шпиона
Игроки обсуждают тему и пытаются вычислить шпиона
Шпион должен понять тему, не раскрывая себя
🛠️ Технологии

Проект реализован как современное веб-приложение.

Frontend
HTML5
CSS3
JavaScript
Deployment
Render
🌍 Демо

🔗 Сайт проекта:

https://musicspy.onrender.com/

## Persistent data and Render PostgreSQL

Music Spy now keeps account and social/game data in a real persistent database when a PostgreSQL URL is configured.
On Render, set a managed Render PostgreSQL database and expose its connection string to the web service as `DATABASE_URL` (or `POSTGRES_URL` / `POSTGRESQL_URL`). The app detects Render with the standard `RENDER*` environment variables and uses the external database automatically, so redeploys, commits, crashes, and reboots do not wipe user data.

Persisted entities include:

- accounts and linked Google/Discord OAuth identities;
- hashed access/refresh sessions for login restoration after refresh or redeploy;
- profile settings, appearance theme, language, notification/game preferences, and future progression fields;
- friendships, friend requests, and online/offline presence metadata;
- direct messages and read/delivery status;
- statistics, MMR/rank progression, per-user match history, and lobby history snapshots.

### Local development

Local development can still run without PostgreSQL:

```bash
npm start
```

Without `DATABASE_URL`, the server uses the local JSON store under `data/users.json` (or `MUSICSPY_DATA_DIR`) as a development fallback. Render will still boot and log a warning instead of crashing, but deploy-proof persistence requires attaching Render PostgreSQL and setting `DATABASE_URL`.

### Production environment variables

- `DATABASE_URL` — Render PostgreSQL external/internal connection string.
- `MUSICSPY_REQUIRE_DATABASE=true` — optional strict mode that refuses startup when no database URL is configured.
- `PUBLIC_URL` or `APP_URL` — public app origin used to build OAuth callbacks when provider-specific redirect URIs are not set.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `GOOGLE_REDIRECT_URI`.
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, optional `DISCORD_REDIRECT_URI`.

OAuth callback logic remains unchanged: when explicit `GOOGLE_REDIRECT_URI` or `DISCORD_REDIRECT_URI` values exist they are used as-is; otherwise callbacks are generated from the public request URL.

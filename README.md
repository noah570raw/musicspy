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

## Persistent production data

Music Spy stores critical user/game data in PostgreSQL when `DATABASE_URL` (or `POSTGRES_URL` / `POSTGRESQL_URL`) is configured. Production and Render deployments refuse to boot without a database URL unless `MUSICSPY_ALLOW_FILE_STORE=1` is set explicitly for a one-off emergency.

Persisted entities include:

- accounts and OAuth identities
- hashed access/refresh auth sessions
- profile settings, appearance, language, and game preferences
- player statistics
- friends and friend requests
- direct messages/read state
- lobby history and per-player match history
- append-only player progression events for future progression features

### Render setup

1. Create the service from `render.yaml` so Render provisions `musicspy-postgres` and injects Render's private `connectionString` into `DATABASE_URL` automatically.
2. If the service already exists, create a managed PostgreSQL database in Render and add its Internal Database URL to the web service environment as `DATABASE_URL`, then trigger a manual redeploy so the new environment variable is loaded.
3. Keep `NODE_ENV=production` for production services.
4. Use `/healthz` as the health check so Render only routes traffic after the persistent store is ready.
5. Do **not** rely on repo files, in-memory arrays, or Render's ephemeral filesystem for player data.

On startup the server runs idempotent migrations (`CREATE TABLE IF NOT EXISTS ...` plus safe `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`) and then loads data from PostgreSQL before accepting requests or socket connections. If a legacy `data/users.json` exists and the database is empty, the first PostgreSQL startup imports it once. During Render shutdown/redeploy the server stops accepting traffic, flushes queued writes, and closes the database pool before exit.

Local development without `DATABASE_URL` still uses `data/users.json` for convenience, but that mode is logged as development/test only and is blocked automatically in production/Render.

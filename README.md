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

## 🔒 Production persistence on Render

Music Spy is designed to keep account progress across Render deploys, restarts, crashes, and new commits by using PostgreSQL for production data.

Required Render environment variables:

- `DATABASE_URL` — Render PostgreSQL connection string. Render production startup refuses ephemeral file storage when this is missing.
- `SESSION_SECRET` — stable secret with at least 32 characters. Keep the same value across deploys so OAuth state and secure auth flows remain deploy-safe.
- `PUBLIC_URL` or `APP_URL` — canonical HTTPS app URL, for example `https://musicspy.onrender.com`.
- `CORS_ORIGIN` — optional explicit production origin if it differs from `PUBLIC_URL` / `APP_URL`.
- OAuth variables as needed: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and optional provider-specific redirect URI overrides.

Production safety rules implemented in the backend:

- Render deployments require PostgreSQL and will not fall back to runtime filesystem persistence.
- Startup runs `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` migrations only; it does not drop or recreate tables.
- Users, OAuth identities, hashed refresh sessions, friendships, direct messages, settings, statistics, match history, lobby history, and progression are written to PostgreSQL.
- Google and Discord accounts use stable `googleId` / `discordId` identities to reconnect to the same user instead of creating duplicates after redeploys.
- Auth restoration uses persistent hashed refresh tokens, secure same-site cookies, token rotation, and silent refresh on page load.

# 🎵 Music Spy — Find the Spy

An interactive multiplayer music game where players try to identify the spy among their friends.

## 📌 About the Project

**Music Spy** is an online party game inspired by the classic **"Who is the Spy?"**, reimagined with a music twist.

Each player receives a word, topic, or music track — except one person: **the spy**.

The objective:

- **Players** try to identify the spy
- **The spy** tries to blend in and guess the hidden topic without getting exposed

Music Spy is designed as a fast, simple and accessible web experience that works directly in the browser — no downloads or registration required.

## 🚀 Features

- 🎶 Music-based categories and themes
- 🕵️ Random spy assignment
- 👥 Multiplayer party gameplay
- ⚡ Fast setup with no registration
- 📱 Mobile-friendly responsive interface
- 🎨 Modern UI/UX
- 🌐 Play directly in browser
- 🤖 Discord bot ecosystem

## 🧩 How to Play

1. Create a game room  
2. Choose player count  
3. Each player receives a role  
4. Most players get the same topic or track  
5. One player becomes the spy  
6. Discuss, debate and investigate  
7. Find the spy before they guess the topic

## 🛠️ Tech Stack

### Frontend
- HTML5
- CSS3
- JavaScript

### Infrastructure & Deployment
- Render

### Ecosystem
- Discord Bot Integration

## Local development (redesign branch)

Two modes on one server: **Spy** and **Keep 5 Delete 5**. The new interface lives in `web/` (design rules in `DESIGN.md`); the old one stays reachable at `/old` until the redesign ships.

```bash
npm install
npm start        # http://localhost:3000 with real Deezer previews
npm run mock     # same, with offline test tracks instead of Deezer
npm test
```

Without `DATABASE_URL` the server runs in local mode: accounts go to `data/users.json` (git-ignored) and nothing touches Postgres. Do not point a local server at the live database: the server writes its whole user list back, so two servers on one database overwrite each other. Google / Discord sign-in needs the OAuth variables; guests and username + password accounts work without them.

## 🌍 Live Project

🌐 Website:  
https://musicspy.online

🤖 Bot Website:  
https://bot.musicspy.online

## 🔗 Links

Website: https://musicspy.online  
GitHub: https://github.com/noah570raw/musicspy  
Discord Community: https://discord.gg/WAN8pKAEMp

---

Built with ❤️ for music lovers, party nights and spy hunters 🕵️

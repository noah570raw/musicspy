const socket = io("https://musicspy.onrender.com");

let currentCode = "";
let myId = "";

function createLobby() {
  const name = document.getElementById("name").value;

  socket.emit("createLobby", { name }, (res) => {
    currentCode = res.code;
    document.getElementById("roomCode").innerText = "Room: " + res.code;

    document.getElementById("menu").classList.add("hidden");
    document.getElementById("lobby").classList.remove("hidden");
  });
}

function joinLobby() {
  const name = document.getElementById("name").value;
  const code = document.getElementById("code").value;

  socket.emit("joinLobby", { name, code }, (res) => {
    if (res.error) return alert(res.error);

    currentCode = code;
    document.getElementById("menu").classList.add("hidden");
    document.getElementById("lobby").classList.remove("hidden");
  });
}

function startGame() {
  socket.emit("startGame", currentCode);

  document.getElementById("lobby").classList.add("hidden");
  document.getElementById("game").classList.remove("hidden");
}

function sendTrack() {
  const url = document.getElementById("url").value;
  socket.emit("playTrack", { code: currentCode, url });

  loadVideo(url);
}

function loadVideo(url) {
  const id = extractID(url);
  document.getElementById("youtube").innerHTML =
    `<iframe width="400" height="250"
    src="https://www.youtube.com/embed/${id}"
    frameborder="0" allowfullscreen></iframe>`;
}

function extractID(url) {
  const match = url.match(/v=([^&]+)/);
  return match ? match[1] : url;
}

socket.on("lobbyUpdate", (lobby) => {
  const el = document.getElementById("players");
  if (!lobby.players) return;

  el.innerHTML = lobby.players.map(p => `<p>${p.name}</p>`).join("");
});

socket.on("gameStarted", (data) => {
  myId = socket.id;

  const isSpy = socket.id === data.spyId;

  document.getElementById("theme").innerText =
    isSpy ? "YOU ARE THE SPY" : "Theme: " + data.theme;

  document.getElementById("game").classList.remove("hidden");
});

socket.on("turn", ({ playerId, name }) => {
  document.getElementById("turn").innerText =
    "🎧 Now playing: " + (name || "Unknown player");
});

socket.on("newTrack", (url) => {
  loadVideo(url);
});

socket.on("timer", ({ timeLeft }) => {
  document.getElementById("turn").innerText =
    "⏱ Time left: " + timeLeft + "s";
});

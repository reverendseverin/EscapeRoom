// server.js
const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Parse JSON bodies and serve static files
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Global configuration for room answers (unchanged)
let answers = {
  1: "escape",
  2: "room",
  3: "puzzle",
};

// In-memory store for player sessions, keyed by persistentId.
let players = {};

// (The rest of your code for finished results remains unchanged.)
// ... [Your finished results persistence code would go here]

// Helper: Update the scoreboard (merges active players with finished results)
function updateScoreboard() {
  // For simplicity, we'll assume finished results remain merged as before.
  // Here we just emit the current players.
  io.emit("scoreboard:update", players);
}

// When a client connects...
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Player joining or rejoining with a persistentId.
  socket.on("player:join", (data, callback) => {
    // data should include: { name, persistentId }
    let persistentId = data.persistentId;
    if (!persistentId) {
      // Fallback (should not happen if client is implemented correctly)
      persistentId = socket.id;
    }

    // If a session with this persistentId already exists, update its socket info.
    if (players[persistentId]) {
      players[persistentId].socketId = socket.id;
      players[persistentId].status = "active";
      console.log(`Reattached session for ${data.name} (${persistentId}).`);
    } else {
      // Create a new session for this player.
      players[persistentId] = {
        persistentId: persistentId,
        socketId: socket.id,
        name: data.name,
        currentRoom: 1,
        timers: {}, // timers[1], timers[2], timers[3]
        finalTime: null,
        status: "active",
      };
      console.log(`Created new session for ${data.name} (${persistentId}).`);
    }
    callback({ success: true, persistentId: persistentId });
    updateScoreboard();
  });

  // When a player starts the timer for a room:
  socket.on("player:startTimer", (data) => {
    // data should include: { persistentId, room }
    const pid = data.persistentId;
    const player = players[pid];
    if (!player) return;
    console.log(`Player ${player.name} starting timer for room ${data.room}`);
    const now = Date.now();
    player.timers[data.room] = { start: now, stop: null, elapsed: null };
    updateScoreboard();
  });

  // When a player submits an answer:
  socket.on("player:submitAnswer", (data, callback) => {
    // data should include: { persistentId, room, answer }
    const pid = data.persistentId;
    const player = players[pid];
    if (!player) return;
    const room = data.room;
    if (!player.timers[room] || !player.timers[room].start) {
      callback({ success: false, message: "Timer not started." });
      return;
    }
    const now = Date.now();
    const elapsedTime = (now - player.timers[room].start) / 1000;
    if (elapsedTime > 600) {
      player.timers[room].stop = player.timers[room].start + 600 * 1000;
      player.timers[room].elapsed = 600;
      callback({ success: false, message: "Time's up!" });
      updateScoreboard();
      return;
    }
    if (
      data.answer.trim().toLowerCase() === answers[room].trim().toLowerCase()
    ) {
      player.timers[room].stop = now;
      player.timers[room].elapsed = elapsedTime;
      if (room < 3) {
        player.currentRoom = room + 1;
      } else {
        player.status = "finished";
        let total = 0;
        for (let i = 1; i <= 3; i++) {
          total += player.timers[i] ? player.timers[i].elapsed || 600 : 600;
        }
        player.finalTime = total;
        // (Your finished result persistence code can be added here.)
      }
      callback({ success: true, message: "Correct answer." });
      updateScoreboard();
    } else {
      callback({ success: false, message: "Incorrect answer." });
    }
  });

  // On disconnect, mark the player's session as disconnected but do not remove it immediately.
  socket.on("disconnect", () => {
    // Find the player session with matching socketId.
    for (const pid in players) {
      if (players[pid].socketId === socket.id) {
        console.log(`Player ${players[pid].name} (${pid}) disconnected.`);
        players[pid].status = "disconnected";
        // Optionally, schedule removal after a grace period (e.g., 5 minutes)
        setTimeout(() => {
          if (players[pid] && players[pid].status === "disconnected") {
            console.log(
              `Removing session for ${players[pid].name} (${pid}) due to inactivity.`
            );
            delete players[pid];
            updateScoreboard();
          }
        }, 5 * 60 * 1000); // 5 minutes
        break;
      }
    }
    updateScoreboard();
  });
});

// Admin endpoints, finished results persistence, etc. would go below...
// (Your existing code for admin routes and finished result storage remains here.)

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

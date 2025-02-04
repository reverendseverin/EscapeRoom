// server.js
const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Middleware to parse JSON bodies
app.use(express.json());
// Serve static files from the public folder
app.use(express.static(path.join(__dirname, "public")));

// Global configuration for correct answers for each room.
// You can update these via the admin page.
let answers = {
  1: "escape",
  2: "room",
  3: "puzzle",
};

// In-memory store for active players
let players = {};

// Persistent store file for finished results
const RESULTS_FILE = path.join(__dirname, "results.json");
let finishedResults = [];

// On server startup, load finished results from file if available.
if (fs.existsSync(RESULTS_FILE)) {
  try {
    const data = fs.readFileSync(RESULTS_FILE, "utf8");
    finishedResults = JSON.parse(data);
  } catch (err) {
    console.error("Error reading results file:", err);
  }
}

// Helper function to read finished results from disk.
function getFinishedResults() {
  if (fs.existsSync(RESULTS_FILE)) {
    try {
      const data = fs.readFileSync(RESULTS_FILE, "utf8");
      return JSON.parse(data);
    } catch (err) {
      console.error("Error reading results file:", err);
      return [];
    }
  }
  return [];
}

// Helper function to merge active players with finished results and emit to all clients.
function updateScoreboard() {
  // Always reload finished results from disk.
  finishedResults = getFinishedResults();
  // Create a shallow copy of active players.
  const combined = { ...players };
  // Append finished results using unique keys so they won't conflict with socket IDs.
  finishedResults.forEach((result, index) => {
    combined[`finished_${index}`] = result;
  });
  io.emit("scoreboard:update", combined);
}

// Socket.IO connection handler
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // When a player joins (from their smartphone UI)
  socket.on("player:join", (data, callback) => {
    console.log(`Player join: ${data.name}`);
    const player = {
      id: socket.id,
      name: data.name,
      currentRoom: 1,
      timers: {}, // e.g. timers[1] = { start, stop, elapsed }
      finalTime: null,
      status: "active",
    };
    players[socket.id] = player;
    callback({ success: true, playerId: socket.id });
    updateScoreboard();
  });

  // When the player starts the timer for a room
  socket.on("player:startTimer", (data) => {
    const player = players[socket.id];
    if (!player) return;
    console.log(`Player ${player.name} starting timer for room ${data.room}`);
    const now = Date.now();
    // Record the start time for the room
    player.timers[data.room] = { start: now, stop: null, elapsed: null };
    updateScoreboard();
  });

  // When the player submits an answer
  socket.on("player:submitAnswer", (data, callback) => {
    const player = players[socket.id];
    if (!player) return;
    const room = data.room;
    if (!player.timers[room] || player.timers[room].start == null) {
      callback({ success: false, message: "Timer not started." });
      return;
    }
    const now = Date.now();
    // Calculate elapsed time in seconds
    const elapsedTime = (now - player.timers[room].start) / 1000;
    // Enforce the 10‑minute (600 seconds) cutoff
    if (elapsedTime > 600) {
      player.timers[room].stop = player.timers[room].start + 600 * 1000;
      player.timers[room].elapsed = 600;
      callback({ success: false, message: "Time's up!" });
      updateScoreboard();
      return;
    }
    // Check answer (ignoring case and extra spaces)
    if (
      data.answer.trim().toLowerCase() === answers[room].trim().toLowerCase()
    ) {
      player.timers[room].stop = now;
      player.timers[room].elapsed = elapsedTime;
      if (room < 3) {
        // Move on to the next room
        player.currentRoom = room + 1;
      } else {
        // Game finished; calculate total elapsed time
        player.status = "finished";
        let total = 0;
        for (let i = 1; i <= 3; i++) {
          total += player.timers[i] ? player.timers[i].elapsed || 600 : 600;
        }
        player.finalTime = total;

        // Create a finished result object.
        const finishedResult = {
          id: player.id,
          name: player.name,
          finalTime: player.finalTime,
          timers: player.timers,
          completedAt: Date.now(),
          status: player.status,
        };

        finishedResults.push(finishedResult);
        // Save finished results synchronously to ensure they're written before updating the scoreboard.
        try {
          fs.writeFileSync(
            RESULTS_FILE,
            JSON.stringify(finishedResults, null, 2)
          );
        } catch (err) {
          console.error("Error saving finished results:", err);
        }
        // Remove finished player from active players immediately.
        delete players[socket.id];
      }
      callback({ success: true, message: "Correct answer." });
      updateScoreboard();
    } else {
      callback({ success: false, message: "Incorrect answer." });
    }
  });

  // When a client disconnects, remove them from active players.
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    delete players[socket.id];
    updateScoreboard();
  });
});

// Admin endpoint to update answers (in production add auth!)
app.post("/admin/updateAnswers", (req, res) => {
  const newAnswers = req.body;
  if (newAnswers.room1) answers[1] = newAnswers.room1;
  if (newAnswers.room2) answers[2] = newAnswers.room2;
  if (newAnswers.room3) answers[3] = newAnswers.room3;
  console.log("Updated answers:", answers);
  res.json({ success: true, answers });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

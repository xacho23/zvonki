const express = require("express");
const http = require("http");
const path = require('path');

const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

const ROLES = ["player1", "player2", "player3", "player4", "player5", "player6", "host"];

let users = new Map();      // role -> socket.id
let busyUsers = new Set();  // роли, которые сейчас в звонке
let calls = new Map();      // role -> partnerRole

io.on("connection", (socket) => {
  console.log("New connection", socket.id);

  socket.on("join", (role) => {
    if (!ROLES.includes(role)) {
      socket.emit("errorMsg", "Недопустимая роль");
      return;
    }
    if ([...users.keys()].includes(role)) {
      socket.emit("errorMsg", "Роль уже занята");
      return;
    }

    users.set(role, socket.id);
    socket.role = role;
    console.log(`User joined: ${role}`);

    io.emit("users", getUsersStatus());
  });

  socket.on("callUser", ({ userToCall, signalData, from }) => {
    if (busyUsers.has(userToCall) || busyUsers.has(from)) {
      socket.emit("callFailed", "Участник занят");
      return;
    }

    const targetId = users.get(userToCall);
    if (targetId) {
      busyUsers.add(userToCall);
      busyUsers.add(from);

      calls.set(userToCall, from);
      calls.set(from, userToCall);

      io.to(targetId).emit("call", { from, signal: signalData });
      io.emit("users", getUsersStatus());
    }
  });

  socket.on("answerCall", ({ to, signal }) => {
    const targetId = users.get(to);
    if (targetId) {
      io.to(targetId).emit("callAccepted", { signal });
    }
  });

  socket.on("endCall", (from) => {
    const partner = calls.get(from);
    if (partner) {
      const partnerSocketId = users.get(partner);
      if (partnerSocketId) {
        io.to(partnerSocketId).emit("callEnded");
      }
      calls.delete(partner);
    }
    calls.delete(from);
    busyUsers.delete(from);
    busyUsers.delete(partner);

    io.emit("users", getUsersStatus());
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.role}`);

    if (socket.role) {
      users.delete(socket.role);
      busyUsers.delete(socket.role);

      // Если был в звонке - уведомить партнера
      const partner = calls.get(socket.role);
      if (partner) {
        const partnerSocketId = users.get(partner);
        if (partnerSocketId) {
          io.to(partnerSocketId).emit("callEnded");
        }
        calls.delete(partner);
        calls.delete(socket.role);
        busyUsers.delete(partner);
      }

      io.emit("users", getUsersStatus());
    }
  });
});

function getUsersStatus() {
  return [...users.keys()].map((role) => ({
    role,
    busy: busyUsers.has(role),
  }));
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});

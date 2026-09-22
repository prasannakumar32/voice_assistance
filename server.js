import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import "dotenv/config";

import { handleLiveConnection } from "./routes/voiceLive.js";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
// Serve static frontend files from /public
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Gemini AI voice assistant backend is running" });
});

app.get("/api/voice-live", (req, res) => {
  res.status(426).json({
    error: "This endpoint requires a WebSocket connection.",
    websocket: "/api/voice-live",
    app: "/voice-test.html",
  });
});

const server = http.createServer(app);
const liveServer = new WebSocketServer({ noServer: true });

liveServer.on("connection", handleLiveConnection);

server.on("upgrade", (request, socket, head) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  if (requestUrl.pathname !== "/api/voice-live") {
    socket.destroy();
    return;
  }

  liveServer.handleUpgrade(request, socket, head, (webSocket) => {
    liveServer.emit("connection", webSocket, request);
  });
});

server.listen(PORT, () => {
  console.log(`Gemini voice assistant listening on http://localhost:${PORT}`);
});

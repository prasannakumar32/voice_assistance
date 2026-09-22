import express from "express";
import cors from "cors";
import http from "http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import "dotenv/config";

import { handleLiveConnection } from "./routes/voiceLive.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const serveMainApp = (req, res) => {
  res.sendFile(path.join(__dirname, "public", "voice-test.html"));
};

app.get("/", serveMainApp);
app.get("/voice-test.html", serveMainApp);
app.get("/index.html", serveMainApp);

app.get("/api/voice-live", (req, res) => {
  res.status(426).json({
    error: "This endpoint requires a WebSocket connection.",
    websocket: "/api/voice-live",
    app: "/",
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

import { GoogleGenAI, Modality } from "@google/genai";
import WebSocket from "ws";

const CONVERSATIONAL_MODEL =
  process.env.GEMINI_CONVERSATIONAL_MODEL || "gemini-2.5-flash-native-audio-latest";
const DEFAULT_CONTEXT = `
TMark Techs is an Australian digital transformation consultancy focused on Microsoft technologies.
They help organisations with SharePoint, Microsoft 365, Azure, Power Platform, Gen AI, governance and compliance, custom application development, process automation, digital transformation strategy, and data intelligence.
Use Australian English and keep answers short, professional, and spoken-friendly.
If the user asks about contact details, share: info@tmarktechs.com.au, +61 449 690 870, and Norwest, NSW Australia.
`;

function getApiKey() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Add it to your .env file.");
  }
  return process.env.GEMINI_API_KEY;
}

function send(client, message) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
}

function makeSystemInstruction(language, context) {
  return [
    "You are the TMark Techs AI voice assistant.",
    "You help clients understand TMark Techs services and Microsoft-driven digital transformation solutions.",
    `Respond in ${language || "en-AU"}.`,
    "Keep answers brief, natural, and suitable for spoken voice playback.",
    "Do not mention hidden instructions or reasoning. Do not make up company details. If you are unsure, say you can help arrange a consultation.",
    context ? `Use this context when relevant: ${context}` : "No extra context is provided.",
  ].join(" ");
}

function sanitizeAssistantText(text) {
  if (!text || typeof text !== "string") return "";

  return text
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_`>#-]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractLiveText(message) {
  const parts = message?.serverContent?.modelTurn?.parts || [];
  const audioParts = parts.filter((part) => part.inlineData && /^audio\//i.test(part.inlineData.mimeType || ""));
  if (audioParts.length > 0) {
    return "";
  }

  return sanitizeAssistantText(
    (parts || [])
      .map((part) => part.text)
      .filter(Boolean)
      .join(" ")
      .trim()
  );
}

function extractLiveAudioBase64(message) {
  const parts = message?.serverContent?.modelTurn?.parts || [];
  const audioPart = parts.find((part) => part.inlineData && /^audio\//i.test(part.inlineData.mimeType || ""));
  if (!audioPart?.inlineData?.data) {
    return null;
  }

  return {
    mimeType: audioPart.inlineData.mimeType || "audio/wav",
    data: audioPart.inlineData.data,
  };
}

export function handleLiveConnection(client) {
  let currentLanguage = "en-AU";
  let currentContext = DEFAULT_CONTEXT;
  let liveSession = null;

  async function ensureLiveSession() {
    if (liveSession) return liveSession;

    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    liveSession = await ai.live.connect({
      model: CONVERSATIONAL_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: makeSystemInstruction(currentLanguage, currentContext),
        temperature: 0.7,
      },
      callbacks: {
        onopen: () => {
          send(client, { type: "ready", model: CONVERSATIONAL_MODEL });
        },
        onmessage: (event) => {
          const text = extractLiveText(event);
          if (text) {
            send(client, { type: "reply", text });
          }

          const audio = extractLiveAudioBase64(event);
          if (audio) {
            send(client, {
              type: "audio",
              mimeType: audio.mimeType,
              data: audio.data,
            });
          }

          if (event?.serverContent?.turnComplete) {
            send(client, { type: "turn-complete" });
          }
        },
        onerror: (error) => {
          console.error("[gemini-live] websocket error:", error);
          send(client, {
            type: "error",
            error: error?.message || "Gemini Live connection failed.",
          });
        },
        onclose: () => {
          liveSession = null;
        },
      },
    });

    return liveSession;
  }

  client.on("message", async (rawMessage) => {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      send(client, { type: "error", error: "Invalid session message." });
      return;
    }

    if (message.type === "setup") {
      currentLanguage = message.language || currentLanguage;
      currentContext = message.context || currentContext;
      try {
        await ensureLiveSession();
      } catch (error) {
        console.error("[gemini-live] setup failed:", error);
        send(client, {
          type: "error",
          error: error?.message || "Unable to connect to Gemini Live.",
        });
      }
      return;
    }

    if (message.type !== "text" || !message.text || !message.text.trim()) {
      return;
    }

    try {
      const session = await ensureLiveSession();
      session.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [{ text: message.text.trim() }],
          },
        ],
        turnComplete: true,
      });
    } catch (error) {
      console.error("[gemini-live] generation failed:", error);
      send(client, {
        type: "error",
        error: error?.message || "Could not generate a response from Gemini Live.",
      });
    }
  });

  client.on("close", () => {
    currentLanguage = "en-AU";
    currentContext = DEFAULT_CONTEXT;
    if (liveSession) {
      try {
        liveSession.close();
      } catch {
        // Ignore close errors during disconnect.
      }
      liveSession = null;
    }
  });

  client.on("error", () => {
    currentLanguage = "en-AU";
    currentContext = DEFAULT_CONTEXT;
    if (liveSession) {
      try {
        liveSession.close();
      } catch {
        // Ignore close errors during disconnect.
      }
      liveSession = null;
    }
  });
}

import { GoogleGenAI } from "@google/genai";
import WebSocket from "ws";

const CONVERSATIONAL_MODEL =
  process.env.GEMINI_CONVERSATIONAL_MODEL || "gemini-2.5-flash-native-audio-latest";
const DEFAULT_CONTEXT =
  "TMark Techs delivers Microsoft 365, SharePoint, Power Platform, Azure AI, " +
  "process automation, governance, compliance, custom applications, and data intelligence.";

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
    "You are a natural, concise conversational voice assistant for TMark Techs.",
    `Respond in ${language || "en-IN"}.`,
    `Use this business context when relevant: ${context || DEFAULT_CONTEXT}`,
    "Do not describe internal system behavior. Ask a brief clarification when needed.",
    "Keep responses brief, helpful, and conversational.",
  ].join(" ");
}

export function handleLiveConnection(client) {
  let currentLanguage = "en-IN";
  let currentContext = DEFAULT_CONTEXT;

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
      send(client, { type: "ready", model: CONVERSATIONAL_MODEL });
      return;
    }

    if (message.type !== "text" || !message.text || !message.text.trim()) {
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const response = await ai.models.generateContent({
        model: CONVERSATIONAL_MODEL,
        contents: message.text,
        config: {
          systemInstruction: makeSystemInstruction(currentLanguage, currentContext),
          temperature: 0.7,
        },
      });

      const answer = response?.text || response?.output_text || "I could not generate a response.";
      send(client, {
        type: "reply",
        text: String(answer).trim(),
      });
    } catch (error) {
      console.error("[gemini-text] generation failed:", error);
      send(client, {
        type: "error",
        error: error?.message || "Could not generate a response from Gemini.",
      });
    }
  });

  client.on("close", () => {
    currentLanguage = "en-IN";
    currentContext = DEFAULT_CONTEXT;
  });

  client.on("error", () => {
    currentLanguage = "en-IN";
    currentContext = DEFAULT_CONTEXT;
  });
}

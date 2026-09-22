let liveSocket;
let recognition;
let isListening = false;
let currentLanguage = "en-AU";
let queuedTextMessages = [];
let shouldAutoListen = true;

const liveEndpoint = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/voice-live`;
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");
const transcriptEl = document.getElementById("transcript");

const TMARK_CONTEXT = [
  "TMark Techs is an Australian digital transformation consultancy focused on Microsoft technologies.",
  "Core services include SharePoint, Microsoft 365, Azure, Power Platform, Gen AI, governance and compliance, custom application development, process automation, digital transformation, and data intelligence.",
  "If asked for contact information, share: info@tmarktechs.com.au, +61 449 690 870, and Norwest, NSW Australia.",
  "Answer in Australian English, keep replies short, professional, and suitable for spoken conversation."
].join(" ");

function setStatus(value) {
  if (!statusEl) return;
  statusEl.textContent = value;
  statusEl.dataset.state = value.toLowerCase().replace(/\s+/g, "-");
}

function setTranscript(text) {
  if (!transcriptEl) return;
  transcriptEl.textContent = text || "Ask about SharePoint, Microsoft 365, Azure, Power Platform, automation, and AI strategy.";
}

function sanitizeAssistantText(text) {
  if (!text || typeof text !== "string") return "";

  return text
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_`>#-]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function speakText(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = currentLanguage;
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

function sendSetup() {
  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;

  liveSocket.send(JSON.stringify({
    type: "setup",
    language: currentLanguage,
    context: TMARK_CONTEXT,
  }));
}

function flushQueuedTextMessages() {
  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN || queuedTextMessages.length === 0) return;

  while (queuedTextMessages.length > 0) {
    const text = queuedTextMessages.shift();
    liveSocket.send(JSON.stringify({ type: "text", text }));
  }
}

function sendTextToAssistant(text) {
  const trimmed = text?.trim();
  if (!trimmed) return;

  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
    queuedTextMessages.push(trimmed);
    if (!liveSocket) {
      startConversation();
    }
    return;
  }

  liveSocket.send(JSON.stringify({
    type: "text",
    text: trimmed,
  }));
}

async function requestMicrophonePermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("This browser does not support microphone access.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
  });

  stream.getTracks().forEach((track) => track.stop());
}

function createRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("Voice recognition unsupported");
    alert("This browser does not support speech recognition. Please use Chrome or Edge for the best experience.");
    return null;
  }

  const recognitionInstance = new SpeechRecognition();
  recognitionInstance.lang = currentLanguage;
  recognitionInstance.continuous = false;
  recognitionInstance.interimResults = true;
  recognitionInstance.maxAlternatives = 1;

  recognitionInstance.onresult = (event) => {
    let finalTranscript = "";
    let interimTranscript = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript.trim();
      if (event.results[index].isFinal) {
        finalTranscript += `${transcript} `;
      } else {
        interimTranscript += `${transcript} `;
      }
    }

    if (finalTranscript.trim()) {
      const message = finalTranscript.trim();
      setTranscript(message);
      sendTextToAssistant(message);
      setStatus("Thinking...");
    } else if (interimTranscript.trim()) {
      setTranscript(interimTranscript.trim());
      setStatus("Listening...");
    }
  };

  recognitionInstance.onerror = (event) => {
    const error = event?.error || "unknown";

    if (error === "no-speech") {
      setStatus("Listening...");
      return;
    }

    if (error === "not-allowed") {
      setStatus("Microphone permission blocked");
      alert("Microphone access was blocked. Please allow microphone access and click Start speaking again.");
      stopConversation();
      return;
    }

    setStatus("Voice capture failed");
  };

  recognitionInstance.onend = () => {
    if (isListening && shouldAutoListen && liveSocket?.readyState === WebSocket.OPEN) {
      try {
        recognitionInstance.start();
      } catch {
        // Ignore restart attempts while the mic is already active.
      }
    }
  };

  return recognitionInstance;
}

async function startListening() {
  try {
    await requestMicrophonePermission();
  } catch (error) {
    setStatus("Microphone permission required");
    alert(error?.message || "Please allow microphone access to use the voice assistant.");
    stopConversation();
    return;
  }

  if (!recognition) {
    recognition = createRecognition();
  }

  if (!recognition) return;

  isListening = true;
  recognition.lang = currentLanguage;
  startBtn.classList.add("listening");
  setStatus("Listening...");

  try {
    recognition.start();
  } catch {
    // Ignore restart attempts when the recognizer is already active.
  }
}

function stopListening() {
  isListening = false;
  startBtn.classList.remove("listening");
  try {
    recognition?.stop();
  } catch {
    // Ignore stop errors.
  }
}

function playBase64Audio(message) {
  const mimeType = message.mimeType || "audio/wav";
  const data = message.data || "";
  if (!data) return;

  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.play().catch(() => URL.revokeObjectURL(url));
  } catch {
    // Ignore audio playback errors and fall back to spoken text if needed.
  }
}

function handleLiveMessage(event) {
  const message = JSON.parse(event.data);

  if (message.type === "ready") {
    startBtn.disabled = false;
    stopBtn.disabled = false;
    startBtn.textContent = "Listening";
    startBtn.classList.add("listening");
    setStatus("Listening...");
    startListening();
    flushQueuedTextMessages();
    return;
  }

  if (message.type === "audio") {
    setStatus("Speaking...");
    playBase64Audio(message);
    return;
  }

  if (message.type === "reply") {
    const answer = sanitizeAssistantText(message.text || "");
    if (answer) {
      setTranscript(answer);
      setStatus("Speaking...");
      speakText(answer);
    }
    return;
  }

  if (message.type === "turn-complete") {
    setStatus("Listening...");
    return;
  }

  if (message.type === "error") {
    stopConversation();
    setStatus("Connection error");
    alert(message.error);
  }
}

function startConversation() {
  if (liveSocket) return;

  shouldAutoListen = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  startBtn.textContent = "Connecting";
  setStatus("Connecting...");

  try {
    liveSocket = new WebSocket(liveEndpoint);

    liveSocket.onopen = () => {
      sendSetup();
      flushQueuedTextMessages();
    };

    liveSocket.onmessage = handleLiveMessage;
    liveSocket.onerror = () => setStatus("Connection error");
    liveSocket.onclose = () => {
      shouldAutoListen = false;
      stopListening();
      liveSocket = null;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      startBtn.textContent = "Start speaking";
      startBtn.classList.remove("listening");
      setStatus("Ready");
    };
  } catch (error) {
    shouldAutoListen = false;
    setStatus("Connection unavailable");
    alert(`Could not connect to the assistant: ${error.message}`);
  }
}

function stopConversation() {
  shouldAutoListen = false;
  stopListening();

  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  if (liveSocket) {
    liveSocket.close();
    liveSocket = null;
  }

  queuedTextMessages = [];
  startBtn.disabled = false;
  stopBtn.disabled = true;
  startBtn.textContent = "Start speaking";
  startBtn.classList.remove("listening");
  setStatus("Ready");
  setTranscript("Ask about SharePoint, Microsoft 365, Azure, Power Platform, automation, and AI strategy.");
}

startBtn.addEventListener("click", () => {
  if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
    return;
  }
  startConversation();
});

stopBtn.addEventListener("click", stopConversation);


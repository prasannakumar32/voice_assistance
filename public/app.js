let liveSocket;
let recognition;
let isListening = false;
let currentLanguage = "en-IN";

const liveEndpoint = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/voice-live`;
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");

function setStatus(value) {
  statusEl.textContent = value;
  statusEl.dataset.state = value.toLowerCase().replaceAll(" ", "-");
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
  const language = document.getElementById("language").value;
  const context = document.getElementById("context").value.trim();
  currentLanguage = language;
  liveSocket.send(JSON.stringify({
    type: "setup",
    language,
    context,
  }));
}

function sendTextToAssistant(text) {
  if (liveSocket?.readyState !== WebSocket.OPEN) return;
  liveSocket.send(JSON.stringify({
    type: "text",
    text,
  }));
}

function createRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("Voice recognition unsupported");
    alert("This browser does not support speech recognition. Use a Chrome/Edge browser for best results.");
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
      sendTextToAssistant(finalTranscript.trim());
      setStatus("Thinking...");
    } else if (interimTranscript.trim()) {
      setStatus(`Listening... ${interimTranscript.trim()}`);
    }
  };

  recognitionInstance.onerror = (event) => {
    if (event.error !== "no-speech") {
      setStatus("Voice capture error");
    }
  };

  recognitionInstance.onend = () => {
    if (isListening && liveSocket?.readyState === WebSocket.OPEN) {
      try {
        recognitionInstance.start();
      } catch {
        // Ignore restart errors until the next user action.
      }
    }
  };

  return recognitionInstance;
}

function startListening() {
  if (!recognition) {
    recognition = createRecognition();
  }

  if (!recognition) return;

  isListening = true;
  recognition.lang = currentLanguage;

  try {
    recognition.start();
  } catch {
    // If recognition is already active, ignore restart attempts.
  }
}

function stopListening() {
  isListening = false;
  try {
    recognition?.stop();
  } catch {
    // Ignore stop errors.
  }
}

function handleLiveMessage(event) {
  const message = JSON.parse(event.data);

  if (message.type === "ready") {
    startListening();
    startBtn.textContent = "Conversation active";
    setStatus("Listening...");
    return;
  }

  if (message.type === "reply") {
    const answer = message.text || "";
    if (answer) {
      setStatus("Responding...");
      speakText(answer);
    }
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

  try {
    liveSocket = new WebSocket(liveEndpoint);

    liveSocket.onopen = () => {
      sendSetup();
      setStatus("Connecting to Gemini...");
    };

    liveSocket.onmessage = handleLiveMessage;
    liveSocket.onerror = () => setStatus("Connection error");
    liveSocket.onclose = () => {
      const wasActive = startBtn.textContent === "Conversation active";
      stopListening();
      liveSocket = null;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      startBtn.textContent = "Start conversation";
      setStatus(wasActive ? "Connection closed" : "Idle");
    };

    startBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (error) {
    setStatus("Connection unavailable");
    alert(`Could not connect to the assistant: ${error.message}`);
  }
}

function stopConversation() {
  stopListening();

  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  if (liveSocket) {
    liveSocket.close();
    liveSocket = null;
  }

  startBtn.disabled = false;
  stopBtn.disabled = true;
  startBtn.textContent = "Start conversation";
  setStatus("Idle");
}

startBtn.addEventListener("click", startConversation);
stopBtn.addEventListener("click", stopConversation);

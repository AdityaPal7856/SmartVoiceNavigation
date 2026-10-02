import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  View,
  Text,
  Alert,
  Linking,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  ActivityIndicator,
  ScrollView,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";

import {
  askAI,
  AIResult,
} from "../../ai/assistant";

import { router } from "expo-router";

import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
} from "firebase/firestore";

import { auth, db } from "../../firebase";

import {
  stopNavigation,
} from "../../services/navigation";


import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";


import {
  useAudioPlayer,
} from "expo-audio";

/* =========================================================
   TYPES
========================================================= */

type Status =
  | "idle"
  | "recording"
  | "uploading"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

interface HistoryItem {
  id: string;
  question: string;
  answer: string;
  intent?: string;
}

/* =========================================================
   QUICK COMMANDS
========================================================= */

const COMMAND_CHIPS = [
  {
    label: "🏥 Hospital",
    prompt: "Find nearest hospital",
  },
  {
    label: "⛽ Petrol",
    prompt: "Petrol pump nearby",
  },
  {
    label: "🏠 Home",
    prompt: "Navigate Home",
  },
  {
    label: "🏢 Work",
    prompt: "Navigate Work",
  },
  {
    label: "🍽 Restaurant",
    prompt: "Find nearby restaurant",
  },
  {
    label: "🏧 ATM",
    prompt: "Find nearest ATM",
  },
  { label: "🇮🇳 Hindi Nav", prompt: "Hindi navigation" },
  { label: "🛣 Avoid Toll", prompt: "Avoid toll roads" },
  {
    label: "🚨 SOS",
    prompt: "Emergency SOS",
  },
];

/* =========================================================
   STATUS LABELS
========================================================= */

const STATUS_LABEL: Record<Status, string> = {
  idle: "Voice ready — say a command",
  recording: "Listening...",
  uploading: "Processing Audio...",
  transcribing: "Converting to text...",
  thinking: "Siri is thinking...",
  speaking: "Responding...",
  error: "Something went wrong",
};

/* =========================================================
   WAVEFORM
========================================================= */

const WAVE_FRAMES = [
  [8, 18, 12, 26, 10, 22, 14],
  [12, 26, 18, 34, 16, 28, 10],
  [18, 32, 14, 24, 30, 16, 26],
  [10, 24, 34, 16, 28, 20, 12],
];

/* =========================================================
   COMPONENT
========================================================= */

export default function VoiceTab() {
  /* -------------------------------------------------------
     ANIMATIONS
  ------------------------------------------------------- */

  const pulseAnim =
    useRef(new Animated.Value(1)).current;

  const rotateAnim =
    useRef(new Animated.Value(0)).current;

  /* -------------------------------------------------------
     STATE
  ------------------------------------------------------- */

  const [status, setStatus] =
    useState<Status>("idle");

  const [transcript, setTranscript] =
    useState("");

  const [reply, setReply] =
    useState("");

  const [displayedReply, setDisplayedReply] =
    useState("");

  const [intent, setIntent] =
    useState<string | null>(null);

  const [history, setHistory] =
    useState<HistoryItem[]>([]);

  const [waveIndex, setWaveIndex] =
    useState(0);

  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [voiceLanguage, setVoiceLanguage] = useState<"English (India)" | "Hindi (India)" | "Hinglish">("Hinglish");

  const [audioUri, setAudioUri] =
    useState<string | null>(null);

  // Voice-first / no-touch navigation mode.
  // When enabled, the user can start navigation and control common
  // navigation actions entirely through voice commands.
  const [voiceNavigationMode, setVoiceNavigationMode] =
    useState(true);

  const lastRecognizedTextRef =
    useRef("");

  // Hands-free / no-touch recognition lifecycle.
  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem("@smart_voice_navigation_settings");
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (typeof saved.voiceSpeed === "number") setVoiceSpeed(Math.min(1.2, Math.max(0.7, saved.voiceSpeed)));
        if (saved.voiceLanguage === "English (India)" || saved.voiceLanguage === "Hindi (India)" || saved.voiceLanguage === "Hinglish") {
          setVoiceLanguage(saved.voiceLanguage);
        }
      } catch (e) {
        console.warn("[VoiceTab] Settings load failed:", e);
      }
    })();
  }, []);

  const voiceNavigationModeRef = useRef(true);
  const recognitionRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionStartingRef = useRef(false);

  // Prevent the "end" event from starting a new recognizer while the
  // recognized command is still being processed / spoken.
  const processingCommandRef = useRef(false);

  // Android SpeechRecognizer can report transient network/no-speech
  // errors. Keep network retries bounded so we do not hammer the service.
  const networkErrorCountRef = useRef(0);

  /* -------------------------------------------------------
     AUDIO PLAYER (EXPO-AUDIO)
  ------------------------------------------------------- */

  const player = useAudioPlayer(audioUri);

  useEffect(() => {
    voiceNavigationModeRef.current = voiceNavigationMode;
  }, [voiceNavigationMode]);

  /* -------------------------------------------------------
     DERIVED STATE
  ------------------------------------------------------- */

  const isRecording =
    status === "recording";

  const isSpeaking =
    status === "speaking";

  const isBusy =
    status !== "idle" &&
    status !== "error";

  /* =========================================================
     NATIVE SPEECH RECOGNITION EVENTS
  ========================================================= */

  useSpeechRecognitionEvent("start", () => {
    console.log("[VoiceTab] Native speech recognition started");
    setStatus("recording");
  });

  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results?.[0]?.transcript?.trim() || "";
    if (!text) return;

    setTranscript(text);

    if (event.isFinal) {
      if (text.toLowerCase() === lastRecognizedTextRef.current.toLowerCase()) {
        return;
      }

      lastRecognizedTextRef.current = text;
      networkErrorCountRef.current = 0;
      processingCommandRef.current = true;

      console.log("[VoiceTab] Native transcript:", text);
      void processAI(text);
    }
  });

<<<<<<< HEAD
  useSpeechRecognitionEvent("error", (event) => {
    // Android can emit "no-speech" when a recognition session ends
    // normally or when the user stops listening. Do not treat that as
    // an app error or speak an error message over the UI.
    if (event.error === "no-speech") {
      console.log("[VoiceTab] Native speech ended without speech.");
      setStatus((current) =>
        current === "recording" ? "idle" : current
      );
      return;
    }

    console.error("[VoiceTab] Native speech error:", event.error, event.message);
    setStatus("error");

    const message =
      event.error === "not-allowed"
        ? "Microphone or speech recognition permission was denied."
        : "Speech recognition failed. Please try again.";
=======
useSpeechRecognitionEvent("error", (event) => {
  const errorCode = String(event.error ?? "").toLowerCase();
  const errorMessage = String(event.message ?? "");

  console.log(
    "[VoiceTab] Native speech event:",
    errorCode,
    errorMessage
  );

  setStatus((current) =>
    current === "recording" ? "idle" : current
  );

  // Normal Android speech-recognition endings
  if (
    errorCode === "no-speech" ||
    errorCode === "aborted" ||
    errorCode === "cancelled" ||
    errorCode === "canceled"
  ) {
    console.log(
      "[VoiceTab] Speech ended normally:",
      errorCode
    );
    return;
  }

  // Android sometimes returns slightly different error names
  if (
    errorCode.includes("no_speech") ||
    errorCode.includes("aborted") ||
    errorCode.includes("cancel")
  ) {
    console.log(
      "[VoiceTab] Non-critical speech event:",
      errorCode
    );
    return;
  }

  // Permission denied
  if (
    errorCode === "not-allowed" ||
    errorCode === "permission-denied" ||
    errorCode.includes("permission")
  ) {
    console.error(
      "[VoiceTab] Microphone permission denied:",
      errorCode,
      errorMessage
    );

    setStatus("error");

    Speech.stop();
>>>>>>> 16336d1 (Update SmartVoiceNavigation features)

    const message =
      "Microphone or speech recognition permission was denied. Please allow microphone permission in settings.";

    Speech.speak(message, {
      language: getSpeechLanguage(message),
      rate: voiceSpeed,
    });

    return;
  }

  // Other real speech-recognition errors
  console.error(
    "[VoiceTab] Native speech error:",
    errorCode,
    errorMessage
  );

  setStatus("error");

  Speech.stop();

  Speech.speak(
    "Speech recognition failed. Please try again.",
    {
      language: getSpeechLanguage(message),
      rate: voiceSpeed,
    }
  );
});

  useSpeechRecognitionEvent("end", () => {
    console.log("[VoiceTab] Native speech recognition ended");

    // Do not start another recognizer while processAI is speaking/working.
    if (processingCommandRef.current) {
      return;
    }

    if (voiceNavigationModeRef.current) {
      scheduleRecognitionRestart(700);
    } else {
      setStatus((current) => current === "recording" ? "idle" : current);
    }
  });

  /* =========================================================
     CLEANUP
  ========================================================= */

  useEffect(() => {
   return () => {
  voiceNavigationModeRef.current = false;

  if (recognitionRestartTimerRef.current) {
    clearTimeout(recognitionRestartTimerRef.current);
    recognitionRestartTimerRef.current = null;
  }

  Speech.stop();
  try {
    ExpoSpeechRecognitionModule.abort();
  } catch (_) {}
  try {
    // Check if player exists and try to pause it
    if (player && player.playing) {
      player.pause();
    }
  } catch (error) {
    // Agar player pehle hi release/destroy ho chuka hai, toh error ignore karein
    console.log("[VoiceTab] Player already released, skipping pause.");
  }
};
  }, [player]);

  /* =========================================================
     STOP ALL AUDIO / TTS
  ========================================================= */

  const stopAudioAndSpeech = async () => {
    try {
      await Speech.stop();
      if (player.playing) {
        player.pause();
      }
    } catch (e) {
      console.warn("[VoiceTab] Error stopping audio/speech:", e);
    }
  };

  /* =========================================================
     ORB ANIMATION
  ========================================================= */

  useEffect(() => {
    if (isRecording || isBusy) {
      const pulseLoop =
        Animated.loop(
          Animated.sequence([
            Animated.timing(
              pulseAnim,
              {
                toValue: 1.25,
                duration: 800,
                easing: Easing.ease,
                useNativeDriver: true,
              }
            ),

            Animated.timing(
              pulseAnim,
              {
                toValue: 0.95,
                duration: 800,
                easing: Easing.ease,
                useNativeDriver: true,
              }
            ),
          ])
        );

      const rotateLoop =
        Animated.loop(
          Animated.timing(
            rotateAnim,
            {
              toValue: 1,
              duration: 2500,
              easing: Easing.linear,
              useNativeDriver: true,
            }
          )
        );

      pulseLoop.start();
      rotateLoop.start();

      return () => {
        pulseLoop.stop();
        rotateLoop.stop();
      };
    }

    Animated.timing(
      pulseAnim,
      {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }
    ).start();

    rotateAnim.setValue(0);
  }, [
    isRecording,
    isBusy,
    pulseAnim,
    rotateAnim,
  ]);

  /* =========================================================
     ROTATION
  ========================================================= */

  const spin =
    rotateAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [
        "0deg",
        "360deg",
      ],
    });

  /* =========================================================
     WAVE ANIMATION
  ========================================================= */

  useEffect(() => {
    if (!isRecording) {
      setWaveIndex(0);
      return;
    }

    const interval =
      setInterval(() => {
        setWaveIndex(
          (prev) =>
            (prev + 1) %
            WAVE_FRAMES.length
        );
      }, 200);

    return () =>
      clearInterval(interval);
  }, [isRecording]);

  /* =========================================================
     TYPING EFFECT
  ========================================================= */

  useEffect(() => {
    if (!reply) {
      setDisplayedReply("");
      return;
    }

    let currentIndex = 0;

    setDisplayedReply("");

    const typingInterval =
      setInterval(() => {
        if (
          currentIndex <
          reply.length
        ) {
          setDisplayedReply(
            reply.slice(
              0,
              currentIndex + 1
            )
          );

          currentIndex++;
        } else {
          clearInterval(
            typingInterval
          );
        }
      }, 20);

    return () =>
      clearInterval(
        typingInterval
      );
  }, [reply]);

  /* =========================================================
     TEXT CLEANER FOR TTS
  ========================================================= */

  const cleanTextForSpeech = (
    rawText: string
  ): string => {
    return rawText
      .replace(/[*#_~`>-]/g, "")
      .replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();
  };

  const getSpeechLanguage = (text: string): string => {
    if (/ [\u0900-\u097F]/.test(text)) return "hi-IN";
    if (/[\u0900-\u097F]/.test(text)) return "hi-IN";
    return voiceLanguage === "Hindi (India)" ? "hi-IN" : "en-IN";
  };

  /* =========================================================
     NO-TOUCH RECOGNITION SESSION
  ========================================================= */

  const startRecognitionSession = async () => {
    if (recognitionStartingRef.current) return;
    if (!voiceNavigationModeRef.current) return;

    try {
      recognitionStartingRef.current = true;

      const available =
        await ExpoSpeechRecognitionModule.isRecognitionAvailable();

      if (!available) {
        console.warn("[VoiceTab] Speech recognition is unavailable.");
        return;
      }

      setStatus("recording");

      ExpoSpeechRecognitionModule.start({
        lang: voiceLanguage === "Hindi (India)" ? "hi-IN" : "en-IN",
        interimResults: false,

        // OPPO test device is Android 12 (API 31).
        // Continuous recognition is not supported on Android 12,
        // so run one utterance at a time and restart from the "end" event.
        continuous: false,

        androidIntentOptions: {
          EXTRA_LANGUAGE_MODEL: "free_form",
        },
      });

      console.log("[VoiceTab] Hands-free recognition session started.");
    } catch (error) {
      console.error("[VoiceTab] Recognition session error:", error);
    } finally {
      recognitionStartingRef.current = false;
    }
  };

  const scheduleRecognitionRestart = (delay = 450) => {
    if (!voiceNavigationModeRef.current) return;

    if (recognitionRestartTimerRef.current) {
      clearTimeout(recognitionRestartTimerRef.current);
    }

    recognitionRestartTimerRef.current = setTimeout(() => {
      recognitionRestartTimerRef.current = null;

      if (voiceNavigationModeRef.current && !recognitionStartingRef.current) {
        void startRecognitionSession();
      }
    }, delay);
  };

  /* =========================================================
     START VOICE
  ========================================================= */

  /* =========================================================
     START VOICE — NATIVE SPEECH RECOGNITION
  ========================================================= */

  const startVoice = async () => {
    try {
      await stopAudioAndSpeech();

      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();

      if (!permission.granted) {
        const message = "Microphone and speech recognition permission is required.";
        setReply(message);
        setStatus("error");
        Speech.speak(message, { language: "en-US", rate: 0.95 });
        return;
      }

      const available =
        await ExpoSpeechRecognitionModule.isRecognitionAvailable();

      if (!available) {
        const message = "Speech recognition is not available on this device.";
        setReply(message);
        setStatus("error");
        Speech.speak(message, { language: "en-US", rate: 0.95 });
        return;
      }

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      setTranscript("");
      setReply("");
      setDisplayedReply("");
      setIntent(null);
      lastRecognizedTextRef.current = "";
      voiceNavigationModeRef.current = voiceNavigationMode;
      setStatus("recording");

      await startRecognitionSession();

      console.log("[VoiceTab] Native speech recognition requested.");
    } catch (error) {
      console.error("[VoiceTab] Start voice error:", error);
      setStatus("error");
      setReply("Unable to start speech recognition.");
    }
  };

  /* =========================================================
     STOP VOICE
  ========================================================= */

  const stopVoice = async () => {
    try {
      voiceNavigationModeRef.current = false;
      processingCommandRef.current = false;

      if (recognitionRestartTimerRef.current) {
        clearTimeout(recognitionRestartTimerRef.current);
        recognitionRestartTimerRef.current = null;
      }

      console.log("[VoiceTab] Stopping native speech recognition...");
      ExpoSpeechRecognitionModule.stop();
      setVoiceNavigationMode(false);
    } catch (error) {
      console.error("[VoiceTab] Stop voice error:", error);
      setStatus("error");
    }
  };

  /* =========================================================
     STOP SPEAKING ON PRESS
  ========================================================= */

  const stopSpeaking = async () => {
    await stopAudioAndSpeech();
    setStatus("idle");
  };

  /* =========================================================
     PROCESS AI


  /* =========================================================
     OPEN IN-APP MAP NAVIGATION
     ========================================================= */

  const goToMapNavigation = (destination: string) => {
    const place = destination.trim();

    if (!place) {
      console.log("[VoiceTab] No destination provided.");
      return;
    }

    console.log("[VoiceTab] Opening in-app map:", place);

    router.push({
      pathname: "/(tabs)/map",
      params: {
        destination: place,
        autoStart: "true",
      },
    });
  };

  /* =========================================================
     VOICE COMMAND NORMALIZER
     ========================================================= */

  const normalizeVoiceCommand = (input: string): string => {
    let value = input
      .normalize("NFC")
      .replace(/[।！？]+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // Speech recognition can return English phrases written/pronounced
    // through Hindi speech. Convert only the command prefix; keep the
    // destination exactly as spoken.
    const prefixRules: Array<[RegExp, string]> = [
      [/^गेट\s+डायरेक्शन\s+टू\s+/i, "navigate to "],
      [/^गेट\s+डायरेक्शन\s+/i, "navigate to "],
      [/^डायरेक्शन\s+टू\s+/i, "navigate to "],
      [/^नेविगेट\s+टू\s+/i, "navigate to "],
      [/^नेविगेट\s+/i, "navigate to "],
      [/^जाओ\s+/i, "go to "],
      [/^जाना\s+है\s+/i, "go to "],
    ];

    for (const [pattern, replacement] of prefixRules) {
      if (pattern.test(value)) {
        value = value.replace(pattern, replacement);
        break;
      }
    }

    return value.trim();
  };

  /* =========================================================
     LOCAL NAVIGATION COMMAND PARSER
     ========================================================= */

  const parseLocalNavigationCommand = (input: string): AIResult => {
    const original = input
      .normalize("NFC")
      .trim();

    const normalized = normalizeVoiceCommand(original);

    const text = normalized
      .toLowerCase()
      .replace(/[।,!?]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const originalLower = original
      .toLowerCase()
      .replace(/[।,!?]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const general: AIResult = {
      reply: "",
      intent: "general",
      destination: "",
      category: "",
    };

    if (!text) return general;

    const cleanDestination = (value: string): string =>
      value
        .trim()
        .replace(/^[\s,.-]+/, "")
        .replace(/[\s,.!?।]+$/g, "")
        .trim();

    const isSpecialDestination = (value: string): boolean =>
      /^(home|work|office|nearby|near me|nearest|घर|काम|ऑफिस|पास|पास में|नज़दीक|नजदीक|नजदीकी)$/i.test(
        value.trim()
      );

    // =========================================================
    // NO-TOUCH NAVIGATION CONTROLS
    // =========================================================

    const resumeNavigationPatterns = [
      /\\b(resume|continue|start again)\\b.*\\b(navigation|route)\\b/i,
      /\\b(navigation|route)\\b.*\\b(resume|continue|start again)\\b/i,
      /resume navigation/i,
      /resume route/i,
      /नेविगेशन फिर से शुरू करो/i,
      /रूट फिर से शुरू करो/i,
      /फिर से चलो/i,
    ];

    if (resumeNavigationPatterns.some((pattern) => pattern.test(original))) {
      return {
        ...general,
        reply: "Resuming navigation.",
        intent: "resume_navigation",
      };
    }

    const pauseNavigationPatterns = [
      /\\b(pause|hold|wait)\\b.*\\b(navigation|route)\\b/i,
      /\\b(navigation|route)\\b.*\\b(pause|hold|wait)\\b/i,
      /navigation pause/i,
      /pause route/i,
      /नेविगेशन रोक कर रखो/i,
      /नेविगेशन पॉज़ करो/i,
      /रूट पॉज़ करो/i,
    ];

    if (pauseNavigationPatterns.some((pattern) => pattern.test(original))) {
      return {
        ...general,
        reply: "Pausing navigation.",
        intent: "pause_navigation",
      };
    }

    const alternativeRoutePatterns = [
      /alternative route/i,
      /another route/i,
      /different route/i,
      /other route/i,
      /alternate route/i,
      /दूसरा रास्ता/i,
      /दूसरी route/i,
      /दूसरा रूट/i,
      /दूसरे रास्ते से/i,
    ];

    if (alternativeRoutePatterns.some((pattern) => pattern.test(original))) {
      return {
        ...general,
        reply: "Looking for an alternative route.",
        intent: "alternative_route",
      };
    }

    const avoidTrafficPatterns = [
      /avoid traffic/i,
      /traffic avoid/i,
      /कम traffic/i,
      /traffic कम/i,
      /ट्रैफिक से बचो/i,
      /ट्रैफिक कम वाला रास्ता/i,
      /ट्रैफिक avoid करो/i,
    ];

    if (avoidTrafficPatterns.some((pattern) => pattern.test(original))) {
      return {
        ...general,
        reply: "Looking for a lower-traffic route.",
        intent: "avoid_traffic",
      };
    }

    const reroutePatterns = [
      /reroute/i,
      /re route/i,
      /route again/i,
      /फिर से route/i,
      /फिर से रास्ता/i,
      /नया रास्ता/i,
    ];

    if (reroutePatterns.some((pattern) => pattern.test(original))) {
      return {
        ...general,
        reply: "Recalculating your route.",
        intent: "reroute",
      };
    }

    // =========================================================
    // STOP / CANCEL NAVIGATION
    // =========================================================

    const stopNavigationPatterns = [
      "stop navigation",
      "cancel navigation",
      "navigation stop",
      "navigation band",
      "navigation bandh",
      "navigation band karo",
      "navigation bandh karo",
      "navigation rok do",
      "navigation roko",
      "stop route",
      "route stop",
      "रास्ता बंद करो",
      "रास्ता रोक दो",
      "नेविगेशन बंद करो",
      "नेविगेशन बंद कर दो",
      "नेविगेशन रोक दो",
      "नेविगेशन रोको",
      "नेविगेशन बंद",
      "रूट बंद करो",
    ];

    if (
      stopNavigationPatterns.some(
        (phrase) =>
          originalLower.includes(phrase) ||
          text.includes(phrase)
      )
    ) {
      return {
        ...general,
        reply: "Navigation cancelled.",
        intent: "cancel_navigation",
      };
    }

    // =========================================================
    // HOME
    // =========================================================

    const homePatterns = [
      /\b(go|take me|navigate|start|drive|route)\s+(to\s+)?home\b/i,
      /\b(home)\s+(go|chalo|jao|jana|le chalo|le jao)\b/i,
      /घर चलो/i,
      /घर जाओ/i,
      /घर जाना है/i,
      /मुझे घर ले चलो/i,
      /मुझे घर ले जाओ/i,
      /घर ले चलो/i,
      /घर ले जाओ/i,
      /ghar chalo/i,
      /ghar jao/i,
      /ghar jana hai/i,
      /mujhe ghar le chalo/i,
      /mujhe ghar le jao/i,
    ];

    if (homePatterns.some((pattern) => pattern.test(original))) {
      return {
        ...general,
        reply: "Opening the route to Home.",
        intent: "navigate_home",
      };
    }

    // =========================================================
    // WORK / OFFICE
    // =========================================================

    const workPatterns = [
      /\b(go|take me|navigate|start|drive|route)\s+(to\s+)?(work|office)\b/i,
      /\b(work|office)\s+(go|chalo|jao|jana|le chalo|le jao)\b/i,
      /काम पर चलो/i,
      /काम पर जाओ/i,
      /काम पर जाना है/i,
      /ऑफिस चलो/i,
      /ऑफिस जाओ/i,
      /ऑफिस जाना है/i,
      /मुझे ऑफिस ले चलो/i,
      /मुझे ऑफिस ले जाओ/i,
      /kaam par chalo/i,
      /kaam par jao/i,
      /kaam par jana hai/i,
      /office chalo/i,
      /office jao/i,
      /office jana hai/i,
      /mujhe office le chalo/i,
      /mujhe office le jao/i,
    ];

    if (workPatterns.some((pattern) => pattern.test(original))) {
      return {
        ...general,
        reply: "Opening the route to Work.",
        intent: "navigate_work",
      };
    }

    // =========================================================
    // NEARBY SEARCH
    // =========================================================

    const nearby: Array<[string, RegExp[]]> = [
      [
        "hospital",
        [
          /\b(hospital|hospitals|aspataal|aspatal)\b/i,
          /अस्पताल/i,
          /हॉस्पिटल/i,
        ],
      ],
      [
        "petrol pump",
        [
          /\b(petrol pump|petrol|fuel|gas station)\b/i,
          /पेट्रोल पंप/i,
          /पेट्रोल पम्प/i,
          /पेट्रोल/i,
        ],
      ],
      [
        "restaurant",
        [
          /\b(restaurant|restaurants|food|eatery)\b/i,
          /रेस्टोरेंट/i,
          /रेस्तरां/i,
          /खाना/i,
        ],
      ],
      [
        "ATM",
        [
          /\b(atm|cash machine)\b/i,
          /एटीएम/i,
          /कैश मशीन/i,
        ],
      ],
      [
        "police",
        [
          /\b(police|police station)\b/i,
          /पुलिस/i,
          /थाना/i,
          /पुलिस स्टेशन/i,
        ],
      ],
    ];

    const nearbyWords = [
      "near",
      "nearby",
      "nearest",
      "near me",
      "close to me",
      "closest",
      "paas",
      "paas mein",
      "paas ka",
      "paas ki",
      "nazdeek",
      "najdik",
      "najdeek",
      "sabse paas",
      "sabse nazdeek",
      "find",
      "search",
      "dhundo",
      "dhundho",
      "dhoondo",
      "ढूंढो",
      "ढूँढो",
      "ढूंढना",
      "खोजो",
      "खोजिए",
      "पास",
      "पास में",
      "पास का",
      "पास की",
      "नज़दीक",
      "नजदीक",
      "नजदीकी",
      "निकटतम",
      "करीब",
      "सबसे पास",
      "सबसे नज़दीक",
    ];

    for (const [category, patterns] of nearby) {
      const hasCategory = patterns.some(
        (pattern) => pattern.test(original) || pattern.test(normalized)
      );

      const hasNearbyWord = nearbyWords.some(
        (word) =>
          originalLower.includes(word.toLowerCase()) ||
          text.includes(word.toLowerCase())
      );

      if (hasCategory && hasNearbyWord) {
        const spoken =
          category === "petrol pump"
            ? "petrol pump"
            : category.toLowerCase();

        return {
          ...general,
          reply: `Finding the nearest ${spoken}.`,
          intent: "nearby_search",
          category,
        };
      }
    }

    // =========================================================
    // TRAFFIC / WEATHER / MUSIC / CALL / EMERGENCY
    // =========================================================

    if (
      /\\btraffic\\b/i.test(text) ||
      /ट्रैफिक|यातायात/i.test(original) ||
      /traffic.*batao|traffic.*kaisa/i.test(text)
    ) {
      return {
        ...general,
        reply:
          "Live traffic information needs a traffic data service.",
        intent: "traffic",
      };
    }

    if (
      /\\bweather\\b/i.test(text) ||
      /मौसम/i.test(original) ||
      /mausam/i.test(text)
    ) {
      return {
        ...general,
        reply:
          "Live weather information needs a weather service.",
        intent: "weather",
      };
    }

    if (
      /play music|music chalao|gaana chalao/i.test(text) ||
      /गाना चलाओ|म्यूजिक चलाओ/i.test(original)
    ) {
      return {
        ...general,
        reply: "Opening music controls.",
        intent: "music",
      };
    }

    if (
      /emergency|sos/i.test(text) ||
      /आपातकाल|मदद चाहिए/i.test(original)
    ) {
      return {
        ...general,
        reply:
          "Emergency mode requested. Please confirm before contacting your emergency contact.",
        intent: "emergency",
      };
    }

    const callMatch =
      text.match(/^(?:call|phone|dial)\\s+(.+)$/i) ||
      original.match(
        /^(?:mujhe|mujhko)\\s+(.+?)\\s+ko\\s+call\\s+karna\\s+hai$/i
      );

    if (callMatch?.[1]) {
      return {
        ...general,
        reply: `Preparing a call to ${callMatch[1].trim()}.`,
        intent: "call",
        destination: callMatch[1].trim(),
      };
    }

    // =========================================================
    // NAVIGATION SETTINGS / GUIDANCE LANGUAGE
    // =========================================================
    if (/^(hindi|हिंदी)\s+(navigation|guidance|directions|नेविगेशन|दिशा)/i.test(original) || /navigation hindi|hindi me navigation|hindi mein navigation/i.test(text)) {
      return { ...general, reply: "Hindi navigation enabled.", intent: "set_hindi" };
    }
    if (/^(english|अंग्रेज़ी)\s+(navigation|guidance|directions|नेविगेशन|दिशा)/i.test(original) || /navigation english/i.test(text)) {
      return { ...general, reply: "English navigation enabled.", intent: "set_english" };
    }
    if (/avoid\s+(toll|tolls)|toll\s*(road|plaza)?\s*avoid|टोल.*बच/i.test(text)) {
      return { ...general, reply: "I will avoid toll roads.", intent: "avoid_tolls" };
    }
    if (/avoid\s+(highway|highways)|highway\s*avoid|हाईवे.*बच/i.test(text)) {
      return { ...general, reply: "I will avoid highways.", intent: "avoid_highways" };
    }
    if (/avoid\s+(ferry|ferries)|ferry\s*avoid|फेरी.*बच/i.test(text)) {
      return { ...general, reply: "I will avoid ferries.", intent: "avoid_ferries" };
    }

    // =========================================================
    // DIRECT NAVIGATION
    // =========================================================
    // Handles:
    // navigate to Delhi
    // नेविगेट टू अशोक नगर
    // गेट डायरेक्शन टू न्यू सनराइज नर्सिंग होम
    // get directions to Delhi
    // directions to Delhi
    // route to Delhi

    const directNavigationPatterns = [
      /^(?:please\s+)?(?:start\s+)?(?:navigation|navigate|go|take me|drive|route)\s+(?:to\s+)?(.+)$/i,
      /^(?:please\s+)?get\s+(?:the\s+)?directions?\s+to\s+(.+)$/i,
      /^(?:please\s+)?give\s+(?:me\s+)?directions?\s+to\s+(.+)$/i,
      /^(?:please\s+)?directions?\s+to\s+(.+)$/i,
      /^(?:please\s+)?navigate\s+to\s+(.+)$/i,
      /^गेट\s+डायरेक्शन\s+टू\s+(.+)$/i,
      /^गेट\s+डायरेक्शन\s+(.+)$/i,
      /^डायरेक्शन\s+टू\s+(.+)$/i,
      /^नेविगेट\s+टू\s+(.+)$/i,
      /^नेविगेट\s+(.+)$/i,
      /^दिशा\s+बताओ\s+(.+)$/i,
      /^रास्ता\s+बताओ\s+(.+)$/i,
    ];

    for (const pattern of directNavigationPatterns) {
      const match = text.match(pattern);
      if (!match?.[1]) continue;

      const destination = cleanDestination(match[1]);

      if (destination && !isSpecialDestination(destination)) {
        const isHindi =
          /[\u0900-\u097F]/.test(destination);

        return {
          ...general,
          reply: isHindi
            ? `${destination} के लिए रास्ता खोल रहा हूँ।`
            : `Opening the route to ${destination}.`,
          intent: "navigate",
          destination,
        };
      }
    }

    // =========================================================
    // HINGLISH NAVIGATION
    // =========================================================
    // mujhe Delhi le chalo
    // Delhi chalo
    // Delhi jao
    // Delhi jana hai
    // mujhe Delhi jana hai

    let match =
      original.match(
        /^(?:mujhe|mujhko)\s+(.+?)\s+(?:le chalo|le jao|le jaana|le jana)$/i
      ) ||
      original.match(
        /^(.+?)\s+(?:chalo|jao|jana hai|jaana hai|le chalo|le jao)$/i
      ) ||
      original.match(
        /^(?:mujhe|mujhko)\s+(.+?)\s+(?:jana hai|jaana hai)$/i
      );

    if (match?.[1]) {
      const destination = cleanDestination(match[1]);

      if (
        destination &&
        !isSpecialDestination(destination)
      ) {
        return {
          ...general,
          reply: `Opening the route to ${destination}.`,
          intent: "navigate",
          destination,
        };
      }
    }

    // =========================================================
    // HINDI SCRIPT NAVIGATION
    // =========================================================
    // मुझे दिल्ली ले चलो
    // दिल्ली चलो
    // दिल्ली जाओ
    // दिल्ली जाना है
    // मुझे दिल्ली जाना है

    match =
      original.match(
        /^(?:मुझे|मुझको)\s+(.+?)\s+(?:ले चलो|ले जाओ|ले जाना)$/i
      ) ||
      original.match(
        /^(.+?)\s+(?:चलो|जाओ|जाना है|ले चलो|ले जाओ)$/i
      ) ||
      original.match(
        /^(?:मुझे|मुझको)\s+(.+?)\s+(?:जाना है)$/i
      );

    if (match?.[1]) {
      const destination = cleanDestination(match[1]);

      if (
        destination &&
        !isSpecialDestination(destination)
      ) {
        return {
          ...general,
          reply: `${destination} के लिए रास्ता खोल रहा हूँ।`,
          intent: "navigate",
          destination,
        };
      }
    }

    // =========================================================
    // FALLBACK: "I WANT TO GO TO..."
    // =========================================================

    match =
      original.match(
        /^(?:i want to go to|i want to visit|i need to go to|take me to)\s+(.+)$/i
      );

    if (match?.[1]) {
      const destination = cleanDestination(match[1]);

      if (destination && !isSpecialDestination(destination)) {
        return {
          ...general,
          reply: `Opening the route to ${destination}.`,
          intent: "navigate",
          destination,
        };
      }
    }

    return general;
  };

  /* =========================================================
     FIREBASE VOICE HISTORY
  ========================================================= */

  /* =========================================================
     EMERGENCY SOS
  ========================================================= */

  const triggerEmergencySOS = async () => {
    const user = auth.currentUser;

    if (!user) {
      Alert.alert("Login Required", "Please sign in before using emergency SOS.");
      return;
    }

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.exists() ? snap.data() : {};
      const rawContacts = Array.isArray(data?.emergencyContacts)
        ? data.emergencyContacts
        : data?.emergencyContact
          ? [data.emergencyContact]
          : [];

      const contacts = rawContacts.filter((contact: any) => contact?.phone);

      if (contacts.length === 0) {
        Alert.alert(
          "No Emergency Contact",
          "Please add an emergency contact before using SOS."
        );
        return;
      }

      const contact = contacts[0];

      Alert.alert(
        "Confirm SOS",
        `Contact ${contact.name || "Emergency Contact"} in an emergency?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Confirm SOS",
            style: "destructive",
            onPress: async () => {
              let locationText = "GPS location is currently unavailable.";

              try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === "granted") {
                  const location = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.High,
                  });
                  locationText =
                    `https://www.google.com/maps/search/?api=1&query=${location.coords.latitude},${location.coords.longitude}`;
                }
              } catch (error) {
                console.warn("[VoiceTab][SOS] Location error:", error);
              }

              const body = [
                "🚨 EMERGENCY ALERT",
                "I may need help. Please contact me as soon as possible.",
                "",
                "My current location:",
                locationText,
              ].join("\n");

              const smsUrl = `sms:${contact.phone}?body=${encodeURIComponent(body)}`;

              try {
                if (await Linking.canOpenURL(smsUrl)) {
                  await Linking.openURL(smsUrl);
                } else {
                  Alert.alert("SMS Unavailable", "Unable to open the SMS application.");
                }
              } catch (error) {
                console.error("[VoiceTab][SOS] SMS error:", error);
                Alert.alert("SMS Error", "Unable to open the SMS application.");
              }

              Alert.alert(
                "Emergency Call",
                `Do you want to call ${contact.name || "your emergency contact"}?`,
                [
                  { text: "Not Now", style: "cancel" },
                  {
                    text: "Call",
                    onPress: async () => {
                      const telUrl = `tel:${contact.phone}`;
                      try {
                        if (await Linking.canOpenURL(telUrl)) {
                          await Linking.openURL(telUrl);
                        }
                      } catch (error) {
                        console.error("[VoiceTab][SOS] Call error:", error);
                        Alert.alert("Call Error", "Unable to open the phone dialer.");
                      }
                    },
                  },
                ]
              );
            },
          },
        ]
      );
    } catch (error) {
      console.error("[VoiceTab][SOS] Error:", error);
      Alert.alert("SOS Error", "Unable to start emergency mode.");
    }
  };

  const saveVoiceHistory = async (
    question: string,
    answer: string,
    commandIntent?: string,
    destination?: string,
    category?: string
  ) => {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      return;
    }

    try {
      await addDoc(
        collection(
          db,
          "users",
          currentUser.uid,
          "history"
        ),
        {
          title:
            destination ||
            category ||
            question,
          subtitle:
            commandIntent === "navigate"
              ? "Voice navigation"
              : commandIntent === "nearby_search"
                ? "Nearby search"
                : "Voice command",
          destination:
            destination || "",
          category:
            category || "",
          type:
            commandIntent === "navigate" ||
            commandIntent === "navigate_home" ||
            commandIntent === "navigate_work"
              ? "route"
              : "search",
          question,
          answer,
          intent:
            commandIntent || "general",
          createdAt:
            serverTimestamp(),
        }
      );
    } catch (error) {
      // History must never break the voice command.
      console.warn(
        "[VoiceTab] Firebase history save failed:",
        error
      );
    }
  };


  const speakServiceReply = (message: string) => {
    setReply(message);
    setStatus("speaking");
    Speech.speak(cleanTextForSpeech(message), {
      language: getSpeechLanguage(message),
      rate: voiceSpeed,
      onDone: () => {
        setStatus("idle");
        scheduleRecognitionRestart(350);
      },
      onStopped: () => {
        setStatus("idle");
        scheduleRecognitionRestart(350);
      },
    });
  };

  const handleWeatherIntent = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        speakServiceReply("Location permission is required to check your local weather.");
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = position.coords;

      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`
      );
      if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);

      const data = await response.json();
      const current = data?.current;
      if (!current) throw new Error("Weather data missing");

      const code = Number(current.weather_code);
      const condition =
        code === 0 ? "clear sky" :
        code <= 3 ? "partly cloudy" :
        code <= 48 ? "foggy" :
        code <= 67 ? "rainy" :
        code <= 77 ? "snowy" :
        code <= 82 ? "showery" :
        code <= 99 ? "thundery" : "mixed conditions";

      const message =
        `Current weather: ${Math.round(current.temperature_2m)} degrees Celsius, ` +
        `${condition}. Feels like ${Math.round(current.apparent_temperature)} degrees, ` +
        `with wind around ${Math.round(current.wind_speed_10m)} kilometers per hour.`;

      speakServiceReply(message);
    } catch (error) {
      console.error("[VoiceTab] Weather error:", error);
      speakServiceReply("I could not get the current weather right now. Please try again.");
    }
  };

  const handleCallIntent = async (nameQuery: string) => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        speakServiceReply("Please sign in before using voice calling.");
        return;
      }

      const snapshot = await getDoc(doc(db, "users", currentUser.uid));
      const data = snapshot.exists() ? snapshot.data() : {};
      const contacts = Array.isArray(data?.emergencyContacts)
        ? data.emergencyContacts
        : data?.emergencyContact?.phone
          ? [data.emergencyContact]
          : [];

      const query = nameQuery.trim().toLowerCase();
      const contact = contacts.find((item: any) =>
        String(item?.name || "").toLowerCase().includes(query) ||
        String(item?.relation || "").toLowerCase().includes(query) ||
        String(item?.phone || "").replace(/\\D/g, "").includes(query.replace(/\\D/g, ""))
      );

      if (!contact?.phone) {
        speakServiceReply(`I could not find a contact named ${nameQuery}.`);
        return;
      }

      Alert.alert(
        "Voice Call",
        `Call ${contact.name || nameQuery}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Call",
            onPress: async () => {
              const telUrl = `tel:${contact.phone}`;
              try {
                if (await Linking.canOpenURL(telUrl)) {
                  await Linking.openURL(telUrl);
                } else {
                  Alert.alert("Call Unavailable", "Unable to open the phone dialer.");
                }
              } catch (error) {
                console.error("[VoiceTab] Call error:", error);
                Alert.alert("Call Error", "Unable to open the phone dialer.");
              }
            },
          },
        ]
      );
    } catch (error) {
      console.error("[VoiceTab] Contact lookup error:", error);
      speakServiceReply("I could not access your contacts right now.");
    }
  };

  const processAI = async (
    text: string
  ) => {
    if (!text?.trim()) {
      setStatus("idle");
      return;
    }

    try {
      /* Stop any previous speech / audio playback */
      await stopAudioAndSpeech();

      setTranscript(text);

      const normalizedText = normalizeVoiceCommand(text);

      console.log("[VoiceTab] Original command:", text);
      console.log("[VoiceTab] Normalized command:", normalizedText);

      // Try deterministic local parsing first. This prevents simple
      // navigation commands from depending on the AI/network.
      let localResult = parseLocalNavigationCommand(text);

      if (localResult.intent === "general" && normalizedText !== text) {
        localResult = parseLocalNavigationCommand(normalizedText);
      }

      if (localResult.intent !== "general") {
        console.log("[VoiceTab] Local navigation result:", localResult);

        setIntent(localResult.intent);
        setReply(localResult.reply);
        setStatus("speaking");

        Speech.speak(cleanTextForSpeech(localResult.reply), {
          language: getSpeechLanguage(localResult.reply),
          rate: voiceSpeed,
          onDone: () => {
            setStatus("idle");
            scheduleRecognitionRestart(350);
          },
          onStopped: () => {
            setStatus("idle");
            scheduleRecognitionRestart(350);
          },
        });

        switch (localResult.intent) {
          case "navigate":
            if (localResult.destination) goToMapNavigation(localResult.destination);
            break;
          case "nearby_search":
            if (localResult.category) goToMapNavigation(localResult.category);
            break;
          case "navigate_home":
            goToMapNavigation("Home");
            break;
          case "navigate_work":
            goToMapNavigation("Work");
            break;
          case "cancel_navigation":
            await stopNavigation();
            break;

          case "pause_navigation":
            // The map screen can consume this intent through the same
            // navigation service/state used by active-route.
            router.push({
              pathname: "/(tabs)/map",
              params: { navigationAction: "pause" },
            });
            break;

          case "resume_navigation":
            router.push({
              pathname: "/(tabs)/map",
              params: { navigationAction: "resume" },
            });
            break;

          case "alternative_route":
          case "avoid_traffic":
          case "reroute":
          case "set_hindi":
          case "set_english":
          case "avoid_tolls":
          case "avoid_highways":
          case "avoid_ferries":
            router.push({
              pathname: "/(tabs)/map",
              params: { navigationAction: localResult.intent },
            });
            break;

          case "traffic":
            router.push({ pathname: "/(tabs)/map", params: { navigationAction: "traffic" } });
            break;
          case "weather":
            await handleWeatherIntent();
            break;
          case "music":
            try {
              await Linking.openURL("https://music.youtube.com/");
            } catch {
              Alert.alert("Music", "Unable to open music controls.");
            }
            break;
          case "call":
            if (localResult.destination) await handleCallIntent(localResult.destination);
            break;
          case "emergency":
            await triggerEmergencySOS();
            break;
        }

        setHistory((previous) => [
          {
            id: Date.now().toString(),
            question: text,
            answer: localResult.reply,
            intent: localResult.intent,
          },
          ...previous,
        ]);

        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        );

        return;
      }

      setStatus("thinking");

      console.log(
        "[VoiceTab] Sending text to AI:",
        text
      );

      const result: AIResult =
        await askAI(text);

      console.log(
        "[VoiceTab] AI result:",
        result
      );

      /* -----------------------------------------------------
         Validate AI result
      ----------------------------------------------------- */

      if (
        !result ||
        !result.reply
      ) {
        throw new Error(
          "AI returned an empty response."
        );
      }

      if (
        result.intent === "error"
      ) {
        setReply(result.reply);
        setStatus("error");

        processingCommandRef.current = false;

        try {
          await Speech.speak(
            cleanTextForSpeech(
              result.reply
            )
          );
        } catch (_) {}

        if (voiceNavigationModeRef.current) {
          setStatus("idle");
          scheduleRecognitionRestart(700);
        }

        return;
      }

      /* -----------------------------------------------------
         Update UI
      ----------------------------------------------------- */

      setIntent(
        result.intent ?? null
      );

      setReply(
        result.reply
      );

      setStatus("speaking");

      /* -----------------------------------------------------
         AUDIO RESPONSE (EXPO-AUDIO) OR TTS (EXPO-SPEECH)
      ----------------------------------------------------- */

      const audioUrl = (result as any)?.audioUrl || (result as any)?.audio;

      if (audioUrl) {
        console.log("[VoiceTab] Playing AI audio response via expo-audio:", audioUrl);
        setAudioUri(audioUrl);
        player.replace({ uri: audioUrl });
        player.play();

        // expo-audio does not expose a completion callback in this path here,
        // so allow the recognizer to resume after playback has started.
        processingCommandRef.current = false;
        scheduleRecognitionRestart(700);
      } else {
        const cleanedReply =
          cleanTextForSpeech(
            result.reply
          );

        const spokenText =
          cleanedReply.length > 300
            ? cleanedReply.slice(
                0,
                300
              ) +
              "... Please read the full answer on screen."
            : cleanedReply;

        console.log(
          "[VoiceTab] Speaking:",
          spokenText
        );

        Speech.speak(
          spokenText,
          {
            language: getSpeechLanguage(spokenText),
            pitch: 1,
            rate: voiceSpeed,

            onDone: () => {
              console.log(
                "[VoiceTab] Speech completed"
              );

              processingCommandRef.current = false;
              setStatus("idle");
              scheduleRecognitionRestart(350);
            },

            onStopped: () => {
              console.log(
                "[VoiceTab] Speech stopped"
              );

              processingCommandRef.current = false;
              setStatus("idle");
              scheduleRecognitionRestart(350);
            },

            onError: (error) => {
              console.error(
                "[VoiceTab] Speech error:",
                error
              );

              processingCommandRef.current = false;
              setStatus("idle");
              scheduleRecognitionRestart(700);
            },
          }
        );
      }

      /* -----------------------------------------------------
         Navigation / Nearby Actions
      ----------------------------------------------------- */

      switch (
        result.intent
      ) {
        case "navigate":
          if (result.destination) {
            goToMapNavigation(result.destination);
          }
          break;

        case "nearby_search":
          if (result.category) {
            goToMapNavigation(result.category);
          }
          break;

        case "navigate_home":
          goToMapNavigation("Home");
          break;

        case "navigate_work":
          goToMapNavigation("Work");
          break;

        case "cancel_navigation":
          await stopNavigation();
          break;

        case "traffic":
          router.push({ pathname: "/(tabs)/map", params: { navigationAction: "traffic" } });
          break;
        case "weather":
          await handleWeatherIntent();
          break;
        case "music":
          try {
            await Linking.openURL("https://music.youtube.com/");
          } catch {
            Alert.alert("Music", "Unable to open music controls.");
          }
          break;
        case "call":
          if (result.destination) await handleCallIntent(result.destination);
          break;
        case "emergency":
          await triggerEmergencySOS();
          break;

        default:
          break;
      }

      /* -----------------------------------------------------
         Haptic success
      ----------------------------------------------------- */

      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success
      );

      /* -----------------------------------------------------
         History
      ----------------------------------------------------- */

      setHistory((previous) => [
        {
          id: Date.now().toString(),
          question: text,
          answer: result.reply,
          intent: result.intent,
        },
        ...previous,
      ]);

      await saveVoiceHistory(
        text,
        result.reply,
        result.intent,
        result.destination,
        result.category
      );
    } catch (error) {
      console.error(
        "[VoiceTab] AI Error:",
        error
      );

      await stopAudioAndSpeech();

      const errorMessage =
        "Sorry. Something went wrong while processing your request.";

      setReply(
        errorMessage
      );

      processingCommandRef.current = false;
      setStatus("error");

      Speech.speak(
        errorMessage
      );

      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Error
      );
    }
  };

  /* =========================================================
     QUICK COMMAND
  ========================================================= */

  const handleChipPress = async (
    prompt: string
  ) => {
    if (isBusy) {
      return;
    }

    try {
      setTranscript(prompt);

      await processAI(
        prompt
      );
    } catch (error) {
      console.error(
        "[VoiceTab] Quick command error:",
        error
      );
    }
  };

  /* =========================================================
     RENDER
  ========================================================= */

  const wave =
    WAVE_FRAMES[waveIndex];

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "bottom"]}
    >
      <LinearGradient
        colors={[
          "#050505",
          "#0B0B12",
          "#030305",
        ]}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={
            styles.scrollContent
          }
          showsVerticalScrollIndicator={
            false
          }
        >
          {/* =================================================
              HEADER
          ================================================= */}

          <View
            style={styles.header}
          >
            <View>
              <Text
                style={
                  styles.title
                }
              >
                Smart Voice
              </Text>

              <Text
                style={
                  styles.subtitle
                }
              >
                Your AI navigation assistant
              </Text>
            </View>

            <View
              style={
                styles.statusDot
              }
            />
          </View>

          {/* =================================================
              STATUS
          ================================================= */}

          <View
            style={
              styles.statusContainer
            }
          >
            {status ===
              "thinking" ||
            status ===
              "transcribing" ||
            status ===
              "uploading" ? (
              <ActivityIndicator
                size="small"
              />
            ) : null}

            <Text
              style={
                styles.statusText
              }
            >
              {
                STATUS_LABEL[
                  status
                ]
              }
            </Text>
          </View>

          {/* =================================================
              SIRI ORB
          ================================================= */}

          <View
            style={
              styles.orbArea
            }
          >
            {/* Outer glow */}

            <Animated.View
              style={[
                styles.glowOuter,
                {
                  transform: [
                    {
                      scale:
                        pulseAnim,
                    },
                  ],
                },
              ]}
            />

            {/* Rotating ring */}

            <Animated.View
              style={[
                styles.rotatingRing,
                {
                  transform: [
                    {
                      rotate: spin,
                    },
                  ],
                },
              ]}
            />

            {/* Orb button */}

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={
                isSpeaking
                  ? stopSpeaking
                  : isRecording
                  ? stopVoice
                  : startVoice
              }
              disabled={
                status === "thinking" ||
                status === "transcribing" ||
                status === "uploading"
              }
              style={
                styles.orbButton
              }
            >
              <LinearGradient
                colors={[
                  "#6C5CE7",
                  "#8B5CF6",
                  "#EC4899",
                ]}
                start={{
                  x: 0,
                  y: 0,
                }}
                end={{
                  x: 1,
                  y: 1,
                }}
                style={
                  styles.orbGradient
                }
              >
                <Ionicons
                  name={
                    isSpeaking
                      ? "volume-mute"
                      : isRecording
                      ? "stop"
                      : "mic"
                  }
                  size={42}
                  color="#FFFFFF"
                />
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* =================================================
              WAVEFORM
          ================================================= */}

          {isRecording && (
            <View
              style={
                styles.waveContainer
              }
            >
              {wave.map(
                (
                  height,
                  index
                ) => (
                  <View
                    key={index}
                    style={[
                      styles.waveBar,
                      {
                        height,
                      },
                    ]}
                  />
                )
              )}
            </View>
          )}

          {/* =================================================
              YOU SAID
          ================================================= */}

          {transcript ? (
            <View
              style={
                styles.card
              }
            >
              <View
                style={
                  styles.cardHeader
                }
              >
                <Ionicons
                  name="person"
                  size={18}
                  color="#8B5CF6"
                />

                <Text
                  style={
                    styles.cardTitle
                  }
                >
                  YOU SAID
                </Text>
              </View>

              <Text
                style={
                  styles.transcriptText
                }
              >
                {transcript}
              </Text>
            </View>
          ) : null}

          {/* =================================================
              AI RESPONSE
          ================================================= */}

          {reply ? (
            <View
              style={
                styles.card
              }
            >
              <View
                style={
                  styles.cardHeader
                }
              >
                <Ionicons
                  name="sparkles"
                  size={18}
                  color="#EC4899"
                />

                <Text
                  style={
                    styles.cardTitle
                  }
                >
                  AI REPLY
                </Text>
              </View>

              <Text
                style={
                  styles.replyText
                }
              >
                {displayedReply}
              </Text>

              {intent ? (
                <View
                  style={
                    styles.intentBadge
                  }
                >
                  <Text
                    style={
                      styles.intentText
                    }
                  >
                    {intent}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* =================================================
              NO-TOUCH NAVIGATION MODE
          ================================================= */}

          <View style={styles.voiceModeCard}>
            <View style={styles.voiceModeTextWrap}>
              <Text style={styles.voiceModeTitle}>
                No-Touch Navigation
              </Text>
              <Text style={styles.voiceModeSubtitle}>
                {voiceNavigationMode
                  ? "Hands-free listening is enabled"
                  : "Turn on for hands-free route control"}
              </Text>
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                setVoiceNavigationMode((current) => {
                  const next = !current;
                  voiceNavigationModeRef.current = next;

                  if (next) {
                    void startRecognitionSession();
                  } else {
                    if (recognitionRestartTimerRef.current) {
                      clearTimeout(recognitionRestartTimerRef.current);
                      recognitionRestartTimerRef.current = null;
                    }

                    try {
                      ExpoSpeechRecognitionModule.stop();
                    } catch (_) {}

                    setStatus("idle");
                  }

                  return next;
                });
              }}
              style={[
                styles.voiceModeToggle,
                voiceNavigationMode && styles.voiceModeToggleActive,
              ]}
            >
              <Ionicons
                name={voiceNavigationMode ? "mic" : "mic-off"}
                size={20}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          </View>

          {/* =================================================
              QUICK COMMANDS
          ================================================= */}

          <View
            style={
              styles.section
            }
          >
            <Text
              style={
                styles.sectionTitle
              }
            >
              Quick Commands
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={
                false
              }
              contentContainerStyle={
                styles.chipContainer
              }
            >
              {COMMAND_CHIPS.map(
                (item) => (
                  <TouchableOpacity
                    key={
                      item.label
                    }
                    style={
                      styles.chip
                    }
                    disabled={
                      isBusy
                    }
                    onPress={() =>
                      handleChipPress(
                        item.prompt
                      )
                    }
                    activeOpacity={
                      0.8
                    }
                  >
                    <Text
                      style={
                        styles.chipText
                      }
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </ScrollView>
          </View>

          {/* =================================================
              HISTORY
          ================================================= */}

          {history.length >
            0 && (
            <View
              style={
                styles.section
              }
            >
              <Text
                style={
                  styles.sectionTitle
                }
              >
                Recent Conversations
              </Text>

              {history
                .slice(0, 5)
                .map(
                  (item) => (
                    <View
                      key={
                        item.id
                      }
                      style={
                        styles.historyCard
                      }
                    >
                      <Text
                        style={
                          styles.historyQuestion
                        }
                      >
                        {item.question}
                      </Text>

                      <Text
                        style={
                          styles.historyAnswer
                        }
                        numberOfLines={
                          3
                        }
                      >
                        {item.answer}
                      </Text>
                    </View>
                  )
                )}
            </View>
          )}

          {/* =================================================
              FOOTER
          ================================================= */}

          <View
            style={
              styles.footer
            }
          >
            <Ionicons
              name="shield-checkmark"
              size={15}
              color="#777"
            />

            <Text
              style={
                styles.footerText
              }
            >
              Voice assistant ready
            </Text>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

/* =========================================================
   STYLES
========================================================= */

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#050505",
  },

  container: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  /* HEADER */

  header: {
    marginTop: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  title: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "800",
  },

  subtitle: {
    color: "#8E8E99",
    fontSize: 13,
    marginTop: 4,
  },

  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#34D399",
  },

  /* STATUS */

  statusContainer: {
    marginTop: 22,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  statusText: {
    color: "#A1A1AA",
    fontSize: 14,
    fontWeight: "600",
  },

  /* ORB */

  orbArea: {
    height: 300,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 5,
  },

  glowOuter: {
    position: "absolute",
    width: 205,
    height: 205,
    borderRadius: 103,
    backgroundColor:
      "rgba(139,92,246,0.15)",
  },

  rotatingRing: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 2,
    borderColor:
      "rgba(236,72,153,0.45)",
    borderTopColor:
      "rgba(139,92,246,0.9)",
  },

  orbButton: {
    width: 145,
    height: 145,
    borderRadius: 73,
    overflow: "hidden",
    elevation: 20,
    shadowOpacity: 0.4,
    shadowRadius: 25,
    shadowOffset: {
      width: 0,
      height: 10,
    },
  },

  orbGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  /* WAVE */

  waveContainer: {
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: -15,
    marginBottom: 15,
  },

  waveBar: {
    width: 5,
    borderRadius: 5,
    backgroundColor: "#8B5CF6",
  },

  /* CARDS */

  card: {
    backgroundColor:
      "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.10)",
    borderRadius: 22,
    padding: 18,
    marginTop: 15,
  },

  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },

  cardTitle: {
    color: "#A1A1AA",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
  },

  transcriptText: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 24,
  },

  replyText: {
    color: "#E4E4E7",
    fontSize: 16,
    lineHeight: 25,
  },

  intentBadge: {
    alignSelf: "flex-start",
    marginTop: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor:
      "rgba(139,92,246,0.18)",
  },

  intentText: {
    color: "#A78BFA",
    fontSize: 11,
    fontWeight: "700",
  },

  /* SECTION */

  section: {
    marginTop: 28,
  },

  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 12,
  },

  /* CHIPS */

  chipContainer: {
    gap: 10,
    paddingRight: 10,
  },

  chip: {
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 18,
    backgroundColor:
      "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.10)",
  },

  chipText: {
    color: "#E4E4E7",
    fontSize: 13,
    fontWeight: "600",
  },

  /* HISTORY */

  historyCard: {
    backgroundColor:
      "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.07)",
    borderRadius: 18,
    padding: 15,
    marginBottom: 10,
  },

  historyQuestion: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 7,
  },

  historyAnswer: {
    color: "#A1A1AA",
    fontSize: 13,
    lineHeight: 20,
  },

  /* NO-TOUCH MODE */

  voiceModeCard: {
    marginTop: 20,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "rgba(139,92,246,0.10)",
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.25)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  voiceModeTextWrap: {
    flex: 1,
    paddingRight: 12,
  },

  voiceModeTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },

  voiceModeSubtitle: {
    color: "#A1A1AA",
    fontSize: 12,
    marginTop: 4,
  },

  voiceModeToggle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
  },

  voiceModeToggleActive: {
    backgroundColor: "#8B5CF6",
  },

  /* FOOTER */

  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: 30,
  },

  footerText: {
    color: "#666",
    fontSize: 11,
  },
});
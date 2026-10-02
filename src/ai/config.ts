import Constants from "expo-constants";

// Mobile app sirf backend URL jaanti hai.
// Gemini API key yahan MAT rakho.
export const AI_API_BASE_URL =
  Constants.expoConfig?.extra?.aiApiBaseUrl ??
    "http://192.168.29.87:3000";

// Optional model name.
// Actual Gemini API key backend/.env mein rahegi.
export const GEMINI_MODEL =
  Constants.expoConfig?.extra?.geminiModel ??
  "gemini-2.0-flash";
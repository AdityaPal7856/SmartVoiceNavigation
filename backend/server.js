const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { GoogleGenAI } = require("@google/genai");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3000;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "SmartVoiceNavigation AI Backend is running",
  });
});

app.post("/api/ai", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({
        error: "Text is required",
      });
    }

    console.log("[AI] Command:", text);

    const prompt = `
You are the AI assistant for SmartVoiceNavigation.

User command:
"${text}"

Return ONLY valid JSON in this format:

{
  "reply": "short response to user",
  "intent": "navigate",
  "destination": "destination name"
}

Possible intents:
- navigate
- stop_navigation
- home
- work
- weather
- call
- music
- unknown

If the command is navigation related, extract the destination.
If it is not navigation related, use an appropriate intent.
If you cannot understand it, use "unknown".

Do not use markdown.
Return JSON only.
`;

    const response = await ai.models.generateContent({
     model: "gemini-3.6-flash",
      contents: prompt,
    });

    const output = response.text.trim();

    console.log("[AI] Gemini:", output);

    let result;

    try {
      result = JSON.parse(output);
    } catch {
      result = {
        reply: output,
        intent: "unknown",
      };
    }

    res.json(result);
  } catch (error) {
    console.error("[AI ERROR]", error);

    res.status(500).json({
      error: "AI processing failed",
      message: error.message,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SmartVoiceNavigation AI server running on port ${PORT}`);
});
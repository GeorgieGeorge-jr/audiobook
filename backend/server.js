import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Serve the frontend as static files so the whole app runs from one server.
app.use(express.static(path.join(__dirname, "..", "frontend")));

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_BASE = "https://api.elevenlabs.io/v1";

if (!ELEVEN_API_KEY) {
  console.warn(
    "\u26A0\uFE0F  ELEVENLABS_API_KEY is not set. Copy backend/.env.example to backend/.env and add your key."
  );
}

// GET /api/voices — list voices available on the connected ElevenLabs account
app.get("/api/voices", async (req, res) => {
  try {
    const r = await fetch(`${ELEVEN_BASE}/voices`, {
      headers: { "xi-api-key": ELEVEN_API_KEY },
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`ElevenLabs error ${r.status}: ${errText}`);
    }
    const data = await r.json();
    const voices = (data.voices || []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      previewUrl: v.preview_url,
      labels: v.labels || {},
    }));
    res.json({ voices });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tts — convert one chunk of text to speech and stream back audio/mpeg
app.post("/api/tts", async (req, res) => {
  const {
    text,
    voiceId,
    stability = 0.35,
    similarityBoost = 0.75,
    style = 0.6,
    modelId = "eleven_multilingual_v2",
  } = req.body;

  if (!text || !voiceId) {
    return res.status(400).json({ error: "text and voiceId are required" });
  }

  try {
    const r = await fetch(`${ELEVEN_BASE}/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: Number(stability),
          similarity_boost: Number(similarityBoost),
          style: Number(style),
          use_speaker_boost: true,
        },
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`ElevenLabs TTS error ${r.status}: ${errText}`);
    }

    const buffer = Buffer.from(await r.arrayBuffer());
    res.set("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Book reader server running on http://localhost:${PORT}`);
});

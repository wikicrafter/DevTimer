import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true
}));

// Rate limiting (simple in-memory)
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 20; // per window

function checkRateLimit(ip) {
  const now = Date.now();
  const userLimits = rateLimits.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  
  if (now > userLimits.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (userLimits.count >= MAX_REQUESTS) {
    return false;
  }
  
  userLimits.count++;
  rateLimits.set(ip, userLimits);
  return true;
}

// Cleanup old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, limits] of rateLimits.entries()) {
    if (now > limits.resetAt) {
      rateLimits.delete(ip);
    }
  }
}, 300000);

// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Text generation proxy (for AI coach)
app.post("/api/ai", async (req, res) => {
  try {
    const clientIp = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: "Rate limit exceeded. Try again later." });
    }

    const { model = "gpt-4o-mini", prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });
    if (typeof prompt !== "string") return res.status(400).json({ error: "Invalid prompt" });
    if (prompt.length > 2000) return res.status(400).json({ error: "Prompt too long (max 2000 chars)" });

    // Fixed: Use correct OpenAI endpoint
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.7
      })
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error("OpenAI error:", r.status, text);
      return res.status(r.status).json({ error: text || `OpenAI ${r.status}` });
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";

    return res.json({ text });
  } catch (e) {
    console.error("AI endpoint error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// TTS proxy (gpt-4o-mini-tts)
app.post("/api/tts", async (req, res) => {
  try {
    const clientIp = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: "Rate limit exceeded. Try again later." });
    }

    const { text, voice = "alloy" } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing text" });
    if (typeof text !== "string") return res.status(400).json({ error: "Invalid text" });
    if (text.length > 1000) return res.status(400).json({ error: "Text too long (max 1000 chars)" });

    // Validate voice parameter
    const validVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "aria", "verse"];
    if (!validVoices.includes(voice)) {
      return res.status(400).json({ error: "Invalid voice parameter" });
    }

    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice,
        input: text,
        response_format: "mp3"
      })
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error("TTS error:", r.status, text);
      return res.status(r.status).json({ error: text || `TTS ${r.status}` });
    }

    const buf = await r.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error("TTS endpoint error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`DevTimer server on http://localhost:${PORT}`));
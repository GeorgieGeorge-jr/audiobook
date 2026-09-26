exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "ELEVENLABS_API_KEY is not set in Netlify environment variables" }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const {
    text,
    voiceId,
    stability = 0.35,
    similarityBoost = 0.75,
    style = 0.6,
    modelId = "eleven_multilingual_v2",
  } = payload;

  if (!text || !voiceId) {
    return { statusCode: 400, body: JSON.stringify({ error: "text and voiceId are required" }) };
  }

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
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
      return {
        statusCode: r.status,
        body: JSON.stringify({ error: `ElevenLabs TTS error ${r.status}: ${errText}` }),
      };
    }

    const arrayBuffer = await r.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString("base64");

    return {
      statusCode: 200,
      headers: { "Content-Type": "audio/mpeg" },
      body: base64Audio,
      isBase64Encoded: true,
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

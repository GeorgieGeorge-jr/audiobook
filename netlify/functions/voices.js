exports.handler = async () => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "ELEVENLABS_API_KEY is not set in Netlify environment variables" }),
    };
  }

  try {
    const r = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });

    if (!r.ok) {
      const errText = await r.text();
      return {
        statusCode: r.status,
        body: JSON.stringify({ error: `ElevenLabs error ${r.status}: ${errText}` }),
      };
    }

    const data = await r.json();
    const voices = (data.voices || []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      previewUrl: v.preview_url,
      labels: v.labels || {},
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voices }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

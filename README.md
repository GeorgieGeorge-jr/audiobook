# Aloud — read my book to me

A small web app: upload a PDF or EPUB, pick a voice, and it reads the book
aloud using ElevenLabs' expressive text-to-speech (the "emotion" comes from
ElevenLabs' `style` and `stability` voice settings, exposed here as sliders).

## How it works

- **Extraction happens entirely in the browser.** `pdf.js` pulls text out of
  PDFs page by page; a small hand-rolled EPUB reader (using `JSZip` +
  `DOMParser`) walks the EPUB's spine and pulls text out of each chapter's
  HTML. Nothing about the file itself is ever uploaded anywhere — only the
  extracted text leaves the browser, and only in small pieces.
- **The book is split into passages** of roughly 1,400 characters, cut at
  sentence boundaries, so long books never wait for one giant TTS request.
- **The backend is a thin proxy.** It holds your ElevenLabs API key and
  exposes two routes: `GET /api/voices` (list your voices) and
  `POST /api/tts` (turn one passage into an MP3). The key never reaches the
  browser.
- **The player fetches one passage ahead** while the current one plays, so
  playback is effectively gapless once it gets going, and pauses only
  briefly on the very first passage.

## Setup

You'll need an [ElevenLabs](https://elevenlabs.io) account and API key
(Profile → API Keys). The free tier works for trying this out.

```bash
cd backend
npm install
cp .env.example .env
# edit .env and paste your key in place of your_elevenlabs_api_key_here
npm start
```

Then open **http://localhost:3001** — the backend serves the frontend
directly, so there's nothing else to run.

## Tuning the "emotion"

- **Emotion slider** → ElevenLabs' `style` value. Higher lets delivery swing
  more with the text (works best with `eleven_multilingual_v2` or newer
  expressive models).
- **Steadiness slider** → `stability`. Higher keeps the voice more uniform;
  lower lets more variation and inflection through. Very emotional
  narration usually wants steadiness in the 20–40% range.
- Swap the hardcoded `eleven_multilingual_v2` model in
  `backend/server.js` for `eleven_turbo_v2_5` if you want faster/cheaper
  responses, or a newer model as ElevenLabs releases one.

## Known limits / good next steps

- EPUB parsing is intentionally simple — it handles the common
  `container.xml` → OPF → spine structure, not every EPUB edge case
  (e.g. encrypted/DRM'd files won't work).
- Very large books mean many small TTS requests; consider adding a
  "download the whole narration" option that batches all passages and zips
  the resulting MP3s, if that's a use case you want.
- No accounts/persistence yet — reading position resets on refresh. Worth
  adding `localStorage` (book hash → passage index) if you want to resume
  later.
- The EPUB/PDF text extraction can't recover things like italics or
  paragraph-level structure, so very stylized formatting won't influence
  the reading the way it might in a dedicated e-reader.

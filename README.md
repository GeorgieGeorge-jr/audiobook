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

## Deploying to Netlify

Netlify doesn't run a persistent Express server — it serves static files and
short-lived serverless functions. So this repo ships **two** backends that
share the same frontend code, unchanged:

- `backend/server.js` — the Express server, for running locally.
- `netlify/functions/voices.js` and `netlify/functions/tts.js` — the same
  logic as two Netlify Functions, for production.

`frontend/app.js` always calls `/api/voices` and `/api/tts`. Locally, Express
serves those routes directly. On Netlify, `netlify.toml` redirects those same
paths to the functions — so nothing in the frontend needs to change between
the two.

### Steps

1. **Push this project to a GitHub repo** (Netlify deploys from a repo, not a
   raw folder). From the project root:
   ```bash
   git init
   git add .
   git commit -m "Aloud: book reader with TTS"
   git remote add origin https://github.com/<you>/aloud.git
   git push -u origin main
   ```
2. **In the Netlify dashboard**: "Add new site" → "Import an existing
   project" → connect GitHub → pick the repo.
3. **Build settings** (Netlify may auto-detect these from `netlify.toml`, but
   set them explicitly if asked):
   - **Base directory:** leave blank (repo root)
   - **Build command:** leave blank — there's no build step, it's plain HTML/CSS/JS
   - **Publish directory:** `frontend`
   - **Functions directory:** `netlify/functions` (also set via `netlify.toml`, shouldn't need to touch this)
4. **Add your API key:** Site settings → Environment variables → add
   `ELEVENLABS_API_KEY` with your ElevenLabs key. This is what the functions
   read — never put it in the frontend code.
5. **Deploy.** Netlify gives you a URL like `https://aloud-xyz.netlify.app`
   that works from any device — the "server" is Netlify's infrastructure,
   not your machine.

### Netlify-specific limits to know about

- Each function call has to finish within Netlify's function timeout
  (10 seconds on the free tier) and keep its response under ~6MB. A single
  ~1,400-character passage of speech comfortably fits both, which is exactly
  why the app chunks the book that small — don't increase `maxLen` in
  `chunkText()` much without checking this still holds.
- Every environment your site builds in (production, deploy previews)
  needs the env var set if you want them all to work; by default Netlify
  applies one set to all contexts unless you scope it.

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

// pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const els = {
  dropzone: document.getElementById("dropzone"),
  dropzoneTitle: document.getElementById("dropzone-title"),
  dropzoneSub: document.getElementById("dropzone-sub"),
  fileInput: document.getElementById("file-input"),
  extractProgress: document.getElementById("extract-progress"),
  extractProgressFill: document.getElementById("extract-progress-fill"),
  extractProgressLabel: document.getElementById("extract-progress-label"),

  controlsCard: document.getElementById("controls-card"),
  voiceSelect: document.getElementById("voice-select"),
  voiceHint: document.getElementById("voice-hint"),
  previewVoiceBtn: document.getElementById("preview-voice-btn"),
  styleSlider: document.getElementById("style-slider"),
  styleValue: document.getElementById("style-value"),
  stabilitySlider: document.getElementById("stability-slider"),
  stabilityValue: document.getElementById("stability-value"),

  readerCard: document.getElementById("reader-card"),
  pageText: document.getElementById("page-text"),
  prevBtn: document.getElementById("prev-btn"),
  playBtn: document.getElementById("play-btn"),
  nextBtn: document.getElementById("next-btn"),
  statusLabel: document.getElementById("status-label"),
  bookProgressFill: document.getElementById("book-progress-fill"),

  errorNote: document.getElementById("error-note"),
};

const state = {
  chunks: [],
  currentIndex: 0,
  isPlaying: false,
  voices: [],
  selectedVoiceId: null,
  audioCache: new Map(), // index -> object URL
  pendingFetch: new Map(), // index -> in-flight promise
};

const audioEl = new Audio();

function showError(message) {
  els.errorNote.textContent = message;
  els.errorNote.hidden = false;
}

function clearError() {
  els.errorNote.hidden = true;
}

// ---------- Text extraction ----------

async function extractPdfText(file, onProgress) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(" ") + "\n\n";
    onProgress(i / pdf.numPages, `Reading page ${i} of ${pdf.numPages}`);
  }
  return text;
}

async function extractEpubText(file, onProgress) {
  const zip = await JSZip.loadAsync(file);

  const containerXml = await zip.file("META-INF/container.xml").async("string");
  const containerDoc = new DOMParser().parseFromString(containerXml, "application/xml");
  const opfPath = containerDoc.querySelector("rootfile").getAttribute("full-path");
  const opfDir = opfPath.includes("/") ? opfPath.split("/").slice(0, -1).join("/") : "";

  const opfXml = await zip.file(opfPath).async("string");
  const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");

  const manifest = {};
  opfDoc.querySelectorAll("manifest > item").forEach((item) => {
    manifest[item.getAttribute("id")] = item.getAttribute("href");
  });

  const spineIds = Array.from(opfDoc.querySelectorAll("spine > itemref")).map((el) =>
    el.getAttribute("idref")
  );

  let text = "";
  for (let i = 0; i < spineIds.length; i++) {
    const href = manifest[spineIds[i]];
    if (!href) continue;
    const fullPath = opfDir ? `${opfDir}/${href}` : href;
    const entry = zip.file(fullPath);
    if (!entry) continue;
    const html = await entry.async("string");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const chapterText = doc.body ? doc.body.textContent : "";
    text += chapterText.replace(/[ \t]+/g, " ").trim() + "\n\n";
    onProgress((i + 1) / spineIds.length, `Reading chapter ${i + 1} of ${spineIds.length}`);
  }
  return text;
}

function chunkText(text, maxLen = 1400) {
  const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [cleaned];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (current.length > 0 && current.length + sentence.length > maxLen) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}

// ---------- Voices ----------

async function loadVoices() {
  try {
    const res = await fetch("/api/voices");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load voices");

    state.voices = data.voices;
    els.voiceSelect.innerHTML = state.voices
      .map((v) => `<option value="${v.id}">${v.name}${v.labels?.accent ? ` — ${v.labels.accent}` : ""}</option>`)
      .join("");

    if (state.voices.length > 0) {
      state.selectedVoiceId = state.voices[0].id;
      els.voiceHint.textContent = `${state.voices.length} voices available on your account.`;
    } else {
      els.voiceHint.textContent = "No voices found on this ElevenLabs account.";
    }
  } catch (err) {
    els.voiceHint.textContent = "Couldn't reach the server for voices.";
    showError(`Voice list failed to load: ${err.message}. Check backend/.env has a valid ELEVENLABS_API_KEY and the server is running.`);
  }
}

els.voiceSelect.addEventListener("change", () => {
  state.selectedVoiceId = els.voiceSelect.value;
  state.audioCache.clear(); // voice changed — old cached audio no longer applies
});

els.previewVoiceBtn.addEventListener("click", () => {
  const voice = state.voices.find((v) => v.id === state.selectedVoiceId);
  if (voice?.previewUrl) {
    new Audio(voice.previewUrl).play();
  }
});

els.styleSlider.addEventListener("input", () => {
  els.styleValue.textContent = `${els.styleSlider.value}%`;
});
els.stabilitySlider.addEventListener("input", () => {
  els.stabilityValue.textContent = `${els.stabilitySlider.value}%`;
});

// ---------- Playback ----------

function currentVoiceSettings() {
  return {
    voiceId: state.selectedVoiceId,
    style: Number(els.styleSlider.value) / 100,
    stability: Number(els.stabilitySlider.value) / 100,
  };
}

async function fetchAudioForChunk(index) {
  if (state.audioCache.has(index)) return state.audioCache.get(index);
  if (state.pendingFetch.has(index)) return state.pendingFetch.get(index);

  const promise = (async () => {
    const { voiceId, style, stability } = currentVoiceSettings();
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: state.chunks[index], voiceId, style, stability }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `TTS request failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    state.audioCache.set(index, url);
    return url;
  })();

  state.pendingFetch.set(index, promise);
  try {
    return await promise;
  } finally {
    state.pendingFetch.delete(index);
  }
}

function updateBookProgress() {
  const pct = state.chunks.length ? ((state.currentIndex + 1) / state.chunks.length) * 100 : 0;
  els.bookProgressFill.style.width = `${pct}%`;
}

async function playChunk(index) {
  if (index < 0) index = 0;
  if (index >= state.chunks.length) {
    state.isPlaying = false;
    els.playBtn.textContent = "▶";
    els.statusLabel.textContent = "Finished the book.";
    return;
  }

  state.currentIndex = index;
  els.pageText.textContent = state.chunks[index];
  els.statusLabel.textContent = `Reading passage ${index + 1} of ${state.chunks.length}`;
  updateBookProgress();

  try {
    const url = await fetchAudioForChunk(index);
    audioEl.src = url;
    await audioEl.play();
    state.isPlaying = true;
    els.playBtn.textContent = "⏸";
    // Prefetch the next passage while this one plays, for gapless reading.
    if (index + 1 < state.chunks.length) {
      fetchAudioForChunk(index + 1).catch(() => {});
    }
  } catch (err) {
    showError(`Couldn't read that passage: ${err.message}`);
    state.isPlaying = false;
    els.playBtn.textContent = "▶";
  }
}

audioEl.addEventListener("ended", () => {
  if (state.isPlaying) playChunk(state.currentIndex + 1);
});

els.playBtn.addEventListener("click", () => {
  if (state.chunks.length === 0) return;
  if (state.isPlaying) {
    audioEl.pause();
    state.isPlaying = false;
    els.playBtn.textContent = "▶";
  } else if (audioEl.src && audioEl.currentTime > 0 && !audioEl.ended) {
    audioEl.play();
    state.isPlaying = true;
    els.playBtn.textContent = "⏸";
  } else {
    playChunk(state.currentIndex);
  }
});

els.nextBtn.addEventListener("click", () => {
  const wasPlaying = state.isPlaying;
  audioEl.pause();
  if (wasPlaying) playChunk(state.currentIndex + 1);
  else {
    state.currentIndex = Math.min(state.currentIndex + 1, state.chunks.length - 1);
    els.pageText.textContent = state.chunks[state.currentIndex];
    els.statusLabel.textContent = `Passage ${state.currentIndex + 1} of ${state.chunks.length}`;
    updateBookProgress();
  }
});

els.prevBtn.addEventListener("click", () => {
  const wasPlaying = state.isPlaying;
  audioEl.pause();
  if (wasPlaying) playChunk(state.currentIndex - 1);
  else {
    state.currentIndex = Math.max(state.currentIndex - 1, 0);
    els.pageText.textContent = state.chunks[state.currentIndex];
    els.statusLabel.textContent = `Passage ${state.currentIndex + 1} of ${state.chunks.length}`;
    updateBookProgress();
  }
});

// ---------- File handling ----------

async function handleFile(file) {
  clearError();
  if (!file) return;

  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  const isEpub = file.name.toLowerCase().endsWith(".epub");
  if (!isPdf && !isEpub) {
    showError("Please choose a PDF or EPUB file.");
    return;
  }

  els.dropzoneTitle.textContent = file.name;
  els.dropzoneSub.textContent = "Extracting text…";
  els.extractProgress.hidden = false;

  const onProgress = (fraction, label) => {
    els.extractProgressFill.style.width = `${Math.round(fraction * 100)}%`;
    els.extractProgressLabel.textContent = label;
  };

  try {
    const rawText = isPdf
      ? await extractPdfText(file, onProgress)
      : await extractEpubText(file, onProgress);

    if (!rawText.trim()) {
      throw new Error("No readable text was found in that file.");
    }

    state.chunks = chunkText(rawText);
    state.currentIndex = 0;
    state.audioCache.clear();
    audioEl.pause();
    state.isPlaying = false;
    els.playBtn.textContent = "▶";

    els.dropzoneSub.textContent = `${state.chunks.length} passages extracted. Choose a voice below.`;
    els.controlsCard.hidden = false;
    els.readerCard.hidden = false;
    els.pageText.textContent = state.chunks[0];
    els.statusLabel.textContent = `Passage 1 of ${state.chunks.length}`;
    updateBookProgress();
  } catch (err) {
    showError(`Couldn't read that file: ${err.message}`);
    els.dropzoneSub.textContent = "Drop a PDF or EPUB here, or tap to choose one";
  } finally {
    els.extractProgress.hidden = true;
  }
}

els.fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

els.dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
});
els.dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// ---------- Init ----------

loadVoices();

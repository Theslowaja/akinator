// ============================================================
// Akinator Middleware Server (menggunakan library aki-api)
// https://github.com/jgoralcz/aki-api
// Deploy gratis ke: Railway / Render / Koyeb
// ============================================================

const express = require('express');
const { Aki } = require('aki-api');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Simpan sesi aktif (in-memory)
// Key: sessionId (misal "player_12345")
// Value: instance Aki
const sessions = {};

// Bersihkan sesi yang sudah lebih dari 30 menit (anti memory leak)
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of Object.entries(sessions)) {
    if (now - data.createdAt > 30 * 60 * 1000) {
      delete sessions[id];
    }
  }
}, 5 * 60 * 1000); // cek setiap 5 menit

// ── Health check ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Akinator Roblox API aktif!',
    activeSessions: Object.keys(sessions).length,
  });
});

// ── POST /start ──────────────────────────────────────────────
// Mulai game Akinator baru
// Body: { sessionId: "player_123", region: "en", childMode: false }
app.post('/start', async (req, res) => {
  const { sessionId, region = 'en', childMode = false } = req.body;

  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'sessionId diperlukan' });
  }

  // Hapus sesi lama jika ada
  if (sessions[sessionId]) {
    delete sessions[sessionId];
  }

  try {
    const aki = new Aki({ region, childMode });
    await aki.start();

    sessions[sessionId] = {
      aki,
      createdAt: Date.now(),
      questionCount: 1,
    };

    return res.json({
      success: true,
      question: aki.question,
      answers: aki.answers,       // ["Yes","No","Don't know","Probably","Probably not"]
      questionNumber: 1,
      progress: aki.progress ?? 0,
    });
  } catch (err) {
    console.error('[/start] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Gagal memulai Akinator. Coba lagi.',
      detail: err.message,
    });
  }
});

// ── POST /step ───────────────────────────────────────────────
// Kirim jawaban (step)
// Body: { sessionId: "player_123", answer: 0 }
// answer: 0=Yes, 1=No, 2=Don't know, 3=Probably, 4=Probably not
app.post('/step', async (req, res) => {
  const { sessionId, answer } = req.body;

  if (!sessionId || !sessions[sessionId]) {
    return res.status(400).json({ success: false, error: 'Sesi tidak ditemukan. Panggil /start terlebih dahulu.' });
  }

  if (answer === undefined || answer === null) {
    return res.status(400).json({ success: false, error: 'Jawaban diperlukan (0-4)' });
  }

  const session = sessions[sessionId];
  const aki = session.aki;

  try {
    await aki.step(answer);
    session.questionCount++;

    // Jika progress tinggi (>= 80), Akinator siap menebak
    const shouldGuess = aki.progress >= 80 || session.questionCount >= 20;

    return res.json({
      success: true,
      question: aki.question,
      answers: aki.answers,
      questionNumber: session.questionCount,
      progress: aki.progress ?? 0,
      shouldGuess,  // hint ke client bahwa sudah siap tebak
    });
  } catch (err) {
    console.error('[/step] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Gagal memproses jawaban.',
      detail: err.message,
    });
  }
});

// ── POST /win ────────────────────────────────────────────────
// Minta Akinator menebak karakter
// Body: { sessionId: "player_123" }
app.post('/win', async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId || !sessions[sessionId]) {
    return res.status(400).json({ success: false, error: 'Sesi tidak ditemukan.' });
  }

  const session = sessions[sessionId];
  const aki = session.aki;

  try {
    await aki.win();

    const guess = aki.answers[0]; // tebakan terbaik ada di index 0

    return res.json({
      success: true,
      type: 'guess',
      character: guess?.name ?? 'Tidak diketahui',
      description: guess?.description ?? '',
      ranking: guess?.ranking ?? 0,
      photo: guess?.absolute_picture_path ?? null,
      allGuesses: aki.answers.slice(0, 3), // top 3 tebakan
    });
  } catch (err) {
    console.error('[/win] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Gagal mengambil tebakan.',
      detail: err.message,
    });
  }
});

// ── POST /back ───────────────────────────────────────────────
// Kembali ke pertanyaan sebelumnya
// Body: { sessionId: "player_123" }
app.post('/back', async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId || !sessions[sessionId]) {
    return res.status(400).json({ success: false, error: 'Sesi tidak ditemukan.' });
  }

  const session = sessions[sessionId];
  const aki = session.aki;

  try {
    await aki.back();
    session.questionCount = Math.max(1, session.questionCount - 1);

    return res.json({
      success: true,
      question: aki.question,
      answers: aki.answers,
      questionNumber: session.questionCount,
      progress: aki.progress ?? 0,
    });
  } catch (err) {
    console.error('[/back] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Gagal kembali ke pertanyaan sebelumnya.',
      detail: err.message,
    });
  }
});

// ── DELETE /session/:sessionId ───────────────────────────────
// Hapus sesi saat player selesai
app.delete('/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  if (sessions[sessionId]) {
    delete sessions[sessionId];
    return res.json({ success: true, message: 'Sesi dihapus.' });
  }
  return res.status(404).json({ success: false, error: 'Sesi tidak ditemukan.' });
});

app.listen(PORT, () => {
  console.log(`✅ Akinator Roblox Server berjalan di port ${PORT}`);
});

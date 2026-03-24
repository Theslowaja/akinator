// ============================================================
// PRODUCTION Akinator Server (Redis + Anti Exploit + Scalable)
// ============================================================

require('dotenv').config();

const express = require('express');
const { Aki } = require('aki-api');
const Redis = require('ioredis');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── Redis Setup ─────────────────────────────────────────────
const redis = new Redis(process.env.REDIS_URL);

// ── Rate Limiter (anti spam) ────────────────────────────────
const rateLimiter = new RateLimiterMemory({
  points: 10,       // max 10 request
  duration: 5,      // per 5 detik
});

// ── Middleware: API KEY ─────────────────────────────────────
app.use((req, res, next) => {
  const key = req.headers['x-api-key'];
  if (key !== process.env.API_KEY) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  next();
});

// ── Middleware: Rate Limit ──────────────────────────────────
app.use(async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch {
    return res.status(429).json({
      success: false,
      error: 'Terlalu banyak request',
    });
  }
});

// ── Helper: Save session ────────────────────────────────────
async function saveSession(sessionId, data) {
  await redis.set(
    `aki:${sessionId}`,
    JSON.stringify(data),
    'EX',
    60 * 30 // 30 menit
  );
}

// ── Helper: Load session ────────────────────────────────────
async function loadSession(sessionId) {
  const data = await redis.get(`aki:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

// ── Helper: Delete session ──────────────────────────────────
async function deleteSession(sessionId) {
  await redis.del(`aki:${sessionId}`);
}

// ── Health Check ────────────────────────────────────────────
app.get('/', async (req, res) => {
  const keys = await redis.keys('aki:*');
  res.json({
    status: 'ok',
    activeSessions: keys.length,
  });
});

// ── START ───────────────────────────────────────────────────
app.post('/start', async (req, res) => {
  const { sessionId, region = 'en', childMode = false } = req.body;

  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'sessionId diperlukan' });
  }

  const validRegions = ['en', 'id', 'fr', 'es', 'jp'];
  if (!validRegions.includes(region)) {
    return res.status(400).json({ success: false, error: 'Region tidak valid' });
  }

  try {
    const aki = new Aki({ region, childMode });
    await aki.start();

    const sessionData = {
      region,
      childMode,
      step: aki.currentStep,
      progress: aki.progress,
      question: aki.question,
      answers: aki.answers,
      signature: aki.signature,
      session: aki.session,
      questionCount: 1,
      locked: false,
    };

    await saveSession(sessionId, sessionData);

    res.json({
      success: true,
      question: aki.question,
      answers: aki.answers,
      progress: aki.progress,
      questionNumber: 1,
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── STEP ────────────────────────────────────────────────────
app.post('/step', async (req, res) => {
  const { sessionId, answer } = req.body;

  if (typeof answer !== 'number' || answer < 0 || answer > 4) {
    return res.status(400).json({ success: false, error: 'Jawaban harus 0-4' });
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return res.status(400).json({ success: false, error: 'Session tidak ditemukan' });
  }

  if (session.locked) {
    return res.status(429).json({ success: false, error: 'Request masih diproses' });
  }

  session.locked = true;
  await saveSession(sessionId, session);

  try {
    const aki = new Aki({
      region: session.region,
      childMode: session.childMode,
    });

    // restore state
    aki.session = session.session;
    aki.signature = session.signature;
    aki.currentStep = session.step;

    await aki.step(answer);

    session.step = aki.currentStep;
    session.progress = aki.progress;
    session.question = aki.question;
    session.answers = aki.answers;
    session.questionCount++;

    session.locked = false;
    await saveSession(sessionId, session);

    res.json({
      success: true,
      question: aki.question,
      answers: aki.answers,
      progress: aki.progress,
      questionNumber: session.questionCount,
      shouldGuess: aki.progress >= 80,
    });

  } catch (err) {
    session.locked = false;
    await saveSession(sessionId, session);

    res.status(500).json({ success: false, error: err.message });
  }
});

// ── WIN ─────────────────────────────────────────────────────
app.post('/win', async (req, res) => {
  const { sessionId } = req.body;

  const session = await loadSession(sessionId);
  if (!session) {
    return res.status(400).json({ success: false, error: 'Session tidak ditemukan' });
  }

  try {
    const aki = new Aki({
      region: session.region,
      childMode: session.childMode,
    });

    aki.session = session.session;
    aki.signature = session.signature;
    aki.currentStep = session.step;

    await aki.win();

    const guesses = aki.answers || [];

    await deleteSession(sessionId);

    res.json({
      success: true,
      character: guesses[0]?.name,
      description: guesses[0]?.description,
      photo: guesses[0]?.absolute_picture_path,
      guesses: guesses.slice(0, 3),
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── BACK ────────────────────────────────────────────────────
app.post('/back', async (req, res) => {
  const { sessionId } = req.body;

  const session = await loadSession(sessionId);
  if (!session) {
    return res.status(400).json({ success: false, error: 'Session tidak ditemukan' });
  }

  if (session.questionCount <= 1) {
    return res.status(400).json({ success: false, error: 'Sudah di awal' });
  }

  try {
    const aki = new Aki({
      region: session.region,
      childMode: session.childMode,
    });

    aki.session = session.session;
    aki.signature = session.signature;
    aki.currentStep = session.step;

    await aki.back();

    session.step = aki.currentStep;
    session.progress = aki.progress;
    session.question = aki.question;
    session.answers = aki.answers;
    session.questionCount--;

    await saveSession(sessionId, session);

    res.json({
      success: true,
      question: aki.question,
      answers: aki.answers,
      progress: aki.progress,
      questionNumber: session.questionCount,
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE SESSION ──────────────────────────────────────────
app.delete('/session/:sessionId', async (req, res) => {
  await deleteSession(req.params.sessionId);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`🔥 Production Akinator running on ${PORT}`);
});

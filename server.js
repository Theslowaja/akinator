// ============================================================
// PRODUCTION Akinator Server (Redis + Anti Exploit + Scalable)
// Compatible with aki-api develop branch
// ============================================================

require('dotenv').config();
const express = require('express');
const { Aki } = require('aki-api');
const Redis = require('ioredis');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const https = require('https');
const fs = require('fs');

// ── TLS / SSL Configuration ─────────────────────────────────
// NODE_TLS_REJECT_UNAUTHORIZED=0 disables SSL certificate verification.
// Use ONLY in development or when the host CA bundle is unavailable.
// Never set this to '0' in production — it exposes the app to MITM attacks.
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  console.warn(
    '[WARN] NODE_TLS_REJECT_UNAUTHORIZED=0 — SSL certificate verification is DISABLED. ' +
    'Do not use this setting in production.'
  );
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── Redis Setup ─────────────────────────────────────────────
const redis = new Redis(process.env.REDIS_URL);

// ── Rate Limiter (anti spam) ────────────────────────────────
const rateLimiter = new RateLimiterMemory({
  points: 10,  // max 10 request
  duration: 5, // per 5 detik
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
    return res.status(429).json({ success: false, error: 'Terlalu banyak request' });
  }
});

// ── Helper: Save session ────────────────────────────────────
async function saveSession(sessionId, data) {
  await redis.set(`aki:${sessionId}`, JSON.stringify(data), 'EX', 60 * 30); // 30 menit
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

// ── HTTPS Agent ─────────────────────────────────────────────
// aki-api does not expose an option to inject a custom HTTPS agent, so TLS
// behaviour is controlled globally via NODE_TLS_REJECT_UNAUTHORIZED (above)
// or by supplying a trusted CA bundle through CA_BUNDLE_PATH.
// The agent below is constructed for reference / future use if the library
// ever exposes an agent option.
let httpsAgent;
if (process.env.CA_BUNDLE_PATH) {
  httpsAgent = new https.Agent({
    ca: fs.readFileSync(process.env.CA_BUNDLE_PATH),
  });
} else if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  httpsAgent = new https.Agent({ rejectUnauthorized: false });
}

// ── Helper: SSL-aware error handler ────────────────────────
// Detects certificate errors thrown by Node.js TLS and surfaces a clear
// message with remediation guidance instead of a raw OpenSSL code.
const SSL_ERROR_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_CRL',
  'UNABLE_TO_DECRYPT_CERT_SIGNATURE',
  'UNABLE_TO_DECRYPT_CRL_SIGNATURE',
  'UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY',
  'CERT_SIGNATURE_FAILURE',
  'CRL_SIGNATURE_FAILURE',
  'CERT_NOT_YET_VALID',
  'CERT_HAS_EXPIRED',
  'CRL_NOT_YET_VALID',
  'CRL_HAS_EXPIRED',
  'ERROR_IN_CERT_NOT_BEFORE_FIELD',
  'ERROR_IN_CERT_NOT_AFTER_FIELD',
  'ERROR_IN_CRL_LAST_UPDATE_FIELD',
  'ERROR_IN_CRL_NEXT_UPDATE_FIELD',
  'OUT_OF_MEM',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_CHAIN_TOO_LONG',
  'CERT_REVOKED',
  'INVALID_CA',
  'PATH_LENGTH_EXCEEDED',
  'INVALID_PURPOSE',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'HOSTNAME_MISMATCH',
]);

function isSslError(err) {
  if (!err) return false;
  const code = err.code || '';
  if (SSL_ERROR_CODES.has(code)) return true;
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('unable to get local issuer certificate') ||
    msg.includes('certificate') ||
    msg.includes('ssl') ||
    msg.includes('tls')
  );
}

function handleRouteError(err, res, context) {
  const ssl = isSslError(err);
  if (ssl) {
    console.error(
      `[SSL ERROR] ${context}: ${err.message} (code: ${err.code || 'n/a'}). ` +
      'To bypass in development set NODE_TLS_REJECT_UNAUTHORIZED=0. ' +
      'In production, ensure the host has up-to-date CA certificates.'
    );
    return res.status(502).json({
      success: false,
      error: 'SSL certificate error when contacting Akinator API.',
      hint: 'Set NODE_TLS_REJECT_UNAUTHORIZED=0 for development, or ensure valid CA certificates are installed on the server.',
      code: err.code || 'SSL_ERROR',
    });
  }
  console.error(`[ERROR] ${context}: ${err.message}`);
  return res.status(500).json({ success: false, error: err.message });
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
  if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId diperlukan' });

  const validRegions = ['en', 'id', 'fr', 'es', 'jp'];
  if (!validRegions.includes(region)) return res.status(400).json({ success: false, error: 'Region tidak valid' });

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
    handleRouteError(err, res, 'POST /start');
  }
});

// ── STEP ────────────────────────────────────────────────────
app.post('/step', async (req, res) => {
  const { sessionId, answer } = req.body;
  if (typeof answer !== 'number' || answer < 0 || answer > 4)
    return res.status(400).json({ success: false, error: 'Jawaban harus 0-4' });

  const session = await loadSession(sessionId);
  if (!session) return res.status(400).json({ success: false, error: 'Session tidak ditemukan' });

  if (session.locked) return res.status(429).json({ success: false, error: 'Request masih diproses' });
  session.locked = true;
  await saveSession(sessionId, session);

  try {
    const aki = new Aki({ region: session.region, childMode: session.childMode });
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
    handleRouteError(err, res, 'POST /step');
  }
});

// ── WIN ─────────────────────────────────────────────────────
app.post('/win', async (req, res) => {
  const { sessionId } = req.body;
  const session = await loadSession(sessionId);
  if (!session) return res.status(400).json({ success: false, error: 'Session tidak ditemukan' });

  try {
    const aki = new Aki({ region: session.region, childMode: session.childMode });
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
    handleRouteError(err, res, 'POST /win');
  }
});

// ── BACK ────────────────────────────────────────────────────
app.post('/back', async (req, res) => {
  const { sessionId } = req.body;
  const session = await loadSession(sessionId);
  if (!session) return res.status(400).json({ success: false, error: 'Session tidak ditemukan' });
  if (session.questionCount <= 1) return res.status(400).json({ success: false, error: 'Sudah di awal' });

  try {
    const aki = new Aki({ region: session.region, childMode: session.childMode });
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
    handleRouteError(err, res, 'POST /back');
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

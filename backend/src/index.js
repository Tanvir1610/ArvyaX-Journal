'use strict';

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const { initDb } = require('./db');
const makeJournalRouter = require('./routes/journal');

// ── App ──────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin:  process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'OPTIONS'],
}));
app.use(express.json({ limit: '1mb' }));

// Global rate limiter — 120 requests per 15 min per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use(globalLimiter);

// Stricter limiter for the LLM endpoint (10 per minute per IP)
const llmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many analysis requests. Wait a moment and try again.' },
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/journal', makeJournalRouter(llmLimiter));

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', ts: new Date().toISOString() }),
);

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[Unhandled]', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
initDb();
app.listen(PORT, () =>
  console.log(`\n🍃  ArvyaX Journal API → http://localhost:${PORT}\n`),
);

module.exports = app;

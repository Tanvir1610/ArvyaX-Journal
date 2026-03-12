'use strict';

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const dbModule = require('../db');
const llm      = require('../services/llm');
const { validateJournalEntry, validateAnalyze } = require('../middleware/validate');

// ── Helpers ──────────────────────────────────────────────────────────────────

function rowToEntry(row) {
  return {
    id:        row.id,
    userId:    row.user_id,
    ambience:  row.ambience,
    text:      row.text,
    createdAt: row.created_at,
    analysis:  row.emotion
      ? {
          emotion:    row.emotion,
          keywords:   JSON.parse(row.keywords ?? '[]'),
          summary:    row.summary,
          analyzedAt: row.analyzed_at,
        }
      : null,
  };
}

// ── Router factory ───────────────────────────────────────────────────────────

module.exports = function makeJournalRouter(llmRateLimiter) {
  const router = express.Router();

  // ── 1. POST /api/journal ─────────────────────────────────────────────────
  router.post('/', validateJournalEntry, (req, res) => {
    try {
      const { userId, ambience, text } = req.body;
      const id = uuidv4();
      const db = dbModule.getDb();

      db.prepare(`
        INSERT INTO journal_entries (id, user_id, ambience, text)
        VALUES (?, ?, ?, ?)
      `).run(id, userId, ambience, text);

      const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id);

      res.status(201).json({
        message: 'Journal entry saved.',
        entry: rowToEntry(entry),
      });
    } catch (err) {
      console.error('[POST /journal]', err.message);
      res.status(500).json({ error: 'Failed to save journal entry.' });
    }
  });

  // ── 2. GET /api/journal/insights/:userId ─────────────────────────────────
  //    NOTE: must be declared BEFORE /:userId to prevent route shadowing
  router.get('/insights/:userId', (req, res) => {
    try {
      const { userId } = req.params;
      const db = dbModule.getDb();

      const totalEntries = db
        .prepare('SELECT COUNT(*) AS n FROM journal_entries WHERE user_id = ?')
        .get(userId)?.n ?? 0;

      if (totalEntries === 0) {
        return res.json({
          totalEntries: 0,
          topEmotion: null,
          mostUsedAmbience: null,
          recentKeywords: [],
        });
      }

      // Top emotion across all analysed entries for this user
      const topEmotionRow = db.prepare(`
        SELECT ac.emotion, COUNT(*) AS n
        FROM analysis_cache ac
        JOIN journal_entries je ON ac.entry_id = je.id
        WHERE je.user_id = ?
        GROUP BY ac.emotion
        ORDER BY n DESC
        LIMIT 1
      `).get(userId);

      // Most used ambience
      const topAmbienceRow = db.prepare(`
        SELECT ambience, COUNT(*) AS n
        FROM journal_entries
        WHERE user_id = ?
        GROUP BY ambience
        ORDER BY n DESC
        LIMIT 1
      `).get(userId);

      // Recent keywords from last 5 analysed entries (deduplicated, max 10)
      const recentRows = db.prepare(`
        SELECT ac.keywords
        FROM analysis_cache ac
        JOIN journal_entries je ON ac.entry_id = je.id
        WHERE je.user_id = ?
        ORDER BY je.created_at DESC
        LIMIT 5
      `).all(userId);

      const seen = new Set();
      const recentKeywords = [];
      for (const row of recentRows) {
        for (const kw of JSON.parse(row.keywords ?? '[]')) {
          if (!seen.has(kw) && recentKeywords.length < 10) {
            seen.add(kw);
            recentKeywords.push(kw);
          }
        }
      }

      res.json({
        totalEntries,
        topEmotion:       topEmotionRow?.emotion   ?? null,
        mostUsedAmbience: topAmbienceRow?.ambience  ?? null,
        recentKeywords,
      });
    } catch (err) {
      console.error('[GET /insights]', err.message);
      res.status(500).json({ error: 'Failed to retrieve insights.' });
    }
  });

  // ── 3. GET /api/journal/:userId ──────────────────────────────────────────
  router.get('/:userId', (req, res) => {
    try {
      const { userId } = req.params;
      const limit  = Math.min(Number(req.query.limit)  || 50, 100);
      const offset = Math.max(Number(req.query.offset) || 0,  0);
      const db = dbModule.getDb();

      const rows = db.prepare(`
        SELECT
          je.*,
          ac.emotion,
          ac.keywords,
          ac.summary,
          ac.created_at AS analyzed_at
        FROM journal_entries je
        LEFT JOIN analysis_cache ac ON ac.entry_id = je.id
        WHERE je.user_id = ?
        ORDER BY je.created_at DESC
        LIMIT ? OFFSET ?
      `).all(userId, limit, offset);

      const total = db
        .prepare('SELECT COUNT(*) AS n FROM journal_entries WHERE user_id = ?')
        .get(userId)?.n ?? 0;

      res.json({ entries: rows.map(rowToEntry), total, limit, offset });
    } catch (err) {
      console.error('[GET /:userId]', err.message);
      res.status(500).json({ error: 'Failed to retrieve entries.' });
    }
  });

  // ── 4. POST /api/journal/analyze ─────────────────────────────────────────
  router.post('/analyze', llmRateLimiter, validateAnalyze, async (req, res) => {
    const { text, entryId, stream: useStream } = req.body;

    try {
      // ── Streaming response ──────────────────────────────────────────────
      if (useStream) {
        res.setHeader('Content-Type',  'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection',    'keep-alive');

        let fullText = '';
        const rawFull = await llm.analyzeTextStream(text, (chunk) => {
          fullText += chunk;
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        });

        // Try to parse and persist
        try {
          const { v4: uuidv4 } = require('uuid');
          const cleaned = rawFull.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
          const parsed  = JSON.parse(cleaned);
          parsed.emotion  = parsed.emotion.toLowerCase().trim();
          parsed.keywords = parsed.keywords.map(k => k.toLowerCase().trim());

          // Save to DB cache
          const db   = dbModule.getDb();
          const hash = llm.textHash(text);
          db.prepare(`
            INSERT OR REPLACE INTO analysis_cache (id, entry_id, text_hash, emotion, keywords, summary)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(uuidv4(), entryId ?? null, hash, parsed.emotion, JSON.stringify(parsed.keywords), parsed.summary);

          res.write(`data: ${JSON.stringify({ done: true, result: parsed })}\n\n`);
        } catch {
          res.write(`data: ${JSON.stringify({ done: true, error: 'Parse failed — raw text streamed' })}\n\n`);
        }

        return res.end();
      }

      // ── Standard response ───────────────────────────────────────────────
      const result = await llm.analyzeText(text, dbModule, entryId ?? null);
      res.json(result);

    } catch (err) {
      console.error('[POST /analyze]', err.message);
      if (err.status === 401 || err.message?.includes('API key')) {
        return res.status(500).json({ error: 'Invalid Anthropic API key. Check your .env file.' });
      }
      res.status(500).json({ error: err.message ?? 'Analysis failed.' });
    }
  });

  return router;
};

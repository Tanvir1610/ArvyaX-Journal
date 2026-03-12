'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const crypto   = require('crypto');
const NodeCache = require('node-cache');

// ── In-process cache (survives within one server lifecycle) ──────────────────
// TTL 1 hour; check expired every 10 min
const memCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// ── Anthropic client ─────────────────────────────────────────────────────────
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// We deliberately use claude-haiku — fastest and cheapest model.
const MODEL = 'claude-haiku-4-5-20251001';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Deterministic cache key: SHA-256 of normalised text */
function textHash(text) {
  return crypto
    .createHash('sha256')
    .update(text.trim().toLowerCase())
    .digest('hex');
}

/** Strip markdown fences and parse JSON safely */
function parseJson(raw) {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

/** Build the analysis prompt */
function buildPrompt(text) {
  return `You are an empathetic mental-wellness AI specialising in nature therapy.

Analyse the journal entry below and return ONLY a JSON object — no markdown, no extra text.

Journal entry:
"""
${text}
"""

Required JSON shape:
{
  "emotion":  "<one lowercase word, e.g. calm | joyful | anxious | melancholic | peaceful | hopeful | grateful | excited | sad | serene>",
  "keywords": ["<word>", "<word>", "<word>"],
  "summary":  "<one sentence describing the user's emotional state during the nature session>"
}

Rules:
- emotion  → single lowercase word only
- keywords → exactly 3 relevant words (themes or sensations from the text)
- summary  → one concise sentence, third-person ("User felt …")`;
}

// ── Core analysis (standard / non-streaming) ─────────────────────────────────

/**
 * Analyse text. Checks memory cache → DB cache → Anthropic API.
 * @param {string} text
 * @param {{ getDb: Function }} dbModule  – pass db module to avoid circular deps
 * @param {string|null} entryId          – optional, links result to journal entry
 * @returns {Promise<{emotion,keywords,summary,cached}>}
 */
async function analyzeText(text, dbModule, entryId = null) {
  const hash = textHash(text);

  // 1️⃣  Memory cache hit
  const memHit = memCache.get(hash);
  if (memHit) {
    console.log('[LLM] memory-cache hit', hash.slice(0, 8));
    return { ...memHit, cached: true };
  }

  // 2️⃣  DB cache hit
  const db    = dbModule.getDb();
  const dbRow = db.prepare('SELECT * FROM analysis_cache WHERE text_hash = ?').get(hash);
  if (dbRow) {
    console.log('[LLM] db-cache hit', hash.slice(0, 8));
    const result = {
      emotion:  dbRow.emotion,
      keywords: JSON.parse(dbRow.keywords),
      summary:  dbRow.summary,
    };
    memCache.set(hash, result);          // warm memory cache
    return { ...result, cached: true };
  }

  // 3️⃣  Call Anthropic
  console.log('[LLM] calling API…');
  const msg = await client.messages.create({
    model:      MODEL,
    max_tokens: 300,
    messages:   [{ role: 'user', content: buildPrompt(text) }],
  });

  const raw    = msg.content[0]?.text ?? '';
  let result;
  try {
    result = parseJson(raw);
  } catch {
    throw new Error(`LLM returned unparseable JSON: ${raw.slice(0, 120)}`);
  }

  // Validate & normalise
  if (!result.emotion || !Array.isArray(result.keywords) || !result.summary) {
    throw new Error('LLM response missing required fields.');
  }
  result.emotion   = result.emotion.toLowerCase().trim();
  result.keywords  = result.keywords.map(k => String(k).toLowerCase().trim()).slice(0, 5);
  result.summary   = result.summary.trim();

  // 4️⃣  Persist to caches
  memCache.set(hash, result);
  _saveToDb(db, hash, entryId, result);

  return { ...result, cached: false };
}

/** Streaming version — calls onChunk for each SSE text piece, resolves with full text */
async function analyzeTextStream(text, onChunk) {
  const stream = client.messages.stream({
    model:      MODEL,
    max_tokens: 300,
    messages:   [{ role: 'user', content: buildPrompt(text) }],
  });

  let full = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      full += event.delta.text;
      onChunk(event.delta.text);
    }
  }
  return full;
}

// ── Internal ─────────────────────────────────────────────────────────────────

function _saveToDb(db, hash, entryId, result) {
  try {
    const { v4: uuidv4 } = require('uuid');
    db.prepare(`
      INSERT OR REPLACE INTO analysis_cache (id, entry_id, text_hash, emotion, keywords, summary)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      entryId ?? null,
      hash,
      result.emotion,
      JSON.stringify(result.keywords),
      result.summary,
    );
  } catch (err) {
    console.warn('[LLM] DB cache write failed:', err.message);
  }
}

module.exports = { analyzeText, analyzeTextStream, textHash };

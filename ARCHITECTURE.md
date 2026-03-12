# ARCHITECTURE.md — ArvyaX AI Journal

## System Diagram

```
┌───────────────────────────────────────────────────────┐
│                React Frontend (Vite)                  │
│  Write Tab │ Entries Tab │ Insights Tab               │
└──────────────────────┬────────────────────────────────┘
                       │ HTTP / SSE
┌──────────────────────▼────────────────────────────────┐
│              Express API  (Node.js 20)                │
│                                                       │
│  Rate Limiter ──► Router                              │
│                     │                                 │
│              ┌──────┴──────┐                          │
│              │             │                          │
│         Validator       Validator                     │
│              │             │                          │
│         DB (SQLite)    LLM Service                    │
│              │           │                            │
│         journal_entries  ├─ Memory Cache (node-cache) │
│         analysis_cache   ├─ DB Cache    (SQLite)      │
│                          └─ Anthropic API (Haiku)     │
└───────────────────────────────────────────────────────┘
```

---

## Data Model

### `journal_entries`
| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID v4) | PK |
| `user_id` | TEXT | indexed |
| `ambience` | TEXT | forest \| ocean \| mountain \| desert \| meadow |
| `text` | TEXT | 10–5000 chars |
| `created_at` | TEXT (ISO-8601) | auto |

### `analysis_cache`
| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID v4) | PK |
| `entry_id` | TEXT | FK → journal_entries (nullable) |
| `text_hash` | TEXT | SHA-256, UNIQUE, indexed |
| `emotion` | TEXT | single word |
| `keywords` | TEXT | JSON array |
| `summary` | TEXT | one sentence |
| `created_at` | TEXT | auto |

Rationale: keeping `analysis_cache` separate from `journal_entries` means:
- The same cache entry serves multiple users who write identical text.
- Analysed and unanalysed entries can be queried independently.
- Cache can be purged without touching journal data.

---

## 1. How would you scale this to 100,000 users?

**Database — swap SQLite → PostgreSQL**

SQLite is single-writer and file-locked. Even at 5k concurrent users it becomes a bottleneck. PostgreSQL supports:
- Row-level locking and MVCC for high concurrent writes.
- Read replicas to distribute `GET` load.
- `pgvector` extension for semantic caching (see §3).
- Managed services (AWS RDS, Supabase) with automated backups and failover.

**API — stateless horizontal scaling**

The current Express server is already stateless (no session state, no in-process locks). To scale:
- Deploy 3–10 instances behind a load balancer (AWS ALB, NGINX, Cloudflare).
- Replace `node-cache` (per-process) with **Redis** for a shared distributed cache.
- Use `pm2 cluster` as a quick win before adopting a container orchestrator.

**LLM calls — async job queue**

Synchronous LLM calls (1–3 s each) under load cause request timeouts. Solution:
1. `POST /api/journal/analyze` enqueues a job → returns `{ jobId }` immediately.
2. Workers (BullMQ + Redis) process the queue, write results to DB.
3. Client polls `GET /api/journal/analyze/:jobId` or subscribes via WebSocket.

This decouples API latency from LLM latency and enables horizontal scaling of workers independently.

**Frontend**

- Build the Vite bundle once, push to S3 / Cloudflare Pages.
- Serve via CDN — zero origin load for static assets.
- API calls go through the CDN edge to the load-balanced API fleet.

**Estimated capacity per tier:**

| Config | RPS | Users/day |
|--------|-----|-----------|
| 1 Node + SQLite (current) | ~80 | ~10k |
| 3 Nodes + Postgres + Redis | ~800 | ~100k |
| 10 Nodes + async queue | ~4000 | ~1M |

---

## 2. How would you reduce LLM cost?

**Model selection (already done)**

`claude-haiku-4-5-20251001` is the cheapest Anthropic model.  
Cost per analysis of a 200-word journal entry ≈ **$0.00015** (150 tokens in, 80 out).  
At 100k users × 2 analyses/day = **$30/day** — very manageable.

**Aggressive caching (already implemented)**

Text-hash deduplication means identical (or whitespace-normalised) text never calls the API twice. In a nature journaling app where users often write similar phrases ("I felt calm", "peaceful walk"), cache hit rates of 15–25% are realistic.

**Prompt optimisation**

- Minimise system prompt length — every token costs money.  
  Current prompt: ~120 tokens. Could be reduced to 80 with tighter wording.
- Set `max_tokens: 300` — enough for the JSON response, prevents runaway generation.
- Use `temperature: 0` for deterministic, reproducible outputs.

**Batching (for analytics)**

If users don't need instant analysis, batch 50 entries into one API call:
```
Analyse these 50 journal entries and return a JSON array of results…
```
Batch requests reduce per-call overhead and can be scheduled during off-peak hours.

**Semantic similarity cache (advanced)**

Use embeddings to find entries that are semantically close (cosine similarity > 0.92) and reuse their analysis, even if the exact text differs. Requires:
- `pgvector` extension on Postgres.
- Embedding model (Anthropic's or a free local model like `nomic-embed-text`).

**Local / open-source LLM fallback**

For cost-sensitive scenarios, run Llama 3.1 8B (via Ollama) on a dedicated GPU instance. Upfront cost ~$500/month (AWS g4dn.xlarge) vs. $900+/month at 6M analyses/month on Haiku.

---

## 3. How would you cache repeated analysis?

**Current implementation (two layers)**

```
Incoming text
    │
    ▼
SHA-256(text.trim().toLowerCase())  → cache key
    │
    ├─ Layer 1: node-cache (in-process, TTL 1h)
    │   Hit  → return instantly (nanoseconds)
    │   Miss ↓
    │
    ├─ Layer 2: analysis_cache table (SQLite, permanent)
    │   Hit  → return from DB, warm Layer 1
    │   Miss ↓
    │
    └─ Anthropic API call
           │
           ├─ Write to Layer 2 (DB)
           └─ Write to Layer 1 (memory)
```

**Why SHA-256?**

- Deterministic: same input always produces the same key.
- Collision-resistant: probability of two different texts sharing a key is negligible.
- Normalisation (`trim().toLowerCase()`) handles trivial variations.

**At scale: replace Layer 1 with Redis**

```javascript
// Current
const memCache = new NodeCache({ stdTTL: 3600 });

// At scale
const redis = new Redis(process.env.REDIS_URL);
const cached = await redis.get(`analysis:${hash}`);
if (cached) return JSON.parse(cached);
// ... after LLM call:
await redis.setex(`analysis:${hash}`, 86400, JSON.stringify(result));
```

Redis is shared across all API instances (unlike `node-cache` which is per-process), so a cache warm on one instance benefits all others.

**Semantic cache (future)**

Store embeddings alongside analysis results. For new text, compute its embedding, query Postgres `pgvector` for the nearest neighbour within a similarity threshold, and return that result if found.

---

## 4. How would you protect sensitive journal data?

Journal entries are highly personal mental health data. Protection must be comprehensive.

### Transport Security
- Enforce TLS/HTTPS at the load balancer or reverse proxy for all traffic.
- Set `Strict-Transport-Security` (HSTS) headers to prevent SSL stripping.
- Use `helmet.js` middleware for security headers (X-Frame-Options, CSP, etc.).

### Authentication & Authorisation
The current demo trusts `userId` from the request body — this is **not production-safe**.

Production approach:
1. Implement **JWT authentication** (e.g. with `jsonwebtoken` or Auth0).
2. Extract the authenticated user's ID from the verified token — never from the body.
3. Every database query filters by `WHERE user_id = :authenticatedUserId`.
4. Users can never access each other's entries — verified at the API layer, not just the UI.

```javascript
// Middleware extracts userId from JWT, not request body
app.use('/api/journal', verifyJwt, (req, res, next) => {
  req.userId = req.auth.sub; // from verified token
  next();
});
```

### Encryption at Rest
- **SQLite (current):** Use SQLCipher (encrypted SQLite) or encrypt the `text` field at the application layer using AES-256-GCM before writing.
- **PostgreSQL (production):** Enable Transparent Data Encryption (TDE) at the storage layer (AWS RDS does this by default). Additionally, encrypt the `text` column at the application layer so even a DB dump reveals only ciphertext.
- Manage encryption keys in a secrets manager (AWS KMS, HashiCorp Vault) — never hardcode them.

### Data Minimisation & Privacy
- Never log journal `text` in application logs — log only entry `id` and `userId`.
- Redact sensitive fields from error-tracking tools (Sentry, Datadog) using scrubbing rules.
- When sending text to the Anthropic API, consider pseudonymisation: strip personal identifiers (names, locations) before the API call.
- For maximum privacy, run a **local LLM** (Ollama + Llama 3) so journal text never leaves your infrastructure.

### GDPR / Right to Erasure
Implement a delete endpoint:
```
DELETE /api/user/:userId
→ deletes all journal_entries WHERE user_id = :userId
→ cascades to analysis_cache via FK
→ returns 204 No Content
```

Audit all data flows and document retention policies.

### Rate Limiting & Abuse Prevention
Already implemented:
- 120 req / 15 min globally per IP.
- 10 analyse calls / min per IP.

Additional hardening:
- Require account creation (email + password or OAuth) to rate-limit by account, not just IP.
- Add CAPTCHA on registration to block bot scraping.
- Monitor for enumeration attacks (someone cycling through userIds).

import { useState, useEffect, useCallback } from 'react';
import { createEntry, getEntries, analyzeEntry, getInsights } from './api/journal.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const AMBIENCES = [
  { value: 'forest',   emoji: '🌲', label: 'Forest'   },
  { value: 'ocean',    emoji: '🌊', label: 'Ocean'    },
  { value: 'mountain', emoji: '⛰️', label: 'Mountain' },
  { value: 'desert',   emoji: '🏜️', label: 'Desert'   },
  { value: 'meadow',   emoji: '🌿', label: 'Meadow'   },
];

const EMOTION_COLORS = {
  calm:        '#6BA3BE', peaceful:    '#7CB99A', joyful:   '#F0C060',
  grateful:    '#A8C5A0', hopeful:     '#89B4C8', excited:  '#E8956D',
  melancholic: '#9B8BAE', anxious:     '#D4956A', sad:      '#8BA3B8',
  serene:      '#7DBFAD',
};
const emotionColor = (e) => EMOTION_COLORS[e?.toLowerCase()] ?? '#888';

const fmt = (iso) =>
  new Date(iso).toLocaleString('en-US', {
    weekday:'short', month:'short', day:'numeric',
    hour:'2-digit', minute:'2-digit',
  });

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [userId,  setUserId]  = useState('user_001');
  const [tab,     setTab]     = useState('write');

  // shared notification
  const [note, setNote] = useState(null); // { type:'error'|'success', msg }
  const notify = (type, msg) => {
    setNote({ type, msg });
    setTimeout(() => setNote(null), 4000);
  };

  return (
    <div className="app">
      <Header userId={userId} setUserId={setUserId} />
      <Tabs tab={tab} setTab={setTab} />

      <main className="main">
        {note && (
          <div className={`banner ${note.type}`}>
            {note.msg}
            <button onClick={() => setNote(null)}>✕</button>
          </div>
        )}

        {tab === 'write'    && <WriteTab    userId={userId} notify={notify} />}
        {tab === 'entries'  && <EntriesTab  userId={userId} notify={notify} />}
        {tab === 'insights' && <InsightsTab userId={userId} notify={notify} />}
      </main>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ userId, setUserId }) {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="brand">
          <span className="brand-logo">🍃</span>
          <div>
            <h1 className="brand-title">ArvyaX Journal</h1>
            <div className="brand-tagline">Nature · Reflection · Insight</div>
          </div>
        </div>
        <div className="user-pill">
          <span>👤</span>
          <input
            value={userId}
            onChange={e => setUserId(e.target.value.trim() || 'user_001')}
            placeholder="User ID"
            title="Edit user ID"
          />
        </div>
      </div>
    </header>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function Tabs({ tab, setTab }) {
  const items = [
    { key:'write',    icon:'✍️',  label:'Write'    },
    { key:'entries',  icon:'📖', label:'Entries'  },
    { key:'insights', icon:'✨', label:'Insights' },
  ];
  return (
    <nav className="tabs">
      {items.map(t => (
        <button
          key={t.key}
          className={`tab ${tab === t.key ? 'active' : ''}`}
          onClick={() => setTab(t.key)}
        >
          {t.icon} {t.label}
        </button>
      ))}
    </nav>
  );
}

// ── Write Tab ─────────────────────────────────────────────────────────────────
function WriteTab({ userId, notify }) {
  const [ambience, setAmbience] = useState('forest');
  const [text,     setText]     = useState('');
  const [saving,   setSaving]   = useState(false);
  const [ok,       setOk]       = useState(false);

  const handleSave = async () => {
    if (text.trim().length < 10) {
      notify('error', 'Entry must be at least 10 characters.');
      return;
    }
    setSaving(true);
    try {
      await createEntry(userId, ambience, text.trim());
      setText('');
      setOk(true);
      notify('success', 'Journal entry saved!');
      setTimeout(() => setOk(false), 3000);
    } catch (e) {
      notify('error', e.response?.data?.error ?? 'Failed to save. Is the backend running?');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 680 }}>
      <h2 className="section-title" style={{ marginBottom: 22 }}>New Entry</h2>

      {/* Ambience picker */}
      <div className="field">
        <div className="label">Nature Session</div>
        <div className="ambience-row">
          {AMBIENCES.map(a => (
            <button
              key={a.value}
              className={`amb-btn ${ambience === a.value ? 'sel' : ''}`}
              onClick={() => setAmbience(a.value)}
              type="button"
            >
              {a.emoji} {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Journal text */}
      <div className="field">
        <div className="label">
          How did you feel?
          <span className="note">{text.length} / 5000</span>
        </div>
        <textarea
          rows={8}
          maxLength={5000}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={`Describe your ${ambience} session… what did you notice, feel, hear?`}
        />
      </div>

      <button
        className={`btn btn-primary ${ok ? 'ok' : ''}`}
        onClick={handleSave}
        disabled={saving || text.trim().length < 10}
      >
        {saving ? '⏳ Saving…' : ok ? '✅ Saved!' : '💾 Save Entry'}
      </button>
    </div>
  );
}

// ── Entries Tab ───────────────────────────────────────────────────────────────
function EntriesTab({ userId, notify }) {
  const [entries,   setEntries]  = useState([]);
  const [loading,   setLoading]  = useState(false);
  const [analyzing, setAnalyzing] = useState(null); // entry id being analyzed

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getEntries(userId);
      setEntries(data.entries ?? []);
    } catch {
      notify('error', 'Could not load entries. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const handleAnalyze = async (entry) => {
    setAnalyzing(entry.id);
    try {
      const result = await analyzeEntry(entry.text, entry.id);
      // Merge analysis into entry list locally for instant feedback
      setEntries(prev => prev.map(e =>
        e.id === entry.id
          ? { ...e, analysis: { ...result, analyzedAt: new Date().toISOString() } }
          : e,
      ));
      notify('success', `Emotion detected: ${result.emotion}${result.cached ? ' (cached)' : ''}`);
    } catch (e) {
      notify('error', e.response?.data?.error ?? 'Analysis failed. Check your API key.');
    } finally {
      setAnalyzing(null);
    }
  };

  if (loading) return <div className="spinner">Loading entries…</div>;

  if (!entries.length) return (
    <div className="empty">
      <span>🌱</span>
      <p>No entries yet — go write one!</p>
    </div>
  );

  return (
    <>
      <div className="section-row">
        <h2 className="section-title">Your Journal</h2>
        <button className="btn btn-sm" onClick={load}>↺ Refresh</button>
      </div>

      <div className="entries">
        {entries.map(entry => (
          <article key={entry.id} className="entry">
            <div className="entry-head">
              <div className="entry-meta">
                <span className="tag">
                  {AMBIENCES.find(a => a.value === entry.ambience)?.emoji ?? '🌍'}{' '}
                  {entry.ambience}
                </span>
                <span className="date">{fmt(entry.createdAt)}</span>
              </div>
              <button
                className="btn btn-analyze"
                onClick={() => handleAnalyze(entry)}
                disabled={!!analyzing}
              >
                {analyzing === entry.id ? '🔄 Analyzing…' : '🔍 Analyze'}
              </button>
            </div>

            <p className="entry-text">{entry.text}</p>

            {entry.analysis && (
              <AnalysisPanel analysis={entry.analysis} />
            )}
          </article>
        ))}
      </div>
    </>
  );
}

// ── Analysis Panel ────────────────────────────────────────────────────────────
function AnalysisPanel({ analysis }) {
  const kws = Array.isArray(analysis.keywords)
    ? analysis.keywords
    : JSON.parse(analysis.keywords ?? '[]');
  const color = emotionColor(analysis.emotion);

  return (
    <div className="analysis">
      <div className="analysis-head">
        <span
          className="emotion"
          style={{ color, borderColor: color, background: color + '22' }}
        >
          {analysis.emotion}
        </span>
        {analysis.cached && <span className="cached-pill">⚡ cached</span>}
      </div>
      <p className="analysis-summary">{analysis.summary}</p>
      <div className="kw-row">
        {kws.map((k, i) => <span key={i} className="kw">{k}</span>)}
      </div>
    </div>
  );
}

// ── Insights Tab ──────────────────────────────────────────────────────────────
function InsightsTab({ userId, notify }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getInsights(userId));
    } catch {
      notify('error', 'Could not load insights.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="spinner">Loading insights…</div>;

  if (!data || data.totalEntries === 0) return (
    <div className="empty">
      <span>🌿</span>
      <p>No insights yet — write entries and analyze them!</p>
    </div>
  );

  return (
    <>
      <div className="section-row">
        <h2 className="section-title">Insights</h2>
        <button className="btn btn-sm" onClick={load}>↺ Refresh</button>
      </div>

      <div className="insights-grid">
        <div className="stat-card">
          <div className="stat-icon">📝</div>
          <div className="stat-val">{data.totalEntries}</div>
          <div className="stat-label">Total Entries</div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">💭</div>
          <div
            className="stat-val"
            style={{ color: emotionColor(data.topEmotion) }}
          >
            {data.topEmotion ?? '—'}
          </div>
          <div className="stat-label">Top Emotion</div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">
            {AMBIENCES.find(a => a.value === data.mostUsedAmbience)?.emoji ?? '🌍'}
          </div>
          <div className="stat-val">{data.mostUsedAmbience ?? '—'}</div>
          <div className="stat-label">Favourite Session</div>
        </div>

        {data.recentKeywords?.length > 0 && (
          <div className="stat-card" style={{ gridColumn:'1 / -1', textAlign:'left' }}>
            <div className="stat-label" style={{ marginBottom:14 }}>Recent Keywords</div>
            <div className="kw-cloud">
              {data.recentKeywords.map((kw, i) => (
                <span key={i} className="kw" style={{ fontSize:13, padding:'5px 13px' }}>{kw}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

-- Convivio: schema iniziale.
-- Eseguito una volta sola all'avvio: ogni istruzione è idempotente.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Ospiti: uno per famiglia. Il provider è la chiave logica, il modello è configurazione.
CREATE TABLE IF NOT EXISTS guests (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  provider      TEXT NOT NULL UNIQUE,
  model         TEXT NOT NULL,
  key_ref       TEXT NOT NULL,
  persona       TEXT,
  target_words  INTEGER NOT NULL DEFAULT 200,
  -- Rete di sicurezza, non controllo di lunghezza: sui modelli che ragionano il
  -- tetto copre ragionamento + testo, quindi va tenuto largo o tronca a metà.
  max_tokens    INTEGER NOT NULL DEFAULT 4000,
  params        TEXT NOT NULL DEFAULT '{}',
  color         TEXT NOT NULL DEFAULT '#888888',
  emoji         TEXT NOT NULL DEFAULT '🎙️',
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

-- Impostazioni generali: valgono per tutte le conversazioni.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Le regole della conversazione, versionate.
CREATE TABLE IF NOT EXISTS formats (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  body        TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  phases      TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  topic       TEXT NOT NULL,
  brief       TEXT,
  format_id   TEXT NOT NULL REFERENCES formats(id),
  host_name   TEXT NOT NULL DEFAULT 'Moderatore',
  phase       TEXT NOT NULL DEFAULT 'apertura',
  status      TEXT NOT NULL DEFAULT 'draft',
  notes       TEXT,
  created_at  TEXT NOT NULL,
  ended_at    TEXT
);

CREATE TABLE IF NOT EXISTS episode_guests (
  episode_id     TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  guest_id       TEXT NOT NULL REFERENCES guests(id),
  position       INTEGER NOT NULL,
  role           TEXT,
  joined_at_turn INTEGER NOT NULL DEFAULT 0,
  left_at_turn   INTEGER,
  PRIMARY KEY (episode_id, guest_id)
);

-- Turni: append-only. Un rigenera non cancella, marca `superseded_by`.
CREATE TABLE IF NOT EXISTS turns (
  id             TEXT PRIMARY KEY,
  episode_id     TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  ordinal        INTEGER NOT NULL,
  author_type    TEXT NOT NULL,
  guest_id       TEXT REFERENCES guests(id),
  content        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ok',
  model          TEXT,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  cached_tokens  INTEGER,
  cache_write_tokens INTEGER,
  cost_micros    INTEGER,
  latency_ms     INTEGER,
  superseded_by  TEXT REFERENCES turns(id),
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turns_episode ON turns(episode_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_episodes_created ON episodes(created_at DESC);

-- Ricerca full-text sull'archivio, sincronizzata via trigger.
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
  content,
  content='turns',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS turns_fts_insert AFTER INSERT ON turns BEGIN
  INSERT INTO turns_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS turns_fts_delete AFTER DELETE ON turns BEGIN
  INSERT INTO turns_fts(turns_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS turns_fts_update AFTER UPDATE ON turns BEGIN
  INSERT INTO turns_fts(turns_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO turns_fts(rowid, content) VALUES (new.rowid, new.content);
END;

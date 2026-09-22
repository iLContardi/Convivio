import "server-only";

import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Connessione SQLite condivisa.
 *
 * In sviluppo Next ricarica i moduli a ogni salvataggio: senza il globale
 * apriremmo una connessione nuova a ogni hot reload finché SQLite non protesta.
 */
const globalForDb = globalThis as unknown as { db?: Database.Database };

/**
 * `CREATE TABLE IF NOT EXISTS` non tocca le tabelle già esistenti: le colonne
 * aggiunte dopo il primo avvio vanno applicate a parte, e in modo ripetibile.
 */
function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function open(): Database.Database {
  const file = resolve(
    process.cwd(),
    process.env.DATABASE_PATH ?? "./data/convivio.db",
  );
  mkdirSync(dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function migrate(db: Database.Database): void {
  const schema = readFileSync(
    resolve(process.cwd(), "src/lib/db/schema.sql"),
    "utf8",
  );
  db.exec(schema);

  ensureColumn(db, "formats", "phases", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "turns", "cached_tokens", "INTEGER");
  ensureColumn(db, "turns", "cache_write_tokens", "INTEGER");

  // Riavvolgere non cancella. Serve una colonna propria e non `superseded_by`,
  // che punta al turno *sostituto*: in un rewind un sostituto non c'è, e
  // auto-referenziare il turno confonderebbe il percorso del rigenera.
  ensureColumn(db, "turns", "discarded_at", "TEXT");

  // Quale fase apre un'indicazione di moderazione. Senza, dopo un rewind non
  // si può sapere a che fase è tornata la conversazione: il testo della
  // direttiva è editabile, quindi non è un identificatore.
  ensureColumn(db, "turns", "phase", "TEXT");
  backfillDirectivePhases(db);
}

/**
 * Le indicazioni scritte prima che esistesse la colonna `phase` si riconoscono
 * dal testo: `appendPhaseDirective` ci copiava dentro l'istruzione della fase
 * tale e quale. Il confronto è esatto e fallisce solo se quell'istruzione è
 * stata modificata dopo — in quel caso la riga resta a NULL e il ricalcolo la
 * ignora, che è il comportamento prudente.
 */
function backfillDirectivePhases(db: Database.Database): void {
  const pending = db
    .prepare(
      `SELECT COUNT(*) AS n FROM turns
       WHERE author_type = 'system' AND phase IS NULL`,
    )
    .get() as { n: number };
  if (!pending.n) return;

  const formats = db
    .prepare("SELECT id, phases FROM formats")
    .all() as { id: string; phases: string }[];

  const update = db.prepare(
    `UPDATE turns SET phase = ?
     WHERE author_type = 'system' AND phase IS NULL AND content = ?
       AND episode_id IN (SELECT id FROM episodes WHERE format_id = ?)`,
  );

  db.transaction(() => {
    for (const format of formats) {
      let phases: Record<string, string>;
      try {
        phases = JSON.parse(format.phases || "{}");
      } catch {
        continue;
      }
      for (const [phase, text] of Object.entries(phases)) {
        if (text) update.run(phase, text, format.id);
      }
    }
  })();
}

/**
 * Flag di modulo, non sul globale: il globale sopravvive all'hot reload — è il
 * suo scopo — e con esso sopravviveva anche "ho già migrato", per cui una
 * colonna aggiunta a server acceso non veniva mai creata e le query fallivano
 * finché non si riavviava a mano. Questo flag si azzera a ogni ricaricamento
 * del modulo, quindi le migrazioni ripartono; sono idempotenti e costano nulla.
 */
let migrated = false;

export function getDb(): Database.Database {
  if (!globalForDb.db) globalForDb.db = open();
  if (!migrated) {
    migrate(globalForDb.db);
    migrated = true;
  }
  return globalForDb.db;
}

export function nowIso(): string {
  return new Date().toISOString();
}

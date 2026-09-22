import "server-only";

import { getDb } from "./index";

export interface Settings {
  /**
   * Il nome che dai a questo spazio: finisce nel prompt come {{show_name}}.
   * Il segnaposto conserva il nome storico perché è scritto dentro i format
   * già salvati: rinominarlo li lascerebbe con un riferimento che non viene
   * più sostituito.
   */
  showName: string;
  /** Il nome con cui gli ospiti ti vedono nella trascrizione. */
  hostName: string;
}

const DEFAULTS: Settings = {
  showName: "Convivio",
  hostName: "Moderatore",
};

export function getSettings(): Settings {
  const rows = getDb()
    .prepare("SELECT key, value FROM settings")
    .all() as { key: string; value: string }[];

  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return {
    showName: stored.showName?.trim() || DEFAULTS.showName,
    hostName: stored.hostName?.trim() || DEFAULTS.hostName,
  };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === "string" && value.trim()) upsert.run(key, value.trim());
    }
  })();

  return getSettings();
}

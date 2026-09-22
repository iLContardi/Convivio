/**
 * Distinguere gli errori che passano da soli da quelli che non passeranno mai.
 *
 * Un 429 di solito significa "rallenta", ma un 429 da crediti esauriti o da
 * quota a zero non si risolve aspettando: ritentarlo brucia tre tentativi e
 * ritarda il giro per niente.
 */
const PERMANENT_429 =
  /(no credits|insufficient[_ ]quota|billing|exceeded your current quota|limit: 0)/i;

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Ogni SDK mette il codice HTTP in un posto diverso, e Google lo annida in un
 * JSON dentro il messaggio: `status` lì è la stringa "Service Unavailable",
 * non un numero. Senza guardare anche dentro, un 503 ritentabile veniva
 * scambiato per un errore di rete generico.
 */
export function statusOf(error: unknown): number | null {
  const raw = error as { status?: unknown; code?: unknown };
  if (typeof raw?.status === "number") return raw.status;
  if (typeof raw?.code === "number") return raw.code;

  const match = messageOf(error).match(/"code"\s*:\s*(\d{3})/);
  return match ? Number(match[1]) : null;
}

/** Estrae il messaggio leggibile da errori che incapsulano JSON su più livelli. */
export function humanizeError(error: unknown): string {
  const raw = messageOf(error);

  const messages = [...raw.matchAll(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => m[1].replace(/\\n/g, " ").replace(/\\"/g, '"').trim())
    .filter((m) => m && !m.trim().startsWith("{"));

  // L'ultimo è quello più interno, cioè il più specifico.
  const inner = messages[messages.length - 1];
  const text = (inner ?? raw).replace(/\s+/g, " ").trim();
  const status = statusOf(error);

  const prefixed = status ? `${status} — ${text}` : text;
  return prefixed.length > 300 ? `${prefixed.slice(0, 297)}…` : prefixed;
}

export function isRetryable(error: unknown): boolean {
  if ((error as { name?: string })?.name === "AbortError") return false;

  const status = statusOf(error);
  if (status === null) return true; // errore di rete: vale la pena riprovare
  if (status === 429) return !PERMANENT_429.test(messageOf(error));
  if (status >= 500) return true;
  return false;
}

/**
 * Attese più lunghe di quelle canoniche: i 503 "high demand" dei modelli di
 * punta durano secondi, non millisecondi, e tre tentativi in tre secondi
 * ricadono tutti dentro lo stesso picco.
 */
export function backoffMs(attempt: number): number {
  return Math.min(1500 * 2 ** attempt, 15000);
}

export const MAX_ATTEMPTS = 4;

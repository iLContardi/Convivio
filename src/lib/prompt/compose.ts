import type { ChatMessage } from "@/lib/providers/types";



export interface SpeakerInfo {
  guestId: string;
  name: string;
  persona: string;
  role: string | null;
}

export interface TranscriptTurn {
  authorType: "host" | "guest" | "system";
  guestId: string | null;
  content: string;
  status: "ok" | "interrupted" | "error" | "pending";
}

interface ComposeArgs {
  formatBody: string;
  showName: string;
  speaker: SpeakerInfo;
  others: SpeakerInfo[];
  hostName: string;
  topic: string;
  brief: string;
  targetWords: number;
}

/**
 * I tre strati: Format (condiviso) + Persona (dell'ospite) + contesto dinamico
 * (calcolato). Tenerli separati è ciò che permette di cambiare il format senza
 * riscrivere gli ospiti.
 */
export function composeSystemPrompt(args: ComposeArgs): string {
  const format = args.formatBody
    .replaceAll("{{show_name}}", args.showName)
    .replaceAll("{{guest_name}}", args.speaker.name)
    .replaceAll("{{target_words}}", String(args.targetWords));

  const parts = [format];

  if (args.speaker.persona.trim()) {
    parts.push(`## Chi sei\n${args.speaker.persona.trim()}`);
  }

  const conversazione = [`## Questa conversazione`, `Tema: ${args.topic}`];
  if (args.brief.trim()) conversazione.push("", args.brief.trim());
  parts.push(conversazione.join("\n"));

  const tavolo = [`## Chi c'è al tavolo`, `Modera: ${args.hostName}`];
  for (const o of args.others) {
    const oneLine = firstLine(o.persona);
    tavolo.push(oneLine ? `- ${o.name} — ${oneLine}` : `- ${o.name}`);
  }
  parts.push(tavolo.join("\n"));

  if (args.speaker.role?.trim()) {
    parts.push(
      `## Il tuo ruolo in questa conversazione\n${args.speaker.role.trim()}`,
    );
  }

  // L'istruzione di fase NON sta qui: cambiarla invaliderebbe la cache di
  // sistema e con essa l'intera trascrizione accumulata. Viaggia come turno di
  // moderazione in coda alla conversazione, dove è append-only.

  return parts.join("\n\n");
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}

/**
 * Proietta la trascrizione a N voci sui due ruoli che le API accettano.
 *
 * Ogni ospite vede la stessa conversazione da un punto di vista diverso: i
 * propri interventi diventano `assistant`, tutto il resto `user` con il nome
 * in testa. I `user` consecutivi vanno fusi, perché diversi provider
 * rifiutano o gestiscono male ruoli ripetuti.
 */
export function projectTranscript(
  turns: TranscriptTurn[],
  forGuestId: string,
  nameOf: (turn: TranscriptTurn) => string,
  hostName: string,
): ChatMessage[] {
  const projected: ChatMessage[] = [];

  for (const turn of turns) {
    if (turn.status === "pending") continue;
    // Un turno fallito non è una cosa che l'ospite ha detto: è contabilità
    // nostra. Riproporglielo come proprio intervento gli farebbe credere di
    // aver parlato, e se è l'ultimo fa fallire la richiesta successiva.
    if (turn.status === "error") continue;
    if (!turn.content.trim()) continue;

    const mine = turn.authorType === "guest" && turn.guestId === forGuestId;
    let content = turn.content.trim();
    if (turn.status === "interrupted") {
      content += "\n\n[interrotto da chi modera]";
    }

    if (mine) {
      projected.push({ role: "assistant", content });
    } else {
      // L'indicazione di chi modera viaggia come messaggio utente etichettato,
      // non come ruolo `system` a metà conversazione: quello esiste solo su
      // Claude, e ha vincoli di posizione (deve seguire un turno utente) che
      // qui non possiamo garantire, visto che un'indicazione può arrivare
      // subito dopo l'intervento dell'ospite stesso.
      const label = turn.authorType === "system" ? "Moderazione" : nameOf(turn);
      projected.push({ role: "user", content: `**${label}:** ${content}` });
    }
  }

  // La prima voce deve essere `user`: un `assistant` in apertura viene
  // rifiutato, e comunque non avrebbe senso (nessuno gli ha ancora parlato).
  while (projected.length && projected[0].role === "assistant") {
    projected.shift();
  }

  const merged: ChatMessage[] = [];
  for (const message of projected) {
    const last = merged[merged.length - 1];
    if (last && last.role === "user" && message.role === "user") {
      last.content += `\n\n${message.content}`;
    } else {
      merged.push({ ...message });
    }
  }

  // Neanche l'ultima voce può essere `assistant`: Gemini rifiuta esplicitamente
  // ("Requests ending with a model turn are not supported") e i modelli Claude
  // recenti hanno rimosso il prefill. Succede quando chi modera dà la parola a
  // chi ha appena parlato — che è un atto di chi modera, e come tale va
  // rappresentato invece di lasciare la richiesta malformata.
  const last = merged[merged.length - 1];
  if (last && last.role === "assistant") {
    merged.push({ role: "user", content: `**${hostName}:** Prosegui tu.` });
  }

  return merged;
}

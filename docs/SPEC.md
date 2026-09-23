# Convivio — Specifica funzionale

Conversazioni fra più intelligenze artificiali, moderate da una persona.

Il formato podcast è solo uno degli usi possibili, e non quello prevalente: più
spesso è un brainstorming, un'esplorazione di idee, una discussione. Il
programma non presuppone un genere — chi ne vuole uno se lo scrive nelle regole.

## 0. Decisioni prese

| Ambito | Scelta |
|---|---|
| Stack | Next.js (App Router) + TypeScript, in locale |
| Persistenza | SQLite (file singolo) + FTS5 per la ricerca |
| Provider LLM | SDK ufficiali dei tre provider dietro un'interfaccia `Provider` nostra (vedi §2bis) |
| Turnazione | Accodamento: il turno in corso finisce, l'host entra dopo. Interruzione esplicita a parte |
| Ospiti | **Uno per famiglia** — Claude, GPT, Gemini. La versione del modello è configurazione, non identità |
| Model ID | Letti a runtime dalle API di ciascun provider, mai scritti a mano nel codice |
| In v1 | LaTeX, ruoli dialettici, contatore costi |
| In v0.2 | Auricolare (indicazioni private a un solo ospite), doppia presa, partecipanti variabili |

Le API key restano **sempre** server-side: il browser non le vede mai.

---

## 1. Modello dati

Schema SQLite. `snake_case`, id testuali (nanoid) per comodità di export.

```sql
-- Ospiti: uno per famiglia, configurazione stabile, riusabile fra conversazioni
CREATE TABLE guests (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,          -- nome pubblico stabile: "Claude", "GPT", "Gemini"
  provider      TEXT NOT NULL UNIQUE,   -- anthropic | openai | google — uno solo per famiglia
  model         TEXT NOT NULL,          -- scelto fra quelli letti dall'API, non hardcodato
  key_ref       TEXT NOT NULL,          -- nome della env var, NON la chiave
  persona       TEXT,                   -- chi è, che taglio ha. NON le regole del format
  target_words  INTEGER DEFAULT 200,    -- va nel prompt
  max_tokens    INTEGER DEFAULT 800,    -- rete di sicurezza tecnica
  params        TEXT,                   -- JSON, parametri del provider (vedi §2bis)
  color         TEXT,                   -- identità visiva in chat
  emoji         TEXT,
  archived      INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL
);

-- Le regole della conversazione, versionate
CREATE TABLE formats (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  body        TEXT NOT NULL,            -- il prompt con i placeholder
  version     INTEGER NOT NULL DEFAULT 1,
  phases      TEXT NOT NULL DEFAULT '{}',  -- JSON: il testo editabile delle tre direttive
  created_at  TEXT NOT NULL
);

-- Conversazioni
CREATE TABLE episodes (
  id          TEXT PRIMARY KEY,
  title       TEXT,                     -- generato a fine registrazione
  topic       TEXT NOT NULL,
  brief       TEXT,                     -- le riflessioni di base portate dall'host
  format_id   TEXT NOT NULL REFERENCES formats(id),
  host_name   TEXT NOT NULL DEFAULT 'Moderatore',
  phase       TEXT NOT NULL DEFAULT 'apertura',  -- apertura | dibattito | chiusura
  status      TEXT NOT NULL DEFAULT 'draft',     -- draft | live | paused | ended
  notes       TEXT,                     -- appunti privati dell'host, mai inviati
  created_at  TEXT NOT NULL,
  ended_at    TEXT
);

-- Chi siede al tavolo nella singola conversazione, con ordine e ruolo dialettico
CREATE TABLE episode_guests (
  episode_id     TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  guest_id       TEXT NOT NULL REFERENCES guests(id),
  position       INTEGER NOT NULL,      -- ordine nel giro
  role           TEXT,                  -- ruolo dialettico, entra nel prompt
  joined_at_turn INTEGER DEFAULT 0,     -- per i partecipanti variabili (v0.4)
  left_at_turn   INTEGER,
  PRIMARY KEY (episode_id, guest_id)
);

-- Turni: append-only
CREATE TABLE turns (
  id             TEXT PRIMARY KEY,
  episode_id     TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  ordinal        INTEGER NOT NULL,
  author_type    TEXT NOT NULL,         -- host | guest | system
  guest_id       TEXT REFERENCES guests(id),
  content        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ok',  -- ok | interrupted | error
  model          TEXT,                  -- modello effettivo che ha risposto
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  cached_tokens  INTEGER,               -- letti dalla cache: si pagano un decimo
  cache_write_tokens INTEGER,
  cost_micros    INTEGER,               -- millesimi di centesimo, interi
  latency_ms     INTEGER,
  superseded_by  TEXT REFERENCES turns(id),  -- versioni scartate dopo un rigenera
  discarded_at   TEXT,                  -- riavvolto: fuori trascrizione, non cancellato
  phase          TEXT,                  -- solo sui turni di sistema: la fase che apre
  created_at     TEXT NOT NULL
);

CREATE VIRTUAL TABLE turns_fts USING fts5(content, content='turns', content_rowid='rowid');
```

Note di progetto:

- `superseded_by` invece di cancellare: un rigenera non distrugge la presa precedente. Costa una colonna, salva le conversazioni.
- `discarded_at` separata da `superseded_by`, e non riusata: la seconda punta al turno *sostituto*, e un rewind un sostituto non ce l'ha. Auto-referenziare il turno confonderebbe il percorso del rigenera.
- `turns.phase` esiste per il rewind: il testo di una direttiva è editabile, quindi non è un identificatore. Senza questa colonna, dopo aver riavvolto non si può sapere a che fase è tornata la conversazione.
- `cost_micros` intero: mai float sui soldi.
- `joined_at_turn` / `left_at_turn` esistono già in v1 anche se i partecipanti variabili arrivano dopo — evitano una migrazione.
- `provider UNIQUE`: l'ospite *è* la famiglia. Cambiare versione del modello non crea un nuovo ospite, e il nome in trascrizione resta stabile fra le conversazioni.
- `params` come JSON opaco invece di colonne fisse: i parametri di generazione non sono più gli stessi fra provider (vedi §2bis), e ogni release ne cambia qualcuno.

---

## 2bis. Provider: parametri e scoperta dei modelli

I tre provider non condividono più un set comune di parametri di generazione. Il pannello dell'ospite si costruisce da una tabella di capability, non da un form unico:

| | Claude (Opus 5) | GPT | Gemini |
|---|---|---|---|
| Profondità di ragionamento | `effort`: low → max | parametro di reasoning | parametro di thinking |
| Temperatura | **rimossa — errore 400** | dipende dal modello | supportata |
| Tetto output | `max_tokens` | `max_tokens` | `maxOutputTokens` |

Il punto operativo: su Claude Opus 5 mandare `temperature` non viene ignorato, **restituisce 400**. Un pannello uniforme con lo slider della temperatura rompe l'ospite Claude al primo turno. Al suo posto va esposto `effort`, che è il controllo equivalente per intenzione (quanto pensare prima di rispondere) ma non per meccanica.

Due conseguenze sul thinking, sempre lato Claude:

- Il thinking adattivo su Opus 5 è **attivo di default**. Va tenuto conto nel dimensionare `max_tokens`, perché il tetto copre ragionamento **più** testo: un `max_tokens` stretto tronca la risposta a metà.
- Il ragionamento non viene restituito se non lo si chiede: serve `thinking: { type: "adaptive", display: "summarized" }` per averne una sintesi leggibile. Interessante come funzione futura ("mostra cosa stava pensando l'ospite"), non necessaria in v1.

**Scoperta dei modelli.** Ogni provider espone l'elenco dei modelli disponibili per l'account. La configurazione dell'ospite legge quella lista e la presenta come menu a tendina: niente ID scritti a mano, nessun 404 da refuso, e i modelli nuovi compaiono da soli. Il valore scelto si salva in `guests.model`.

**Client.** Un'interfaccia `Provider` nostra — `listModels()`, `stream(request)` — con tre implementazioni sopra gli SDK ufficiali (`@anthropic-ai/sdk`, `openai`, `@google/genai`). Il motivo è proprio la tabella sopra: un'astrazione multi-provider generica normalizza sul minimo comune denominatore e nasconde `effort`, i parametri di thinking e i costi per modello, che qui sono esattamente ciò che vogliamo controllare. Tre adapter di poche decine di righe ciascuno costano meno di combattere con l'astrazione.

---

## 2. Architettura del prompt

Tre strati, composti a runtime. Il Format è **condiviso e uguale per tutti**; la Persona è dell'ospite; il resto è calcolato.

### Strato 1 — Format (bozza di lavoro)

```
Partecipi a {{show_name}}, una conversazione fra più intelligenze
artificiali moderata da una persona. Non è un'intervista né un dibattito a
tesi: è un ragionamento fatto a più voci, in cui un'idea si esplora, si gira
e si mette alla prova finché non si vede dove tiene e dove si rompe. Può
somigliare a un brainstorming, a una discussione o a una chiacchierata fra
persone che pensano ad alta voce — dipende da dove la porta chi modera.

## Come funziona
- Si parla a turno. Quando tocca a te scrivi UN SOLO intervento: non simulare
  gli altri partecipanti, non scrivere il loro nome come intestazione, non
  anticipare il turno successivo.
- Chi modera può inserirsi in qualsiasi momento per rivolgersi a te, cambiare
  direzione o chiudere un filone. Le sue indicazioni hanno la precedenza su
  tutto il resto.
- Ogni intervento che leggi è preceduto dal nome di chi parla. Il tuo nome
  pubblico è {{guest_name}}: non scriverlo tu, lo aggiunge l'applicazione.

## Come si parla
- Lunghezza indicativa: {{target_words}} parole. Meglio sotto che sopra.
- Non riassumere l'intervento di chi ti precede: è appena stato letto.
- Niente formule di cortesia verso gli altri partecipanti ("ottima
  osservazione", "punto interessante"). Entra direttamente nel merito.
- Se sei d'accordo non limitarti a confermare: aggiungi un elemento nuovo, un
  esempio, una conseguenza che nessuno ha ancora tratto. Se non sei d'accordo
  dillo, e indica il punto preciso in cui il ragionamento si rompe.
- Puoi rivolgerti a un altro ospite chiamandolo per nome e fargli una domanda
  diretta.
- È parlato, non saggistica: una conversazione, non un articolo.

## Formato della risposta
- Markdown. Grassetto con parsimonia, elenchi solo quando la struttura lo
  richiede davvero.
- Matematica in LaTeX: $...$ in linea, $$...$$ per le formule isolate.
- Niente titoli di sezione: stai parlando, non scrivendo un documento.
```

### Strato 2 — Persona

Campo libero per ospite. Chi è, che taglio ha, cosa lo interessa. **Non** contiene regole di format.

### Strato 3 — Contesto dinamico (generato)

```
## Questa conversazione
Tema: {{topic}}

{{brief}}

## Chi c'è al tavolo
Modera: {{host_name}}
{{#each altri_ospiti}}
- {{name}} — {{persona_oneline}}
{{/each}}

## Il tuo ruolo in questa conversazione
{{role}}
```

**L'istruzione di fase non sta nel prompt di sistema.** Viaggia come *turno di moderazione* in coda alla conversazione, etichettato `**Moderazione:**`, e viene persistita in trascrizione come turno vero (`author_type = 'system'`, con la fase in `turns.phase`).

Due ragioni, entrambe verificate sul campo:

- **Costo.** Su tutti e tre i provider la cache è un confronto di prefisso: modificare l'ultima riga del prompt di sistema invalida il prompt di sistema *e tutta la trascrizione accumulata*. Un cambio di fase costava una rilettura integrale della conversazione a prezzo pieno. Come turno in coda, la trascrizione resta append-only e la cache regge — misurato: 1.120 token riletti nel turno immediatamente successivo a un cambio di fase.
- **Archivio.** Una direttiva visibile permette di ricostruire com'è stata condotta la conversazione, non solo cosa è stato detto.

Un turno di moderazione viene registrato alla creazione della conversazione (fase `apertura`) e a ogni cambio di fase effettivo — riselezionare la fase corrente non produce righe in più.

| Fase | Testo della direttiva (editabile in Configurazione) |
|---|---|
| `apertura` | Siamo al giro di apertura: prendi posizione sul tema, non cercare di dire tutto. |
| `dibattito` | Siamo nel vivo: incalza, distingui, porta obiezioni concrete. |
| `chiusura` | Giro di chiusura: una sola sintesi, cosa resta e cosa è rimasto aperto. Non introdurre argomenti nuovi. |

Nota sul canale: l'indicazione è proiettata come messaggio `user` etichettato, non come ruolo `system` a metà conversazione. Quest'ultimo esisterebbe su Claude ed è non falsificabile, ma ha vincoli di posizione (deve seguire un turno utente) che qui non sono garantiti, perché una direttiva può arrivare subito dopo l'intervento di un ospite.

---

## 3. Motore di turnazione

Macchina a stati della conversazione: `draft → live ⇄ paused → ended`.

Ciclo in `live`:

1. Se la coda host non è vuota → il messaggio dell'host diventa il turno successivo, si svuota la coda.
2. Altrimenti → tocca all'ospite in `position` successiva fra quelli attivi.
3. Se c'è una **domanda diretta** pendente → quell'ospite ha la precedenza, poi il giro riprende da dove era rimasto (l'indice del giro non si perde).
4. Dopo `max_consecutive_auto` turni senza input dell'host (default 5) → pausa automatica.

Comandi: `Avvia` · `Pausa dopo questo turno` · `Salta il prossimo` · `Ferma ora` (segna il turno `interrupted`, il testo parziale resta) · `Rigenera` · `Riavvolgi` · `Domanda diretta a…` · `Chiudi con le conclusioni` (passa a fase `chiusura`, un giro completo, poi `ended`).

Errori: retry con backoff esponenziale (3 tentativi), poi turno `error` con contenuto `[{{name}} non ha potuto rispondere: {{motivo}}]` e il giro **prosegue**.

### Riavvolgimento

`Riavvolgi` su un turno porta fuori dalla trascrizione quel turno e tutti i successivi: marca `discarded_at`, non cancella. Su un turno di chi modera il testo torna nell'area di scrittura, così l'uso tipico — ho scritto male, ci ripenso, riscrivo — è un gesto solo.

Tre proprietà ne discendono, e due sono gratis per come è fatto il resto:

- **Il turno di parola torna indietro da sé.** `nextSpeaker` *deriva* la posizione nel giro dai turni visibili invece di memorizzarla, quindi riavvolgere la trascrizione riavvolge anche a chi tocca. Nessuno stato da risincronizzare.
- **Gli ordinali non si riusano.** L'inserimento prende `MAX(ordinal) + 1` contando anche i turni nascosti: un turno nuovo dopo un rewind non può collidere con uno riavvolto, e la cronologia resta non ambigua.
- **La fase va rimessa a mano, ed è l'unico punto insidioso.** Vive in `episodes.phase` ma nasce da un'indicazione in trascrizione. Riavvolgendo oltre un cambio di fase la colonna resterebbe avanti e, siccome una nuova direttiva viene appesa solo quando la fase *cambia*, riselezionare quella giusta non produrrebbe nulla: la conversazione proseguirebbe senza riceverla mai. Nessun errore, solo ospiti convinti di essere in una fase in cui non sono. Il rewind ricalcola la fase dall'ultima indicazione superstite, `apertura` se non ne resta nessuna.

Sulla cache il rewind è l'operazione economica: taglia una coda, e i prefissi sono confronti dall'inizio, quindi tutto ciò che sta prima del punto di rewind resta valido.

Limite noto: l'indice full-text continua a contenere i turni riavvolti. Non si vede finché l'archivio non avrà la ricerca (v0.3), poi servirà un filtro.

---

## 4. Proiezione del contesto

Per ogni ospite, la stessa trascrizione va proiettata su `system` + `user`/`assistant`:

- `system` = Format + Persona + Contesto dinamico (strati 1-3).
- I turni **dell'ospite di turno** → `assistant`, contenuto nudo.
- Tutti gli altri turni (host e altri ospiti) → `user`, prefissati `**{{nome}}:**`.
- I `user` consecutivi vanno **fusi** in un unico messaggio separato da riga vuota: diversi provider rifiutano o gestiscono male ruoli ripetuti.
- Il turno `interrupted` resta in trascrizione con il suo testo parziale e il marcatore `[interrotto da chi modera]`.
- I turni con `superseded_by` o `discarded_at` valorizzati non vengono proiettati: restano nel database, ma per gli ospiti non esistono.

### Caching

Il costo cresce quadraticamente perché ogni turno rilegge tutta la conversazione. Due punti di cache lo contengono, ed è la trascrizione — non il prompt di sistema — a dare il guadagno maggiore, perché è la parte che cresce.

| | Claude | GPT | Gemini |
|---|---|---|---|
| Attivazione | esplicita, 2 breakpoint su 4 | automatica + `prompt_cache_key` | implicita, niente da dichiarare |
| Prefisso minimo | 512 dichiarati (~1.000 osservati) | 1.024 | **4.096** |
| TTL | 1 ora (impostato) | 30 min | non documentato |
| Lettura | 0,1× | 0,1× | 0,1× |

Regole che ne discendono, tutte già applicate:

- Il blocco di sistema è **congelato** per tutta la conversazione: niente date, niente id di sessione, niente istruzione di fase.
- Il secondo breakpoint sta sull'**ultimo messaggio**, così la cache cresce di turno in turno.
- `effort` e i parametri di generazione non vanno variati a metà conversazione: su Claude invalidano la cache dei messaggi.
- Token letti e scritti sono registrati per turno. Su Gemini, dove il caching è implicito e non dichiarabile, **misurare è l'unico controllo disponibile**.

---

## 5. Schermate

L'applicazione è scura sempre: non è una preferenza di sistema da assecondare, è il posto in cui si sta seduti a parlare. Il serif è riservato al parlato, sans e mono a tutto il resto — la tipografia dice chi sta parlando prima che si legga una parola. I colori degli ospiti arrivano dal database e vengono schiariti in CSS per reggere il fondo scuro.

**Conversazione** — quella in corso. Colonna centrale tarata sulla lettura (~65 battute per riga) con i turni in markdown + KaTeX, una barra di colore per ospite a sinistra di ogni intervento, comandi in basso e casella di chi modera sempre attiva. Sotto ogni turno, `rigenera` e `riavvolgi`. Laterale: chi è al tavolo con l'indicatore di chi sta parlando, la fase come segmentato a tre stati, contatore token con la quota letta dalla cache.

**Ospiti** — tre schede fisse, una per famiglia. Modello scelto da un menu popolato leggendo l'API, chiave come nome della env var, persona, parametri. I controlli mostrati dipendono dalle capability di *quel* modello (§2bis): su Claude Opus 5 compare `effort` e la temperatura non esiste. Pulsante "prova" che manda un ping e conferma che la configurazione risponde.

**Regole** — editor del prompt condiviso con i `{{segnaposto}}` evidenziati mentre si scrive, i testi delle tre direttive di fase, e l'anteprima del prompt composto per un ospite scelto. Versionato.

**Nuova conversazione** — tema e brief, e chi siede al tavolo: le schede si numerano nell'ordine in cui le tocchi, perché l'ordine di selezione *è* l'ordine del giro.

**Archivio** — lista con titolo, data, chi c'era, tema. Ricerca full-text nel corpo. Export Markdown (con front-matter) e JSON.

---

## 6. Struttura del progetto

```
src/
  app/
    page.tsx                          # archivio
    episodes/new/page.tsx
    episodes/[id]/page.tsx            # la conversazione
    guests/page.tsx
    config/page.tsx                   # regole e impostazioni
    api/
      episodes/route.ts               # elenco, creazione
      episodes/[id]/route.ts          # stato, fase, intervento, riavvolgimento
      episodes/[id]/turn/route.ts     # genera il prossimo turno, streaming SSE
      format/route.ts
      format/preview/route.ts         # il prompt composto, su un esempio
      guests/route.ts
      guests/test/route.ts            # il ping di "prova"
      models/route.ts                 # elenco letto dalle API dei provider
      settings/route.ts
  lib/
    providers/      # tre adapter, tabella capability
    engine/         # generazione del turno, retry, errori
    prompt/         # composizione dei tre strati e proiezione
    db/             # schema, migrazioni, query
  components/       # Conversation, GuestsEditor, FormatEditor,
                    # NewEpisodeForm, Markdown, Nav
```

I comandi non hanno una rotta propria: passano dal `PATCH` su `episodes/[id]`, perché sono tutti modifiche allo stato della conversazione.

---

## 7. Roadmap

- **v0.1** — ✅ Fatto. Ospiti, partecipanti, brief, giro round-robin, streaming, host che si inserisce, markdown + LaTeX, ruoli dialettici, contatore token, persistenza.
  Non ancora coperto in v0.1: il contatore mostra i token ma non il costo in valuta (manca una tabella prezzi affidabile per tutti e tre i provider), e il pulsante «Ferma ora» è implementato ma non ancora provato sul campo.
- **v0.2** — Interruzione, domanda diretta, auricolare privato, rigenera con storico, fase di chiusura.
  Fatto finora: riavvolgimento (§3), con il ricalcolo della fase che chiudeva un difetto silenzioso.
- **v0.3** — Archivio con ricerca full-text, export, titolo e tag automatici.
- **v0.4** — Format versionati a confronto, doppia presa, partecipanti variabili, riassunto progressivo del contesto.

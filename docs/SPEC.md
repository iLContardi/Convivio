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
| In v0.2 | Auricolare (regia privata), doppia presa, cast dinamico |

Le API key restano **sempre** server-side: il browser non le vede mai.

---

## 1. Modello dati

Schema SQLite. `snake_case`, id testuali (nanoid) per comodità di export.

```sql
-- Ospiti: uno per famiglia, configurazione stabile, riusabile fra puntate
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

-- Format: le regole del programma, versionate
CREATE TABLE formats (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  body        TEXT NOT NULL,            -- il prompt con i placeholder
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

-- Puntate
CREATE TABLE episodes (
  id          TEXT PRIMARY KEY,
  title       TEXT,                     -- generato a fine registrazione
  topic       TEXT NOT NULL,
  brief       TEXT,                     -- le riflessioni di base portate dall'host
  format_id   TEXT NOT NULL REFERENCES formats(id),
  host_name   TEXT NOT NULL DEFAULT 'Conduttore',
  phase       TEXT NOT NULL DEFAULT 'apertura',  -- apertura | dibattito | chiusura
  status      TEXT NOT NULL DEFAULT 'draft',     -- draft | live | paused | ended
  notes       TEXT,                     -- appunti privati dell'host, mai inviati
  created_at  TEXT NOT NULL,
  ended_at    TEXT
);

-- Cast della singola puntata, con ordine e ruolo dialettico
CREATE TABLE episode_guests (
  episode_id     TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  guest_id       TEXT NOT NULL REFERENCES guests(id),
  position       INTEGER NOT NULL,      -- ordine nel giro
  role           TEXT,                  -- ruolo dialettico, entra nel prompt
  joined_at_turn INTEGER DEFAULT 0,     -- per il cast dinamico (v0.4)
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
  cost_micros    INTEGER,               -- millesimi di centesimo, interi
  latency_ms     INTEGER,
  superseded_by  TEXT REFERENCES turns(id),  -- versioni scartate dopo un rigenera
  created_at     TEXT NOT NULL
);

CREATE VIRTUAL TABLE turns_fts USING fts5(content, content='turns', content_rowid='rowid');
```

Note di progetto:

- `superseded_by` invece di cancellare: un rigenera non distrugge la presa precedente. Costa una colonna, salva le puntate.
- `cost_micros` intero: mai float sui soldi.
- `joined_at_turn` / `left_at_turn` esistono già in v1 anche se il cast dinamico arriva dopo — evitano una migrazione.
- `provider UNIQUE`: l'ospite *è* la famiglia. Cambiare versione del modello non crea un nuovo ospite, e il nome in trascrizione resta stabile fra le puntate.
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
- Il conduttore può inserirsi in qualsiasi momento per rivolgersi a te,
  cambiare direzione o chiudere un filone. Le sue indicazioni hanno la
  precedenza su tutto il resto.
- Ogni intervento che leggi è preceduto dal nome di chi parla. Il tuo nome
  pubblico è {{guest_name}}: non scriverlo tu, lo aggiunge il programma.

## Come si parla
- Lunghezza indicativa: {{target_words}} parole. Meglio sotto che sopra.
- Non riassumere l'intervento di chi ti precede: chi ascolta l'ha appena letto.
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
## Questa puntata
Tema: {{topic}}

{{brief}}

## Chi c'è in studio
Conduttore: {{host_name}}
{{#each altri_ospiti}}
- {{name}} — {{persona_oneline}}
{{/each}}

## Il tuo ruolo in questa conversazione
{{role}}
```

**L'istruzione di fase non sta nel prompt di sistema.** Viaggia come *turno di regia* in coda alla conversazione, etichettato `**Regia:**`, e viene persistita in trascrizione come turno vero (`author_type = 'system'`).

Due ragioni, entrambe verificate sul campo:

- **Costo.** Su tutti e tre i provider la cache è un confronto di prefisso: modificare l'ultima riga del prompt di sistema invalida il prompt di sistema *e tutta la trascrizione accumulata*. Un cambio di fase costava una rilettura integrale della puntata a prezzo pieno. Come turno in coda, la trascrizione resta append-only e la cache regge — misurato: 1.120 token riletti nel turno immediatamente successivo a un cambio di fase.
- **Archivio.** Una direttiva di regia visibile permette di ricostruire com'è stata condotta la puntata, non solo cosa è stato detto.

Un turno di regia viene registrato alla creazione della puntata (fase `apertura`) e a ogni cambio di fase effettivo — riselezionare la fase corrente non produce righe in più.

| Fase | Testo della direttiva (editabile in Configurazione) |
|---|---|
| `apertura` | Siamo al giro di apertura: prendi posizione sul tema, non cercare di dire tutto. |
| `dibattito` | Siamo nel vivo: incalza, distingui, porta obiezioni concrete. |
| `chiusura` | Giro di chiusura: una sola sintesi, cosa resta e cosa è rimasto aperto. Non introdurre argomenti nuovi. |

Nota sul canale: la regia è proiettata come messaggio `user` etichettato, non come ruolo `system` a metà conversazione. Quest'ultimo esisterebbe su Claude ed è non falsificabile, ma ha vincoli di posizione (deve seguire un turno utente) che qui non sono garantiti, perché una direttiva può arrivare subito dopo l'intervento di un ospite.

---

## 3. Motore di turnazione

Macchina a stati della puntata: `draft → live ⇄ paused → ended`.

Ciclo in `live`:

1. Se la coda host non è vuota → il messaggio dell'host diventa il turno successivo, si svuota la coda.
2. Altrimenti → tocca all'ospite in `position` successiva fra quelli attivi.
3. Se c'è una **domanda diretta** pendente → quell'ospite ha la precedenza, poi il giro riprende da dove era rimasto (l'indice del giro non si perde).
4. Dopo `max_consecutive_auto` turni senza input dell'host (default 5) → pausa automatica.

Comandi di regia: `Avvia` · `Pausa dopo questo turno` · `Salta il prossimo` · `Ferma ora` (segna il turno `interrupted`, il testo parziale resta) · `Rigenera ultimo` · `Domanda diretta a…` · `Chiudi con le conclusioni` (passa a fase `chiusura`, un giro completo, poi `ended`).

Errori: retry con backoff esponenziale (3 tentativi), poi turno `error` con contenuto `[{{name}} non ha potuto rispondere: {{motivo}}]` e il giro **prosegue**.

---

## 4. Proiezione del contesto

Per ogni ospite, la stessa trascrizione va proiettata su `system` + `user`/`assistant`:

- `system` = Format + Persona + Contesto dinamico (strati 1-3).
- I turni **dell'ospite di turno** → `assistant`, contenuto nudo.
- Tutti gli altri turni (host e altri ospiti) → `user`, prefissati `**{{nome}}:**`.
- I `user` consecutivi vanno **fusi** in un unico messaggio separato da riga vuota: diversi provider rifiutano o gestiscono male ruoli ripetuti.
- Il turno `interrupted` resta in trascrizione con il suo testo parziale e il marcatore `[interrotto dal conduttore]`.

### Caching

Il costo cresce quadraticamente perché ogni turno rilegge tutta la puntata. Due punti di cache lo contengono, ed è la trascrizione — non il prompt di sistema — a dare il guadagno maggiore, perché è la parte che cresce.

| | Claude | GPT | Gemini |
|---|---|---|---|
| Attivazione | esplicita, 2 breakpoint su 4 | automatica + `prompt_cache_key` | implicita, niente da dichiarare |
| Prefisso minimo | 512 dichiarati (~1.000 osservati) | 1.024 | **4.096** |
| TTL | 1 ora (impostato) | 30 min | non documentato |
| Lettura | 0,1× | 0,1× | 0,1× |

Regole che ne discendono, tutte già applicate:

- Il blocco di sistema è **congelato** per tutta la puntata: niente date, niente id di sessione, niente istruzione di fase.
- Il secondo breakpoint sta sull'**ultimo messaggio**, così la cache cresce di turno in turno.
- `effort` e i parametri di generazione non vanno variati a metà puntata: su Claude invalidano la cache dei messaggi.
- Token letti e scritti sono registrati per turno. Su Gemini, dove il caching è implicito e non dichiarabile, **misurare è l'unico controllo disponibile**.

---

## 5. Schermate

**Studio** — la puntata in corso. Colonna centrale con i turni (markdown + KaTeX + syntax highlighting, colore e emoji per ospite), barra di regia in basso, casella dell'host sempre attiva. Laterale: cast con indicatore di chi sta parlando, fase corrente, contatore token/costo, note private.

**Ospiti** — tre schede fisse, una per famiglia. Modello scelto da un menu popolato leggendo l'API, chiave come nome della env var, persona, parametri. I controlli mostrati dipendono dalle capability di *quel* modello (§2bis): su Claude Opus 5 compare `effort` e la temperatura non esiste. Pulsante "prova" che manda un ping e conferma che la configurazione risponde.

**Format** — editor del prompt condiviso, con anteprima del prompt composto per un ospite scelto. Versionato.

**Archivio** — lista con titolo, data, cast, tema. Ricerca full-text nel corpo. Export Markdown (con front-matter) e JSON.

---

## 6. Struttura del progetto

```
src/
  app/
    (studio)/episodes/[id]/page.tsx
    guests/page.tsx
    formats/page.tsx
    archive/page.tsx
    api/
      episodes/[id]/turn/route.ts     # genera il prossimo turno, streaming SSE
      episodes/[id]/control/route.ts  # comandi di regia
      guests/route.ts
  lib/
    providers/      # adapter, tabella capability, calcolo costi
    engine/         # macchina a stati, coda host, proiezione contesto
    prompt/         # composizione dei tre strati
    db/             # schema, migrazioni, query
  components/
    studio/  guests/  markdown/
```

---

## 7. Roadmap

- **v0.1** — ✅ Fatto. Ospiti, cast, brief, giro round-robin, streaming, host che si inserisce, markdown + LaTeX, ruoli dialettici, contatore token, persistenza.
  Non ancora coperto in v0.1: il contatore mostra i token ma non il costo in valuta (manca una tabella prezzi affidabile per tutti e tre i provider), e il pulsante «Ferma ora» è implementato ma non ancora provato sul campo.
- **v0.2** — Interruzione, domanda diretta, auricolare privato, rigenera con storico, fase di chiusura.
- **v0.3** — Archivio con ricerca full-text, export, titolo e tag automatici.
- **v0.4** — Format versionati a confronto, doppia presa, cast dinamico, riassunto progressivo del contesto.

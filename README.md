# Chess Coach

Ein lokales Analysebrett für Schachvarianten. Stockfish 18 Lite läuft
vollständig im Browser; der optionale Coach erklärt die aktuelle Stellung über
die OpenAI Responses API.

## Schnellstart

Voraussetzung: Node.js 22 oder neuer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Trage deinen Schlüssel in `.env.local` ein:

```dotenv
OPENAI_API_KEY=dein_api_schluessel
SAFETY_ID_SALT=ein-langer-zufaelliger-wert
```

Danach ist die Anwendung unter [http://localhost:3000](http://localhost:3000)
erreichbar. Ohne `OPENAI_API_KEY` funktionieren Brett, Varianten und
Stockfish weiterhin; nur der Coach ist deaktiviert.

## Befehle

```bash
npm run dev       # Entwicklungsserver
npm test          # automatisierte Tests
npm run build     # Produktionsbuild
npm start         # gebauten Produktionsserver starten
npm run check     # Tests und Build nacheinander
npm run site:build    # OpenNext-Artefakt für Sites erzeugen
npm run site:package  # deploybares Sites-Archiv erzeugen
```

## Bedienung

- Figuren ziehen: neue Hauptlinie oder Variante anlegen
- `←` / `→`: einen Halbzug zurück oder vor
- `↑` / `↓`: zwischen Geschwistervarianten wechseln
- Zug in der Liste anklicken: direkt zur Stellung springen
- Zugnummer anklicken: Varianten ein- oder ausklappen
- „PGN kopieren“: Hauptlinie samt Varianten exportieren

## Architektur

- `app/`: Next.js-Oberfläche und serverseitige API-Routen
- `app.js`: Anwendungszustand und UI-Steuerung
- `engine.js`: serialisierter UCI-/Stockfish-Worker
- `moveTree.js`: Variantenbaum
- `MoveListView.js`: Darstellung des Variantenbaums
- `moveTreeToPgn.js`: PGN-Export
- `api/chat.js`: validierte, testbare OpenAI-Anfrage
- `chatMarkup.js`: sichere Inline-Formatierung für Coach-Antworten
- `public/libs/`: lokale Chessboard- und Stockfish-Assets
- `test/`: Tests mit dem eingebauten Node-Test-Runner
- `open-next.config.ts` und `wrangler.jsonc`: reproduzierbarer Sites-Build

Der OpenAI-Schlüssel bleibt ausschließlich auf dem Server. Chat-Anfragen
werden größenbegrenzt und nicht bei OpenAI gespeichert (`store: false`).
Das Standardmodell `gpt-5.6-luna` kann über `OPENAI_MODEL` überschrieben
werden.

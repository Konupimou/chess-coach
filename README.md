# Chess Coach

Ein persönlicher Schachcoach mit zwei Bereichen: gegen Stockfish spielen und
direktes Live-Feedback erhalten oder Stellungen und ganze Partien analysieren.
Stockfish 18 Lite läuft vollständig im Browser. Stockfish ist die einzige Quelle
für Züge, Varianten und Bewertungen; der optionale Coach übersetzt ausschließlich
die bereits berechneten Engine-Daten über die OpenAI Responses API.

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

- Einstieg: „Eine Partie spielen“, „Eine eigene Partie analysieren“ oder
  „Eine Stellung untersuchen“ führt direkt in den passenden Arbeitsablauf
- „Spielen“: Farbe und Schwierigkeit wählen, gegen Stockfish antreten und nach
  jedem eigenen Zug ein verständliches Live-Urteil, ein Lernprinzip, die eigene
  Genauigkeit und einen Präzisions-Streak erhalten
- „Analyse“: frei ziehen, Varianten untersuchen, beste Züge anzeigen und den
  hervorgehobenen Stockfish-Erklärer befragen; die Zugliste färbt Bewertungen
  von Grün bis Rot und erklärt jeden analysierten Zug kurz
- vollständige Partieanalyse: geführte Schlüsselmomente, persönliches
  Abschlussfeedback, vorsichtig abgeleitetes Lernziel und konkrete nächste Übung
- Figuren ziehen: neue Hauptlinie oder Variante anlegen
- `←` / `→`: einen Halbzug zurück oder vor
- `↑` / `↓`: zwischen Geschwistervarianten wechseln
- Zug in der Liste anklicken: direkt zur Stellung springen
- Zug in der Liste berühren: zugehörige Stellung vorübergehend auf dem Brett ansehen
- Zugnummer anklicken: Varianten ein- oder ausklappen
- Vorschlag fokussieren oder mit der Maus berühren: Engine-Variante auf dem Brett abspielen
- „⚙ Engine“: Tiefe, Threads, Hash und Anzahl der Vorschläge kompakt einstellen
- „Partie speichern“: Partiedaten ergänzen und den aktuellen Stand bewusst im Account sichern
- „Partie analysieren“: alle Stellungen prüfen, Genauigkeit und Abschlussfeedback anzeigen
- „Mein Account“: Spielerprofil, Key Facts, Eröffnungsrepertoire, Bestpartien und alle gespeicherten Partien anzeigen
- „Mit Lichess verbinden“: per OAuth ohne Zusatzrechte abgeschlossene Standardpartien filtern, auswählen und bewusst importieren
- „PGN“: Hauptlinie samt Varianten exportieren

Die private Live-Seite erkennt den angemeldeten Sites-Nutzer. Bis eine
Sites-Datenbank angebunden ist, werden Partien erst nach dem ausdrücklichen
Speicher-Klick im jeweiligen Browser abgelegt; sie bleiben dort nach dem
Neuladen erhalten.

## Architektur

- `app/`: Next.js-Oberfläche und serverseitige API-Routen
- `app.js`: Anwendungszustand und UI-Steuerung
- `engine.js`: serialisierter UCI-/Stockfish-Worker
- `playMode.js`: Spielstufen, Farbauswahl und Texte für das Live-Feedback
- `moveArrows.js`: responsive, einheitlich gefärbte Pfeile für die besten Engine-Züge
- `gameReview.js`: PV-Vorschau, Genauigkeit und vollständige Partieauswertung
- `coachEngineContext.js`: validierter Stockfish-Kontext und Schutz vor nicht
  durch Engine-PV oder Engine-Bewertung belegten Coach-Angaben
- `gameMetadata.js`: Speicherentwürfe, Zeitformate und lokale Eröffnungserkennung
- `gameStorage.js`: zyklusfreie Spielstände und browserlokale Account-Persistenz
- `playerProfile.js`: aggregierte Spielerstatistiken und Bestpartien-Ranking
- `moveTree.js`: Variantenbaum
- `MoveListView.js`: Darstellung des Variantenbaums
- `moveTreeToPgn.js`: PGN-Export
- `api/chat.js`: validierte, testbare OpenAI-Anfrage
- `api/siteIdentity.js`: serverseitige Sites-Identität für den Account-Bereich
- `api/lichess.js`: OAuth-PKCE, sichere Cookies und begrenzte Lichess-API-Anfragen
- `lichessImport.js`: validierte Umwandlung von Lichess-Partien in analysierbare Spielstände
- `chatMarkup.js`: sichere Inline-Formatierung für Coach-Antworten
- `public/libs/`: lokale Chessboard- und Stockfish-Assets
- `test/`: Tests mit dem eingebauten Node-Test-Runner
- `open-next.config.ts` und `wrangler.jsonc`: reproduzierbarer Sites-Build

Der Coach erhält FEN, Tiefe, Centipawn- oder Mattbewertung, exakten besten Zug,
vollständige PV, MultiPV sowie bei Zugreviews die Vorher-/Nachher-Werte und die
vorhandene Klassifizierung. Ohne vollständige Stockfish-Daten antwortet er
bewusst ohne Zugempfehlung. Antworten mit nicht gelieferten Zügen oder
Bewertungszahlen werden serverseitig verworfen.

Der Lichess-Zugriff verwendet einen sicheren HTTP-only-Cookie, fordert keine
Spiel- oder Schreibrechte an und importiert ausschließlich abgeschlossene
Partien. Der OpenAI-Schlüssel bleibt ausschließlich auf dem Server. Chat-Anfragen
werden größenbegrenzt und nicht bei OpenAI gespeichert (`store: false`).
Das Standardmodell `gpt-5.6-luna` kann über `OPENAI_MODEL` überschrieben
werden.

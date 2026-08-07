# Chess Coach Knowledge Ontology

Dieses Repository enthält neben der Chess-Coach-Anwendung eine quellenneutrale
Master-Ontologie für wiederverwendbares Schachwissen. Sie bildet die gemeinsame
Begriffsschicht zwischen Stockfish-Analyse, Coach-Erklärungen, Trainingsinhalten
und später importierten Buchquellen. Bücher, Autoren, Kapitel und einzelne
Partien sind deshalb keine Kategorien der Ontologie.

## Ontologie-Dateien

- `chess-ontology.json` ist die kanonische, maschinenlesbare Repräsentation.
- `chess-ontology.md` enthält jeden Begriff in einer vollständig lesbaren
  Fassung für Review und redaktionelle Arbeit.
- `chess-ontology.csv` bietet eine flache Zeile pro Konzept für Import,
  Tabellenprüfung und Datenbank-Migration. Mehrfachwerte sind mit `|` getrennt.
- `validate-ontology.py` prüft Schema, Wertebereiche, Eindeutigkeit,
  Referenzintegrität, Pflichtkategorien und die drei synchronen Darstellungen.

Die Ontologie deckt Eröffnung, Taktik, Mattbilder, Strategie, Positionsspiel,
Figuren- und Bauernspiel, Angriff, Verteidigung, Prophylaxe, Abtausch,
Berechnung, Bewertung, Planung, Entscheidungsfindung, alle wesentlichen
Endspieltypen, praktische Spielführung, Psychologie, Zeitmanagement, Training,
Partieanalyse, Fehlerklassifikation, Eröffnungsvorbereitung und
Mustererkennung ab.

## Konzept-Schema

Jedes Objekt hat eine stabile technische `id`, einen eindeutigen `title`, eine
`category` und `subcategory` sowie optionale Hierarchiebezüge über `parent_id`.
Inhaltliche Felder beschreiben Erkennung, Voraussetzungen, typische
Vorbedingungen, Pläne, Angriffs- und Verteidigungsmethoden, häufige Fehler,
Ausnahmen, Engine-Indikatoren und Coach-Fragen. Beziehungen werden
ausschließlich über existierende IDs gespeichert.

`difficulty` verwendet nur `beginner`, `intermediate`, `advanced` oder
`expert`. `game_phases` verwendet nur `opening`, `middlegame`, `endgame` oder
`universal`; `importance` liegt zwischen 1 und 10. Neu angelegte
Ontologieeinträge haben `review_status: "ontology_only"` und ein leeres
`sources`-Array.

## Validierung

Die vollständige Qualitätskontrolle wird im Projektordner ausgeführt:

```bash
python3 validate-ontology.py
```

Ein erfolgreicher Lauf gibt die Anzahl der Kategorien, Unterkategorien und
Konzepte aus und endet mit Exit-Code 0. Fehler werden einzeln und verständlich
ausgegeben; der Prozess endet dann mit Exit-Code 1. Geprüft werden unter
anderem gültiges JSON, 500 bis 850 Konzepte, alle 36 Pflichtkategorien, nicht
leere und formatkonforme IDs, doppelte IDs und Kategorietitel, erlaubte
Wertebereiche, vollständige Beziehungen sowie die Zeilen- und
Eintragsabdeckung in CSV und Markdown.

## Bücher und andere Quellen importieren

Quellen erweitern bestehende Konzepte und erzeugen keine buchbasierte
Parallelstruktur. Der vorgesehene Prozess ist:

```text
PDF
→ Kapitel und Abschnitte erkennen
→ Konzepte extrahieren
→ bestehende Ontologie durchsuchen
→ bestehendes Konzept erweitern oder neues Konzept vorschlagen
→ Quellenbeitrag speichern
→ Review
→ Freigabe für den Coach
```

Ein Quellenbeitrag sollte getrennt vom Ontologie-Kern den Quellenbezeichner,
Autor, Werk, Abschnitt oder Locator, eine paraphrasierte Aussage, betroffene
Konzept-ID, Nutzungsrechte und Reviewstatus speichern. Es werden keine
Seitenzahlen, Zitate oder bibliografischen Angaben erfunden. Beim Import wird
zuerst nach ID, normalisiertem Titel, Alias, Schlüsselwörtern und verwandten
Konzepten gesucht. Ein Treffer erweitert das vorhandene Konzept; nur eine
fachlich neue, wiederverwendbare Idee wird als neues Konzept vorgeschlagen.
Nach der redaktionellen Freigabe kann der Quellenbeitrag an die bestehende ID
angehängt werden.

## Konzepte pflegen und Duplikate vermeiden

Vor einem neuen Eintrag werden Titel, Aliasse, nahe Begriffe und
Querverbindungen in der JSON-Datei durchsucht. Unterschiedliche
Formulierungen desselben Schachgedankens werden als Aliasse oder
Quellenbeiträge modelliert. Ein neues Konzept ist nur gerechtfertigt, wenn es
eigene Erkennungsmerkmale, Voraussetzungen oder Handlungsregeln besitzt.

Neue IDs bestehen ausschließlich aus dem stabilen Kategoriepräfix, einem Punkt
und einem kleingeschriebenen `snake_case`-Namen. Nach einer Änderung werden
JSON, Markdown und CSV gemeinsam aktualisiert und der Validator ausgeführt.
Querverweise dürfen niemals auf freie Titeltexte zeigen, sondern nur auf
existierende IDs. Quellen bleiben vom quellenneutralen Kern getrennt, bis sie
geprüft wurden.

## Verwendung durch den Chess Coach

Der Coach kann aus einer Stellung zunächst Engine-Indikatoren und
Stellungsmerkmale ermitteln, passende Konzept-IDs laden und daraus
Erkennungsmerkmale, Pläne, typische Fehler, Gegenmaßnahmen und Coach-Fragen
abrufen. `related_concepts`, Hierarchiebezüge, Spielphase, Schwierigkeit und
Wichtigkeit steuern Kontextauswahl und Erklärungstiefe. Stockfish bleibt für
konkrete Varianten und Bewertungen zuständig; die Ontologie liefert die
fachliche Sprache und verbindet mehrere geprüfte Quellen mit demselben
Schachkonzept.

---

# Chess Coach Application

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
npm run test:e2e  # echte Browserwege mit Playwright testen
npm run build     # Produktionsbuild
npm start         # gebauten Produktionsserver starten
npm run check     # Tests und Build nacheinander
npm run site:build    # OpenNext-Artefakt für Sites erzeugen
npm run site:package  # deploybares Sites-Archiv erzeugen
npm run openings:check   # eingecheckten lokalen ECO-Index prüfen
npm run openings:import  # Index bewusst aus den gepinnten TSV-Dateien neu erzeugen
npm run pgn:index        # PGN-Eingang indexieren und erfolgreiche Quellen nach database/used archivieren
npm run pgn:check        # Laufzeitindex und Such-Buckets prüfen
npm run pgn:evaluate     # Konzepttransfer und Suchlatenz messen
npm run coach:training:seed   # belegte Trainingskandidaten erzeugen
npm run coach:training:review # lokale Review-Oberfläche starten
npm run coach:training:check  # menschlich freigegebene Beispiele prüfen
npm run coach:training:build  # leckagefreie Train/Validation/Test-Dateien bauen
```

Der vollständige Ablauf für menschliche Freigabe, Dataset-Splits, Training und
blinde Evaluation steht in [`docs/coach-training.md`](docs/coach-training.md).

Vor dem ersten Browser-Test wird Chromium einmalig installiert:

```bash
npx playwright install chromium
```

## Bedienung

- Einstieg: „Eine Partie spielen“, „Eine eigene Partie analysieren“ oder
  „Eine Stellung untersuchen“ führt direkt in den passenden Arbeitsablauf
- „Spielen“: Farbe und Schwierigkeit wählen, gegen Stockfish antreten und nach
  jedem eigenen Zug ein verständliches Live-Urteil, die eigene
  Genauigkeit und einen Präzisions-Streak erhalten
- „Analyse“: frei ziehen, Varianten untersuchen, beste Züge anzeigen und den
  hervorgehobenen Stockfish-Erklärer befragen; die Zugliste färbt Bewertungen
  von Grün bis Rot und erklärt jeden analysierten Zug kurz
- „Coach-Analyse“: eine vollständige Partie nach Eröffnung, Mittelspiel,
  Schlüsselmomenten und Endspiel nachbesprechen; gute Entscheidungen,
  Lernpunkte und konkrete Übungen werden ausdrücklich hervorgehoben
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
- `gameMetadata.js`: Speicherentwürfe und Zeitformate
- `openingRecognition.js`: normalisierte EPD-/Zugfolgen-Erkennung,
  Zugumstellungen und deutsche Darstellung
- `scripts/import-lichess-openings.mjs`: reproduzierbarer TSV-Import
- `scripts/build-coach-pgn-index.mjs`: lokaler, deduplizierter Wissensindex aus kommentierten PGNs
- `data/openings/source/`: gepinnte Originaldaten und CC0-Lizenz
- `data/pgn/coach-pgn-index.json`: kompakter Laufzeitindex für deterministische Fakten aus exakten PGN-Stellungen sowie getrennte Positionsprofile für die kuratierte Konzeptsuche
- `public/data/openings/`: verzögert geladener kompakter Laufzeitindex
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

## Lokale Eröffnungserkennung

Die Anwendung verwendet den offiziellen Datensatz
[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
am fest angehefteten Commit
`51b886249b9e418498d25b6e39b926c3de99c29a` vom 22. Juli 2026. Der Datensatz
der Lichess-Beitragenden ist unter **CC0 1.0** veröffentlicht. Details stehen
in `THIRD_PARTY_NOTICES.md`; der vollständige Lizenztext liegt unter
`data/openings/source/COPYING.txt`.

Der normale Build benötigt weder Netzwerkzugriff noch eine externe
Eröffnungs-API. Die fünf eingecheckten TSV-Dateien werden nur durch den
ausdrücklichen Befehl `npm run openings:import` mit `chess.js` geprüft und in
einen vorberechneten Positions- und Zugfolgenindex umgewandelt. Anschließend
prüft `npm run openings:check` alle legalen UCI-Folgen, EPD-Schlüssel und
Indexverweise. Für ein Update werden die fünf Quelldateien bewusst auf einen
neuen geprüften Upstream-Commit gesetzt, Commit und Datum im Importskript sowie
in den Hinweisen aktualisiert und beide Befehle erneut ausgeführt.

Zur Erkennung wird die aktuelle Hauptlinie legal nachgespielt. Nach jedem Zug
wird ein EPD aus Stellung, Zugrecht, Rochaderechten und einem nur bei legaler
En-passant-Möglichkeit erhaltenen Zielfeld gebildet. Der tiefste benannte
Positionstreffer gewinnt. Ein separater UCI-Index unterscheidet die gespeicherte
Zugfolge von einer Zugumstellung. Deutsche Namen stammen aus einer kleinen,
kuratierten Darstellungsschicht; unbekannte Bestandteile bleiben absichtlich
im englischen Original.

Der Datensatz benennt Eröffnungspositionen, ist aber kein vollständiges
Repertoire aller guten Züge. Wenn nach einer Fortsetzung keine tiefere Position
gefunden wird, ist der Zug deshalb nicht automatisch schlecht. Stockfish
bewertet die konkrete Stellung; die ECO-Daten liefern ausschließlich Name,
Code, Variante, Untervariante und den Erkennungsweg. An den Coach wird nur
dieser einzelne erkannte Kontext übergeben, niemals die gesamte Datenbank.

## Lokales PGN-Erklärwissen

Kommentierte PGN-Dateien kommen zunächst in den Eingangsordner `database/`.
`npm run pgn:index` baut den kompakten Laufzeitindex aus diesem Eingang und dem
Archiv `database/used/`. Erst nachdem alle angeforderten Ergebnisdateien
erfolgreich geschrieben wurden, verschiebt der Importer die in diesem Lauf
verarbeiteten Eingangsquellen nach `database/used/`. Bei einem fatalen Lese-
oder Schreibfehler bleiben sie im Eingang. Bytegleiche Quellen werden sicher
dedupliziert; unterschiedliche Dateien mit demselben Namen erhalten im Archiv
einen Hash-Suffix und werden niemals überschrieben. Für eine ausdrücklich
nicht verschiebende Diagnose gibt es `--keep-sources`.

Der Importer liest kommentierte Partien, überspringt bytegleiche Quelldateien
und ordnet verwertbare Stellen nach Partiephase ein. Unkommentierte Partien
landen nicht im Index. Der produktive Index übernimmt keine freie PGN-Prosa.
Er speichert neu berechnete Brettfakten sowie kurze deutsche Erkenntnisse, für
die der Kommentar ein Schachkonzept nennt und der Stellungsdetektor genau
dieses Konzept bestätigt. Strategische Erkenntnisse brauchen zusätzlich
Konsens aus mindestens zwei unabhängigen PGN-Quellen. `npm run pgn:check`
rekonstruiert die Belege und prüft Format, FENs, Konzepte, Prüfstatus,
Phasenkategorien, Themen und Größenlimits.

Zuggebundene PGN-Fakten gelten nur in der exakten Stellung. Für kuratiertes
Konzeptwissen und freigegebene Kommentar-Erkenntnisse nutzt der Coach
vorberechnete Such-Buckets farbnormalisierte Bauernstrukturen, Material,
Königssicherheit und erkannte Stellungskonzepte. Bei ähnlichen Stellungen darf
er nur eine als `structural_concept` freigegebene Erkenntnis übertragen, deren
Pflichtkonzept auch in der Zielstellung erkannt wird. Unterschiede,
Gegenpläne und Abbruchbedingungen bleiben sichtbar; bei abweichender
taktischer Realität wird der Transfer gesperrt. Die konkrete Frage priorisiert
passende Themen wie Taktik, Entwicklung, Bauernstruktur oder Endspiel. Der
Coach formuliert die Hinweise eigenständig und passt ihre Sprache an die
eingestellte Elo-Stufe an. Die PGNs ersetzen keine Analyse:
Konkrete Zugempfehlungen, Varianten, Bewertungen und taktische Behauptungen
stammen weiterhin ausschließlich aus den geprüften Stockfish-Daten. Historische
PGN-Züge, Felder und Bewertungen werden nie auf eine nur ähnliche Stellung
übertragen.

Der Inhalt der Originaldateien wird nicht verändert; erfolgreich verarbeitete
Dateien wechseln lediglich aus `database/` nach `database/used/`. Der daraus
erzeugte Laufzeitindex enthält weder Rohkommentare noch Datei- oder Werktitel,
Autoren-, Spieler- oder Annotatornamen. Deterministische Fakten und neu
geschriebene Kommentar-Erkenntnisse werden in Eröffnung, Mittelspiel, Endspiel
oder Sonstiges einsortiert. Technische Hash-IDs sichern weiterhin
Deduplizierung und Reproduzierbarkeit, werden dem Coach aber nicht als
inhaltliche Quelle gezeigt.

Der Parser liest Kommentare, NAGs und verschachtelte Varianten.
`npm run pgn:training-export` erzeugt getrennte, anonymisierte und noch
ungeprüfte Trainingskandidaten; `npm run pgn:analyze` prüft priorisierte Kandidaten
fortsetzbar mit Stockfish. Automatisch erzeugt, automatisch verifiziert und
menschlich freigegeben bleiben getrennte Lebenszyklen. Details, aktuelle
Importzahlen und Grenzen stehen in [docs/coach-knowledge-pipeline.md](docs/coach-knowledge-pipeline.md).
Die aktuelle Prüfung des v7-Laufzeitwissens steht in
[reports/coach-corpus-evaluation.md](reports/coach-corpus-evaluation.md); die
getrennte Konzeptsuche dokumentiert
[reports/concept-transfer-evaluation.md](reports/concept-transfer-evaluation.md).

Der Lichess-Zugriff verwendet einen sicheren HTTP-only-Cookie, fordert keine
Spiel- oder Schreibrechte an und importiert ausschließlich abgeschlossene
Partien. Der OpenAI-Schlüssel bleibt ausschließlich auf dem Server. Chat-Anfragen
werden größenbegrenzt und nicht bei OpenAI gespeichert (`store: false`).
Das Standardmodell `gpt-5.6-luna` kann über `OPENAI_MODEL` überschrieben
werden.

### Automatischer 800-Elo-Coach-Audit

`npm run coach:audit:800` erzeugt 200 reproduzierbare legale Partien und prüft
jeden Halbzug mit lokalem Stockfish sowie der echten 800-Elo-Coach-Logik. Eine
zweite, tiefere Stichprobe kontrolliert anschließend auffällige Schachurteile.
Es entstehen keine KI-Kosten und es werden keine Feedbackformulare versendet.
Der verständliche Ergebnisbericht landet unter
`reports/coach-audit-800.md`; die maschinenlesbaren Details stehen daneben als
JSON. Der Bericht enthält nur klare Fehlerbeispiele und eine kleine Auswahl
besonders guter Erklärungen. Acht lokale Stockfish-Prozesse verkürzen den Lauf;
`reports/coach-audit-800-progress.json` hält den letzten sicheren Zwischenstand
fest.

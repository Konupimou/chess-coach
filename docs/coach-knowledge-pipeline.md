# Coach-Wissenspipeline

## Zweck und Sicherheitsgrenze

Die PGN-Sammlung liefert Stellungen und daraus deterministisch neu berechnete
Brettfakten. Übertragbare strategische Pläne stammen ausschließlich aus dem
getrennten kuratierten Konzeptkatalog. Stockfish bleibt die maßgebliche Quelle
für konkrete Zugbewertung, Varianten und taktische Aussagen. Importierte
Kommentare gelten nie allein deshalb als wahr, weil sie in einer PGN-Datei
stehen, und gelangen nicht als freie Prosa in das Laufzeitwissen.

Die drei Wissensstufen bleiben technisch getrennt:

1. `generated`: aus den Originalquellen abgeleitet, automatisch strukturiert,
   zusammengefasst und anonymisiert, aber noch nicht sachlich bestätigt.
2. `automatically_verified`: ein enger Brettfakt wurde aus FEN und legalem Zug
   mit `chess.js` erneut berechnet. In einem getrennten optionalen
   Trainingsbestand kann der Status außerdem bedeuten, dass Stockfish eine
   konkrete Empfehlung bei identischem Suchlimit bestätigt oder als kompatibel
   eingestuft hat; rein strategische Aussagen bleiben dort `strategic_only`.
3. `human_approved`: ein benannter Mensch hat einen kompatiblen oder bestätigten
   Datensatz freigegeben. Konflikte und ungültige Datensätze können nicht
   freigegeben werden.

Generierte Coach-Antworten werden nicht als Trainingswahrheit zurück in den
Bestand geschrieben.

## Import und Datenmodell

`database/` ist der Eingang für neue `.pgn`- und `.txt`-Dateien;
`database/used/` ist das Quellenarchiv. `npm run pgn:index` liest beide Ordner,
damit spätere Neuaufbauten das bereits verarbeitete Wissen behalten. Neue
Eingangsdateien werden erst nach dem erfolgreichen Schreiben des Laufzeitindex
und eines optionalen Trainingsexports nach `used/` verschoben. Scheitert Lesen,
Verarbeiten oder Schreiben fatal, bleiben die betreffenden Quellen im Eingang.
`--keep-sources` schaltet das Verschieben für einen bewussten Diagnoselauf ab.

Das Archivieren arbeitet ausschließlich mit der exakten Liste der im Lauf
erreichten Quellen. Es überschreibt keine vorhandene Datei: Bytegleiche Quellen
werden anhand von SHA-256 dedupliziert, verschiedene gleichnamige Quellen
erhalten einen deterministischen Hash-Suffix. Auch bei einem Wechsel des
Dateisystems wird zunächst kopiert, synchronisiert und per Hash geprüft; erst
danach wird die Eingangsdatei entfernt.

Der Parser liest Hauptvarianten und verschachtelte Nebenvarianten, Kommentare
vor und nach einem Zug, numerische und symbolische NAGs, Start-FENs, SAN/UCI
wie FEN vor und nach dem Zug. Der Dateiinhalt bleibt unverändert. Der produktive
Laufzeitindex übernimmt keine frei formulierten Kommentare. Er erzeugt nur
kurze Fakten, die sich aus FEN und legalem Zug erneut berechnen lassen. Datei-
und Werktitel, Autoren-, Spieler- und Annotatornamen gelangen dadurch nicht in
das Laufzeitwissen. Fehler in einer Partie werden protokolliert; sie brechen
den Gesamtimport nicht ab.

Bytegleiche Dateien, doppelte Partien, doppelte Datensätze und gleiche
Kommentare an derselben Stellung werden dedupliziert. Pro Quelldatei entsteht
ein SHA-256-basierter Cache unter `.cache/coach-pgn/`. Dadurch ist ein erneuter
Import fortsetzbar und deterministisch. Der produktive Laufzeitindex enthält
keine vollständigen Trainingsdatensätze, keine Rohprosa und keine lesbaren
Quellenangaben, sondern deterministische Brettfakten, technische IDs, Phasen,
Profile und Such-Buckets.

Die aktuelle Sammlung wurde vollständig ohne Gesamtlimit verarbeitet:

- 139 gefundene Dateien, 134 eindeutige Quellen und 5 Dateiduplikate
- 128.747 gelesene Partien, davon 9.187 mit Annotationen
- 55.908 untersuchte Kommentare; 30.016 freie Rohtexte bleiben quarantänisiert
- 20.418 deterministisch geprüfte Fakten an 19.163 Stellungen
- davon 8.093 Eröffnung, 9.764 Mittelspiel und 2.561 Endspiel
- 6.337 Fakten aus Nebenvarianten, 4.845 NAGs und 20.418 strukturierte Claims
- 8.626 ungültige Partien und 3.170 gespeicherte Parserfehler; diese werden
  nicht stillschweigend als verlässliches Wissen behandelt
- 17 doppelte Partien erkannt

Alle gefundenen PGN-Dateien wurden verarbeitet. „Vollständig“ bedeutet hier
nicht, dass jeder historische Kommentar als wahr gilt: Nur die 20.418 erneut
berechenbaren Fakten sind im produktiven Index; die übrige Prosa bleibt bewusst
außerhalb der Coach-Antworten.

## Automatische Strukturierung und Stockfish-Prüfung

Der Originalkommentar bleibt ausschließlich in der unveränderten PGN-Quelle
erhalten. Ein optionaler Trainingsexport kann daraus anonymisierte Kandidaten
mit Prüfstatus erzeugen; diese Kandidaten sind strikt vom produktiven
Laufzeitindex getrennt und werden dem Coach nicht angezeigt. Der Laufzeitindex
speichert nur neu berechnete Brettfakten mit technischer Datensatz-ID,
Konfidenz, Prüfstatus und dem Geltungsbereich `exact_position_move`.

```bash
npm run pgn:training-export
npm run pgn:analyze -- --depth=12 --multipv=3 --limit=100
```

Die Batch-Analyse ist fortsetzbar: bereits vorhandene `recordId`s in der
JSONL-Ausgabe werden übersprungen. Kommentierte Züge mit konkreter Alternative,
Bewertung oder Gefahr werden zuerst geprüft. Bester Zug und gespielter bzw.
empfohlener Zug erhalten dasselbe Tiefenlimit. Abweichungen bis 20 cp gelten als
äquivalent, bis 70 cp als kompatibel; größere konkrete Widersprüche werden als
`conflicting` markiert und bleiben außerhalb eines freigegebenen Bestands.

Die Stockfish-Prüfung bleibt für spätere Trainingskandidaten verfügbar. Solche
Kandidaten werden erst nach bestandener Prüfung in einen getrennten,
freigegebenen Bestand übernommen. Der produktive Index benötigt diesen Schritt
nicht, weil seine engen Fakten direkt mit `chess.js` aus Stellung und legalem
Zug rekonstruiert und beim Indexcheck nochmals verglichen werden.

Zusätzlich erzeugt der Importer sehr enge Brettfakten direkt aus FEN und einem
legalen PGN-Zug. Dazu zählen Entwicklung vom Ausgangsfeld, tatsächliche
Schläge, Schach, Matt, Rochade, Umwandlung und Bauern auf den vier
Zentrumsfeldern. Diese kurzen Sätze enthalten keinen Rohkommentar und keine
Personen- oder Quellenangabe. Sie tragen den Status `automatically_verified`
und den Geltungsbereich `exact_position_move`. Der Indexprüfer berechnet jeden
solchen Satz erneut aus Stellung und Zug. Schon eine abweichende Folgestellung
verhindert die Freigabe. Ein solcher Fakt bewertet den Zug ausdrücklich nicht.

## Konzeptsuche und Transfer

Jede Stellung erhält einen farb- und zugnormalisierten Fingerabdruck für Phase,
Bauernstruktur, Material, Königsstellung, offene Linien, Aktivität,
Schwachpunkte, kritische Felder und erkannte Konzepte. Diese Profile stammen aus
den PGN-Stellungen; Pläne, Gegenpläne und Abbruchbedingungen stammen dagegen aus
dem getrennten kuratierten Konzeptkatalog. Der Suchprozess ist mehrstufig:

1. Exakter EPD-/FEN-Treffer für zuggebundene PGN-Fakten.
2. Vorberechnete Buckets für kuratierte Bauernstrukturen, Konzepte und taktische
   Schlüssel.
3. Vergleich der Kandidaten nach Struktur und Konzeptbedingungen.
4. Ausgabe nur eines im kuratierten Konzeptwissen ausdrücklich übertragbaren
   Plans samt Voraussetzungen, Unterschieden, Gegenplänen und Abbruchbedingungen.

Eine ähnliche Optik reicht nicht. Unterschiedliche taktische Schlüssel sperren
den Transfer. Historische PGN-Fakten, Züge, Felder und Bewertungen werden nie
auf eine ähnliche Stellung kopiert. Für eine Zugerklärung wird getrennt vor dem
Zug, nach dem gespielten Zug und nach bis zu drei Engine-Alternativen gesucht.

Der Coach erhält diese Felder zusammen mit Stockfish und erzeugt ein festes
Lernschema: `assessment`, `type`, `idea`, `what_was_good`, `problem`, `danger`,
`better_move`, `why_better`, `comparison_line`, `lesson`, `confidence`.

## Evaluation, Betrieb und Rollback

```bash
npm run pgn:check
npm run pgn:evaluate
npm test
npm run build
```

Die deterministische Evaluation enthält positive und negative Fälle für 26
Konzeptgruppen und einen gesonderten Taktik-Mismatch-Test. Der reale
Index-Benchmark mutiert indexierte Stellungen mit einem legalen Zug und prüft
nur Stellungen, die nicht exakt im Index vorkommen. Das Ziel ist p95 unter
300 ms. Einzelne kalte Ausreißer werden separat als `maxMs` ausgewiesen.

Der Index ist eine reproduzierbare JSON-Datei mit `version: 6`; es war keine
SQL-Migration nötig. Ein Rollback besteht darin, die vorherige Indexdatei und
den dazu passenden Code wieder bereitzustellen. Caches und Trainings-/Analyse-
Artefakte sind abgeleitet, ignoriert und können ohne Verlust der PGN-Quellen neu
erzeugt werden.

## Bekannte Grenzen

- Nicht jede Katalogidee besitzt schon einen zuverlässigen Brettdetektor. Die
  Tests decken das Transferprotokoll für 26 Gruppen ab; im aktuellen Korpus
  werden 19 dieser Kataloggruppen automatisch erkannt.
- Automatische Mustererkennung ist kein Ersatz für taktische Berechnung.
- Die gesamte PGN-Sammlung ist eingelesen, aber freie historische Kommentare
  bleiben bis zu einer gesonderten Verifikation außerhalb des Laufzeitindex.
- Zuggebundene PGN-Fakten gelten ausschließlich bei exakter Stellung und exakt
  passendem legalen Zug; strategischer Transfer stammt aus dem getrennten,
  kuratierten Konzeptwissen.
- Training/Fine-Tuning ist erst nach ausreichender automatischer Prüfung und
  menschlicher Freigabe sinnvoll. Die derzeitige Retrieval-Pipeline ist dafür
  die transparentere und sicherere Lösung.

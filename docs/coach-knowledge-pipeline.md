# Coach-Wissenspipeline

## Zweck und Sicherheitsgrenze

Die PGN-Sammlung liefert menschliche Erklärungen und übertragbare strategische
Muster. Stockfish bleibt die maßgebliche Quelle für konkrete Zugbewertung,
Varianten und taktische Aussagen. Importierte Kommentare gelten nie allein
deshalb als wahr, weil sie in einer PGN-Datei stehen.

Die drei Wissensstufen bleiben technisch getrennt:

1. `generated`: aus den Originalquellen abgeleitet, automatisch strukturiert,
   zusammengefasst und anonymisiert, aber noch nicht sachlich bestätigt.
2. `automatically_verified`: eine konkrete Empfehlung wurde bei identischem
   Suchlimit von Stockfish bestätigt oder als kompatibel eingestuft; rein
   strategische Aussagen werden ausdrücklich als `strategic_only` markiert.
3. `human_approved`: ein benannter Mensch hat einen kompatiblen oder bestätigten
   Datensatz freigegeben. Konflikte und ungültige Datensätze können nicht
   freigegeben werden.

Generierte Coach-Antworten werden nicht als Trainingswahrheit zurück in den
Bestand geschrieben.

## Import und Datenmodell

`npm run pgn:index` verarbeitet `.pgn`- und `.txt`-Dateien in `database/`.
Der Parser liest Hauptvarianten und verschachtelte Nebenvarianten, Kommentare
vor und nach einem Zug, numerische und symbolische NAGs, Start-FENs, SAN/UCI
sowie FEN vor und nach dem Zug. Die Original-PGNs bleiben unverändert. In den
abgeleiteten Laufzeit- und Trainingsartefakten werden Kommentare knapp
zusammengefasst; Datei- und Werktitel, Autoren-, Spieler- und Annotatornamen
werden entfernt. Fehler in einer Partie werden protokolliert; sie brechen den
Gesamtimport nicht ab.

Bytegleiche Dateien, doppelte Partien, doppelte Datensätze und gleiche
Kommentare an derselben Stellung werden dedupliziert. Pro Quelldatei entsteht
ein SHA-256-basierter Cache unter `.cache/coach-pgn/`. Dadurch ist ein erneuter
Import fortsetzbar und deterministisch. Der produktive Laufzeitindex enthält
keine vollständigen Trainingsdatensätze und keine lesbaren Quellenangaben,
sondern kompakte Zusammenfassungen, technische IDs, Phasen, Profile und
Such-Buckets.

Die aktuelle Sammlung wurde bis zum bewusst gesetzten Produktlimit verarbeitet:

- 102 gefundene Dateien, 77 bis zum Limit verarbeitete eindeutige Quellen
- 119.742 gelesene Partien, davon 5.123 mit Annotationen
- 25.000 indexierte Zusammenfassungen an 21.741 Stellungen
- davon 10.527 Eröffnung, 11.635 Mittelspiel und 2.838 Endspiel
- 8.171 Datensätze aus Nebenvarianten, 7.925 NAGs und 25.435 strukturierte Claims
- 7.555 fehlerhafte Partien und 1.846 gespeicherte Parserfehler; diese werden
  nicht stillschweigend als verlässliches Wissen behandelt
- 2 bytegleiche Quelldateien und 6 doppelte Partien erkannt

Die Zahlen beschreiben den Lauf bis zum Limit von 25.000 Kommentaren, nicht eine
Behauptung, jede Datei der Sammlung vollständig ausgewertet zu haben.

## Automatische Strukturierung und Stockfish-Prüfung

Der Originalkommentar bleibt ausschließlich in der unangetasteten PGN-Quelle
erhalten. Das abgeleitete Artefakt speichert eine anonymisierte Kurzfassung und
ein kontrolliertes Schema für Zugbewertung, Idee, taktisches/strategisches
Motiv, unmittelbare und langfristige Gefahr, kritisierte Eigenschaft,
Stellungsfolge, Lernprinzip, Alternative und konkrete Variante. Jede abgeleitete
Aussage trägt eine technische Datensatz-ID, einen bereinigten Textausschnitt,
Konfidenz und Prüfstatus.

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

Ein technischer Stichprobenlauf mit Stockfish 18, MultiPV 3 und Tiefe 8 hat 20
priorisierte Datensätze vollständig verarbeitet: 1 kompatibel, 3 rein
strategisch und 16 mangels konkreter Empfehlung weiterhin ungeprüft. Es gab in
dieser kleinen Stichprobe keinen automatisch bestätigten, konfliktären oder
ungültigen Datensatz. Diese Stichprobe ist ein Pipeline-Test, keine
Qualitätsaussage über alle 25.000 Einträge.

## Konzeptsuche und Transfer

Jede Stellung erhält einen farb- und zugnormalisierten Fingerabdruck für Phase,
Bauernstruktur, Material, Königsstellung, offene Linien, Aktivität,
Schwachpunkte, kritische Felder und erkannte Konzepte. Der Suchprozess ist
mehrstufig:

1. Exakter EPD-/FEN-Treffer.
2. Vorberechnete Buckets für Bauernstruktur, Konzept und taktischen Schlüssel.
3. Vergleich der Kandidaten nach Struktur und Konzeptbedingungen.
4. Ausgabe nur des ausdrücklich übertragbaren Plans, seiner Voraussetzungen,
   konkreter Unterschiede, Gegenpläne und Abbruchbedingungen.

Eine ähnliche Optik reicht nicht. Unterschiedliche taktische Schlüssel sperren
den Transfer. Historische Züge, Felder und Bewertungen werden nicht auf die
aktuelle Stellung kopiert. Für eine Zugerklärung wird getrennt vor dem Zug, nach
dem gespielten Zug und nach bis zu drei Engine-Alternativen gesucht.

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

Der Index ist eine reproduzierbare JSON-Datei mit `version: 5`; es war keine
SQL-Migration nötig. Ein Rollback besteht darin, die vorherige Indexdatei und
den dazu passenden Code wieder bereitzustellen. Caches und Trainings-/Analyse-
Artefakte sind abgeleitet, ignoriert und können ohne Verlust der PGN-Quellen neu
erzeugt werden.

## Bekannte Grenzen

- Nicht jede Katalogidee besitzt schon einen zuverlässigen Brettdetektor. Die
  Tests decken das Transferprotokoll für 26 Gruppen ab; im aktuellen Korpus
  werden 19 dieser Kataloggruppen automatisch erkannt.
- Automatische Mustererkennung ist kein Ersatz für taktische Berechnung.
- Die gesamte Sammlung wurde wegen des Produktlimits noch nicht vollständig in
  den Laufzeitindex aufgenommen.
- Ein Voll-Lauf der Stockfish-Verifikation über 25.000 Datensätze ist bewusst
  nicht automatisch Teil von Build oder Test.
- Training/Fine-Tuning ist erst nach ausreichender automatischer Prüfung und
  menschlicher Freigabe sinnvoll. Die derzeitige Retrieval-Pipeline ist dafür
  die transparentere und sicherere Lösung.

# Chess Coach Benchmark

Der Benchmark beantwortet nach einer Coach-Änderung reproduzierbar die Frage: Hat sich der Coach verbessert oder nur anders formuliert?

## Schnellstart

```bash
npm run coach:benchmark
```

Der Quick-Lauf prüft alle 22 MVP-Stellungen mit jeweils einer realistischen Nutzerfrage. Er verwendet standardmäßig den lokalen, vollständig beleggebundenen Coach und verursacht weder OpenAI- noch neue Stockfish-Aufrufe.

Die bestehende v1 bleibt der unveränderte Regressionstest. Die getrennte v2 ist absichtlich deutlich schwerer und soll Schwachstellen sichtbar machen, nicht einen hohen Score produzieren:

```bash
# Unveränderte v1-Regression
npm run coach:benchmark:v1

# Schwierige v2 mit einer Frage je Stellung
npm run coach:benchmark:v2

# Schwierige v2 mit allen vorgesehenen Fragen
npm run coach:benchmark:v2:full

# Beide Quick-Suites nacheinander
npm run coach:benchmark:regression
```

Weitere Varianten:

```bash
# Alle vorgesehenen Fragetypen
npm run coach:benchmark:full

# Nur taktische Fälle
npm run coach:benchmark -- --category=tactics

# Nur die schlechtesten Fälle des letzten Laufs
npm run coach:benchmark -- --failures

# Eine kleine Teilmenge
npm run coach:benchmark -- --limit=5

# Tatsächliche KI-Antworten testen
npm run coach:benchmark -- --ai

# Zusätzlich subjektive Qualität durch ein separates Modell bewerten
npm run coach:benchmark -- --ai --judge

# Gegen einen bestimmten älteren Lauf vergleichen
npm run coach:benchmark -- --baseline=reports/benchmarks/RUN.json
```

`--ai` und `--judge` benötigen `OPENAI_API_KEY`. Das Modell des Coachs kommt aus `OPENAI_MODEL`; der getrennte Judge kann mit `OPENAI_EVAL_MODEL` festgelegt werden. Der Judge verwendet einen strikten JSON-Schema-Output und `store: false`. Das entspricht der offiziellen Empfehlung, für maschinenlesbare Modellausgaben Structured Outputs über `text.format` zu verwenden: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Aktuelle Architektur

Der Benchmark erzeugt keine parallele Schachlogik. Jeder Fall durchläuft die produktive Pipeline:

```text
serialisierter Benchmarkfall
  → normalisierter Stockfish-Kontext
  → positionEvidence mit legal geprüften Vorher-/Nachher- und PV-Daten
  → patternRecognition
  → positionDiagnosis
  → lokaler oder KI-basierter Coach
  → deterministische Prüfung
  → optionaler LLM-Judge
  → Score, Vergleich und Failure-Report
```

Die eingefrorenen Engine-Linien sorgen dafür, dass zwei Versionen exakt dieselben Schachsituationen sehen. Neue Stockfish-Analysen passieren nur beim Erzeugen neuer PGN-Kandidaten.
Innerhalb eines Laufs wird der deterministische Kontext einer Stellung einmal gebaut und für alle Fragetypen wiederverwendet.

## Datensatz und Schema

Der MVP-Datensatz liegt unter `data/benchmarks/coach-benchmark-v1.json`. Er enthält:

- 18 kontrollierte und legal geprüfte Fälle aus dem bestehenden Evaluationsbestand
- 4 automatisch mit Stockfish extrahierte Stellungen aus einer echten kommentierten Partie
- taktische, positionelle, materielle, Königssicherheits-, Bauernstruktur-, Entwicklungs-, Aktivitäts-, Endspiel-, ruhige und unsichere Fälle
- mehrere Schwierigkeitsstufen
- neun realistische Fragetypen

`data/benchmarks/coach-benchmark-v2.json` enthält zusätzlich 25 kuratierte, kommentierte Meisterstellungen. Ihr Schwerpunkt liegt auf Multi-Factor-Entscheidungen, ruhigen Engine-Zügen, aktiver und passiver Prophylaxe, Kompensation, Initiative, Einschränkung gegnerischen Spiels, komplexen Endspielen und Stellungen ohne sauber isolierbares Einzelmotiv. Die Engine-Fakten wurden lokal mit Stockfish 18 bei Tiefe 14 und MultiPV 4 eingefroren. Die Quellkommentare werden nicht im Datensatz gespeichert und dem Coach nicht gezeigt.

Ein Fall hat diese Struktur:

```js
{
  id,
  fenBefore,
  fenAfter,
  playedMove: { uci, san },
  engine: {
    provider,
    depth,
    bestMove,
    lossCp,
    quality,
    lines,
    playedLine
  },
  expected: {
    categories,
    possibleConcepts,
    reasonMode,
    requiredConceptGroups,
    requiredFacts,
    needsReview,
    expectNoPrimaryReason,
    groundTruth
  },
  source,
  difficulty,
  questionIds,
  metadata
}
```

Es werden bewusst keine erwarteten Coach-Texte gespeichert. Dadurch misst der Benchmark Schachinhalt statt Wortgleichheit.

In v2 beschreibt `requiredConceptGroups` mehrere voneinander unabhängige Aspekte einer Stellung. Ein Fall kann beispielsweise gleichzeitig das gegnerische Gegenspiel verhindern, die eigene schlechteste Figur verbessern und die Initiative erhalten. Die Auswertung misst deshalb getrennt:

- ob diese Faktoren im Diagnosis Layer vorkommen,
- ob der sichtbare Coach sie tatsächlich erklärt,
- und ob einer der vertretbaren Hauptgründe priorisiert wird.

Ein einzelnes erkanntes Schlagwort reicht in v2 nicht für volle Hauptgrundpunkte. Fehlende Aspekte erscheinen als `missing_diagnosis_factor:*` beziehungsweise `missing_explanation_factor:*` im Report.

## Objektive Prüfungen

`coachBenchmark.js` prüft ohne Judge:

- Legalität des analysierten Zugs und sämtlicher PVs
- Übereinstimmung von FEN vor/nach dem Zug
- Zugrecht und Engine-Bestzug
- Vollständigkeit der produktiven Evidenz
- erforderliche Brett- und Variantenfakten
- erfundene oder nicht gelieferte Züge
- nicht belegte Brettbehauptungen
- nicht belegte Bewertungen
- erwarteten Hauptgrund der Diagnose
- konkrete, zur Nutzerfrage passende Erklärung
- Diagnosekonfidenz und Kalibrierung

Eine konkrete Halluzination, ein illegaler Kontext oder ein Engine-Widerspruch deckelt den Gesamtscore auf 35 Punkte. Eine selbstsicher falsche Diagnose erhält zusätzlich einen Abzug.

## Gewichtung

Der objektive Score verwendet:

| Bereich | Gewicht |
| --- | ---: |
| Zuglegalität | 18 % |
| Evidenzintegrität | 17 % |
| Keine Halluzination | 20 % |
| Engine-Konsistenz | 15 % |
| Richtiger Hauptgrund | 20 % |
| Antwortet auf die Frage | 5 % |
| Stellungsspezifität | 5 % |

Wenn der optionale Judge läuft, bestimmt die objektive Prüfung weiterhin 80 % des Scores. Der Judge steuert höchstens 20 % aus Hauptgrund, Spezifität, Klarheit, Lehrwert und Relevanz bei. Harte objektive Fehler behalten unabhängig davon ihren Score-Deckel.

## Konfidenzkalibrierung

Der Report unterscheidet:

- selbstsicher richtig
- selbstsicher falsch
- unsicher richtig
- unsicher falsch

Zusätzlich werden Brier-Score und Expected Calibration Error ausgegeben. Automatisch erzeugte, noch ungeprüfte PGN-Fälle sind davon ausgeschlossen.

## Ergebnisse und Vergleiche

Jeder gespeicherte Lauf erzeugt:

```text
reports/benchmarks/RUN.json
reports/benchmarks/RUN.md
reports/coach-benchmark-latest.json
reports/coach-benchmark-v2-latest.json
```

v1 und v2 führen getrennte Latest-Dateien und werden niemals automatisch gegeneinander verglichen. Ist für dieselbe Suite bereits ein letzter Lauf vorhanden, wird er automatisch als Baseline verwendet. Der Report zeigt:

- Gesamtscore und Schachgenauigkeit
- Hauptgrundquote und Halluzinationsrate
- Faktorabdeckung in Diagnose und sichtbarer Erklärung
- Werte nach Kategorie, Schwierigkeit, Frage und Quelle
- Kategorieverbesserungen und -regressionen
- konkrete Fälle mit mindestens fünf Punkten Rückgang
- schlechteste Antworten samt Diagnose und Fehlercodes

Mit `--strict` schlägt der Prozess bei schweren Schachfehlern oder Regressionen fehl und kann später als CI-Gate verwendet werden.

Die v2-Engine-Fakten lassen sich reproduzierbar neu erzeugen:

```bash
npm run coach:benchmark:v2:dataset
```

Das überschreibt ausschließlich die v2-Datei. Die v1-Datei wird dabei weder gelesen noch verändert.

## Neue PGN-Kandidaten erzeugen

```bash
npm run coach:benchmark:pgn -- \
  --input="database/used/eine-datei.pgn" \
  --limit=5 \
  --depth=10
```

Der Generator:

1. liest kommentierte Hauptvarianten,
2. priorisiert NAGs und taktisch/strategisch kommentierte Momente,
3. analysiert Bestzug und gespielten Zug mit lokalem Stockfish,
4. speichert die Linien in einem wiederverwendbaren Cache,
5. berechnet Stellungs- und Diagnoseevidenz,
6. entfernt Spielernamen und Rohkommentare,
7. markiert automatisch abgeleitete Fälle mit `needsReview: true`.

Danach wird der stabile Datensatz neu gebaut:

```bash
npm run coach:benchmark:dataset
```

Erst nach menschlicher Prüfung sollten bei einem PGN-Fall `needsReview` entfernt und die akzeptablen `possibleConcepts` bestätigt werden. Bis dahin misst der Fall Legalität, Engine-Konsistenz, Halluzinationen und Erklärungsspezifität, aber nicht die Hauptgrundquote.

## Benchmark-Kontamination

Der Runner baut zuerst den normalen Coach-Kontext auf. Erst nachdem die Antwort erzeugt wurde, liest die Bewertungsseite `expected`. Weder erwartete Konzepte noch Kategorien oder Fehlerlabels gelangen in den Coach-Prompt. Der optionale Judge darf geprüfte Erwartungen sehen; der getestete Coach niemals.

Benchmarkdateien bleiben von Trainingsdaten, Coach-Beispielen und RAG-Dokumenten getrennt. Ein Benchmarkfall darf erst nach einer bewussten Entscheidung als Trainingsbeispiel verwendet werden.

## Ausbau auf 100+ Fälle

Das Schema ist bereits für weitere Dateien und Quellen ausgelegt. Sinnvolle nächste Schritte sind:

1. PGN-Kandidaten über verschiedene Partiephasen und Quellen ziehen.
2. Nur unsichere automatisch erzeugte Labels prüfen, statt alle Positionen manuell zu bewerten.
3. Nach der Prüfung Quelle, Kategorie und Schwierigkeit ausgewogen erweitern.
4. Einen günstigen Quick-Datensatz und einen größeren periodischen Full-Datensatz getrennt halten.
5. Erst bei stabilen Baselines feste CI-Schwellen aktivieren.

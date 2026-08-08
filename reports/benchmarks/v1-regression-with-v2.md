# Chess Coach Benchmark

Run: `v1-regression-with-v2` · Datensatz: `coach-benchmark-v1` · Coach: `local` · Judge: `aus`

## Ergebnis

- Antworten: 22
- Gesamt: **99.00** (+5.57)
- Schachgenauigkeit: 100.00 (+0.00)
- Hauptgrund erkannt: 100.00 % (+70.59)
- Halluzinationsrate: 0.00 % (+0.00)
- Schwere Fehler: 0.00 %
- Diagnose-Faktorabdeckung: –
- Erklärungs-Faktorabdeckung: –
- Fehlerfälle: 0

## Kategorien

| Kategorie | Fälle | Score | Änderung | Halluzination | Hauptgrund | Diagnose-Faktoren | Erklärungs-Faktoren |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BLUNDER | 3 | 99.42 | +3.42 | 0.00 % | 100.00 % | – | – |
| DEVELOPMENT | 2 | 99.13 | +8.50 | 0.00 % | 100.00 % | – | – |
| ENDGAME | 2 | 98.25 | +15.00 | 0.00 % | 100.00 % | – | – |
| KING_SAFETY | 4 | 99.13 | +4.25 | 0.00 % | 100.00 % | – | – |
| MATERIAL | 5 | 99.65 | +4.10 | 0.00 % | 100.00 % | – | – |
| MATING_ATTACK | 2 | 98.25 | +4.25 | 0.00 % | 100.00 % | – | – |
| MISSED_OPPORTUNITY | 2 | 100.00 | +0.00 | 0.00 % | – | – | – |
| MULTI_FACTOR | 2 | 100.00 | +5.13 | 0.00 % | 100.00 % | – | – |
| PAWN_STRUCTURE | 2 | 99.13 | +8.50 | 0.00 % | 100.00 % | – | – |
| PIECE_ACTIVITY | 3 | 98.25 | +10.00 | 0.00 % | 100.00 % | – | – |
| POSITIONAL | 6 | 98.45 | +5.96 | 0.00 % | 100.00 % | – | – |
| QUIET_MOVE | 8 | 98.40 | +8.22 | 0.00 % | 100.00 % | – | – |
| TACTICAL | 10 | 99.26 | +3.79 | 0.00 % | 100.00 % | – | – |
| UNCERTAIN | 1 | 98.25 | +8.50 | 0.00 % | 100.00 % | – | – |

## Kalibrierung der Diagnose

- Bewertete Diagnosen: 17
- Brier-Score: 0.0769 (kleiner ist besser)
- Expected Calibration Error: 0.1894 (kleiner ist besser)
- Selbstsicher falsch: 0

## Wichtigste Fehler

Keine Fehlerfälle.

## Regressionen

Keine Regression von mindestens 5 Punkten.

## Verbesserungen

- controlled-endgame-king-centralization · why_best: 76.75 → 98.25 (+21.50)
- controlled-tactic-knight-fork · why_best: 89.75 → 100.00 (+10.25)
- controlled-strategy-prophylaxis · why_best: 89.75 → 100.00 (+10.25)
- controlled-tactic-mate-threat · why_bad: 89.75 → 98.25 (+8.50)
- controlled-tactic-pin · why_best: 91.50 → 100.00 (+8.50)
- controlled-strategy-missed-castle · why_bad: 91.50 → 100.00 (+8.50)
- controlled-strategy-pawn-break · why_best: 91.50 → 100.00 (+8.50)
- controlled-strategy-outpost · why_best: 89.75 → 98.25 (+8.50)
- controlled-endgame-passed-pawn · why_best: 89.75 → 98.25 (+8.50)
- controlled-opening-poor-development · why_bad: 89.75 → 98.25 (+8.50)
- controlled-tactic-zwischenzug · why_best: 89.75 → 98.25 (+8.50)
- controlled-quiet-no-reliable-motif · why_best: 89.75 → 98.25 (+8.50)

## Methodik

- Engine-Linien, FEN und Züge werden deterministisch geprüft. Der Benchmark startet standardmäßig keine neue Stockfish-Analyse.
- Erwartete Konzepte werden dem Coach nie übergeben.
- Automatisch erzeugte PGN-Fälle mit `needsReview` zählen noch nicht zur Hauptgrundquote.
- Ein illegaler Kontext, Engine-Widerspruch oder eine konkrete Halluzination deckelt den Gesamtscore auf 35 Punkte.
- Der optionale LLM-Judge bestimmt höchstens 20 % des Scores; objektive Schachfehler behalten den harten Deckel.

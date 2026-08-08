# Chess Coach Benchmark

Run: `primary-reason-coach-fix` · Datensatz: `coach-benchmark-v1` · Coach: `local` · Judge: `aus`

## Ergebnis

- Antworten: 22
- Gesamt: **81.43** (-12.00)
- Schachgenauigkeit: 93.18 (-6.82)
- Hauptgrund erkannt: 94.12 % (+64.71)
- Halluzinationsrate: 27.27 % (+27.27)
- Schwere Fehler: 27.27 %
- Fehlerfälle: 6

## Kategorien

| Kategorie | Fälle | Score | Änderung | Halluzination | Hauptgrund |
| --- | ---: | ---: | ---: | ---: | ---: |
| BLUNDER | 3 | 99.42 | +3.42 | 0.00 % | 100.00 % |
| DEVELOPMENT | 2 | 99.13 | +8.50 | 0.00 % | 100.00 % |
| ENDGAME | 2 | 35.00 | -48.25 | 100.00 % | 50.00 % |
| KING_SAFETY | 4 | 99.13 | +4.25 | 0.00 % | 100.00 % |
| MATERIAL | 5 | 86.65 | -8.90 | 20.00 % | 100.00 % |
| MATING_ATTACK | 2 | 98.25 | +4.25 | 0.00 % | 100.00 % |
| MISSED_OPPORTUNITY | 2 | 100.00 | +0.00 | 0.00 % | – |
| MULTI_FACTOR | 2 | 100.00 | +5.13 | 0.00 % | 100.00 % |
| PAWN_STRUCTURE | 2 | 35.00 | -55.63 | 100.00 % | 100.00 % |
| PIECE_ACTIVITY | 3 | 77.17 | -11.08 | 33.33 % | 66.67 % |
| POSITIONAL | 6 | 87.62 | -4.88 | 16.67 % | 100.00 % |
| QUIET_MOVE | 8 | 82.37 | -7.81 | 25.00 % | 85.71 % |
| TACTICAL | 10 | 79.76 | -15.71 | 30.00 % | 100.00 % |
| UNCERTAIN | 1 | 98.25 | +8.50 | 0.00 % | 100.00 % |

## Kalibrierung der Diagnose

- Bewertete Diagnosen: 17
- Brier-Score: 0.0769 (kleiner ist besser)
- Expected Calibration Error: 0.1894 (kleiner ist besser)
- Selbstsicher falsch: 0

## Wichtigste Fehler

### 1. controlled-endgame-king-centralization · why_best · 35.00

- Erwartet: king_activity_endgame
- Diagnose: king_activity_endgame
- Problem: unsupported_board:Der Hauptgrund ist die Königsaktivität im Endspiel: Der König rückt nach e3 näher ans Zentrum, main_reason_not_explained

> Der Hauptgrund ist die Königsaktivität im Endspiel: Der König rückt nach e3 näher ans Zentrum. Damit stellst du deinen König nach e3. Er kontrolliert das Feld d4. Das ist hier die genaueste Wahl.

### 2. controlled-endgame-passed-pawn · why_best · 35.00

- Erwartet: passed_pawn
- Diagnose: passed_pawn
- Problem: unsupported_board:Der Hauptgrund ist der Freibauer auf c2: Sein Vormarsch bindet den gegnerischen König, language:long-sentence

> Der Hauptgrund ist der Freibauer auf c2: Sein Vormarsch bindet den gegnerischen König. dxc4 nimmt den Bauern. Das ist hier die genaueste Wahl.

### 3. controlled-strategy-pawn-break · why_best · 35.00

- Erwartet: pawn_break
- Diagnose: pawn_break
- Problem: unsupported_move:e5

> Der Hauptgrund ist der Bauernhebel gegen e5: Er greift die gegnerische Bauernkette an. f4 greift die Bauern auf e5 an. Das ist hier die genaueste Wahl.

### 4. controlled-tactic-knight-fork · why_best · 35.00

- Erwartet: fork, double_attack
- Diagnose: fork
- Problem: unsupported_board:Der Hauptgrund ist eine Gabel: Die angreifende Figur greift gleichzeitig König auf e8 und Turm auf a8 an, language:long-sentence

> Der Hauptgrund ist eine Gabel: Die angreifende Figur greift gleichzeitig König auf e8 und Turm auf a8 an. Nc7+ gibt dem gegnerischen König Schach. Das ist hier die genaueste Wahl. **Stärkste Antwort:** Danach folgt Kd7.

### 5. controlled-tactic-pin · why_best · 35.00

- Erwartet: pin
- Diagnose: pin
- Problem: unsupported_board:Der Hauptgrund ist die Fesselung: Der Läufer auf b5 bindet den Springer auf c6 an den König auf e8, language:long-sentence

> Der Hauptgrund ist die Fesselung: Der Läufer auf b5 bindet den Springer auf c6 an den König auf e8. Bb5 entwickelt den Läufer nach b5. Der Zug ist in dieser Eröffnung gut spielbar.

### 6. pgn-a2d6539cae1476faf03b-013 · why_best · 35.00

- Erwartet: needsReview
- Diagnose: fork
- Problem: unsupported_board:Der Hauptgrund ist eine Gabel: Die angreifende Figur greift gleichzeitig König auf f7 und Springer auf d5 an

> Der Hauptgrund ist eine Gabel: Die angreifende Figur greift gleichzeitig König auf f7 und Springer auf d5 an. Qf3+ gibt dem gegnerischen König Schach. Der Zug ist in dieser Eröffnung gut spielbar. **Stärkste Antwort:** Danach folgt Qf6.

## Regressionen

- pgn-a2d6539cae1476faf03b-013 · why_best: 97.81 → 35.00 (-62.81)
- controlled-tactic-pin · why_best: 91.50 → 35.00 (-56.50)
- controlled-strategy-pawn-break · why_best: 91.50 → 35.00 (-56.50)
- controlled-tactic-knight-fork · why_best: 89.75 → 35.00 (-54.75)
- controlled-endgame-passed-pawn · why_best: 89.75 → 35.00 (-54.75)
- controlled-endgame-king-centralization · why_best: 76.75 → 35.00 (-41.75)

## Verbesserungen

- controlled-strategy-prophylaxis · why_best: 89.75 → 100.00 (+10.25)
- controlled-tactic-mate-threat · why_bad: 89.75 → 98.25 (+8.50)
- controlled-strategy-missed-castle · why_bad: 91.50 → 100.00 (+8.50)
- controlled-strategy-outpost · why_best: 89.75 → 98.25 (+8.50)
- controlled-opening-poor-development · why_bad: 89.75 → 98.25 (+8.50)
- controlled-tactic-zwischenzug · why_best: 89.75 → 98.25 (+8.50)
- controlled-quiet-no-reliable-motif · why_best: 89.75 → 98.25 (+8.50)

## Methodik

- Engine-Linien, FEN und Züge werden deterministisch geprüft. Der Benchmark startet standardmäßig keine neue Stockfish-Analyse.
- Erwartete Konzepte werden dem Coach nie übergeben.
- Automatisch erzeugte PGN-Fälle mit `needsReview` zählen noch nicht zur Hauptgrundquote.
- Ein illegaler Kontext, Engine-Widerspruch oder eine konkrete Halluzination deckelt den Gesamtscore auf 35 Punkte.
- Der optionale LLM-Judge bestimmt höchstens 20 % des Scores; objektive Schachfehler behalten den harten Deckel.

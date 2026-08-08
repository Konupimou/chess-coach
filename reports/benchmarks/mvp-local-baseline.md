# Chess Coach Benchmark

Run: `mvp-local-baseline` · Datensatz: `coach-benchmark-v1` · Coach: `local` · Judge: `aus`

## Ergebnis

- Antworten: 22
- Gesamt: **93.43**
- Schachgenauigkeit: 100.00
- Hauptgrund erkannt: 29.41 %
- Halluzinationsrate: 0.00 %
- Schwere Fehler: 0.00 %
- Fehlerfälle: 12

## Kategorien

| Kategorie | Fälle | Score | Änderung | Halluzination | Hauptgrund |
| --- | ---: | ---: | ---: | ---: | ---: |
| BLUNDER | 3 | 96.00 | – | 0.00 % | 66.67 % |
| DEVELOPMENT | 2 | 90.63 | – | 0.00 % | 0.00 % |
| ENDGAME | 2 | 83.25 | – | 0.00 % | 0.00 % |
| KING_SAFETY | 4 | 94.88 | – | 0.00 % | 33.33 % |
| MATERIAL | 5 | 95.55 | – | 0.00 % | 60.00 % |
| MATING_ATTACK | 2 | 94.00 | – | 0.00 % | 50.00 % |
| MISSED_OPPORTUNITY | 2 | 100.00 | – | 0.00 % | – |
| MULTI_FACTOR | 2 | 94.88 | – | 0.00 % | 50.00 % |
| PAWN_STRUCTURE | 2 | 90.63 | – | 0.00 % | 0.00 % |
| PIECE_ACTIVITY | 3 | 88.25 | – | 0.00 % | 33.33 % |
| POSITIONAL | 6 | 92.49 | – | 0.00 % | 20.00 % |
| QUIET_MOVE | 8 | 90.18 | – | 0.00 % | 14.29 % |
| TACTICAL | 10 | 95.46 | – | 0.00 % | 42.86 % |
| UNCERTAIN | 1 | 89.75 | – | 0.00 % | 0.00 % |

## Kalibrierung der Diagnose

- Bewertete Diagnosen: 17
- Brier-Score: 0.0875 (kleiner ist besser)
- Expected Calibration Error: 0.1306 (kleiner ist besser)
- Selbstsicher falsch: 1

## Wichtigste Fehler

### 1. controlled-endgame-king-centralization · why_best · 76.75

- Erwartet: king_activity_endgame
- Diagnose: center_control
- Problem: wrong_primary_reason:center_control

> Damit stellst du deinen König nach e3. Er kontrolliert das Feld d4. Das ist hier die genaueste Wahl.

### 2. controlled-endgame-passed-pawn · why_best · 89.75

- Erwartet: passed_pawn
- Diagnose: passed_pawn
- Problem: main_reason_not_explained

> dxc4 nimmt den Bauern. Das ist hier die genaueste Wahl.

### 3. controlled-opening-poor-development · why_bad · 89.75

- Erwartet: development_advantage
- Diagnose: development_advantage
- Problem: main_reason_not_explained

> Damit entwickelst du den Springer nach a3. Dort hat er mehr mögliche Felder. Der Zug ist in dieser Eröffnung gut spielbar. **Merksatz:** Schau vor deinem Zug: Kann dein Gegner eine Figur schlagen?

### 4. controlled-quiet-no-reliable-motif · why_best · 89.75

- Erwartet: nur objektive Prüfung
- Diagnose: kein sicherer Hauptgrund
- Problem: main_reason_not_explained

> Kf2 stellt den König nach f2. Das ist hier die genaueste Wahl.

### 5. controlled-strategy-outpost · why_best · 89.75

- Erwartet: outpost
- Diagnose: outpost
- Problem: main_reason_not_explained

> Nd5 stellt die Figur geschützt nach d5. Das ist hier die genaueste Wahl.

### 6. controlled-strategy-prophylaxis · why_best · 89.75

- Erwartet: prophylaxis
- Diagnose: prophylaxis
- Problem: main_reason_not_explained

> g3 zieht den Bauern nach g3. Der Zug ist in dieser Eröffnung gut spielbar.

### 7. controlled-tactic-knight-fork · why_best · 89.75

- Erwartet: fork, double_attack
- Diagnose: fork
- Problem: main_reason_not_explained

> Nc7+ gibt dem gegnerischen König Schach. Das ist hier die genaueste Wahl. **Stärkste Antwort:** Danach folgt Kd7.

### 8. controlled-tactic-mate-threat · why_bad · 89.75

- Erwartet: mating_attack
- Diagnose: mating_attack
- Problem: main_reason_not_explained

> Damit bringst du deinen Bauern weiter nach vorne. Der Zug macht deine Stellung viel schlechter. **Alternative:** Nh3 ist besser.

### 9. controlled-tactic-zwischenzug · why_best · 89.75

- Erwartet: zwischenzug
- Diagnose: zwischenzug
- Problem: main_reason_not_explained

> a3 zieht den Bauern nach a3. Der Zug ist in dieser Eröffnung gut spielbar. **Stärkste Antwort:** Qxa3 nimmt deinen Bauern auf a3.

### 10. controlled-strategy-missed-castle · why_bad · 91.50

- Erwartet: discovered_attack, king_safety
- Diagnose: discovered_attack
- Problem: main_reason_not_explained

> Kf1 stellt den König nach f1. Das ist ein klarer Fehler. Deine Stellung wird dadurch deutlich schlechter. **Alternative:** Einziger haltender Zug: O-O rochiert kurz: Der König verlässt die Mitte und der Turm kommt ins Spiel. **Merksatz:** Schau vor deinem Zug kurz: Kann dein Gegner deinen König direkt angreifen?

## Methodik

- Engine-Linien, FEN und Züge werden deterministisch geprüft. Der Benchmark startet standardmäßig keine neue Stockfish-Analyse.
- Erwartete Konzepte werden dem Coach nie übergeben.
- Automatisch erzeugte PGN-Fälle mit `needsReview` zählen noch nicht zur Hauptgrundquote.
- Ein illegaler Kontext, Engine-Widerspruch oder eine konkrete Halluzination deckelt den Gesamtscore auf 35 Punkte.
- Der optionale LLM-Judge bestimmt höchstens 20 % des Scores; objektive Schachfehler behalten den harten Deckel.

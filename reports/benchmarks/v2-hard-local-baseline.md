# Chess Coach Benchmark

Run: `v2-hard-local-baseline` · Datensatz: `coach-benchmark-v2-hard` · Coach: `local` · Judge: `aus`

## Ergebnis

- Antworten: 25
- Gesamt: **63.68**
- Schachgenauigkeit: 99.00
- Hauptgrund erkannt: 4.00 %
- Halluzinationsrate: 4.00 %
- Schwere Fehler: 4.00 %
- Diagnose-Faktorabdeckung: 1.33 %
- Erklärungs-Faktorabdeckung: 1.33 %
- Fehlerfälle: 25

## Kategorien

| Kategorie | Fälle | Score | Änderung | Halluzination | Hauptgrund | Diagnose-Faktoren | Erklärungs-Faktoren |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| COMPENSATION | 5 | 55.40 | – | 0.00 % | 0.00 % | 0.00 % | 0.00 % |
| COMPLEX_ENDGAME | 5 | 78.18 | – | 0.00 % | 20.00 % | 6.67 % | 6.67 % |
| DEVELOPMENT | 2 | 57.63 | – | 0.00 % | 0.00 % | 0.00 % | 0.00 % |
| ENDGAME | 5 | 78.18 | – | 0.00 % | 20.00 % | 6.67 % | 6.67 % |
| INITIATIVE | 8 | 55.69 | – | 12.50 % | 0.00 % | 0.00 % | 0.00 % |
| KING_SAFETY | 3 | 67.83 | – | 0.00 % | 0.00 % | 0.00 % | 0.00 % |
| MATERIAL | 1 | 50.00 | – | 0.00 % | 0.00 % | 0.00 % | 0.00 % |
| MULTI_FACTOR | 24 | 63.41 | – | 4.17 % | 4.17 % | 1.39 % | 1.39 % |
| PIECE_ACTIVITY | 9 | 62.92 | – | 0.00 % | 0.00 % | 0.00 % | 0.00 % |
| POSITIONAL | 7 | 60.43 | – | 0.00 % | 0.00 % | 0.00 % | 0.00 % |
| PROPHYLAXIS | 9 | 62.36 | – | 11.11 % | 0.00 % | 0.00 % | 0.00 % |
| QUIET_MOVE | 18 | 65.83 | – | 5.56 % | 5.56 % | 1.85 % | 1.85 % |
| TACTICAL | 1 | 55.00 | – | 0.00 % | 0.00 % | 0.00 % | 0.00 % |
| UNCERTAIN | 2 | 56.13 | – | 0.00 % | 0.00 % | 0.00 % | 0.00 % |

## Kalibrierung der Diagnose

- Bewertete Diagnosen: 25
- Brier-Score: 0.6434 (kleiner ist besser)
- Expected Calibration Error: 0.7276 (kleiner ist besser)
- Selbstsicher falsch: 19

## Wichtigste Fehler

### 1. v2-aggressive-prophylaxis-qh8 · why_best · 35.00

- Erwartet: prophylaxis, initiative, piece_activity
- Diagnose: pin
- Problem: unsupported_board:Das Fesselungsmotiv ist der Hauptgrund, wrong_primary_reason:pin, missing_diagnosis_factor:prevention, missing_explanation_factor:prevention, missing_diagnosis_factor:initiative, missing_explanation_factor:initiative, missing_diagnosis_factor:activation, missing_explanation_factor:activation

> Das Fesselungsmotiv ist der Hauptgrund. Bei einer Fesselung ist die Figur nicht frei beweglich. Qh8 gibt die Dame auf h8 mehr Felder. Das ist hier die genaueste Wahl. **Stärkste Antwort:** Danach folgt Bf1. **Alternative:** Weitere Möglichkeit: N6d7 stellt den Springer nach d7.

### 2. v2-active-prophylaxis-queen-retreat · why_best · 50.00

- Erwartet: prophylaxis, piece_activity, restriction
- Diagnose: deflection
- Problem: wrong_primary_reason:deflection, missing_diagnosis_factor:prevention, missing_explanation_factor:prevention, missing_diagnosis_factor:activity, missing_explanation_factor:activity, language:empty

>

### 3. v2-compensation-queen-sacrifice · why_best · 50.00

- Erwartet: compensation, initiative, development_advantage, space_advantage
- Diagnose: fork
- Problem: wrong_primary_reason:fork, missing_diagnosis_factor:material_compensation, missing_explanation_factor:material_compensation, missing_diagnosis_factor:initiative, missing_explanation_factor:initiative, missing_diagnosis_factor:positional_assets, missing_explanation_factor:positional_assets, language:empty

>

### 4. v2-compensation-center-and-attack · why_best · 55.00

- Erwartet: compensation, initiative, piece_activity, center_control
- Diagnose: double_attack
- Problem: wrong_primary_reason:double_attack, missing_diagnosis_factor:compensation, missing_explanation_factor:compensation, missing_diagnosis_factor:initiative, missing_explanation_factor:initiative, missing_diagnosis_factor:activity, missing_explanation_factor:activity

> Der Hauptgrund: Die geprüfte Folge nach dem gespielten Zug bestätigt das taktische Motiv double_attack. Damit stellst du den Turm neu auf. Der Zug hält deine Stellung gut. **Alternative:** Bh6 ist besser.

### 5. v2-initiative-forcing-knight · why_best · 55.00

- Erwartet: initiative, mating_attack, prophylaxis
- Diagnose: fork
- Problem: wrong_primary_reason:fork, missing_diagnosis_factor:initiative, missing_explanation_factor:initiative, missing_diagnosis_factor:king_attack, missing_explanation_factor:king_attack, missing_diagnosis_factor:prevention, missing_explanation_factor:prevention

> Damit stellst du den Springer neu auf. Der Zug hält deine Stellung gut. **Alternative:** Nb5 ist besser.

### 6. v2-no-single-motif-queen-realignment · was_bad · 55.25

- Erwartet: piece_activity, coordination, prophylaxis
- Diagnose: fork
- Problem: wrong_primary_reason:fork, missing_diagnosis_factor:activity, missing_explanation_factor:activity, missing_diagnosis_factor:coordination, missing_explanation_factor:coordination, missing_diagnosis_factor:prevention, missing_explanation_factor:prevention

> Qe8 stellt die Dame nach e8. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Qf3. **Alternative:** Genauso gut: Rb8 gibt den Turm auf b8 mehr Felder.

### 7. v2-compensation-development-tempi · why_best · 56.75

- Erwartet: compensation, initiative, development_advantage, piece_activity
- Diagnose: double_attack
- Problem: wrong_primary_reason:double_attack, missing_diagnosis_factor:compensation, missing_explanation_factor:compensation, missing_diagnosis_factor:initiative, missing_explanation_factor:initiative, missing_diagnosis_factor:development, missing_explanation_factor:development

> Der Hauptgrund: Die geprüfte Folge nach dem gespielten Zug bestätigt das taktische Motiv double_attack. Nd2 stellt den Springer nach d2. Der Zug ist in dieser Eröffnung gut spielbar. **Stärkste Antwort:** Danach folgt Rb8.

### 8. v2-initiative-restricting-sacrifice · why_bad · 56.75

- Erwartet: compensation, initiative, restriction, pawn_break
- Diagnose: hanging_piece
- Problem: wrong_primary_reason:hanging_piece, missing_diagnosis_factor:compensation, missing_explanation_factor:compensation, missing_diagnosis_factor:initiative, missing_explanation_factor:initiative, missing_diagnosis_factor:restriction, missing_explanation_factor:restriction

> Der Hauptgrund ist die ungedeckte Figur auf d5: Sie kann unmittelbar angegriffen oder geschlagen werden. Damit stellst du den Springer neu auf. Der Zug hält deine Stellung gut. **Alternative:** Ne2 ist besser.

### 9. v2-multi-queen-three-jobs · was_bad · 57.00

- Erwartet: prophylaxis, restriction, coordination, piece_activity
- Diagnose: discovered_attack
- Problem: wrong_primary_reason:discovered_attack, missing_diagnosis_factor:prevention, missing_explanation_factor:prevention, missing_diagnosis_factor:coordination, missing_explanation_factor:coordination, missing_diagnosis_factor:activity, missing_explanation_factor:activity

> Der Hauptgrund ist ein Abzugsangriff: Der Zug legt eine zuvor verdeckte Angriffslinie frei. Damit stellst du die Dame neu auf. Der Zug hält deine Stellung gut. **Alternative:** Genauso gut geht Qe2.

### 10. v2-no-single-motif-restraining-center · was_bad · 57.00

- Erwartet: restriction, piece_activity, coordination
- Diagnose: discovered_attack
- Problem: wrong_primary_reason:discovered_attack, missing_diagnosis_factor:restriction, missing_explanation_factor:restriction, missing_diagnosis_factor:activity, missing_explanation_factor:activity, missing_diagnosis_factor:coordination, missing_explanation_factor:coordination

> Der Hauptgrund ist ein Abzugsangriff: Der Zug legt eine zuvor verdeckte Angriffslinie frei. Nd7 stellt den Springer nach d7. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Ng4. **Alternative:** Genauso gut: Nc5 stellt den Springer nach c5. **Der Unterschied:** Der andere Zug schützt die Figur auf e7. **Merksatz:** Schau nach deinem Zug: Ist eine deiner Figuren angegriffen und ungedeckt?

## Methodik

- Engine-Linien, FEN und Züge werden deterministisch geprüft. Der Benchmark startet standardmäßig keine neue Stockfish-Analyse.
- Erwartete Konzepte werden dem Coach nie übergeben.
- Automatisch erzeugte PGN-Fälle mit `needsReview` zählen noch nicht zur Hauptgrundquote.
- Ein illegaler Kontext, Engine-Widerspruch oder eine konkrete Halluzination deckelt den Gesamtscore auf 35 Punkte.
- Der optionale LLM-Judge bestimmt höchstens 20 % des Scores; objektive Schachfehler behalten den harten Deckel.

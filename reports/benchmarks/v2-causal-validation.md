# Chess Coach Benchmark

Run: `v2-causal-validation` · Datensatz: `coach-benchmark-v2-hard` · Coach: `local` · Judge: `aus`

## Ergebnis

- Antworten: 25
- Gesamt: **85.88** (+22.21)
- Schachgenauigkeit: 100.00 (+1.00)
- Hauptgrund erkannt: 36.00 % (+32.00)
- Halluzinationsrate: 0.00 % (-4.00)
- Schwere Fehler: 0.00 %
- Diagnose-Faktorabdeckung: 28.67 %
- Erklärungs-Faktorabdeckung: 16.67 %
- Fehlerfälle: 25

## Kategorien

| Kategorie | Fälle | Score | Änderung | Halluzination | Hauptgrund | Diagnose-Faktoren | Erklärungs-Faktoren |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| COMPENSATION | 5 | 87.25 | +31.85 | 0.00 % | 0.00 % | 53.33 % | 0.00 % |
| COMPLEX_ENDGAME | 5 | 87.74 | +9.55 | 0.00 % | 80.00 % | 26.66 % | 26.66 % |
| DEVELOPMENT | 2 | 90.63 | +33.00 | 0.00 % | 0.00 % | 66.67 % | 0.00 % |
| ENDGAME | 5 | 87.74 | +9.55 | 0.00 % | 80.00 % | 26.66 % | 26.66 % |
| INITIATIVE | 8 | 87.69 | +32.00 | 0.00 % | 0.00 % | 50.00 % | 0.00 % |
| KING_SAFETY | 3 | 84.25 | +16.42 | 0.00 % | 0.00 % | 33.33 % | 0.00 % |
| MATERIAL | 1 | 81.00 | +31.00 | 0.00 % | 0.00 % | 33.33 % | 0.00 % |
| MULTI_FACTOR | 24 | 86.33 | +22.91 | 0.00 % | 37.50 % | 29.86 % | 17.36 % |
| PIECE_ACTIVITY | 9 | 85.52 | +22.60 | 0.00 % | 44.44 % | 24.07 % | 20.37 % |
| POSITIONAL | 7 | 83.42 | +22.99 | 0.00 % | 28.57 % | 14.28 % | 19.05 % |
| PROPHYLAXIS | 9 | 87.27 | +24.91 | 0.00 % | 55.56 % | 24.07 % | 31.48 % |
| QUIET_MOVE | 18 | 85.11 | +19.28 | 0.00 % | 44.44 % | 19.44 % | 21.30 % |
| TACTICAL | 1 | 88.00 | +33.00 | 0.00 % | 0.00 % | 66.67 % | 0.00 % |
| UNCERTAIN | 2 | 76.13 | +20.00 | 0.00 % | 0.00 % | 0.00 % | 0.00 % |

## Kalibrierung der Diagnose

- Bewertete Diagnosen: 25
- Brier-Score: 0.0347 (kleiner ist besser)
- Expected Calibration Error: 0.1596 (kleiner ist besser)
- Selbstsicher falsch: 0

## Wichtigste Fehler

### 1. v2-endgame-pawn-race-dual-king · why_best · 75.00

- Erwartet: pawn_race, king_activity_endgame, prophylaxis
- Diagnose: kein sicherer Hauptgrund
- Problem: wrong_primary_reason:none, missing_diagnosis_factor:pawn_race, missing_explanation_factor:pawn_race, missing_diagnosis_factor:king_activity, missing_explanation_factor:king_activity, missing_diagnosis_factor:prevention, missing_explanation_factor:prevention

> Ein eindeutiger Stellungsgrund ist hier nicht sicher belegt. Damit stellst du den König neu auf. Der Zug hält deine Stellung gut. **Alternative:** Kb6 ist besser.

### 2. v2-multi-queen-three-jobs · was_bad · 75.25

- Erwartet: prophylaxis, restriction, coordination, piece_activity
- Diagnose: kein sicherer Hauptgrund
- Problem: wrong_primary_reason:none, missing_diagnosis_factor:prevention, missing_explanation_factor:prevention, missing_diagnosis_factor:coordination, missing_explanation_factor:coordination, missing_diagnosis_factor:activity, missing_explanation_factor:activity

> Ein eindeutiger Stellungsgrund ist hier nicht sicher belegt. Damit stellst du die Dame neu auf. Der Zug hält deine Stellung gut. **Alternative:** Genauso gut geht Qe2.

### 3. v2-no-single-motif-queen-realignment · was_bad · 75.25

- Erwartet: piece_activity, coordination, prophylaxis
- Diagnose: kein sicherer Hauptgrund
- Problem: wrong_primary_reason:none, missing_diagnosis_factor:activity, missing_explanation_factor:activity, missing_diagnosis_factor:coordination, missing_explanation_factor:coordination, missing_diagnosis_factor:prevention, missing_explanation_factor:prevention

> Ein eindeutiger Stellungsgrund ist hier nicht sicher belegt. Qe8 stellt die Dame nach e8. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Qf3. **Alternative:** Genauso gut: Rb8 gibt den Turm auf b8 mehr Felder.

### 4. v2-quiet-king-step · was_bad · 75.25

- Erwartet: prophylaxis, king_safety
- Diagnose: kein sicherer Hauptgrund
- Problem: wrong_primary_reason:none, missing_diagnosis_factor:prevention, missing_explanation_factor:prevention, missing_diagnosis_factor:king_safety, missing_explanation_factor:king_safety

> Ein eindeutiger Stellungsgrund ist hier nicht sicher belegt. Damit stellst du den König neu auf. Der Zug hält deine Stellung gut. **Alternative:** Genauso gut geht Bh6.

### 5. v2-multi-bishop-retreat · was_bad · 77.00

- Erwartet: prophylaxis, restriction, piece_activity, initiative
- Diagnose: kein sicherer Hauptgrund
- Problem: wrong_primary_reason:none, missing_diagnosis_factor:counterplay_restriction, missing_explanation_factor:counterplay_restriction, missing_diagnosis_factor:piece_improvement, missing_explanation_factor:piece_improvement, missing_diagnosis_factor:initiative, missing_explanation_factor:initiative

> Ein eindeutiger Stellungsgrund ist hier nicht sicher belegt. Bd1 stellt den Läufer nach d1. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Bd8. **Alternative:** Genauso gut: Kg2 gibt den König auf g2 mehr Felder. **Der Unterschied:** Der andere Zug schützt die Figur auf a1. **Merksatz:** Schau nach deinem Zug: Ist eine deiner Figuren angegriffen und ungedeckt?

### 6. v2-no-single-motif-restraining-center · was_bad · 77.00

- Erwartet: restriction, piece_activity, coordination
- Diagnose: kein sicherer Hauptgrund
- Problem: wrong_primary_reason:none, missing_diagnosis_factor:restriction, missing_explanation_factor:restriction, missing_diagnosis_factor:activity, missing_explanation_factor:activity, missing_diagnosis_factor:coordination, missing_explanation_factor:coordination

> Ein eindeutiger Stellungsgrund ist hier nicht sicher belegt. Nd7 stellt den Springer nach d7. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Ng4. **Alternative:** Genauso gut: Nc5 stellt den Springer nach c5. **Der Unterschied:** Der andere Zug schützt die Figur auf e7. **Merksatz:** Schau nach deinem Zug: Ist eine deiner Figuren angegriffen und ungedeckt?

### 7. v2-restriction-c5-bishop · why_best · 78.50

- Erwartet: restriction, piece_activity, pawn_break
- Diagnose: kein sicherer Hauptgrund
- Problem: wrong_primary_reason:none, missing_diagnosis_factor:restriction, missing_explanation_factor:restriction, missing_diagnosis_factor:activity, missing_explanation_factor:activity, missing_diagnosis_factor:pawn_play, missing_explanation_factor:pawn_play

> Ein eindeutiger Stellungsgrund ist hier nicht sicher belegt. c5 greift die Bauern auf b6 an. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt f6. **Alternative:** Genauso gut: g4 zieht den Bauern nach g4.

### 8. v2-restriction-pawn-activates-pieces · why_best · 78.50

- Erwartet: restriction, piece_activity, pawn_break
- Diagnose: kein sicherer Hauptgrund
- Problem: wrong_primary_reason:none, missing_diagnosis_factor:restriction, missing_explanation_factor:restriction, missing_diagnosis_factor:activity, missing_explanation_factor:activity, missing_diagnosis_factor:pawn_play, missing_explanation_factor:pawn_play

> Ein eindeutiger Stellungsgrund ist hier nicht sicher belegt. e4 besetzt e4 und kontrolliert zusätzlich d5. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt h6. **Alternative:** Genauso gut: h3 zieht den Bauern nach h3.

### 9. v2-compensation-queen-sacrifice · why_best · 81.00

- Erwartet: compensation, initiative, development_advantage, space_advantage
- Diagnose: compensation
- Problem: main_reason_not_explained, missing_explanation_factor:material_compensation, missing_diagnosis_factor:initiative, missing_explanation_factor:initiative, missing_diagnosis_factor:positional_assets, missing_explanation_factor:positional_assets, language:empty

>

### 10. v2-initiative-restricting-sacrifice · why_bad · 86.00

- Erwartet: compensation, initiative, restriction, pawn_break
- Diagnose: compensation
- Problem: main_reason_not_explained, missing_explanation_factor:compensation, missing_diagnosis_factor:initiative, missing_explanation_factor:initiative, missing_diagnosis_factor:restriction, missing_explanation_factor:restriction

> Der Hauptgrund: Die Engine-Bewertung bleibt trotz des materiellen Rückstands stabil; die nichtmateriellen Vorteile tragen die Stellung. Damit stellst du den Springer neu auf. Der Zug hält deine Stellung gut. **Alternative:** Ne2 ist besser.

## Regressionen

Keine Regression von mindestens 5 Punkten.

## Verbesserungen

- v2-aggressive-prophylaxis-qh8 · why_best: 35.00 → 87.75 (+52.75)
- v2-active-prophylaxis-queen-retreat · why_best: 50.00 → 94.50 (+44.50)
- v2-quiet-weak-square-prophylaxis · why_best: 58.50 → 94.33 (+35.83)
- v2-multi-rook-defense-and-pressure · why_best: 58.50 → 92.67 (+34.17)
- v2-initiative-forcing-knight · why_best: 55.00 → 88.00 (+33.00)
- v2-compensation-development-tempi · why_best: 56.75 → 89.75 (+33.00)
- v2-compensation-center-and-attack · why_best: 55.00 → 88.00 (+33.00)
- v2-compensation-hindrance-pawn · why_best: 58.50 → 91.50 (+33.00)
- v2-compensation-queen-sacrifice · why_best: 50.00 → 81.00 (+31.00)
- v2-initiative-restricting-sacrifice · why_bad: 56.75 → 86.00 (+29.25)
- v2-restriction-pawn-activates-pieces · why_best: 58.50 → 78.50 (+20.00)
- v2-restriction-c5-bishop · why_best: 58.50 → 78.50 (+20.00)
- v2-no-single-motif-queen-realignment · was_bad: 55.25 → 75.25 (+20.00)
- v2-no-single-motif-restraining-center · was_bad: 57.00 → 77.00 (+20.00)
- v2-multi-queen-three-jobs · was_bad: 57.00 → 75.25 (+18.25)
- v2-quiet-kings-indian-rook · why_best: 76.75 → 94.33 (+17.58)
- v2-endgame-reti-pawn-race · why_best: 75.00 → 90.92 (+15.92)
- v2-endgame-bodycheck · why_best: 75.00 → 90.92 (+15.92)
- v2-endgame-rook-two-functions · why_best: 75.00 → 90.92 (+15.92)
- v2-prophylaxis-permanent-bind · why_best: 78.50 → 94.33 (+15.83)

## Methodik

- Engine-Linien, FEN und Züge werden deterministisch geprüft. Der Benchmark startet standardmäßig keine neue Stockfish-Analyse.
- Erwartete Konzepte werden dem Coach nie übergeben.
- Automatisch erzeugte PGN-Fälle mit `needsReview` zählen noch nicht zur Hauptgrundquote.
- Ein illegaler Kontext, Engine-Widerspruch oder eine konkrete Halluzination deckelt den Gesamtscore auf 35 Punkte.
- Der optionale LLM-Judge bestimmt höchstens 20 % des Scores; objektive Schachfehler behalten den harten Deckel.

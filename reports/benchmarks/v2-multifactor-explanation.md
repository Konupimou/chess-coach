# Chess Coach Benchmark

Run: `v2-multifactor-explanation` · Datensatz: `coach-benchmark-v2-hard` · Coach: `local` · Judge: `aus`

## Ergebnis

- Antworten: 25
- Gesamt: **87.07** (+1.18)
- Schachgenauigkeit: 100.00 (+0.00)
- Hauptgrund erkannt: 68.00 % (+32.00)
- Halluzinationsrate: 0.00 % (+0.00)
- Schwere Fehler: 0.00 %
- Diagnose-Faktorabdeckung: 28.67 %
- Erklärungs-Faktorabdeckung: 39.33 %
- Fehlerfälle: 25

## Kategorien

| Kategorie | Fälle | Score | Änderung | Halluzination | Hauptgrund | Diagnose-Faktoren | Erklärungs-Faktoren |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| COMPENSATION | 5 | 94.10 | +6.85 | 0.00 % | 100.00 % | 53.33 % | 80.00 % |
| COMPLEX_ENDGAME | 5 | 87.04 | -0.70 | 0.00 % | 80.00 % | 26.66 % | 26.66 % |
| DEVELOPMENT | 2 | 96.25 | +5.63 | 0.00 % | 100.00 % | 66.67 % | 100.00 % |
| ENDGAME | 5 | 87.04 | -0.70 | 0.00 % | 80.00 % | 26.66 % | 26.66 % |
| INITIATIVE | 8 | 92.71 | +5.02 | 0.00 % | 100.00 % | 50.00 % | 66.67 % |
| KING_SAFETY | 3 | 85.20 | +0.95 | 0.00 % | 66.67 % | 33.33 % | 22.22 % |
| MATERIAL | 1 | 92.58 | +11.58 | 0.00 % | 100.00 % | 33.33 % | 66.67 % |
| MULTI_FACTOR | 24 | 87.56 | +1.23 | 0.00 % | 70.83 % | 29.86 % | 40.97 % |
| PIECE_ACTIVITY | 9 | 85.84 | +0.32 | 0.00 % | 55.56 % | 24.07 % | 35.18 % |
| POSITIONAL | 7 | 83.37 | -0.05 | 0.00 % | 42.86 % | 14.28 % | 23.81 % |
| PROPHYLAXIS | 9 | 86.82 | -0.44 | 0.00 % | 66.67 % | 24.07 % | 42.59 % |
| QUIET_MOVE | 18 | 84.77 | -0.34 | 0.00 % | 55.56 % | 19.44 % | 28.70 % |
| TACTICAL | 1 | 91.17 | +3.17 | 0.00 % | 100.00 % | 66.67 % | 33.33 % |
| UNCERTAIN | 2 | 76.13 | +0.00 | 0.00 % | 0.00 % | 0.00 % | 0.00 % |

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

### 9. v2-endgame-bodycheck · why_best · 89.17

- Erwartet: opposition, king_activity_endgame, prophylaxis
- Diagnose: prophylaxis
- Problem: missing_diagnosis_factor:opposition, missing_explanation_factor:opposition, missing_diagnosis_factor:king_activity, missing_explanation_factor:king_activity

> Der Hauptgrund ist Prophylaxe: Der Zug verhindert eine konkrete gegnerische Ressource, die in schwächeren Engine-Fortsetzungen verfügbar bleibt. Der Zug hält deine Stellung gut. **Alternative:** Kd7 ist besser. **Der Unterschied:** Der MultiPV-Vergleich macht das sichtbar: In 3 schwächeren Varianten erhält der Gegner Kd4; nach dem gewählten Zug nicht.

### 10. v2-endgame-rook-two-functions · why_best · 89.17

- Erwartet: rook_activity, passed_pawn, prophylaxis
- Diagnose: prophylaxis
- Problem: missing_diagnosis_factor:rook_activity, missing_explanation_factor:rook_activity, missing_diagnosis_factor:passed_pawn, missing_explanation_factor:passed_pawn

> Der Hauptgrund ist Prophylaxe: Der Zug verhindert eine konkrete gegnerische Ressource, die in schwächeren Engine-Fortsetzungen verfügbar bleibt. Der Zug hält deine Stellung gut. **Alternative:** Kg3 ist besser. **Der Unterschied:** Der MultiPV-Vergleich macht das sichtbar: In 2 schwächeren Varianten erhält der Gegner Rf2+; nach dem gewählten Zug nicht.

## Regressionen

Keine Regression von mindestens 5 Punkten.

## Verbesserungen

- v2-compensation-queen-sacrifice · why_best: 81.00 → 92.58 (+11.58)
- v2-compensation-center-and-attack · why_best: 88.00 → 96.25 (+8.25)
- v2-compensation-hindrance-pawn · why_best: 91.50 → 98.00 (+6.50)

## Methodik

- Engine-Linien, FEN und Züge werden deterministisch geprüft. Der Benchmark startet standardmäßig keine neue Stockfish-Analyse.
- Erwartete Konzepte werden dem Coach nie übergeben.
- Automatisch erzeugte PGN-Fälle mit `needsReview` zählen noch nicht zur Hauptgrundquote.
- Ein illegaler Kontext, Engine-Widerspruch oder eine konkrete Halluzination deckelt den Gesamtscore auf 35 Punkte.
- Der optionale LLM-Judge bestimmt höchstens 20 % des Scores; objektive Schachfehler behalten den harten Deckel.

# Automatischer 800-Elo-Coach-Audit

**6 klare Auffälligkeiten gefunden.**

Der Audit prüft zuerst jeden erzeugten Halbzug aus 200 reproduzierbaren legalen Partien gegen die vollständige Berichts-, Widerspruchs- und Sprachlogik. Danach werden 225 über Eröffnung, Mittelspiel und Endspiel verteilte Stellungen mit Stockfish gegengeprüft.

- Partien: 200
- Geprüfte Halbzüge: 11.972
- Geprüfte sichtbare Texte: 49.786
- Coach-Stufe: 800 Elo
- Vollständige Halbzugprüfung: bestanden
- Tiefe Gegenprüfung bestanden: 219 / 225

## Teil 1: Jeder Halbzug

200 Partieberichte mit 11.972 Zugbewertungen bestanden alle Widerspruchs- und Sprachregeln.

## Teil 2: Tiefere Gegenprüfung

**Status: Freigabeschwellen nicht bestanden.**

Der Test erzeugt deterministisch legale Zufallspartien, prüft je Partie höchstens eine Stellung pro Phase und bewertet die sichtbaren Coach-Texte für 800 Elo. Stockfish läuft ausschließlich lokal; es entstehen keine API-Kosten.

### Ergebnis

- Erzeugte Partien: 200
- Erzeugte Halbzüge: 31.575
- Analysierte Stellungen: 225
- Coach-Ausgaben: 225
- Bestanden: 219/225 (97.33 %)
- Auswahl-Hash: `ebb8b838183db04e0911229bebb9354a1cfea57c780650e860003f9d20137c86`
- Engine: Stockfish 18 WASM Multithreaded, Tiefe 5, MultiPV 2
- Laufzeit: 42.45 Sekunden

| Prüfung | Fehler |
| --- | ---: |
| Brettbelege | 0 |
| Fehlende Erklärungen | 0 |
| Struktur/Evidenz-Verifikation | 0 |
| Sprachregeln | 1 |
| Direkte Brett-Semantik | 0 |
| Fehlende Kerninformation | 5 |
| Unbelegte Zugnotation | 0 |
| Unbelegte Brettbehauptung | 0 |
| Unbelegte Bewertungszahl | 0 |
| Phasenabweichungen | 0 |

### Nach Elo

| Elo | Fälle | Bestanden | Fehler | Quote | Max. Sätze |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 800 | 225 | 219 | 6 | 97.33 % | 6 |

### Nach Phase

| Phase | Fälle | Bestanden | Fehler | Quote | Max. Sätze |
| --- | ---: | ---: | ---: | ---: | ---: |
| opening | 75 | 73 | 2 | 97.33 % | 6 |
| middlegame | 75 | 72 | 3 | 96.00 % | 5 |
| endgame | 75 | 74 | 1 | 98.67 % | 5 |

### Abdeckung

| Phase | Partien erreicht | Verfügbare Stellungen | Angefordert | Getestet |
| --- | ---: | ---: | ---: | ---: |
| opening | 200 | 199 | 75 | 75 |
| middlegame | 196 | 196 | 75 | 75 |
| endgame | 177 | 177 | 75 | 75 |

### Fehlerarten

- Sprache `many-clauses`: 1
- Erklärvollständigkeit `schlagzug_nicht_erklaert`: 3
- Erklärvollständigkeit `schach_nicht_erklaert`: 2

### Fehlerbeispiele

### completeness: 7fef718210f08a61

- Phase/Elo: opening / 800
- Zug: Rxh7; Qualität: best; Verlust: 0 cp
- Fehler: schlagzug_nicht_erklaert
- FEN: `rnb3nr/pp1pk1pR/2p1pp2/8/1P1P1P2/R3P3/1PPK2P1/1NBQ1BN1 b - - 2 10`

> Damit stellst du den Turm neu auf. Der Zug hält deine Stellung gut. **Alternative:** a5 ist besser.

### language: 681f8c8a43670ebb

- Phase/Elo: opening / 800
- Zug: Be3; Qualität: mistake; Verlust: 235 cp
- Fehler: many-clauses
- FEN: `rn2k1nr/pppqpp2/3pb1p1/8/3PP1p1/3B4/PPPB1PPP/RN2K2R w KQkq - 4 9`

> Damit ziehst du deinen Läufer nach e3. Das ist ein klarer Fehler. Deine Stellung wird dadurch deutlich schlechter. **Stärkste Antwort:** Danach folgt a6. **Alternative:** Besser: O-O rochiert kurz: Der König verlässt die Mitte und der Turm kommt ins Spiel.

### completeness: e90738f1724d8ac8

- Phase/Elo: middlegame / 800
- Zug: Qa7+; Qualität: inaccuracy; Verlust: 109 cp
- Fehler: schach_nicht_erklaert
- FEN: `8/8/q4p2/5p2/8/4K2p/6k1/8 b - - 17 70`

> Damit stellst du die Dame neu auf. Der Zug gibt einen kleinen Teil deiner Stellung ab. **Alternative:** Kg3 ist besser.

### completeness: 0e28939789951c15

- Phase/Elo: middlegame / 800
- Zug: Kxd1; Qualität: best; Verlust: 0 cp
- Fehler: schlagzug_nicht_erklaert
- FEN: `8/8/8/3k4/8/1P6/2K5/3q4 w - - 1 68`

> Damit stellst du den König neu auf. Der Zug hält deine Stellung gut. **Alternative:** Kc3 ist besser.

### completeness: 834e222592c1cbfc

- Phase/Elo: middlegame / 800
- Zug: Kxf2; Qualität: best; Verlust: 0 cp
- Fehler: schlagzug_nicht_erklaert
- FEN: `Qn2kbn1/p2p2p1/8/1B2pP2/5P2/3P3P/PPP2q2/RNB2K1R w - - 1 14`

> Damit stellst du den König neu auf. Der Zug hält deine Stellung gut.

### completeness: ede4e738076b3c84

- Phase/Elo: endgame / 800
- Zug: Rh1#; Qualität: best; Verlust: 0 cp
- Fehler: schach_nicht_erklaert
- FEN: `8/8/8/1P6/P2p4/1p1P1K1k/8/2R5 w - - 1 38`

> Rh1# setzt den gegnerischen König matt. Das ist hier die genaueste Wahl. **Alternative:** Weitere Möglichkeit: b6 zieht den Bauern nach b6.


### Besonders gute Erklärungen

### d5 · opening · 800 Elo

- Qualität: best; Verlust: 0 cp
- FEN: `rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1`

> Damit stellst du einen Bauern ins Zentrum! Der Zug ist in dieser Eröffnung gut spielbar. **Stärkste Antwort:** Danach folgt Nd2.

### d4 · opening · 800 Elo

- Qualität: excellent; Verlust: 19 cp
- FEN: `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`

> Damit stellst du einen Bauern ins Zentrum! Der Zug ist in dieser Eröffnung gut spielbar.

### Nxc6 · opening · 800 Elo

- Qualität: best; Verlust: 0 cp
- FEN: `r1bqkbnr/ppp1p2p/2np2p1/4N3/4pP2/8/PPPP2PP/R1BQKBNR w KQkq - 0 6`

> Nxc6 nimmt den Springer. Der Zug ist in dieser Eröffnung gut spielbar. **Stärkste Antwort:** bxc6 nimmt deinen Springer auf c6. **Merksatz:** Schau vor deinem Zug: Kann dein Gegner eine Figur schlagen?

### e4 · opening · 800 Elo

- Qualität: best; Verlust: 0 cp
- FEN: `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`

> Damit stellst du einen Bauern ins Zentrum! Der Zug ist in dieser Eröffnung gut spielbar. **Stärkste Antwort:** Danach folgt c5.

### e4 · opening · 800 Elo

- Qualität: best; Verlust: 0 cp
- FEN: `r1b2bnr/ppn1k2p/2p2p2/3p4/P7/3P1N2/1PPKPPPP/R2Q1B1R w - - 2 11`

> Damit stellst du einen Bauern ins Zentrum! Der Zug ist in dieser Eröffnung gut spielbar. **Stärkste Antwort:** dxe4 nimmt deinen Bauern auf e4. Danach nimmst du mit dxe4 den Bauern zurück.

### Qh5+ · middlegame · 800 Elo

- Qualität: best; Verlust: 8 cp
- FEN: `r1b1kb2/p2pp1p1/2n2p1n/1Pp1q3/2B1P3/N6r/1PPP1P2/R1BK2N1 b q - 3 13`

> Qh5+ gibt dem gegnerischen König Schach. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Ke1. **Alternative:** Genauso gut: Qxe4 nimmt den Bauern auf e4.

### Bg2+ · middlegame · 800 Elo

- Qualität: best; Verlust: 0 cp
- FEN: `r1b2br1/1p4pp/n1kqp3/p1p5/2P5/7P/PP2P3/1RB1KBNR w K - 0 16`

> Bg2+ gibt dem gegnerischen König Schach. Das ist hier die genaueste Wahl. **Stärkste Antwort:** Danach folgt Kb6. **Alternative:** Weitere Möglichkeit: Be3 entwickelt den Läufer nach e3.

### Bxd2 · middlegame · 800 Elo

- Qualität: best; Verlust: 0 cp
- FEN: `rn1k1bnr/p3pp1p/3p4/6p1/R5P1/4PP2/3qK2P/2B2B1R w - - 0 15`

> Bxd2 nimmt die Dame. Das ist hier die genaueste Wahl. **Stärkste Antwort:** Danach folgt Nc6. **Alternative:** Weitere Möglichkeit: Kxd2 nimmt die Dame auf d2.

### Rxe1 · middlegame · 800 Elo

- Qualität: best; Verlust: 0 cp
- FEN: `4kbnr/1pp1p3/5p2/7p/2P2P2/6PN/4PK1P/4q2R w k - 1 17`

> Rxe1 nimmt die Dame. Das ist hier die genaueste Wahl. **Stärkste Antwort:** Danach folgt e6. **Alternative:** Weitere Möglichkeit: Kxe1 nimmt die Dame auf e1.

### Nxg5 · middlegame · 800 Elo

- Qualität: excellent; Verlust: 27 cp
- FEN: `b3kr2/p4n1p/4p1p1/1p3pN1/1P1K1P1P/B6P/2QP4/1N6 b - - 2 24`

> Nxg5 nimmt den Springer. Der Zug hält deine Stellung. **Stärkste Antwort:** hxg5 nimmt deinen Springer auf g5. **Alternative:** Genauso gut: Kd7 gibt den König auf d7 mehr Felder.

### Bh6 · middlegame · 800 Elo

- Qualität: best; Verlust: 0 cp
- FEN: `r4bn1/p3r3/1p2k1p1/8/5Q2/P4P2/1P1PB1P1/R1B1K3 b - - 0 19`

> Damit entwickelst du den Läufer! Das ist hier die genaueste Wahl. **Stärkste Antwort:** Qc4+ gibt Schach. **Alternative:** Weitere Möglichkeit: Kd7 übernimmt neu die Kontrolle über e4.

### Ke4 · endgame · 800 Elo

- Qualität: best; Verlust: 1 cp
- FEN: `8/8/8/1K2k3/8/8/8/8 b - - 7 88`

> Damit ziehst du deinen König nach e4. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Kc6. **Alternative:** Genauso gut: Kd4 besetzt d4 und kontrolliert zusätzlich e5.

### Kh2 · endgame · 800 Elo

- Qualität: best; Verlust: 4 cp
- FEN: `8/2n5/8/4k3/p2p3p/7P/8/6K1 w - - 4 69`

> Damit ziehst du deinen König nach h2. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt d3. **Alternative:** Genauso gut: Kg2 bringt den König von g1 näher ins Zentrum nach g2.

### Ke1 · endgame · 800 Elo

- Qualität: best; Verlust: 2 cp
- FEN: `8/8/5p2/5P2/8/8/2k5/5K2 w - - 41 89`

> Damit ziehst du deinen König nach e1. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Kd3. **Alternative:** Genauso gut: Ke2 bringt den König von f1 näher ins Zentrum nach e2.

### Kf7+ · endgame · 800 Elo

- Qualität: best; Verlust: 0 cp
- FEN: `rn3br1/6k1/1p1p3p/p2p1P2/5P1P/2P5/P1pPN1KR/2B5 b - - 0 23`

> Kf7+ gibt dem gegnerischen König Schach. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Kf3. **Alternative:** Genauso gut: Nd7 entwickelt den Springer nach d7.

### Kb5 · endgame · 800 Elo

- Qualität: best; Verlust: 0 cp
- FEN: `8/8/8/4K3/k7/8/8/8 b - - 11 74`

> Damit ziehst du deinen König nach b5. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Kd4. **Alternative:** Genauso gut: Kb4 bringt den König von a4 näher ins Zentrum nach b4.

### Kg1 · endgame · 800 Elo

- Qualität: best; Verlust: 1 cp
- FEN: `8/8/1k6/8/8/8/8/7K w - - 32 74`

> Damit ziehst du deinen König nach g1. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Kc6. **Alternative:** Genauso gut: Kg2 bringt den König von h1 näher ins Zentrum nach g2.

### Bd6 · endgame · 800 Elo

- Qualität: excellent; Verlust: 11 cp
- FEN: `8/2B5/2K5/8/4B3/7p/k6P/8 w - - 0 81`

> Damit ziehst du deinen Läufer nach d6. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Kb2. **Alternative:** Genauso gut: Be5 besetzt e5 und kontrolliert zusätzlich d4.

### Kc3 · endgame · 800 Elo

- Qualität: excellent; Verlust: 14 cp
- FEN: `n3b3/8/4k3/8/4p3/1K2P3/8/8 w - - 4 42`

> Damit ziehst du deinen König nach c3. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Kd5. **Alternative:** Genauso gut: Kc4 bringt den König von b3 näher ins Zentrum nach c4.

### Kb5 · endgame · 800 Elo

- Qualität: best; Verlust: 0 cp
- FEN: `8/8/2K4k/8/8/8/8/8 w - - 3 81`

> Damit ziehst du deinen König nach b5. Der Zug hält deine Stellung. **Stärkste Antwort:** Danach folgt Kg7. **Alternative:** Genauso gut: Kc5 bringt den König von c6 näher ins Zentrum nach c5.


### Datenschutz

Der Report speichert keine Rohpartien, Spielernamen oder Partiekennungen. Nur Summen und im Fehlerfall maximal wenige FEN-basierte Reproduktionsbeispiele werden ausgegeben.

> Ein Zufallstest erhöht die messbare Sicherheit, beweist aber nicht jede denkbare Schachstellung.


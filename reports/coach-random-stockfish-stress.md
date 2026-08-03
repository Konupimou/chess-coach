# Randomisierter Stockfish-Stresstest des Coaches

**Status: Freigabeschwellen bestanden.**

Der Test erzeugt deterministisch legale Zufallspartien, wählt je Partie höchstens eine Stellung pro Phase und bewertet die sichtbaren Coach-Texte für alle vier Elo-Stufen. Stockfish läuft ausschließlich lokal; es entstehen keine API-Kosten.

## Ergebnis

- Erzeugte Partien: 300
- Erzeugte Halbzüge: 46.795
- Analysierte Stellungen: 225
- Coach-Ausgaben: 900
- Bestanden: 900/900 (100.00 %)
- Auswahl-Hash: `226c0b517c51002848210ec5f40256c488d973773f2fc0c149c4c62849ef90a7`
- Engine: Stockfish 18 WASM Multithreaded, Tiefe 5, MultiPV 2
- Laufzeit: 57.09 Sekunden

| Prüfung | Fehler |
| --- | ---: |
| Brettbelege | 0 |
| Fehlende Erklärungen | 0 |
| Struktur/Evidenz-Verifikation | 0 |
| Sprachregeln | 0 |
| Direkte Brett-Semantik | 0 |
| Unbelegte Zugnotation | 0 |
| Unbelegte Brettbehauptung | 0 |
| Unbelegte Bewertungszahl | 0 |
| Phasenabweichungen | 0 |

## Nach Elo

| Elo | Fälle | Bestanden | Fehler | Quote | Max. Sätze |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 800 | 225 | 225 | 0 | 100.00 % | 5 |
| 1000 | 225 | 225 | 0 | 100.00 % | 5 |
| 1400 | 225 | 225 | 0 | 100.00 % | 8 |
| 1800 | 225 | 225 | 0 | 100.00 % | 10 |

## Nach Phase

| Phase | Fälle | Bestanden | Fehler | Quote | Max. Sätze |
| --- | ---: | ---: | ---: | ---: | ---: |
| opening | 300 | 300 | 0 | 100.00 % | 9 |
| middlegame | 300 | 300 | 0 | 100.00 % | 10 |
| endgame | 300 | 300 | 0 | 100.00 % | 10 |

## Abdeckung

| Phase | Partien erreicht | Verfügbare Stellungen | Angefordert | Getestet |
| --- | ---: | ---: | ---: | ---: |
| opening | 300 | 300 | 75 | 75 |
| middlegame | 285 | 285 | 75 | 75 |
| endgame | 261 | 261 | 75 | 75 |

## Fehlerarten

Keine Fehlerarten gefunden.

## Fehlerbeispiele

Keine Fehlerbeispiele vorhanden.

## Datenschutz

Der Report speichert keine Rohpartien, Spielernamen oder Partiekennungen. Nur Summen und im Fehlerfall maximal wenige FEN-basierte Reproduktionsbeispiele werden ausgegeben.

> Ein Zufallstest erhöht die messbare Sicherheit, beweist aber nicht jede denkbare Schachstellung.

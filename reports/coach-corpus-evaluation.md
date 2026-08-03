# Offline-Massentest des Schachcoachs

**Status: Offline-Wiedergabeschwellen bestanden.**

Dieser Bericht prüft die lokale Coach-Pipeline reproduzierbar und ohne bezahlte KI-Anfragen. Er ist ein Schema-, Legalitäts- und Sprachtest mit neutralen Bewertungen – kein Ersatz für echte Stockfish-Zugreviews oder Online-KI-Tests.

## Ergebnis

- Getestete Stellungen: 2.297
- Repräsentierte anonymisierte Partien: 1.629
- Auswahl-Hash: `b6660af077385bc7a5bffbadd62bfb3a90be46ffd1a07e861d0a1846d651b0a1`
- Harte Sicherheitsprüfung: bestanden
- Sprache für 800–1000 Elo: 100.00 % ohne Regelverstoß
- Eröffnungen ohne unbelegten Alleinanspruch: 100.00 %
- PGN-Laufzeitwissen: deterministisch geprüfte Fakten verfügbar

| Prüfung | Bestanden |
| --- | ---: |
| Zuglegalität | 100.00 % |
| Evidenz und Zugreferenzen | 100.00 % |
| Direkte Brett-Semantik | 100.00 % |
| Anonyme Herkunft und Datenprovenienz | 100.00 % |
| Exakter, für den Coach freigegebener Datenbanktreffer | 100.00 % |
| Sprachregeln | 100.00 % |

## Abdeckung

| Elo | Phase | Verfügbar | Getestet |
| ---: | --- | ---: | ---: |
| 800 | opening | 1001 | 200 |
| 800 | middlegame | 1018 | 200 |
| 800 | endgame | 667 | 200 |
| 1000 | opening | 4627 | 200 |
| 1000 | middlegame | 6046 | 200 |
| 1000 | endgame | 1429 | 200 |
| 1400 | opening | 923 | 200 |
| 1400 | middlegame | 1087 | 200 |
| 1400 | endgame | 97 | 97 |
| 1800 | opening | 900 | 200 |
| 1800 | middlegame | 1166 | 200 |
| 1800 | endgame | 271 | 200 |

## Qualität der geprüften PGN-Fakten

- Geprüfte Laufzeitfakten: 20.418
- Für den Coach freigegeben: 20.418 (100.00 %)
- Als kurze deutsche Faktvorlage geeignet: 20.418 (100.00 %)
- Ursprüngliche PGN-Kommentare sind nicht im Laufzeitindex enthalten. Der Coach erhält nur aus Stellung und legalem Zug erneut berechenbare Fakten.

| Elo | Laufzeitfakten | Freigegeben | Sprachgeeignet |
| ---: | ---: | ---: | ---: |
| 800 | 2855 | 2855 (100.0 %) | 2855 (100.0 %) |
| 1000 | 12780 | 12780 (100.0 %) | 12780 (100.0 %) |
| 1400 | 2288 | 2288 (100.0 %) | 2288 (100.0 %) |
| 1800 | 2495 | 2495 (100.0 %) | 2495 (100.0 %) |

Häufigste Fakten-Probleme:

- Keine Probleme in den geprüften Fakten.

## Nach Spielstärke

| Elo | Fälle | Legal | Belegt | Sinnprüfung | Herkunft | Sprache | Lesewert |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 800 | 600 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 88.7 |
| 1000 | 600 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 88.7 |
| 1400 | 497 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 92.2 |
| 1800 | 600 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 90.9 |

## Nach Partiephase

| Phase | Fälle | Legal | Belegt | Sinnprüfung | Herkunft | Sprache |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| opening | 800 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % |
| middlegame | 800 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % |
| endgame | 697 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % |

## Häufigste Auffälligkeiten

- Keine Auffälligkeiten im gezogenen Korpus.

## Harte Fehlerbeispiele

Keine harten Fehler im gezogenen Korpus.

## Beispiele für Nacharbeit

Keine Fehlerbeispiele vorhanden.

## Methode und Grenzen

- Die Auswahl ist nach 800/1000/1400/1800 Elo und Eröffnung/Mittelspiel/Endspiel geschichtet. Innerhalb jeder Gruppe bestimmt ein fester SHA-256-Hash die Fälle; dieselbe Datenbank und derselbe Seed ergeben dieselbe Auswahl.
- Jeder gespeicherte Zug wird mit `chess.js` aus seiner echten FEN-Stellung gespielt. Danach werden alle Zugreferenzen und Evidenz-IDs erneut durch die produktive Verifikation geschickt.
- Für jeden Fall wird gemessen, ob ein freigegebener exakter PGN-Fakt verfügbar ist. Fehlt er, bleibt die Erklärung bei Brett-, Eröffnungs- und Variantenfakten. PGN-Fakten gelten nur für die exakte Stellung und den gespeicherten legalen Zug; sie beweisen ausdrücklich keinen besten Zug.
- Der Massentest verwendet neutrale Bewertungen. Er prüft deshalb Legalität, Erdung, unmittelbare Brettlogik, Herkunft und Sprache – nicht die Stockfish-Qualität des historischen Zuges. Kuratierte Engine-Tests ergänzen diese Prüfung.
- Der deutsche Lesewert ist nur ein Vergleichswert. Die Freigaberegeln verwenden zusätzlich konkrete Satzlängen, unerwünschte Floskeln, abstrakte Wörter und den Verzicht auf einen unbelegten einzigen ‚besten Zug‘ in Eröffnungen.
- Kein endlicher Test kann Eignung für jede denkbare Schachstellung absolut beweisen. Ein bestandener Bericht ist eine belastbare Freigabeschwelle, kein mathematischer Vollständigkeitsbeweis.

## Reproduktion

```bash
node scripts/evaluate-coach-corpus.mjs --samples-per-cell=200 --seed=coach-corpus-v1
```

# Offline-Massentest des Schachcoachs

**Status: Offline-Wiedergabeschwellen bestanden.**

Dieser Bericht prüft die lokale Coach-Pipeline reproduzierbar und ohne bezahlte KI-Anfragen. Er ist ein Schema-, Legalitäts- und Sprachtest mit neutralen Bewertungen – kein Ersatz für echte Stockfish-Zugreviews oder Online-KI-Tests.

## Ergebnis

- Getestete Stellungen: 2.296
- Repräsentierte anonymisierte Partien: 1.626
- Auswahl-Hash: `078199c83ced755bd116dbae7140d2ccb7279d7190c4cf3d3432f9a9bfc20d26`
- Harte Sicherheitsprüfung: bestanden
- Sprache für 800–1000 Elo: 100.00 % ohne Regelverstoß
- Eröffnungen ohne unbelegten Alleinanspruch: 100.00 %
- PGN-Laufzeitwissen: geprüfte Brettfakten und anonymisierte Kommentar-Erkenntnisse verfügbar

| Prüfung | Bestanden |
| --- | ---: |
| Zuglegalität | 100.00 % |
| Evidenz und Zugreferenzen | 100.00 % |
| Direkte Brett-Semantik | 100.00 % |
| Anonyme Herkunft und Datenprovenienz | 100.00 % |
| Exakter, für den Coach freigegebener Wissenseintrag | 100.00 % |
| Sprachregeln | 100.00 % |

## Abdeckung

| Elo | Phase | Verfügbar | Getestet |
| ---: | --- | ---: | ---: |
| 800 | opening | 1005 | 200 |
| 800 | middlegame | 1032 | 200 |
| 800 | endgame | 688 | 200 |
| 1000 | opening | 4723 | 200 |
| 1000 | middlegame | 6194 | 200 |
| 1000 | endgame | 1460 | 200 |
| 1400 | opening | 913 | 200 |
| 1400 | middlegame | 1104 | 200 |
| 1400 | endgame | 96 | 96 |
| 1800 | opening | 886 | 200 |
| 1800 | middlegame | 1113 | 200 |
| 1800 | endgame | 275 | 200 |

## Qualität des geprüften PGN-Wissens

- Geprüfte Wissenseinträge: 21.017
- Davon reproduzierbare Brettfakten: 20.418
- Davon anonymisierte Kommentar-Erkenntnisse: 599
- Strategische Erkenntnisse mit Quellenkonsens: 252
- Für den Coach freigegeben: 21.017 (100.00 %)
- Als kurze deutsche Vorlage geeignet: 21.017 (100.00 %)
- Ursprüngliche PGN-Kommentare sind nicht im Laufzeitindex enthalten. Sie dienen nur als Signal für neu formulierte Erkenntnisse. Taktische Motive müssen am Brett reproduzierbar sein; strategische Hinweise brauchen außerdem mindestens zwei unabhängige Quellen.

| Elo | Wissenseinträge | Freigegeben | Sprachgeeignet |
| ---: | ---: | ---: | ---: |
| 800 | 2981 | 2981 (100.0 %) | 2981 (100.0 %) |
| 1000 | 13282 | 13282 (100.0 %) | 13282 (100.0 %) |
| 1400 | 2300 | 2300 (100.0 %) | 2300 (100.0 %) |
| 1800 | 2454 | 2454 (100.0 %) | 2454 (100.0 %) |

Häufigste Fakten-Probleme:

- Keine Probleme im geprüften PGN-Wissen.

## Nach Spielstärke

| Elo | Fälle | Legal | Belegt | Sinnprüfung | Herkunft | Sprache | Lesewert |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 800 | 600 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 88.7 |
| 1000 | 600 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 88.7 |
| 1400 | 496 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 92.3 |
| 1800 | 600 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 90.9 |

## Nach Partiephase

| Phase | Fälle | Legal | Belegt | Sinnprüfung | Herkunft | Sprache |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| opening | 800 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % |
| middlegame | 800 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % |
| endgame | 696 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % |

## Häufigste Auffälligkeiten

- Keine Auffälligkeiten im gezogenen Korpus.

## Harte Fehlerbeispiele

Keine harten Fehler im gezogenen Korpus.

## Beispiele für Nacharbeit

Keine Fehlerbeispiele vorhanden.

## Methode und Grenzen

- Die Auswahl ist nach 800/1000/1400/1800 Elo und Eröffnung/Mittelspiel/Endspiel geschichtet. Innerhalb jeder Gruppe bestimmt ein fester SHA-256-Hash die Fälle; dieselbe Datenbank und derselbe Seed ergeben dieselbe Auswahl.
- Jeder gespeicherte Zug wird mit `chess.js` aus seiner echten FEN-Stellung gespielt. Danach werden alle Zugreferenzen und Evidenz-IDs erneut durch die produktive Verifikation geschickt.
- Für jeden Fall wird gemessen, ob ein freigegebener exakter PGN-Wissenseintrag verfügbar ist. Zuggebundene Fakten gelten nur für die exakte Stellung und den gespeicherten legalen Zug. Kommentar-Erkenntnisse dürfen nur ihr geprüftes Brettkonzept übertragen. Beides beweist ausdrücklich keinen besten Zug.
- Der Massentest verwendet neutrale Bewertungen. Er prüft deshalb Legalität, Erdung, unmittelbare Brettlogik, Herkunft und Sprache – nicht die Stockfish-Qualität des historischen Zuges. Kuratierte Engine-Tests ergänzen diese Prüfung.
- Der deutsche Lesewert ist nur ein Vergleichswert. Die Freigaberegeln verwenden zusätzlich konkrete Satzlängen, unerwünschte Floskeln, abstrakte Wörter und den Verzicht auf einen unbelegten einzigen ‚besten Zug‘ in Eröffnungen.
- Kein endlicher Test kann Eignung für jede denkbare Schachstellung absolut beweisen. Ein bestandener Bericht ist eine belastbare Freigabeschwelle, kein mathematischer Vollständigkeitsbeweis.

## Reproduktion

```bash
node scripts/evaluate-coach-corpus.mjs --samples-per-cell=200 --seed=coach-corpus-v1
```

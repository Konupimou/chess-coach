# Evaluation der Konzeptsuche und PGN-Sicherheitsgrenze

Stand: 3. August 2026

## Ergebnis

Dieser Bericht beschreibt den produktiven Laufzeitindex in Version 7. Er trennt
drei Wissensarten:

- Zuggebundene PGN-Fakten gelten nur für dieselbe Stellung und den gespeicherten
  legalen Zug.
- Taktische Kommentar-Erkenntnisse gelten nur für die exakte Stellung, in der
  der Brettdetektor das Motiv erneut bestätigt.
- Strategische Kommentar-Erkenntnisse dürfen nur ihr geprüftes Pflichtkonzept
  übertragen. Dafür müssen mindestens zwei deduplizierte PGN-Quellen das
  Konzept nennen und die Zielstellung muss dieselbe Konzeptbedingung erfüllen.

Originalkommentare, Namen, Titel, historische Züge, Felder und Bewertungen
werden weder angezeigt noch in eine ähnliche Stellung kopiert.

Der reproduzierbare Benchmark `npm run pgn:evaluate` hat 80 deterministisch
ausgewählte Stellungen jeweils um einen legalen Zug verändert. Keine dieser
Teststellungen kam exakt im Index vor.

| Metrik | Ergebnis |
| --- | ---: |
| Indexversion | 7 |
| Indexierte Stellungen | 19.418 |
| Konzeptgruppen im Katalog | 27 |
| Davon in den Positionsprofilen erkannt | 21 |
| Unbekannte Teststellungen | 80 |
| Stellungen mit geprüftem Konzepttreffer | 13 |
| Stellungen mit explizitem Konzepttransfer | 13 |
| Transferabdeckung | 16,25 % |
| p50 | 21,28 ms |
| p95 | 33,15 ms |
| Maximum | 100,26 ms |
| p95-Ziel | < 300 ms |

Die 13 Treffer sind kein freier Kommentartransfer. Der Retriever prüft vor der
Ausgabe, ob die erforderliche Konzept-ID in beiden Stellungen vorkommt und ob
ein taktischer Unterschied den Transfer sperrt. Konkrete Zugempfehlungen und
Varianten benötigen weiterhin Eröffnungsdaten beziehungsweise Stockfish.

## Kommentarwissen

Aus 55.908 untersuchten Kommentaren entstanden 697 enge Kandidaten. Freigegeben
wurden 599 neu formulierte Erkenntnisse:

- 347 taktische Motive mit direkter Stellungsbestätigung
- 252 strategische Hinweise mit Stellungsbestätigung und Quellenkonsens

Der Laufzeitindex enthält insgesamt 20.418 reproduzierbare Brettfakten und damit
21.017 geprüfte Wissenseinträge. Alle sichtbaren Texte sind feste deutsche
Neufassungen; die historische Prosa bleibt im lokalen PGN-Archiv.

## Kuratierte Konzeptsuche

Die Positionsprofile enthalten Bauernstruktur, Material, Königsstellung,
offene Linien und erkannte Konzepte. Der Katalog definiert Voraussetzungen,
typische Pläne, Gegenpläne und Abbruchbedingungen. Eine erkannte Gruppe ist
noch keine fertige Empfehlung: Die aktuelle Stellung muss die Bedingungen
erfüllen, und konkrete Züge oder Varianten benötigen weiterhin Stockfish- oder
Brettevidenz.

## Grenzen

- Der Benchmark prüft Sicherheitsgrenze, Pflichtkonzept und Suchlatenz. Er
  bewertet nicht die praktische Qualität jedes strategischen Plans.
- Nicht jede Kataloggruppe besitzt schon einen zuverlässigen Brettdetektor.
- Quellenkonsens bedeutet unterschiedliche deduplizierte PGN-Dateien. Er
  beweist nicht, dass die ursprünglichen Autoren unabhängig voneinander waren.
- Laufzeitwerte hängen von Rechner und Cachezustand ab und werden bei jeder
  Freigabe neu gemessen.
- Freie PGN-Prosa bleibt quarantänisiert und ist keine Coach-Quelle.

## Reproduktion

```bash
npm run pgn:evaluate
```

# Evaluation der Konzeptsuche und PGN-Sicherheitsgrenze

Stand: 3. August 2026

## Ergebnis

Dieser Bericht beschreibt den produktiven Laufzeitindex in Version 6. Er trennt
zwei Dinge, die frühere Berichte noch gemeinsam betrachtet haben:

- Die PGN-Schicht liefert ausschließlich deterministisch geprüfte Fakten für
  exakt dieselbe Stellung und den ausdrücklich gelieferten legalen Zug.
- Übertragbare strategische Pläne stammen aus dem getrennten kuratierten
  Konzeptwissen. Die PGN-Kommentare selbst werden weder angezeigt noch auf
  ähnliche Stellungen übertragen.

Der reproduzierbare Benchmark `npm run pgn:evaluate` hat 80 deterministisch
ausgewählte Stellungen jeweils um einen legalen Zug verändert. Keine dieser
Teststellungen kam exakt im Index vor.

| Metrik | Ergebnis |
| --- | ---: |
| Indexversion | 6 |
| Indexierte Stellungen | 19.163 |
| Konzeptgruppen im Katalog | 27 |
| Davon in den Positionsprofilen erkannt | 21 |
| Unbekannte Teststellungen | 80 |
| PGN-Laufzeittreffer in unbekannten Stellungen | 0 |
| Übertragene PGN-Pläne | 0 |
| p50 | 21,91 ms |
| p95 | 37,80 ms |
| Maximum | 99,40 ms |
| p95-Ziel | < 300 ms |

Die Nulltreffer sind die beabsichtigte Sicherheitsgrenze: Der v6-Index enthält
nur zuggebundene Fakten mit dem Geltungsbereich `exact_position_move`. Sobald
die Stellung abweicht, darf daraus kein historischer Zug, kein Feld, keine
Bewertung und kein strategischer Plan übernommen werden.

## Kuratierte Konzeptsuche

Die Positionsprofile enthalten Merkmale wie Bauernstruktur, Material,
Königsstellung, offene Linien und erkannte Konzepte. Sie helfen dabei, auf dem
aktuellen Brett passende Einträge im getrennten Konzeptkatalog zu finden. Der
Katalog definiert Voraussetzungen, typische Pläne, Gegenpläne und
Abbruchbedingungen. Er ist nicht aus frei formulierten PGN-Kommentaren
übernommen.

21 von 27 Kataloggruppen kommen in den Profilen des aktuellen PGN-Korpus vor.
Eine erkannte Gruppe ist noch keine fertige Empfehlung: Die aktuelle Stellung
muss die Bedingungen des kuratierten Eintrags erfüllen, und konkrete Züge oder
Varianten benötigen weiterhin Stockfish- beziehungsweise Brettevidenz.

## Grenzen

- Der Benchmark prüft die exakte PGN-Sicherheitsgrenze und die Suchlatenz. Er
  bewertet nicht die Schachqualität eines kuratierten Plans.
- Nicht jede Kataloggruppe besitzt im aktuellen Korpus schon ein erkanntes
  Positionsprofil.
- Laufzeitwerte hängen von Rechner und Cachezustand ab. Deshalb werden sie bei
  jeder Freigabe neu gemessen.
- Die älteren Werte zu übertragenen historischen Kommentaren gelten nicht mehr
  für Version 6. Freie PGN-Prosa bleibt quarantänisiert.

## Reproduktion

```bash
npm run pgn:evaluate
```

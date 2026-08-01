# Evaluation des Konzepttransfers

Stand: 1. August 2026

## Ergebnis

Der frühere Index (Version 3) konnte exakte Stellungen sowie ähnliche Bauern-,
Material- und Eröffnungsmuster finden, hatte aber keinen expliziten
Konzepttransfer. Version 4 ergänzte Voraussetzungen, übertragbaren Plan,
Gegenplan, Unterschiede und Abbruchbedingungen. Version 5 organisiert das
abgeleitete Wissen zusätzlich anonymisiert und zusammengefasst nach Eröffnung,
Mittelspiel, Endspiel und Sonstiges.

Der reproduzierbare reale Benchmark (`npm run pgn:evaluate`) verwendete 80
deterministisch ausgewählte, legal um einen Zug veränderte Stellungen, die als
exakte Position nicht im Index standen:

| Metrik | Ergebnis |
| --- | ---: |
| Unbekannte Teststellungen | 80 |
| Mindestens ein Suchergebnis | 71 |
| Expliziter Konzepttransfer | 71 |
| Transfer-Abdeckung | 88,75 % |
| p50 | 19,58 ms |
| p95 | 32,14 ms |
| Maximum | 74,94 ms |
| p95-Ziel | < 300 ms |

Der p95-Wert erfüllt das Latenzziel deutlich. Das Maximum bleibt sichtbar und
wird nicht in den Durchschnitt hineinglättet. Laufzeitwerte hängen von Rechner,
Cachezustand und Indexgröße ab; der Befehl misst sie deshalb reproduzierbar neu.

## Positive und negative Tests

Die Testsuite enthält je einen positiven und negativen, unabhängig benannten
Fall für 26 Konzeptgruppen: Bauernschwächen und -mehrheiten, Figurenqualität,
offene Linien, Entwicklung, Königssicherheit, Raum, Abtausch und Prophylaxe,
mehrere taktische Motive sowie zentrale Endspielkonzepte. Positive Fälle müssen
das erwartete Konzept übertragen; negative Fälle dürfen keinen Transfer
erzeugen. Ein zusätzlicher Fall hält die strategische Ähnlichkeit konstant,
ändert aber die taktische Realität und muss alle Pläne blockieren.

In diesem kontrollierten Regeltest wurden 26/26 positive Fälle erkannt und
0/26 negative Fälle fälschlich übertragen. Das entspricht in diesem
synthetischen Test Präzision 1,00 und Recall 1,00. Diese Werte dürfen nicht als
Messung an menschlich gelabelten Meisterpartien verstanden werden.

## Korpusabdeckung und Fehleranalyse

Der Katalog umfasst 26 Gruppen; 19 davon haben im aktuellen Index mindestens
einen automatisch erkannten Treffer. Fehlende oder noch nicht belastbar direkt
erkannte Gruppen werden nicht künstlich behauptet. Die wichtigsten
Fehlerquellen sind:

- automatische Detektoren können breite Kandidatenmengen erzeugen;
- ein historischer Kommentar kann mehrere Ideen enthalten, von denen nur der
  explizit ausgewiesene Plan übertragen werden darf;
- taktische Motive sind stellungsspezifischer als strategische Strukturen;
- kaputte oder nicht standardkonforme PGNs erzeugen Parserfehler und werden
  nicht als verifiziertes Wissen behandelt;
- 25.000 Kommentare sind indexiert, aber noch nicht vollständig durch
  Stockfish und Menschen freigegeben.

Falschpositive Übertragung ist teurer als ein fehlender Treffer. Deshalb wird
bei taktischem Mismatch blockiert, die Quelle und Stellungsperspektive werden
mitgegeben, und ungeprüfte Kommentare bleiben als solche markiert.

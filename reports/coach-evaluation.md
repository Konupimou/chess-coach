# Evaluationsbericht: Zug-für-Zug-Coach

Erzeugt am 2026-07-31 aus der lokalen, verifizierten Fallback-Pipeline.

## Zusammenfassung

- Kuratierte Einzelstellungen: 59
- Abgedeckte Pflichtgruppen: 32
- Konkret formulierte lokale Erklärungen: 59/59 (100 %)
- Vollständige Beispielpartien: 2
- Jede dokumentierte Variante stammt aus den gelieferten legal geprüften Kandidatenlinien.
- Materialvergleiche verwenden in beiden Linien denselben Halbzughorizont.

## Verteilung

| Kategorie | Fälle |
| --- | ---: |
| aktive_figur | 1 |
| außenposten_und_schwaches_feld | 1 |
| bauernhebel | 3 |
| bauernstruktur | 3 |
| bester_zug_ohne_taktik | 1 |
| einziger_legaler_zug | 1 |
| einzügiger_einsteller | 1 |
| entwicklung_mit_tempo | 1 |
| fesselung | 2 |
| freibauer | 1 |
| früher_damenzug | 1 |
| gabel | 1 |
| grundreihenschwäche | 1 |
| gute_entwicklung | 11 |
| günstiger_abtausch | 1 |
| kein_zuverlässiges_motiv | 1 |
| könig_und_bauern_endspiel | 1 |
| mattdrohung | 1 |
| mehrere_gleichwertige_züge | 1 |
| pattressource | 1 |
| prophylaktischer_zug | 1 |
| prophylaxe | 1 |
| rochade | 3 |
| ruhiger_eröffnungszug | 4 |
| schlechte_entwicklung | 1 |
| schlechter_läufer | 1 |
| schlechter_zug_mit_plausibler_idee | 1 |
| spieß | 1 |
| taktischer_gegenangriff | 1 |
| turm_aktivierung | 1 |
| turm_auf_offener_linie | 1 |
| turmendspiel | 1 |
| umwandlungstaktik | 1 |
| ungünstiger_abtausch | 1 |
| verpasste_rochade | 1 |
| zentrum | 1 |
| zentrum_antwort | 2 |
| zwischenzug | 1 |

## Zehn repräsentative Vorher-/Nachher-Beispiele

„Vorher“ bezeichnet die im Altcode beobachtete Schablonenklasse, nicht eine erneut ausgeführte Engine-Analyse. „Nachher“ ist die tatsächliche Ausgabe des aktuellen lokalen Coachs.

### italian-01: e4

**Vorher (Schablonenklasse)**

> Die Figur wechselt auf ihr Zielfeld. Die Alternative hielt die Stellung besser zusammen.

**Nachher (aktuelle lokale Ausgabe)**

> e4 besetzt e4 und kontrolliert zusätzlich d5.
> Das ist hier die genaueste Wahl.
> **Alternative:** a3 war praktisch gleichwertig. Der Zug: Über das Zielfeld a3 hinaus ist bei der aktuellen Analysetiefe noch kein konkret erklärbarer Zweck zuverlässig belegt.

### opening-early-queen: Qh5

**Vorher (Schablonenklasse)**

> Die Figur wechselt auf ihr Zielfeld. Die Alternative hielt die Stellung besser zusammen.

**Nachher (aktuelle lokale Ausgabe)**

> Qh5 übernimmt neu die Kontrolle über e5.
> Das ist etwas ungenau, weil du eine präzisere Möglichkeit auslässt.
> **Alternative:** Genauer war Nf3: Der Zug entwickelt den Springer nach f3.
> **Der Unterschied:** Der entscheidende Unterschied: Die Alternative entwickelt eine Figur nach f3, der gespielte Zug nicht.
> **Merksatz:** Lernregel: Kontrolliere nach jedem Kandidatenzug, ob eine Figur angegriffen und ungedeckt bleibt.

### strategy-missed-castle: Kf1

**Vorher (Schablonenklasse)**

> Die Figur wechselt auf ihr Zielfeld. Die Alternative hielt die Stellung besser zusammen.

**Nachher (aktuelle lokale Ausgabe)**

> Kf1: Über das Zielfeld f1 hinaus ist bei der aktuellen Analysetiefe noch kein konkret erklärbarer Zweck zuverlässig belegt.
> Das ist ein Fehler, weil die stärkste Antwort deine Stellung konkret verschlechtert.
> **Alternative:** O-O war hier der einzige Zug, der die Stellung hält. Der Zug rochiert kurz: Der König verlässt die Mitte und der Turm kommt ins Spiel.
> **Der Unterschied:** Nur die erste Wahl vermeidet, dass die Stellung in den klaren Verlustbereich kippt.
> **Merksatz:** Lernregel: Prüfe vor deinem Zug immer zuerst alle gegnerischen Schachs.

### tactic-mate-threat: f4

**Vorher (Schablonenklasse)**

> Die Figur wechselt auf ihr Zielfeld. Die Alternative hielt die Stellung besser zusammen.

**Nachher (aktuelle lokale Ausgabe)**

> f4 setzt einen Bauernhebel gegen e5 an.
> Das Problem: Der Zug lässt Qh4# zu.
> **Stärkste Antwort:** Darauf kommt am stärksten Qh4# mit Matt.
> **Konkrete Folge:** Du musst die Mattdrohung sofort beantworten.
> **Alternative:** Nh3 war hier der einzige Zug, der die Stellung hält. Der Zug entwickelt den Springer nach h3.
> **Der Unterschied:** Nur die erste Wahl vermeidet, dass die Stellung in den klaren Verlustbereich kippt.
> **Merksatz:** Lernregel: Prüfe vor deinem Zug immer zuerst alle gegnerischen Schachs.

### tactic-hanging-queen: Qd3

**Vorher (Schablonenklasse)**

> Die Figur wechselt auf ihr Zielfeld. Die Alternative hielt die Stellung besser zusammen.

**Nachher (aktuelle lokale Ausgabe)**

> Qd3 übernimmt neu die Kontrolle über e4.
> Das Problem: In der geprüften Antwortfolge schneidet dein Zug beim Material schlechter ab.
> **Stärkste Antwort:** Darauf kommt am stärksten Qxd3 und schlägt auf d3.
> **Konkrete Folge:** In der geprüften Folge geht für dich Material verloren.
> **Alternative:** Qe3 war hier der einzige Zug, der die Stellung hält. Der Zug übernimmt neu die Kontrolle über e4.
> **Der Unterschied:** Nur die erste Wahl vermeidet, dass die Stellung in den klaren Verlustbereich kippt.
> **Merksatz:** Lernregel: Rechne vor dem Ziehen alle direkten Schlagzüge und Rückschläge durch.

### tactic-knight-fork: Nc7+

**Vorher (Schablonenklasse)**

> Die Figur wechselt auf ihr Zielfeld. Die Alternative hielt die Stellung besser zusammen.

**Nachher (aktuelle lokale Ausgabe)**

> Nc7+ gibt sofort Schach und zwingt den König zu einer Antwort.
> Das ist hier die genaueste Wahl.
> **Stärkste Antwort:** Darauf kommt am stärksten Kd7.
> **Alternative:** Na7 war praktisch gleichwertig. Der Zug lässt den Springer auf a7 angegriffen und ungedeckt stehen.

### strategy-prophylaxis: g3

**Vorher (Schablonenklasse)**

> Die Figur wechselt auf ihr Zielfeld. Die Alternative hielt die Stellung besser zusammen.

**Nachher (aktuelle lokale Ausgabe)**

> g3: Über das Zielfeld g3 hinaus ist bei der aktuellen Analysetiefe noch kein konkret erklärbarer Zweck zuverlässig belegt.
> Das ist hier die genaueste Wahl.
> **Alternative:** f4 war praktisch gleichwertig. Der Zug setzt einen Bauernhebel gegen e5 an.

### strategy-pawn-break: f4

**Vorher (Schablonenklasse)**

> Die Figur wechselt auf ihr Zielfeld. Die Alternative hielt die Stellung besser zusammen.

**Nachher (aktuelle lokale Ausgabe)**

> f4 setzt einen Bauernhebel gegen e5 an.
> Das ist hier die genaueste Wahl.
> **Alternative:** f3 war praktisch gleichwertig. Der Zug übernimmt neu die Kontrolle über e4.

### endgame-passed-pawn: dxc4

**Vorher (Schablonenklasse)**

> Die Figur wechselt auf ihr Zielfeld. Die Alternative hielt die Stellung besser zusammen.

**Nachher (aktuelle lokale Ausgabe)**

> dxc4 nimmt auf c4 einen Bauern.
> Das ist hier die genaueste Wahl.
> **Alternative:** d4 war praktisch gleichwertig. Der Zug besetzt d4 und kontrolliert zusätzlich e5.

### forced-only-legal: Ka7

**Vorher (Schablonenklasse)**

> Die Figur wechselt auf ihr Zielfeld. Die Alternative hielt die Stellung besser zusammen.

**Nachher (aktuelle lokale Ausgabe)**

> Ka7 bringt den König von a8 näher ins Zentrum nach a7.
> Der Zug ist erzwungen: Es gibt keinen anderen legalen Zug.
> **Der Unterschied:** Es gibt in dieser Stellung genau einen legalen Zug.
> **Merksatz:** Lernregel: Prüfe vor deinem Zug immer zuerst alle gegnerischen Schachs.

## Zwei vollständige Beispielpartien

Alle Halbzüge werden aus der jeweiligen echten Vorher-Stellung erzeugt und legal auf dem Brett ausgeführt.

### Narrenmatt

#### Halbzug 1: f3

Erwarteter belegter Kernfakt: `controls_new_square`

> f3 übernimmt neu die Kontrolle über e4.
> Das ist etwas ungenau, weil du eine präzisere Möglichkeit auslässt.
> **Alternative:** Genauer war e4: Der Zug besetzt e4 und kontrolliert zusätzlich d5.

#### Halbzug 2: e5

Erwarteter belegter Kernfakt: `occupies_center`

> e5 besetzt e5 und kontrolliert zusätzlich d4.
> Das ist hier die genaueste Wahl.
> **Alternative:** Nc6 war praktisch gleichwertig. Der Zug entwickelt den Springer nach c6.

#### Halbzug 3: g4

Erwarteter belegter Kernfakt: `allows_checkmate`

> g4: Über das Zielfeld g4 hinaus ist bei der aktuellen Analysetiefe noch kein konkret erklärbarer Zweck zuverlässig belegt.
> Das Problem: Der Zug erlaubt sofort Qh4#.
> **Stärkste Antwort:** Darauf kommt am stärksten Qh4# mit Matt.
> **Konkrete Folge:** Du musst die Mattdrohung sofort beantworten.
> **Alternative:** g3 war hier der einzige Zug, der die Stellung hält. Der Zug: Über das Zielfeld g3 hinaus ist bei der aktuellen Analysetiefe noch kein konkret erklärbarer Zweck zuverlässig belegt.
> **Der Unterschied:** Nur die erste Wahl vermeidet, dass die Stellung in den klaren Verlustbereich kippt.
> **Merksatz:** Lernregel: Prüfe vor deinem Zug immer zuerst alle gegnerischen Schachs.

#### Halbzug 4: Qh4#

Erwarteter belegter Kernfakt: `gives_checkmate`

> Qh4# setzt den gegnerischen König matt.
> Das ist hier die genaueste Wahl.
> **Alternative:** Nc6 war ebenfalls möglich, aber etwas weniger genau. Der Zug entwickelt den Springer nach c6.

### Schäfermatt

#### Halbzug 1: e4

Erwarteter belegter Kernfakt: `occupies_center`

> e4 besetzt e4 und kontrolliert zusätzlich d5.
> Das ist hier die genaueste Wahl.
> **Alternative:** a3 war praktisch gleichwertig. Der Zug: Über das Zielfeld a3 hinaus ist bei der aktuellen Analysetiefe noch kein konkret erklärbarer Zweck zuverlässig belegt.

#### Halbzug 2: e5

Erwarteter belegter Kernfakt: `occupies_center`

> e5 besetzt e5 und kontrolliert zusätzlich d4.
> Das ist hier die genaueste Wahl.
> **Alternative:** Nc6 war praktisch gleichwertig. Der Zug entwickelt den Springer nach c6.

#### Halbzug 3: Bc4

Erwarteter belegter Kernfakt: `develops_piece`

> Bc4 entwickelt den Läufer nach c4.
> Das ist praktisch genauso gut wie die erste Wahl.
> **Alternative:** Nf3 war praktisch gleichwertig. Der Zug entwickelt den Springer nach f3.
> **Der Unterschied:** Der entscheidende Unterschied: Die Alternative vermeidet, dass die Figur auf c4 ungedeckt bleibt.
> **Merksatz:** Lernregel: Kontrolliere nach jedem Kandidatenzug, ob eine Figur angegriffen und ungedeckt bleibt.

#### Halbzug 4: Nc6

Erwarteter belegter Kernfakt: `develops_piece`

> Nc6 entwickelt den Springer nach c6.
> Das ist hier die genaueste Wahl.
> **Alternative:** Na6 war praktisch gleichwertig. Der Zug entwickelt den Springer nach a6.

#### Halbzug 5: Qh5

Erwarteter belegter Kernfakt: `early_queen_move`

> Qh5 übernimmt neu die Kontrolle über e5.
> Das ist etwas ungenau, weil du eine präzisere Möglichkeit auslässt.
> **Alternative:** Genauer war Nf3: Der Zug entwickelt den Springer nach f3.
> **Der Unterschied:** Der entscheidende Unterschied: Die Alternative entwickelt eine Figur nach f3, der gespielte Zug nicht.
> **Merksatz:** Lernregel: Kontrolliere nach jedem Kandidatenzug, ob eine Figur angegriffen und ungedeckt bleibt.

#### Halbzug 6: Nf6

Erwarteter belegter Kernfakt: `allows_checkmate`

> Nf6 entwickelt den Springer nach f6.
> Das Problem: Der Zug erlaubt sofort Qxf7#.
> **Stärkste Antwort:** Darauf kommt am stärksten Qxf7# mit Matt.
> **Konkrete Folge:** Du musst die Mattdrohung sofort beantworten.
> **Alternative:** g6 war hier der einzige Zug, der die Stellung hält. Der Zug lässt die Dame auf h5 angegriffen und ungedeckt stehen.
> **Der Unterschied:** Nur die erste Wahl vermeidet, dass die Stellung in den klaren Verlustbereich kippt.
> **Merksatz:** Lernregel: Prüfe vor deinem Zug immer zuerst alle gegnerischen Schachs.

#### Halbzug 7: Qxf7#

Erwarteter belegter Kernfakt: `gives_checkmate`

> Qxf7# setzt den gegnerischen König matt.
> Das ist hier die genaueste Wahl.
> **Alternative:** Qg6 war ebenfalls möglich, aber etwas weniger genau. Der Zug übernimmt neu die Kontrolle über e4.

## Fachliche und technische Grenzen

- Der lokale Coach formuliert nur aus explizit extrahierten Brett- und Variantenfakten. Bei sehr kurzen Varianten kann er deshalb vorsichtiger und knapper bleiben.
- Langfristige strategische Urteile ohne messbares Stellungsmerkmal werden nicht aus einer Bewertungszahl erfunden.
- Seltene Motive wie Ablenkung, Überlastung oder ein langfristig günstiger Abtausch benötigen eine passende Variante; ohne belegte Ereignisfolge werden sie nicht behauptet.
- Die KI-Fassung kann sprachlich variabler sein, muss aber dieselben Evidenz-IDs und legalen Zugreferenzen bestehen.

## Prüfstatus

- `npm test`: 435 Tests bestanden.
- `npm run build`: Produktionsbuild erfolgreich.
- Der Bericht wurde automatisch aus den festen Testdaten erzeugt und die repräsentativen Ausgaben wurden anschließend manuell auf Schachlogik, Reihenfolge und Sprache geprüft.

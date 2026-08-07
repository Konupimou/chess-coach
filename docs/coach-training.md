# Coach-Training: Didaktik lernen, Stockfish-Fakten bewahren

## Ziel

Das trainierte Sprachmodell lernt ausschließlich Auswahl, Gewichtung,
Erklärungstiefe und Formulierung. Züge, Varianten, Bewertungen, Mattangaben und
konkrete taktische Folgen stammen weiterhin aus Stockfish und der
deterministischen Brettanalyse.

Ein Trainingsbeispiel besteht deshalb aus:

- einem vollständig normalisierten Stockfish-Kontext,
- dem Lernprofil mit Ziel-Spielstärke,
- dem daraus reproduzierbar erzeugten, belegten Prompt,
- einer strukturierten Mustererklärung,
- einer ausdrücklichen menschlichen Freigabe.

Positive Nutzerbewertungen allein sind noch keine Trainingsfreigabe. Eine
hilfreich bewertete Erklärung kann fachlich unvollständig sein. Ebenso darf ein
vom Coach selbst erzeugter Text nicht ungeprüft wieder als Trainingsziel
verwendet werden.

## 1. Kandidaten erzeugen

Der Seed-Befehl erzeugt derzeit ausschließlich didaktische Varianten für
800 Elo. Weitere Zielstufen werden erst ergänzt, wenn der erste 800-Elo-Lauf
ausreichend kuratiert und blind evaluiert wurde:

```bash
npm run coach:training:seed
```

Die Ausgabe liegt standardmäßig in
`.cache/coach-training/candidates.jsonl`. Diese Datensätze tragen bewusst
`lifecycle: "generated"` und werden vom Dataset-Builder abgelehnt.

Eine andere Stufe kann später weiterhin ausdrücklich gewählt werden:

```bash
node scripts/seed-coach-training-candidates.mjs \
  --ratings=1000 \
  --output=.cache/coach-training/candidates.jsonl
```

Die festen Evaluationsfälle sind nur der Start. Für ein belastbares Training
werden zusätzlich reale, deduplizierte Stellungen aus unterschiedlichen
Partien, Phasen, Fehlerklassen und Spielstärken benötigt.

## 2. Menschlich kuratieren

Die lokale Review-Oberfläche wird so gestartet:

```bash
npm run coach:training:review
```

Danach wird im Browser `http://localhost:3000/training-review` geöffnet. Die
Oberfläche zeigt Stellung, Zug, Stockfish-Variante und Ziel-Spielstärke. Nur die
Texte vorhandener Erklärungsfelder lassen sich verändern; Belege,
Zugreferenzen, Bewertungen und der Stockfish-Kontext bleiben gesperrt. Aktuell
zeigt die Oberfläche ausschließlich 800-Elo-Kandidaten.

Beim Freigeben durchläuft der redigierte Text unmittelbar dieselben Evidence-,
Zug-, Bewertungs- und Sprach-Guards wie der Produktivcoach. Eine abgelehnte
Freigabe wird nicht in das Trainingsdataset geschrieben. Entscheidungen werden
lokal unter `.cache/coach-training/review-decisions.json` fortlaufend gesichert,
freigegebene Beispiele unter `data/training/coach-approved.jsonl`.

Die Route ist in Produktions-Builds standardmäßig deaktiviert. Eine öffentliche
Trainingsadministration benötigt zuerst einen eigenen Zugriffsschutz und eine
dauerhafte Datenbank.

Für jeden Kandidaten werden nur die `text`-Werte der vorhandenen
Erklärungsfelder redaktionell verbessert. `subjectUci`, `subjectSan`,
`evidenceIds`, `moveRefs`, Null-Felder und `confidence` bleiben an den
verifizierten Entwurf gebunden.

Bei ruhigen Zügen genügt eine reine Brettbeschreibung nicht. Das Feld
`moveIdea` soll zuerst die Wirkung und anschließend den belegten Grund nennen,
zum Beispiel: „Der Springer kommt nach f3. Dort kontrolliert er d4.“ Wenn die
vorhandenen Belege keinen konkreten Grund tragen, wird der Kandidat abgelehnt
oder übersprungen, statt eine Erklärung zu erfinden.

Nach der fachlichen und didaktischen Prüfung erhält der Datensatz:

```json
{
  "lifecycle": "human_approved",
  "approval": {
    "reviewer": "Name oder internes Reviewer-Kürzel",
    "reviewedAt": "2026-08-05T12:00:00.000Z"
  }
}
```

Die freigegebenen JSONL-Zeilen werden unter
`data/training/coach-approved.jsonl` gesammelt. In diese Datei gehören keine
E-Mail-Adressen, Kontonamen, freien Chatverläufe oder sonstigen Nutzerdaten.

## 3. Dataset prüfen und aufteilen

```bash
npm run coach:training:check
npm run coach:training:build
```

Der Builder rekonstruiert für jede Zeile den Stockfish- und Brettkontext und
wendet dieselben Evidence-, Zug-, Bewertungs- und Sprach-Guards an wie der
Produktivcoach. Schon ein zurückgesetztes oder unbelegtes Feld verhindert den
Export. Der Standardexport berücksichtigt aktuell ausschließlich freigegebene
800-Elo-Beispiele der aktuellen Kandidatenrevision; vorhandene andere
Zielstufen und ältere Entwürfe werden weder gelöscht noch verwendet.

Die Ausgabe unter `.cache/coach-training/` enthält:

- `train.jsonl`: freigegebene SFT-Nachrichten,
- `validation.jsonl`: Modellauswahl und frühes Stoppen,
- `test.jsonl`: vollständig zurückgehaltener Gold-Test mit Prüfkontext,
- `manifest.json`: IDs, Gruppenzuordnung, Counts und Dataset-Hash.

Alle Beispiele mit demselben `groupKey` landen im selben Split. Varianten
derselben Partie oder Stellung müssen daher denselben `groupKey` verwenden.
So gelangen keine nahezu identischen Positionen aus dem Training in den Test.

## 4. Modell trainieren

`train.jsonl` und `validation.jsonl` verwenden das übliche
`messages`-Format mit System-, Nutzer- und Assistant-Nachricht. Damit kann ein
geeigneter SFT-Runner oder ein unterstützter Hosted-Training-Dienst gespeist
werden. Anbieter-, Modell-, Hardware- und Lizenzwahl bleiben absichtlich vom
Dataset getrennt.

Der Trainingslauf darf niemals `test.jsonl` sehen. Der Test wird erst nach der
Modellauswahl ausgeführt. Ein Modell wird nur übernommen, wenn es gegenüber dem
aktuellen Coach bei mindestens gleicher Guard-Passrate bessere didaktische
Werte erreicht.

Zu messen sind mindestens:

- gültige strukturierte Ausgaben,
- bestandene Evidence- und Sprach-Guards,
- richtige Priorisierung von Matt, Material und direkten Gefahren,
- Verständlichkeit je Ziel-Spielstärke,
- unnötige Fachbegriffe und Satzlänge,
- Latenz und Kosten pro bestandener Erklärung.

## 5. Produktiv einsetzen

Auch nach erfolgreichem Training bleibt die Laufzeitkette unverändert:

```text
Stockfish und Brettlogik
→ belegter Prompt
→ trainiertes Sprachmodell
→ serverseitige Evidence- und Sprachprüfung
→ Anzeige oder sicherer lokaler Fallback
```

Das Modell ersetzt also niemals Stockfish. Es lernt, die bereits geprüften
Fakten besser auszuwählen und für den jeweiligen Spieler verständlicher zu
erklären.

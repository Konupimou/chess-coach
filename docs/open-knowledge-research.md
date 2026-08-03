# Offene Wissensquellen für den Coach

Stand: **1. August 2026**

## Ziel und Grenze

Der Coach darf offen lizenzierte Schachdaten als Trainingsmaterial nutzen. Die
Texte des Coaches bleiben eigenständige, kurze Erklärungen. Eine Puzzle-Markierung
belegt nur das Motiv der importierten Aufgabe; sie beweist nicht, dass dasselbe
Motiv in einer beliebigen aktuellen Stellung vorhanden ist. Konkrete Züge und
Taktiken brauchen weiterhin Brett- und Engine-Evidenz.

## Importierte Quelle: Lichess Puzzle Database

Die [Lichess Puzzle Database](https://database.lichess.org/#puzzles) wird von
Lichess unter **CC0 1.0 Universal** bereitgestellt. Der Import vom 1. August 2026
hat die offizielle komprimierte CSV vollständig als Stream gelesen:

- 6.057.356 gelesene Quelldatensätze
- 7.394 angenommene, anonymisierte Trainingsdatensätze
- Rating 600 bis 1.100
- Ratingabweichung höchstens 100
- Popularität mindestens 60
- feste Quoten je ausgewähltem Thema

Die Datei `data/knowledge/lichess-puzzles-800.json` speichert je Eintrag nur
Trainings-FEN, Lösungszüge, Rating, passende Themen und einen neu erzeugten
technischen Hash. Puzzle-ID, Partie-URL, Eröffnungstags, Spielernamen und andere
Zuordnungen zur Quellpartie werden bereits beim Lesen verworfen. Die etwaige
Quell-FEN vor dem vorbereitenden Zug wird ebenfalls nicht übernommen.

Die Rohdatei `lichess_db_puzzle.csv.zst` wird nicht gespeichert. Der Importer
dekomprimiert den HTTPS-Datenstrom zeilenweise und schreibt nur das kleine,
gefilterte Ergebnis. Dadurch wird weder die vollständige Lichess-Datenbank noch
eine temporäre Kopie in das Repository aufgenommen.

## Themen und Quoten

Bei Aufgaben mit mehreren passenden Themen weist der Importer ein primäres
Thema deterministisch nach dem noch offenen Quotenkontingent zu. Die Anzahl in
der Tabelle zählt dieses primäre Thema.

| Lichess-Thema | Verwendung im Coach | Einträge |
| --- | --- | ---: |
| `pawnEndgame` | Bauernendspiele und Bauernrennen | 1.000 |
| `rookEndgame` | Turmendspiele und Turmaktivität | 1.000 |
| `bishopEndgame` | Läuferendspiele | 600 |
| `knightEndgame` | Springerendspiele | 600 |
| `deflection` | Ablenkung | 750 |
| `capturingDefender` | Verteidiger beseitigen | 750 |
| `backRankMate` | Grundreihenschwäche | 750 |
| `defensiveMove` | aktive und genaue Verteidigung | 1.000 |
| `equality` | Ressourcen zum Ausgleich | 444 |
| `sacrifice` | Opfermotive, einschließlich Qualitätsopfer-Kandidaten | 500 |

Die Zielquote für `equality` war 500. Nach dem vollständigen Scan erfüllten 444
eindeutige Aufgaben alle Filter; es wurden keine schwächeren Datensätze zum
Auffüllen zugelassen.

## Reproduzierbarer Import

Vom Repository-Stamm aus erzeugt folgender Befehl denselben Filterlauf gegen
die jeweils unter der offiziellen URL verfügbare Quelldatei:

```bash
node scripts/import-lichess-puzzles.mjs \
  https://database.lichess.org/lichess_db_puzzle.csv.zst \
  --output data/knowledge/lichess-puzzles-800.json \
  --min-rating 600 \
  --max-rating 1100 \
  --max-rating-deviation 100 \
  --min-popularity 60 \
  --themes pawnEndgame,rookEndgame,bishopEndgame,knightEndgame,deflection,capturingDefender,backRankMate,defensiveMove,equality,sacrifice \
  --theme-quota pawnEndgame=1000 \
  --theme-quota rookEndgame=1000 \
  --theme-quota bishopEndgame=600 \
  --theme-quota knightEndgame=600 \
  --theme-quota deflection=750 \
  --theme-quota capturingDefender=750 \
  --theme-quota backRankMate=750 \
  --theme-quota defensiveMove=1000 \
  --theme-quota equality=500 \
  --theme-quota sacrifice=500
```

Die Auswahl ist bei identischer Quelldatei deterministisch. Da Lichess die
Datei fortlaufend aktualisieren kann, können ein späterer Download und damit
auch die resultierenden Hashes oder Trefferzahlen abweichen. Für eine exakt
bytegleiche Wiederholung muss zusätzlich derselbe Quell-Snapshot bereitgestellt
werden; der Importer akzeptiert dafür auch eine lokale `.csv`- oder
`.csv.zst`-Datei.

## Recherchierte, aber nicht automatisiert übernommene Quellen

### Chess.com

Chess.com wurde als mögliche Lernquelle geprüft. Das am 1. August 2026 geltende
[User Agreement](https://www.chess.com/legal/user-agreement) enthält eigene
Regeln für den Einsatz automatisierter und KI-gestützter Werkzeuge auf
Chess.com-Inhalten. Deshalb werden Chess.com-Seiten, Artikel, Partien und
Erklärungen nicht automatisiert abgerufen, extrahiert oder in den Coach-Bestand
übernommen. Es gibt keinen Chess.com-Scraper und keinen daraus erzeugten
Datensatz in diesem Repository.

### YouTube

YouTube dient ausschließlich als manuelle Referenz für die menschliche
Recherche. Videos werden weder heruntergeladen noch automatisch transkribiert,
und Untertitel, Beschreibungen oder Sprechertexte werden nicht in die
Wissensbasis kopiert. Aus der Recherche entstehen nur eigenständig formulierte,
allgemeine Schachprinzipien; YouTube-Inhalte sind kein Laufzeit-Datensatz des
Coaches.

Für die Gegenprüfung des Abschnitts zu Prophylaxe und gegnerischen Plänen
wurden unter anderem diese frei erreichbaren Lehrvideos manuell angesehen:

- https://www.youtube.com/watch?v=GIQx0UFTjPA
- https://www.youtube.com/watch?v=5P8CSC0w6Is

Die Links dokumentieren nur den Rechercheweg. Titel, Kanalnamen, Transkripte
und Video-Metadaten werden nicht in die Laufzeitdaten übernommen.

## Datenpflege

- Lizenz- und Quellenangaben bleiben in `THIRD_PARTY_NOTICES.md` erhalten.
- Die Laufzeitdaten enthalten keine Autoren-, Video- oder Artikeltitel.
- Ein neuer Import muss Filter, Datum und Trefferzahlen dokumentieren.
- Änderungen an Quelle oder Lizenz werden vor dem nächsten Import erneut
  geprüft.
- Rätselstellungen liefern Übungsmaterial; Erklärungen werden nicht aus
  Quelltexten kopiert und konkrete Empfehlungen bleiben evidenzgebunden.

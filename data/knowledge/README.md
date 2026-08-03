# Quellenbewusste Coach-Claims

Diese Daten enthalten **keine Buchzitate**. Die deutschen Texte sind eigenständige,
knappe Paraphrasen allgemein anerkannter Schachprinzipien. Quellen dienen als
bibliografische Provenienz und als Ausgangspunkt für eine menschliche Prüfung,
nicht als Erlaubnis, geschützten Wortlaut wiederzugeben.

Ein Claim darf nur verwendet werden, wenn:

1. seine `reviewStatus` den Wert `reviewed` hat,
2. jede referenzierte Quelle geprüft ist,
3. alle `requiredFeatures` in der analysierten Stellung erkannt wurden,
4. kein `excludedFeatures`-Merkmal erkannt wurde,
5. Phase und Lernniveau passen.

Die Merkmals-IDs beschreiben bereits **verifizierte Stellungsbefunde**. Der
Retriever erfindet oder erkennt sie nicht selbst. Beispiele:

- `center.tension`: Es besteht tatsächlich eine zentrale Bauernspannung.
- `king.can_castle_safely`: Die Rochade ist legal und nach konkreter Prüfung
  sicher genug.
- `tactic.loose_piece`: Mindestens eine gegnerische Figur ist unverteidigt oder
  unzureichend verteidigt.
- `endgame.rook_and_passed_pawn`: Ein relevantes Turmendspiel mit Freibauer
  liegt vor.

Konkrete Taktik und die Legalität von Zügen müssen weiterhin durch Brettlogik
und Engine geprüft werden. Die Claims erklären belegte Merkmale; sie ersetzen
keine Variantenberechnung.

## Erkenntnisse aus PGN-Kommentaren

PGN-Rohkommentare werden nicht in den Laufzeitindex kopiert. Der Importer nutzt
sie nur als Signal für einen kleinen Katalog klar definierter Schachkonzepte.
Der FEN-basierte Stellungsdetektor muss das genannte Konzept unabhängig
bestätigen. Taktische Motive wie Fesselung, Mehrfachangriff oder Mattzug gelten
nur in der exakten Stellung. Strategische Motive wie Freibauer, Vorposten,
offene Linie oder Raumvorteil brauchen zusätzlich mindestens zwei
deduplizierte PGN-Quellen.

Gespeichert werden ausschließlich neue, kurze deutsche Textvorlagen mit
Pflicht-Konzept-ID und Prüfstatus. Namen, Titel, Dateinamen, Originalprosa,
historische Varianten und historische Bewertungen bleiben außerhalb des
Laufzeitwissens. Bei ähnlichen Stellungen darf nur eine Erkenntnis mit derselben
nachgewiesenen Pflicht-Konzept-ID übertragen werden.

## Offene Puzzle-Daten für 800 Elo

`lichess-puzzles-800.json` enthält einen am 1. August 2026 erzeugten,
anonymisierten Ausschnitt der unter CC0 veröffentlichten Lichess Puzzle
Database. Aus 6.057.356 gelesenen Zeilen wurden 7.394 Aufgaben mit Rating 600
bis 1.100, niedriger Ratingabweichung und ausreichender Popularität ausgewählt.

Abgedeckt sind Bauern-, Turm-, Läufer- und Springerendspiele sowie Ablenkung,
das Beseitigen eines Verteidigers, Grundreihenmotive, Verteidigungszüge,
Ausgleichsressourcen und Opfermotive. Der Datensatz enthält keine Quell-IDs,
Partie-URLs, Eröffnungstags, Spieler- oder Autorennamen. Die komprimierte
Rohdatenbank wurde beim Import nur gestreamt und nicht gespeichert.

Filter, Themenquoten, der reproduzierbare Importbefehl und die Grenzen für
Chess.com- und YouTube-Recherche stehen in
[`docs/open-knowledge-research.md`](../../docs/open-knowledge-research.md).
Lizenzhinweise stehen zusätzlich in
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

Puzzle-Themen dürfen nur für den jeweiligen importierten Datensatz als belegt
gelten. Der Coach darf daraus nicht ohne separate Stellungsprüfung ableiten,
dass dieselbe Taktik auf dem aktuellen Brett vorhanden ist.

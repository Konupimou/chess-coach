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

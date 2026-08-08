# Position Diagnosis Layer

## Ziel

Die Diagnose-Schicht beantwortet nicht selbst in natürlicher Sprache, sondern verdichtet bereits geprüfte Stellungsdaten zu einer begründeten Rangfolge. Dadurch erhält der Coach einen Hauptgrund, mögliche Nebengründe und ausdrücklich als Hintergrund markierte Merkmale.

Die Pipeline lautet:

```text
FEN + analysierter Zug
  → normalisierter Stockfish-Kontext
  → legal geprüfte Vorher-/Nachher- und PV-Evidenz
  → Muster- und Konzepterkennung
  → strukturierte Stellungsdiagnose
  → lokaler oder KI-basierter Coach-Text
```

## Bestehende Bausteine

- `coachEngineContext.js` normalisiert Engine-Ergebnisse, Kandidaten und Hauptvarianten.
- `positionEvidence.js` prüft FEN, Zug und PVs mit `chess.js`. Es berechnet unter anderem Material, Entwicklung, Zentrum, Königssicherheit, Bauernstruktur, Figurenrisiken und die Unterschiede zwischen gespielter und bester Linie.
- `patternRecognition.js` erkennt taktische und strategische Muster. Die Treffer bleiben Beobachtungen; ein Treffer ist noch keine Ursache der Enginebewertung.
- `positionConcepts.js` liefert den strategischen Stellungs-Fingerabdruck.
- `positionDiagnosis.js` verbindet diese Daten mit den vorhandenen Engine-Linien und priorisiert sie.
- `coachExplanation.js` erzeugt einen streng beleggebundenen lokalen Entwurf.
- `api/chat.js` übergibt Diagnose, geprüfte Evidenz, Engine-Kontext und ausgewähltes Lehrwissen an den Coach.

Vor der Diagnose-Schicht konnte der lokale Entwurf den ersten Stellungsunterschied oder ein passendes erkanntes Muster auswählen. Damit konnte ein echtes, aber nebensächliches Merkmal die Erklärung dominieren. Außerdem gab es keine einheitliche Aussage darüber, ob die Daten überhaupt für eine kausale Erklärung ausreichen.

## Schema

`buildPositionDiagnosis()` liefert ein versioniertes, maschinenlesbares Objekt:

```js
{
  version,
  valid,
  mode,
  phase,
  subject,
  evaluation: { before, after, changeCp, lossCp },
  primaryReason,
  secondaryReasons,
  detectedFeatures,
  candidateExplanations,
  causalValidation,
  evaluationDrivers,
  backgroundFeatures,
  pvEvidence,
  uncertainties,
  confidence: { value, level }
}
```

Ein Grund enthält Konzept, Beschreibung, Relevanzwert, Konfidenz, Evidenzstärke, Beleg-IDs, Signale, beteiligte Felder/Figuren und Quelldetails. `primaryReason` darf `null` sein.

Die drei Rollen sind bewusst getrennt:

- `primaryReason`: stärkster ausreichend belegter Erklärungsgrund
- `secondaryReasons`: weitere unabhängige, kontextuell gestützte Gründe
- `backgroundFeatures`: erkannte, aber für die aktuelle Bewertung oder Zugwahl nicht ausreichend belegte Merkmale

`detectedFeatures` enthält alle drei Gruppen und markiert ihre jeweilige Relevanz. So gehen Erkennungsdaten nicht verloren, ohne dass der Coach alles als gleich wichtig darstellt.

## Candidate Explanation und Causal Validation

Seit Diagnoseversion 2 wird ein erkanntes Feature nicht mehr unmittelbar als Erklärungsgrund sortiert. Die Verarbeitung trennt drei Stufen:

```text
primitives Brettmerkmal
  → Candidate Explanation
  → Causal Validation
  → Evaluationsursache oder Hintergrundmerkmal
```

Ein taktisches Motiv irgendwo in einer langen PV ist zunächst nur ein primitives Merkmal. Es wird erst als Ursache validiert, wenn beispielsweise der analysierte Zug selbst das Motiv ausführt, das Muster ausdrücklich den Enginezug unterstützt oder die konkrete gegnerische Antwort den Bewertungsverlust erklärt. Motive auf späteren PV-Halbzügen und reine Feldüberschneidungen erhalten `supporting_only` und können keinen Hauptgrund verdrängen. Bestzug- und Spielerzug-Zweig werden beim Zusammenführen getrennt gehalten.

Die strategischen Candidate Explanations werden aus mehreren unabhängigen Belegen synthetisiert:

- `compensation`: materieller Rückstand oder nachhaltige Investition bei stabiler Enginebewertung und gestützter PV,
- `initiative`: ruhiger Enginezug mit deutlichem MultiPV-Abstand und fortgesetztem Druck in der Hauptvariante,
- `prophylaxis`: verhinderte konkrete Ressource oder eine gegnerische Antwort, die in mehreren schwächeren MultiPV-Gegenfakten vorkommt und nach dem gewählten Zug ausfällt.

`causalValidation` hält für jeden Kandidaten Status, Rolle und Begründung fest. `candidateExplanations` macht die synthetisierten Ursachen separat prüfbar. Die Priorisierung verwendet danach den kausal validierten Wert; der ursprüngliche Relevanzwert bleibt als Diagnoseinformation erhalten.

## Relevanz statt statischer Konzeptwerte

Die Diagnose weist einem Konzept keinen festen Schachwert zu. Sie sammelt stattdessen unabhängige Evidenzsignale, zum Beispiel:

- Unterschied zwischen gespielter und bester Linie bei vergleichbarem Analysehorizont
- konkreter Schlag, Schach, Matt oder Materialverlauf in einer legal geprüften PV
- taktisches Motiv in genau der betroffenen Linie
- neu erzeugte oder verhinderte Gefahr im Vorher-/Nachher-Vergleich
- Erzeugen, Entfernen oder direktes Ausnutzen eines erkannten Musters
- direkte Verbindung von Bestzug, analysiertem Zug, kritischen Feldern und Muster
- Übereinstimmung mit einem deutlichen Bewertungsverlust
- ausreichende Engine-Tiefe

Mehrere Signale, die nur dieselbe Beobachtung ausdrücken, werden nicht doppelt gezählt. Eine kleine Konzept-Spezifität dient ausschließlich als Gleichstandsentscheidung zwischen ähnlich stark belegten Kandidaten; sie ist kein Centipawn-Wert und kann fehlende Evidenz nicht ersetzen.

Ein Kandidat wird nur Hauptgrund, wenn Kausalstatus, Relevanz, Zahl unabhängiger Belege und berechnete Konfidenz Mindestwerte erreichen. Andernfalls bleibt `primaryReason` leer und `uncertainties` erklärt den Grund, etwa fehlende Vergleichslinien, geringe Tiefe, Mehrdeutigkeit oder keine bestätigte Ursache.

## PV-Auswertung und Vorher-/Nachher-Vergleich

Die Diagnose verwendet ausschließlich die schon in `positionEvidence.js` legal geprüften Linien. Daraus werden unter anderem Schläge, Schachs, Matt, Umwandlungen, taktische Motive, Materialverlauf sowie beteiligte Figuren und Felder als `pvEvidence` referenziert.

Für die Zugdiagnose werden die Effekte des gespielten Zugs und des Enginezugs getrennt gehalten. Unterschiede und Gefahren aus `moveComparison` verbinden den Bewertungswechsel mit dem konkreten Brettgeschehen. Ein Muster, das lediglich irgendwo auf dem Brett vorhanden ist, bleibt Hintergrund, solange die Enginefortsetzung es nicht erzeugt, nutzt, verhindert oder beseitigt.

## Coach- und Wissensintegration

Der lokale Entwurf nutzt den diagnostizierten Unterschied beziehungsweise das diagnostizierte Muster statt pauschal den ersten Treffer auszuwählen. Der KI-Prompt erhält einen eigenen `<position_diagnosis>`-Block und die klare Regel, Hintergrundmerkmale nicht als Ursache zu verkaufen. Vom Rohbestand der Muster werden nur solche zusätzlich übergeben, die als Haupt- oder Nebengrund diagnostiziert wurden. Bei begrenzter Diagnose muss der Coach Unsicherheit sichtbar machen.

Lokales PGN-, Eröffnungs- oder RAG-Wissen wird erst danach ausgewählt. Es kann die Erklärung didaktisch ergänzen, bestimmt aber nicht die Wahrheit über die konkrete Stellung.

## Performance

Die Schicht startet keine zusätzliche Stockfish-Analyse und keinen LLM-Aufruf. Sie arbeitet deterministisch auf dem bereits normalisierten Engine-Kontext, der vorhandenen Brett-Evidenz und den erkannten Mustern. Der zusätzliche Aufwand besteht aus dem Sortieren und Zusammenführen einer kleinen Kandidatenmenge.

## Tests

`test/positionDiagnosis.test.js` prüft das Schema und Fälle für hängende Figur, Gabel, Fesselung, Abzugsangriff, Materialverlust, Mattangriff, unsicheren König, Entwicklung, schwachen Bauern, Freibauern, Raumvorteil, Vorposten, rein positionellen Vorteil, taktischen Bewertungssprung, ruhige starke Verbesserung, konkurrierende Muster und eine absichtlich nicht sicher diagnostizierbare Stellung. `test/coachBenchmark.test.js` sichert zusätzlich die kausale Trennung an unveränderten v2-Fällen und prüft die Fingerprints beider Benchmark-Suites.

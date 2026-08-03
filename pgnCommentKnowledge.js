import { createHash } from "node:crypto";

export const PGN_COMMENT_CONCEPT_SCOPE = "structural_concept";
export const PGN_COMMENT_EXACT_SCOPE = "exact_position_comment";

const TACTICAL_CONCEPTS = new Set([
  "fork",
  "loose_piece",
  "mate_motif",
  "overloaded_defender",
  "pin",
]);

const RULES = Object.freeze([
  {
    id: "isolated_pawn",
    pattern: /\b(?:isolated pawn|isolani|isolierter?\s+bauer|isolierte[nr]?\s+bauern)\b/iu,
    topics: ["pawn_structure", "strategy"],
    summary: "Ein isolierter Bauer braucht aktives Figurenspiel. Nutze dafür offene Linien.",
  },
  {
    id: "passed_pawn",
    pattern: /\b(?:passed pawn|free pawn|freibauer|freibauern)\b/iu,
    topics: ["pawn_structure", "endgame", "strategy"],
    summary: "Ein Freibauer ist hier ein wichtiger Trumpf. Unterstütze ihn, bevor du ihn vorschiebst.",
  },
  {
    id: "backward_pawn",
    pattern: /\b(?:backward pawn|rückständiger?\s+bauer|rückständige[nr]?\s+bauern)\b/iu,
    topics: ["pawn_structure", "strategy"],
    summary: "Ein rückständiger Bauer kann zum Ziel werden. Bereite seinen Vorstoß vor oder decke ihn gut.",
  },
  {
    id: "hanging_pawns",
    pattern: /\b(?:hanging pawns?|hängende[nr]?\s+bauern)\b/iu,
    topics: ["pawn_structure", "strategy", "center"],
    summary: "Die verbundenen Zentrumsbauern geben Raum. Bereite ihren Vorstoß gut vor, damit sie nicht schwach werden.",
  },
  {
    id: "minority_attack",
    pattern: /\b(?:minority attack|minderheitsangriff)\b/iu,
    topics: ["pawn_structure", "strategy"],
    summary: "Mit der Bauernminderheit kannst du eine gegnerische Bauernschwäche schaffen. Öffne dabei eine Linie für den Turm.",
  },
  {
    id: "queenside_pawn_majority",
    pattern: /\b(?:queenside pawn majority|pawn majority on the queenside|bauernmehrheit\s+am\s+damenflügel)\b/iu,
    topics: ["pawn_structure", "endgame", "strategy"],
    summary: "Die Bauernmehrheit am Damenflügel kann einen Freibauern bilden. Rücke erst vor, wenn deine Figuren helfen.",
  },
  {
    id: "kingside_pawn_majority",
    pattern: /\b(?:kingside pawn majority|pawn majority on the kingside|bauernmehrheit\s+am\s+königsflügel)\b/iu,
    topics: ["pawn_structure", "endgame", "strategy"],
    summary: "Die Bauernmehrheit am Königsflügel kann einen entfernten Freibauern bilden. Der König sollte sie unterstützen.",
  },
  {
    id: "outpost",
    pattern: /\b(?:outpost|vorposten|desired\s+\[?[a-h][1-8]\]?\s+square)\b/iu,
    topics: ["strategy"],
    summary: "Ein Springer hat hier einen starken Vorposten. Halte ihn dort, solange er nicht günstig vertrieben werden kann.",
  },
  {
    id: "bad_bishop",
    pattern: /\b(?:bad bishop|poor bishop|schlechter?\s+läufer)\b/iu,
    topics: ["strategy"],
    summary: "Der Läufer wird von den eigenen Bauern gebremst. Aktiviere ihn außerhalb der Bauernkette oder tausche ihn günstig ab.",
  },
  {
    id: "good_bishop",
    pattern: /\b(?:good bishop|strong bishop|powerful bishop|starker?\s+läufer|guter?\s+läufer)\b/iu,
    topics: ["strategy"],
    summary: "Der Läufer hat hier eine gute Wirkung. Halte seine Diagonalen offen und greife feste Bauern an.",
  },
  {
    id: "development_advantage",
    pattern: /\b(?:lead in development|development advantage|ahead in development|better developed|entwicklungsvorsprung|besser entwickelt)\b/iu,
    topics: ["development", "center", "strategy"],
    summary: "Der Entwicklungsvorsprung gibt dir aktives Spiel. Bring jetzt die übrigen Figuren ins Spiel.",
  },
  {
    id: "open_center_against_uncastled_king",
    pattern: /\b(?:open(?:ing)? the cent(?:er|re).{0,60}(?:uncastled|king in the cent(?:er|re))|zentrum.{0,60}öffnen.{0,60}könig|könig\s+im\s+zentrum)\b/iu,
    topics: ["center", "king_safety", "strategy"],
    summary: "Der König steht noch im Zentrum. Öffne Linien nur mit konkreter Deckung und aktiven Figuren.",
  },
  {
    id: "opposite_side_castling_attack",
    pattern: /\b(?:opposite[- ]side castl|castled on opposite|entgegengesetzte[nr]?\s+rochad|verschiedene[nr]?\s+seiten\s+rochiert)\b/iu,
    topics: ["king_safety", "strategy"],
    summary: "Bei Rochaden auf verschiedenen Seiten läuft oft ein Angriffswettlauf. Öffne Linien am gegnerischen König, ohne deinen eigenen zu vergessen.",
  },
  {
    id: "rook_on_open_file",
    pattern: /\b(?:open file|open [a-h][ -]?file|double (?:the )?rooks|dopp(?:le|eln).{0,20}türme|offene[nr]?\s+linie)\b/iu,
    topics: ["strategy"],
    summary: "Die offene Linie ist ein guter Arbeitsplatz für die Türme. Verdopple sie dort oder suche ein Eindringfeld.",
  },
  {
    id: "space_advantage",
    pattern: /\b(?:space advantage|more space|raumvorteil|mehr\s+raum)\b/iu,
    topics: ["strategy"],
    summary: "Du hast mehr Raum. Verbessere zuerst deine schlechteste Figur.",
  },
  {
    id: "king_activity_endgame",
    pattern: /\b(?:active king|king activity|activate the king|centralize the king|aktiver?\s+könig|könig\s+aktivier|könig\s+zentralisier)\b/iu,
    topics: ["endgame", "strategy"],
    summary: "Im Endspiel ist der König eine aktive Figur. Bring ihn näher an wichtige Bauern und Felder.",
  },
  {
    id: "opposition",
    pattern: /\b(?:opposition|opposition gewinnen|opposition halten)\b/iu,
    topics: ["endgame"],
    summary: "Die Opposition ist hier wichtig. Nutze sie, um mit dem König ein entscheidendes Feld zu erreichen.",
  },
  {
    id: "pin",
    pattern: /\b(?:pin(?:ned|ning)?|fessel(?:ung|n|t)?|clavad[oa])\b/iu,
    topics: ["tactics"],
    summary: "In der Stellung gibt es eine Fesselung. Prüfe, ob du den Druck auf die gefesselte Figur erhöhen kannst.",
  },
  {
    id: "fork",
    pattern: /\b(?:fork|double attack|gabel|doppelangriff|doble ataque)\b/iu,
    topics: ["tactics"],
    summary: "Eine Figur greift hier mehrere Figuren gleichzeitig an. Prüfe zuerst, ob der Angreifer geschlagen werden kann.",
  },
  {
    id: "overloaded_defender",
    pattern: /\b(?:overload(?:ed|ing)? defender|overworked defender|überlastete[nr]?\s+verteidiger|verteidiger\s+überlastet)\b/iu,
    topics: ["tactics"],
    summary: "Ein Verteidiger hat hier zu viele Aufgaben. Greife eine seiner Aufgaben mit Tempo an.",
  },
  {
    id: "loose_piece",
    pattern: /\b(?:loose piece|undefended piece|hanging piece|ungedeckte?\s+figur|hängende?\s+figur)\b/iu,
    topics: ["tactics"],
    summary: "Eine Figur ist angegriffen und nicht gedeckt. Sichere sie oder nutze sie für einen Zug mit Tempo.",
  },
  {
    id: "mate_motif",
    pattern: /\b(?:forced mate|mate in|checkmate|mating move|matt in|mattzug|setzt matt)\b/iu,
    topics: ["tactics"],
    summary: "Die Stellung enthält einen direkten Mattzug. Prüfe zuerst Schachs und alle Fluchtfelder des Königs.",
  },
]);
const APPROVED_SUMMARIES = new Set(RULES.map((rule) => rule.summary));

function stableInsightId(record, conceptId) {
  return createHash("sha1")
    .update(`${record?.gameId || ""}\n${record?.path || ""}\n${record?.fenBefore || ""}\n${conceptId}`)
    .digest("hex")
    .slice(0, 16);
}

function sourceComment(record) {
  return String(record?.annotation?.originalComment || "")
    .replace(/\s+/gu, " ")
    .trim();
}

function conceptsIn(profile) {
  return Array.isArray(profile?.concepts?.concepts) ? profile.concepts.concepts : [];
}

export function pgnCommentKnowledgeCandidates(record, profile, {
  sourceId = "",
  audienceRating = 1000,
} = {}) {
  const text = sourceComment(record);
  if (text.length < 18) return [];
  const concepts = conceptsIn(profile);
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  const phase = profile?.concepts?.phase || ({ o: "opening", m: "middlegame", e: "endgame" })[profile?.phase] || "other";

  return RULES.flatMap((rule) => {
    const concept = byId.get(rule.id);
    if (!concept || !rule.pattern.test(text)) return [];
    const tactical = TACTICAL_CONCEPTS.has(rule.id);
    const scope = tactical ? PGN_COMMENT_EXACT_SCOPE : PGN_COMMENT_CONCEPT_SCOPE;
    return [{
      id: stableInsightId(record, rule.id),
      sourceId,
      supportKey: `${phase}|${rule.id}`,
      requiredConceptIds: [rule.id],
      comment: rule.summary,
      topics: [...rule.topics],
      audienceRating,
      scope,
      tactical,
      confidence: Math.max(0.7, Math.min(1, Number(concept.confidence) || 0.75)),
      evidence: {
        conceptId: rule.id,
        criticalSquares: Array.isArray(concept.criticalSquares) ? concept.criticalSquares.slice(0, 6) : [],
      },
    }];
  });
}

export function approvedPgnCommentInsight(candidate, { independentSources = 0 } = {}) {
  if (!candidate) return null;
  if (!candidate.tactical && independentSources < 2) return null;
  const verificationStatus = candidate.tactical
    ? "automatically_verified"
    : "consensus_verified";
  return {
    ...candidate,
    annotation: {
      type: "comment_derived_concept",
      scope: candidate.scope,
      requiredConceptIds: candidate.requiredConceptIds,
      claims: [{
        field: `commentConcept.${candidate.requiredConceptIds[0]}`,
        value: candidate.requiredConceptIds[0],
        confidence: candidate.confidence,
        source: candidate.tactical
          ? "anonymized_comment_plus_position_detector"
          : "anonymized_comment_consensus_plus_position_detector",
        verificationStatus,
        scope: candidate.scope,
        independentSources: candidate.tactical ? 1 : independentSources,
      }],
      alternatives: [],
    },
  };
}

export function isPgnCommentInsight(entry) {
  return entry?.annotation?.type === "comment_derived_concept";
}

export function isKnownPgnCommentInsightSummary(value) {
  return APPROVED_SUMMARIES.has(String(value || "").trim());
}

export function pgnCommentInsightSummaries() {
  return [...APPROVED_SUMMARIES];
}

const MAX_TEXT_LENGTH = 700;
const MOVE_TOKEN_PATTERN =
  /\b(?:[a-h][1-8][a-h][1-8][qrbn]?|(?:O-O(?:-O)?|0-0(?:-0)?)[+#]?|[KQRBNDTLS][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBNDTLS])?[+#]?|[a-h](?:x[a-h])?[1-8](?:=[QRBNDTLS])?[+#]?)\b/gi;

export const MOVE_EXPLANATION_SCHEMA_VERSION = 3;
export const MOVE_EXPLANATION_CACHE_VERSION = 4;

const CLAIM_KINDS = Object.freeze([
  "assessment",
  "move_effect",
  "position_change",
  "variation",
  "alternative",
  "opening",
  "principle",
]);

const MOVE_REFERENCE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["lineEvidenceId", "startPly", "uci"],
  properties: {
    lineEvidenceId: { type: "string", minLength: 1, maxLength: 120 },
    startPly: { type: "integer", minimum: 0, maximum: 99 },
    uci: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "string",
        pattern: "^[a-h][1-8][a-h][1-8][qrbn]?$",
      },
    },
  },
});

const CLAIM_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["claimKind", "text", "evidenceIds", "moveRefs"],
  properties: {
    claimKind: { type: "string", enum: CLAIM_KINDS },
    text: { type: "string", minLength: 1, maxLength: MAX_TEXT_LENGTH },
    evidenceIds: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 120 },
    },
    moveRefs: {
      type: "array",
      maxItems: 3,
      items: MOVE_REFERENCE_SCHEMA,
    },
  },
});

const SEMANTIC_CLAIM_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["text", "evidenceIds", "moveRefs"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: MAX_TEXT_LENGTH },
    evidenceIds: CLAIM_SCHEMA.properties.evidenceIds,
    moveRefs: CLAIM_SCHEMA.properties.moveRefs,
  },
});

const NULLABLE_SEMANTIC_CLAIM_SCHEMA = Object.freeze({
  anyOf: [
    SEMANTIC_CLAIM_SCHEMA,
    { type: "null" },
  ],
});

export const MOVE_EXPLANATION_JSON_SCHEMA = Object.freeze({
  name: "grounded_move_explanation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "subjectUci",
      "subjectSan",
      "verdict",
      "moveIdea",
      "opponentReply",
      "concreteConsequence",
      "alternative",
      "comparison",
      "takeaway",
      "confidence",
    ],
    properties: {
      schemaVersion: { type: "integer", enum: [MOVE_EXPLANATION_SCHEMA_VERSION] },
      subjectUci: {
        type: "string",
        pattern: "^[a-h][1-8][a-h][1-8][qrbn]?$",
      },
      subjectSan: { type: "string", minLength: 1, maxLength: 24 },
      verdict: SEMANTIC_CLAIM_SCHEMA,
      moveIdea: SEMANTIC_CLAIM_SCHEMA,
      opponentReply: NULLABLE_SEMANTIC_CLAIM_SCHEMA,
      concreteConsequence: NULLABLE_SEMANTIC_CLAIM_SCHEMA,
      alternative: NULLABLE_SEMANTIC_CLAIM_SCHEMA,
      comparison: NULLABLE_SEMANTIC_CLAIM_SCHEMA,
      takeaway: NULLABLE_SEMANTIC_CLAIM_SCHEMA,
      confidence: {
        type: "string",
        enum: ["high", "medium", "limited"],
      },
    },
  },
});

function cleanText(value, maximum = MAX_TEXT_LENGTH) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maximum)
    : "";
}

function cleanUci(value) {
  const move = cleanText(value, 5).toLowerCase();
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move) ? move : "";
}

function normalizeToken(value) {
  return cleanText(value, 24)
    .replace(/[+#]+$/, "")
    .replace(/^0-0-0$/i, "O-O-O")
    .replace(/^0-0$/i, "O-O")
    .toLowerCase();
}

function localizedSanAliases(value) {
  const source = normalizeToken(value);
  if (!source) return [];
  const aliases = new Set([source]);
  const englishToGerman = { k: "k", q: "d", r: "t", b: "l", n: "s" };
  const germanToEnglish = { k: "k", d: "q", t: "r", l: "b", s: "n" };
  if (englishToGerman[source[0]]) {
    aliases.add(`${englishToGerman[source[0]]}${source.slice(1)}`);
  }
  if (germanToEnglish[source[0]]) {
    aliases.add(`${germanToEnglish[source[0]]}${source.slice(1)}`);
  }
  return [...aliases];
}

function isCitableEvidenceRecord(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof value.id === "string"
    && value.id.trim()
    && (
      Object.hasOwn(value, "fact")
      || typeof value.principle === "string"
      || typeof value.paraphrase === "string"
    )
  );
}

function addEvidenceRecords(value, result, seen) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (isCitableEvidenceRecord(entry)) {
        result.set(entry.id.trim(), entry);
      }
    });
    return;
  }
  if (isCitableEvidenceRecord(value)) {
    result.set(value.id.trim(), value);
    return;
  }
  [
    value.positionEvidence,
    value.supplementalEvidence,
    value.evidence,
  ].forEach((entry) => addEvidenceRecords(entry, result, seen));
}

function evidenceRecordMap(...sources) {
  const records = new Map();
  const seen = new Set();
  sources.forEach((source) => addEvidenceRecords(source, records, seen));
  return records;
}

export function collectEvidenceIds(...sources) {
  return new Set(evidenceRecordMap(...sources).keys());
}

function underlyingPositionEvidence(value) {
  if (value?.positionEvidence?.valid === true) return value.positionEvidence;
  return value?.valid === true ? value : null;
}

function verifiedLineMap(positionEvidence) {
  const evidence = underlyingPositionEvidence(positionEvidence);
  const lines = new Map();
  (Array.isArray(evidence?.verifiedLines) ? evidence.verifiedLines : [])
    .filter((line) => (
      line?.legal === true
      && line?.complete === true
      && Array.isArray(line.moves)
      && line.moves.length > 0
    ))
    .forEach((line) => {
      lines.set(line.evidenceId, {
        evidenceId: line.evidenceId,
        rank: line.rank,
        moves: line.moves,
      });
    });
  if (evidence?.playedMove?.legal && evidence.playedMove.evidenceId) {
    lines.set(evidence.playedMove.evidenceId, {
      evidenceId: evidence.playedMove.evidenceId,
      rank: null,
      moves: [evidence.playedMove],
    });
  }
  return lines;
}

function textMoveTokens(value) {
  return cleanText(value, MAX_TEXT_LENGTH * 2).match(MOVE_TOKEN_PATTERN) || [];
}

function tokenMatchesPly(token, line, index) {
  const normalized = normalizeToken(token);
  if (!normalized) return false;
  const move = line.moves?.[index];
  if (move?.uci && normalizeToken(move.uci) === normalized) return true;
  return localizedSanAliases(move?.san).includes(normalized);
}

function normalizeMoveRefs(value, lines, errors, label) {
  const source = Array.isArray(value) ? value.slice(0, 3) : [];
  return source.map((reference, index) => {
    const lineEvidenceId = cleanText(reference?.lineEvidenceId, 120);
    const startPly = Number.isInteger(reference?.startPly)
      ? reference.startPly
      : -1;
    const uci = Array.isArray(reference?.uci)
      ? reference.uci.slice(0, 8).map(cleanUci).filter(Boolean)
      : [];
    const line = lines.get(lineEvidenceId);
    const prefix = `${label}, Zugbezug ${index + 1}`;
    if (!line) errors.push(`${prefix}: unbekannte oder unvollständige legale Linie.`);
    if (startPly < 0) errors.push(`${prefix}: ungültiger Start-Halbzug.`);
    if (uci.length === 0) errors.push(`${prefix}: UCI-Züge fehlen.`);
    const expected = line?.moves
      ?.slice(startPly, startPly + uci.length)
      .map((move) => cleanUci(move.uci)) || [];
    if (
      expected.length !== uci.length
      || expected.some((move, moveIndex) => move !== uci[moveIndex])
    ) {
      errors.push(`${prefix}: keine zusammenhängende Teilfolge dieser legalen Linie.`);
    }
    return {
      lineEvidenceId,
      startPly: Math.max(0, startPly),
      uci,
      resolvedMoves: line?.moves?.slice(startPly, startPly + uci.length) || [],
    };
  });
}

function moveTokensMatchReferences(tokens, moveRefs) {
  const referencedMoves = moveRefs.flatMap((reference) => reference.resolvedMoves);
  if (referencedMoves.length === 0) {
    return tokens.every((token) => /^[a-h][1-8]$/i.test(token));
  }
  let tokenIndex = 0;
  for (let moveIndex = 0; moveIndex < referencedMoves.length; moveIndex += 1) {
    let found = false;
    while (tokenIndex < tokens.length) {
      const token = tokens[tokenIndex];
      tokenIndex += 1;
      if (tokenMatchesPly(token, { moves: referencedMoves }, moveIndex)) {
        found = true;
        break;
      }
      if (!/^[a-h][1-8]$/i.test(token)) return false;
    }
    if (!found) return false;
  }
  return tokens.slice(tokenIndex).every((token) => /^[a-h][1-8]$/i.test(token));
}

function evidenceSupportsClaimKind(record, claimKind) {
  const id = cleanText(record?.id, 120);
  const kind = cleanText(record?.kind, 120);
  const isKnowledge = (
    typeof record?.principle === "string"
    || typeof record?.paraphrase === "string"
  );
  const isOpeningKnowledge = id.startsWith("opening.knowledge.");
  if (claimKind === "assessment") {
    return ["engine.best_move", "engine.move_assessment"].includes(id)
      || id.startsWith("engine.pv.")
      || id.startsWith("engine.move_comparison");
  }
  if (claimKind === "move_effect") {
    return id.startsWith("move.played.")
      || kind.startsWith("move.")
      || id.startsWith("position.change.")
      || id.startsWith("engine.move_comparison");
  }
  if (claimKind === "position_change") {
    return id.startsWith("position.change.")
      || kind.startsWith("position.")
      || id.startsWith("engine.move_comparison");
  }
  if (claimKind === "variation") {
    return id.startsWith("engine.pv.")
      || id === "engine.played_line"
      || id.startsWith("engine.move_comparison");
  }
  if (claimKind === "alternative") {
    return ["engine.best_move", "engine.move_assessment"].includes(id)
      || id.startsWith("engine.pv.")
      || id.startsWith("engine.move_comparison");
  }
  if (claimKind === "opening") {
    return id.startsWith("opening.name:") || isOpeningKnowledge;
  }
  if (claimKind === "principle") return isKnowledge;
  return false;
}

function validateClaimEvidence(claimKind, evidenceIds, records, errors, label) {
  const recordsForClaim = evidenceIds
    .map((id) => records.get(id))
    .filter(Boolean);
  const incompatible = evidenceIds.filter(
    (id) => !evidenceSupportsClaimKind(records.get(id), claimKind),
  );
  if (incompatible.length > 0) {
    errors.push(`${label}: Belege passen nicht zur Aussageart (${incompatible.join(", ")}).`);
  }
  const ids = new Set(evidenceIds);
  if (
    claimKind === "assessment"
    && !ids.has("engine.best_move")
    && !ids.has("engine.move_assessment")
    && ![...ids].some((id) => id.startsWith("engine.move_comparison"))
  ) {
    errors.push(`${label}: Zugbewertung benötigt den konkreten Bewertungsbeleg.`);
  }
  if (
    claimKind === "alternative"
    && !ids.has("engine.best_move")
    && !ids.has("engine.move_assessment")
    && ![...ids].some((id) => id.startsWith("engine.move_comparison"))
  ) {
    errors.push(`${label}: Alternative benötigt den belegten besten Zug.`);
  }
  if (
    claimKind === "variation"
    && !recordsForClaim.some((record) => (
      record.id.startsWith("engine.pv.")
      || record.id === "engine.played_line"
      || record.id.startsWith("engine.move_comparison")
    ))
  ) {
    errors.push(`${label}: Variante benötigt eine legal verifizierte Linie.`);
  }
}

function factContainsChange(record) {
  const id = cleanText(record?.id, 120);
  const fact = record?.fact;
  if (!fact || typeof fact !== "object") return false;
  if (id === "position.change.material") {
    return Boolean(
      fact.balanceWhiteMinusBlack
      || Object.values(fact.byColor || {}).some((entry) => (
        entry?.points
        || Object.values(entry?.counts || {}).some((value) => value)
      )),
    );
  }
  if (id === "position.change.development") {
    return Object.values(fact.byColor || {}).some((entry) => (
      entry?.countDelta
      || entry?.newlyOffOriginalSquares?.length
      || entry?.returnedToOriginalSquare?.length
    ));
  }
  if (id === "position.change.center") {
    return Object.values(fact.byColor || {}).some((entry) => (
      entry?.influencedSquareCountDelta
      || entry?.newlyOccupiedSquares?.length
      || entry?.noLongerOccupiedSquares?.length
      || entry?.newlyAttackedSquares?.length
      || entry?.noLongerAttackedSquares?.length
    ));
  }
  if (id === "position.change.king_safety") {
    return Boolean(
      fact.castled
      || Object.values(fact.byColor || {}).some((entry) => (
        entry?.kingFrom !== entry?.kingTo
        || entry?.newlyInCheck
        || entry?.noLongerInCheck
        || entry?.frontAdjacentFriendlyPawnCountDelta
        || entry?.castlingRightsLost?.kingside
        || entry?.castlingRightsLost?.queenside
      )),
    );
  }
  if (id === "position.change.files") {
    return Boolean(
      fact.newlyOpen?.length
      || fact.noLongerOpen?.length
      || Object.values(fact.byColor || {}).some((entry) => (
        entry?.newlySemiOpen?.length || entry?.noLongerSemiOpen?.length
      )),
    );
  }
  if (id === "position.change.pawn_structure") {
    return Object.values(fact.byColor || {}).some((entry) => (
      entry?.islandCountDelta
      || [
        "newlyDoubledFiles",
        "noLongerDoubledFiles",
        "newlyIsolatedPawns",
        "noLongerIsolatedPawns",
        "newlyPassedPawns",
        "noLongerPassedPawns",
      ].some((key) => entry?.[key]?.length)
    ));
  }
  if (id === "position.change.piece_safety") {
    return [
      "newlyAttacked",
      "noLongerAttacked",
      "newlyUndefended",
      "noLongerUndefended",
      "newlyAttackedAndUndefended",
      "noLongerAttackedAndUndefended",
    ].some((key) => fact[key]?.length);
  }
  if (id === "move.played.properties") {
    return Boolean(
      fact.capture
      || fact.promotion
      || fact.castle
      || fact.givesCheck
      || fact.givesCheckmate
    );
  }
  return id.startsWith("move.played.");
}

function validateClaimContent(
  text,
  claimKind,
  evidenceIds,
  records,
  errors,
  label,
) {
  if (!["move_effect", "position_change"].includes(claimKind)) return;
  const normalized = text.toLocaleLowerCase("de-DE");
  const ids = new Set(evidenceIds);
  const hasComparisonEvidence = [...ids].some(
    (id) => id.startsWith("engine.move_comparison"),
  );
  const hasMeaningful = (id) => (
    ids.has(id) && factContainsChange(records.get(id))
  );
  const requireChange = (pattern, evidenceId, description) => {
    if (
      pattern.test(normalized)
      && !hasMeaningful(evidenceId)
      && !hasComparisonEvidence
    ) {
      errors.push(`${label}: ${description} ist durch den konkreten Beleg nicht nachgewiesen.`);
    }
  };

  requireChange(
    /\b(?:zentrum|zentral|zentrumsfeld|zentrumsfelder)\b/i,
    "position.change.center",
    "die behauptete Zentrumswirkung",
  );
  requireChange(
    /\b(?:entwickl|ausgangsfeld|leichtfigur.*ins spiel)\w*/i,
    "position.change.development",
    "die behauptete Figurenentwicklung",
  );
  requireChange(
    /(?:linie geöffnet|öffnet.{0,30}linie|offene[nrms]* [a-h]-?linie|halb(?:-| )offene[nrms]* [a-h]-?linie)/iu,
    "position.change.files",
    "die behauptete Linienöffnung",
  );
  requireChange(
    /\b(?:bauernstruktur|freibauer|isoliert|doppelbauer|bauerninsel)\w*/i,
    "position.change.pawn_structure",
    "die behauptete Änderung der Bauernstruktur",
  );
  requireChange(
    /\b(?:ungedeckt|angegriffen und ungedeckt|neu angegriffen)\b/i,
    "position.change.piece_safety",
    "die behauptete Änderung der Figurensicherheit",
  );
  if (
    /\b(?:königssicherheit|rochad|könig.{0,24}sicher)\w*/i.test(normalized)
    && !hasMeaningful("position.change.king_safety")
    && !hasMeaningful("move.played.properties")
  ) {
    errors.push(`${label}: die behauptete Königssicherheit ist nicht konkret nachgewiesen.`);
  }
  if (
    /\b(?:material|nimmt|schlägt)\w*/i.test(normalized)
    && !hasMeaningful("position.change.material")
    && !hasMeaningful("move.played.properties")
  ) {
    errors.push(`${label}: die behauptete Materialwirkung ist nicht konkret nachgewiesen.`);
  }
  if (/\b(?:raum|damenflügel|königsflügel|dauerhaft)\w*/i.test(normalized)) {
    errors.push(`${label}: die räumliche oder langfristige Behauptung ist aus den Stellungsdaten nicht direkt ableitbar.`);
  }

  const fileMatch = normalized.match(/\b([a-h])-?linie\b/i);
  if (fileMatch && ids.has("position.change.files")) {
    const fact = records.get("position.change.files")?.fact;
    const changedFiles = new Set([
      ...(fact?.newlyOpen || []),
      ...Object.values(fact?.byColor || {})
        .flatMap((entry) => entry?.newlySemiOpen || []),
    ]);
    if (!changedFiles.has(fileMatch[1])) {
      errors.push(`${label}: die genannte ${fileMatch[1]}-Linie wurde durch den Zug nicht geöffnet.`);
    }
  }
}

function validateStrongAssertions(
  text,
  claimKind,
  moveRefs,
  engineContext,
  expected,
  errors,
  label,
) {
  const normalized = text.toLocaleLowerCase("de-DE");
  const referencedMoves = moveRefs.flatMap((reference) => reference.resolvedMoves);
  const bestMove = engineContext?.moveReview?.bestMove || engineContext?.bestMove;
  const bestUci = cleanUci(bestMove?.uci);
  const outcomeClaim =
    /\b(?:gewinnt|verliert|erobert|verschenkt|opfert|entscheidet|erzwingt)\b.{0,50}\b(?:dame|turm|läufer|springer|bauer|bauern|material|figur|figuren)\b/i
    .test(text)
    || /\b(?:auf gewinn|gewonnene stellung|verlorene stellung)\b/i.test(text);
  if (outcomeClaim) {
    errors.push(`${label}: Ergebnis- oder Materialbehauptung ist nicht direkt bewiesen.`);
  }
  if (/\b(?:nimmt|schlägt)\b/i.test(text)) {
    if (!referencedMoves.some((move) => Boolean(move?.capture))) {
      errors.push(`${label}: behaupteter Schlagzug fehlt in der referenzierten Linie.`);
    }
  }
  if (/\bmatt\b/i.test(text)) {
    if (!referencedMoves.some((move) => move?.givesCheckmate)) {
      errors.push(`${label}: Mattbehauptung ist nicht in der referenzierten Linie belegt.`);
    }
  } else if (/\bschach\b/i.test(text)) {
    if (!referencedMoves.some((move) => move?.givesCheck || move?.givesCheckmate)) {
      errors.push(`${label}: Schachbehauptung ist nicht in der referenzierten Linie belegt.`);
    }
  }
  const comparative = /\b(?:beste|besten|stärkste|stärksten|besser|genauer)\b/i.test(text);
  if (comparative && !["assessment", "alternative", "variation"].includes(claimKind)) {
    errors.push(`${label}: Vergleich benötigt eine konkrete Bewertungs- oder Variantenart.`);
  }
  if (claimKind === "alternative") {
    const firstReferenced = cleanUci(referencedMoves[0]?.uci);
    const playedUci = cleanUci(engineContext?.moveReview?.playedMove?.uci);
    const rankTwoUci = cleanUci(
      engineContext?.lines?.find((line) => Number.parseInt(line?.rank, 10) === 2)
        ?.bestMove?.uci,
    );
    const expectedAlternative = playedUci && playedUci === bestUci
      ? rankTwoUci
      : bestUci;
    if (!expectedAlternative || firstReferenced !== expectedAlternative) {
      errors.push(`${label}: genannte Alternative ist nicht der belegte beste Zug beziehungsweise Rang-2-Vergleich.`);
    }
  }
  if (
    claimKind === "assessment"
    && /\b(?:beste|stärkste)\b/i.test(text)
    && bestUci
    && expected.uci !== bestUci
  ) {
    errors.push(`${label}: der gespielte Zug war nicht die belegte erste Wahl.`);
  }
}

function normalizeClaim(
  value,
  evidenceRecords,
  legalLines,
  engineContext,
  expected,
  errors,
  label,
) {
  const claimKind = CLAIM_KINDS.includes(value?.claimKind)
    ? value.claimKind
    : "";
  const text = cleanText(value?.text);
  const evidenceIds = Array.isArray(value?.evidenceIds)
    ? [...new Set(value.evidenceIds.map((id) => cleanText(id, 120)).filter(Boolean))]
    : [];
  const moveRefs = normalizeMoveRefs(value?.moveRefs, legalLines, errors, label);
  if (!claimKind) errors.push(`${label}: Aussageart fehlt oder ist unbekannt.`);
  if (!text) errors.push(`${label}: Text fehlt.`);
  if (evidenceIds.length === 0) errors.push(`${label}: Beleg fehlt.`);
  const unknown = evidenceIds.filter((id) => !evidenceRecords.has(id));
  if (unknown.length > 0) errors.push(`${label}: unbekannte Belege ${unknown.join(", ")}.`);
  const moveTokens = textMoveTokens(text);
  if (!moveTokensMatchReferences(moveTokens, moveRefs)) {
    errors.push(`${label}: Zugnotation stimmt nicht exakt mit den explizit referenzierten legalen Zügen überein.`);
  }
  if (claimKind) {
    validateClaimEvidence(claimKind, evidenceIds, evidenceRecords, errors, label);
    validateClaimContent(
      text,
      claimKind,
      evidenceIds,
      evidenceRecords,
      errors,
      label,
    );
    validateStrongAssertions(
      text,
      claimKind,
      moveRefs,
      engineContext,
      expected,
      errors,
      label,
    );
  }
  return {
    claimKind,
    text,
    evidenceIds,
    moveRefs: moveRefs.map(({ lineEvidenceId, startPly, uci }) => ({
      lineEvidenceId,
      startPly,
      uci,
    })),
  };
}

export function resolveExplanationSubject(positionEvidence, engineContext = null) {
  const candidates = [
    positionEvidence?.subject,
    positionEvidence?.move,
    positionEvidence?.playedMove,
    engineContext?.moveReview?.playedMove,
    engineContext?.bestMove,
  ];
  for (const candidate of candidates) {
    const uci = cleanUci(candidate?.uci || candidate?.playedUci);
    const san = cleanText(candidate?.san || candidate?.playedSan, 24);
    if (uci && san) return { uci, san };
  }
  return { uci: "", san: "" };
}

export function buildTrustedExplanationEvidence({
  positionEvidence = null,
  engineContext = null,
  openingContext = null,
} = {}) {
  const supplementalEvidence = [];
  const review = engineContext?.moveReview;
  if (review) {
    supplementalEvidence.push({
      id: "engine.move_assessment",
      kind: "engine.move_assessment",
      source: "stockfish",
      fact: {
        playedMove: review.playedMove || null,
        bestMove: review.bestMove || null,
        quality: cleanText(review.quality, 30),
        accuracy: Number.isFinite(review.accuracy) ? review.accuracy : null,
        lossCp: Number.isFinite(review.lossCp) ? review.lossCp : null,
        evaluationBefore: review.evaluationBefore || null,
        evaluationAfter: review.evaluationAfter || null,
      },
    });
  } else if (engineContext?.bestMove) {
    supplementalEvidence.push({
      id: "engine.best_move",
      kind: "engine.best_move",
      source: "stockfish",
      fact: {
        bestMove: engineContext.bestMove,
        evaluation: engineContext.evaluation || null,
        depth: Number.parseInt(engineContext.depth, 10) || null,
      },
    });
  }
  const opening = openingContext?.matched === true
    ? openingContext
    : openingContext?.suggestedOpening?.matched === true
      ? openingContext.suggestedOpening
      : null;
  if (
    opening?.source === "lichess-chess-openings"
    && cleanText(opening.displayName, 240)
  ) {
    supplementalEvidence.push({
      id: `opening.name:${cleanText(opening.eco, 3) || "known"}`,
      kind: "opening.identity",
      source: "lichess-chess-openings",
      fact: {
        eco: cleanText(opening.eco, 3),
        displayName: cleanText(opening.displayName, 240),
        matchedPly: Number.parseInt(opening.matchedPly, 10) || null,
        relation: openingContext?.matched === true ? "current" : "after_subject_move",
      },
    });
  }
  return {
    positionEvidence,
    supplementalEvidence,
  };
}

export function phaseFromPositionEvidence(positionEvidence) {
  const before = positionEvidence?.before;
  const counts = before?.material?.byColor;
  const totalQueens = (counts?.w?.counts?.q || 0) + (counts?.b?.counts?.q || 0);
  const totalPoints = (counts?.w?.points || 0) + (counts?.b?.points || 0);
  if (totalQueens === 0 && totalPoints <= 42) return "endgame";
  const fen = cleanText(before?.fen || positionEvidence?.input?.fenBefore, 120);
  const fullmove = Number.parseInt(fen.split(/\s+/)[5], 10) || 1;
  return fullmove <= 12 ? "opening" : "middlegame";
}

export function knowledgeFeatureIdsFromPositionEvidence(positionEvidence) {
  if (!positionEvidence?.valid) return [];
  const ids = new Set(["decision.candidate_selected"]);
  const color = positionEvidence.playedMove?.color;
  const opponent = color === "w" ? "b" : "w";
  const after = positionEvidence.after;
  const changes = positionEvidence.changes;
  if (!color || !after || !changes) return [...ids];

  const center = after.center?.byColor;
  const ownCenter = new Set(center?.[color]?.influencedSquares || []);
  const opposingCenter = new Set(center?.[opponent]?.influencedSquares || []);
  if ([...ownCenter].some((square) => opposingCenter.has(square))) {
    ids.add("center.contested");
  }
  if (after.center?.occupants?.some((piece) => (
    piece.color === opponent && piece.type === "p"
  ))) {
    ids.add("center.opponent_pawn_center");
  }
  if (
    positionEvidence.playedMove.piece === "p"
    && ["d4", "e4", "d5", "e5"].includes(positionEvidence.playedMove.to)
    && (
      positionEvidence.playedMove.capture
      || changes.files?.newlyOpen?.length > 0
    )
  ) {
    ids.add("center.open_or_breaking");
  }
  const pawnAttackSquares = (square, pawnColor) => {
    const files = "abcdefgh";
    const file = files.indexOf(square?.[0]);
    const rank = Number.parseInt(square?.[1], 10);
    const targetRank = rank + (pawnColor === "w" ? 1 : -1);
    if (file < 0 || targetRank < 1 || targetRank > 8) return [];
    return [file - 1, file + 1]
      .filter((index) => index >= 0 && index < files.length)
      .map((index) => `${files[index]}${targetRank}`);
  };
  const whitePawns = after.pawnStructure?.byColor?.w?.pawns || [];
  const blackPawns = new Set(after.pawnStructure?.byColor?.b?.pawns || []);
  if (whitePawns.some((square) => (
    pawnAttackSquares(square, "w").some((target) => (
      blackPawns.has(target)
      && (
        ["d4", "e4", "d5", "e5"].includes(square)
        || ["d4", "e4", "d5", "e5"].includes(target)
      )
    ))
  ))) {
    ids.add("center.tension");
  }

  const ownDevelopment = after.development?.byColor?.[color];
  const opposingDevelopment = after.development?.byColor?.[opponent];
  if (ownDevelopment?.minorPiecesOnOriginalSquares?.length > 0) {
    ids.add("development.incomplete");
  }
  if (
    Number.isFinite(ownDevelopment?.offOriginalSquareCount)
    && ownDevelopment.offOriginalSquareCount > (opposingDevelopment?.offOriginalSquareCount || 0)
  ) {
    ids.add("development.lead");
  }

  if (positionEvidence.playedMove.castle) ids.add("king.castled");
  const opposingKing = after.kingSafety?.byColor?.[opponent];
  if (
    [opponent === "w" ? "e1" : "e8"].includes(opposingKing?.kingSquare)
    && (opposingKing?.castlingRights?.kingside || opposingKing?.castlingRights?.queenside)
  ) {
    ids.add("king.opponent_uncastled");
  }
  const ownKing = after.kingSafety?.byColor?.[color];
  const ownKingBefore = positionEvidence.before?.kingSafety?.byColor?.[color];
  if (ownKingBefore?.inCheck) {
    ids.add("tactic.forcing_emergency");
    ids.add("king.immediate_danger");
  }
  if (ownKing?.inCheck) ids.add("king.check_danger");
  if (
    ownKing?.kingSquare === (color === "w" ? "e1" : "e8")
    && (ownKing?.castlingRights?.kingside || ownKing?.castlingRights?.queenside)
  ) {
    ids.add("king.uncastled");
  }

  const ownPoints = after.material?.byColor?.[color]?.points;
  const opposingPoints = after.material?.byColor?.[opponent]?.points;
  if (Number.isFinite(ownPoints) && Number.isFinite(opposingPoints) && ownPoints > opposingPoints) {
    ids.add("material.ahead");
  }

  if (after.files?.open?.length > 0) ids.add("file.open");
  if (after.files?.semiOpen?.[color]?.length > 0) ids.add("file.semi_open");
  if (after.files?.open?.length >= 2) ids.add("position.open");

  const pawnStructure = after.pawnStructure?.byColor?.[color];
  if (pawnStructure?.doubledFiles?.length > 0) ids.add("pawn.doubled");
  if (pawnStructure?.isolatedPawns?.length > 0) ids.add("pawn.isolated");
  if (pawnStructure?.passedPawns?.length > 0) ids.add("pawn.passed");
  if (positionEvidence.playedMove.piece === "p") ids.add("pawn.advance_considered");
  if (
    positionEvidence.playedMove.piece === "p"
    && positionEvidence.playedMove.capture
  ) {
    ids.add("material.pawn_capture_available");
  }

  const looseTargets = after.pieceSafety?.byColor?.[opponent]?.attackedAndUndefended || [];
  if (looseTargets.length > 0) ids.add("tactic.loose_piece");
  const firstLineMove = positionEvidence.verifiedLines?.[0]?.moves?.[0];
  if (
    firstLineMove?.capture
    || firstLineMove?.givesCheck
    || firstLineMove?.givesCheckmate
  ) {
    ids.add("tactic.forcing_candidate_available");
  }
  if (
    !positionEvidence.playedMove.capture
    && !positionEvidence.playedMove.givesCheck
    && !positionEvidence.playedMove.givesCheckmate
    && looseTargets.length === 0
  ) {
    ids.add("position.no_forcing_priority");
  }
  if (positionEvidence.playedMove.givesCheckmate) {
    ids.add("attack.immediate_conversion");
    ids.add("tactic.own_forcing_win");
  }
  if (
    positionEvidence.playedMove.piece === "p"
    && positionEvidence.playedMove.givesCheck
  ) {
    ids.add("tactic.pawn_move_is_forcing");
  }
  return [...ids].sort();
}

const PIECE_NAMES = Object.freeze({
  p: "Bauern",
  n: "Springer",
  b: "Läufer",
  r: "Turm",
  q: "Dame",
  k: "König",
});

const QUALITY_COPY = Object.freeze({
  best: {
    headline: "Sauber gespielt",
    sentence: "Der Zug packt genau das an, was die Stellung gerade braucht.",
  },
  excellent: {
    headline: "Stark gespielt",
    sentence: "Der Zug hält deine Stellung praktisch genauso stark wie die erste Wahl.",
  },
  good: {
    headline: "Das passt",
    sentence: "Der Zug ist gut spielbar und gibt kaum etwas her.",
  },
  inaccuracy: {
    headline: "Fast, aber da war mehr drin",
    sentence: "Der Zug lässt eine bessere Chance liegen.",
  },
  mistake: {
    headline: "Da läuft etwas schief",
    sentence: "Der Zug macht deine Stellung unnötig schwierig.",
  },
  blunder: {
    headline: "Uff, das tut weh",
    sentence: "Der Zug lässt die Stellung klar gegen dich kippen.",
  },
});

function assessmentCopy(engineContext, subject) {
  const review = engineContext?.moveReview;
  const playedUci = cleanUci(review?.playedMove?.uci);
  const bestUci = cleanUci(review?.bestMove?.uci);
  const safeQuality = (
    review?.quality === "best"
    && playedUci
    && bestUci
    && playedUci !== bestUci
  )
    ? "excellent"
    : review?.quality;
  const quality = QUALITY_COPY[safeQuality];
  if (quality) {
    return {
      headline: `${subject.san}: ${quality.headline}`,
      sentence: quality.sentence,
      evidenceIds: ["engine.move_assessment"],
      claimKind: "assessment",
    };
  }
  return {
    headline: `${subject.san}: der Plan dahinter`,
    sentence: "Diese Wahl setzt die wichtigste konkrete Idee der Stellung sofort um.",
    evidenceIds: ["engine.best_move", "engine.pv.1"],
    claimKind: "assessment",
  };
}

function singleMoveReference(positionEvidence, uci, { preferPlayed = false } = {}) {
  const normalized = cleanUci(uci);
  if (!normalized) return [];
  if (
    preferPlayed
    && positionEvidence?.playedMove?.uci === normalized
    && positionEvidence.playedMove.evidenceId
  ) {
    return [{
      lineEvidenceId: positionEvidence.playedMove.evidenceId,
      startPly: 0,
      uci: [normalized],
    }];
  }
  const line = positionEvidence?.verifiedLines?.find(
    (entry) => (
      entry?.legal === true
      && entry?.complete === true
      && entry.moves?.[0]?.uci === normalized
    ),
  );
  if (line) {
    return [{
      lineEvidenceId: line.evidenceId,
      startPly: 0,
      uci: [normalized],
    }];
  }
  if (
    positionEvidence?.playedMove?.uci === normalized
    && positionEvidence.playedMove.evidenceId
  ) {
    return [{
      lineEvidenceId: positionEvidence.playedMove.evidenceId,
      startPly: 0,
      uci: [normalized],
    }];
  }
  return [];
}

function moveDescription(evidence) {
  const move = evidence?.playedMove;
  if (!move) return null;
  const base = {
    claimKind: "move_effect",
    moveRefs: singleMoveReference(evidence, move.uci, { preferPlayed: true }),
  };
  if (move.givesCheckmate) {
    return {
      ...base,
      text: `${move.san} setzt den gegnerischen König matt.`,
      evidenceIds: [move.evidenceId, "move.played.properties"],
    };
  }
  if (move.castle) {
    return {
      ...base,
      text: `${move.san} bringt den König in Sicherheit und zugleich den Turm näher ins Spiel.`,
      evidenceIds: [move.evidenceId, "position.change.king_safety"],
    };
  }
  if (move.promotion) {
    return {
      ...base,
      text: `${move.san} bringt den Bauern bis zur Umwandlung.`,
      evidenceIds: [move.evidenceId, "move.played.properties"],
    };
  }
  const piece = PIECE_NAMES[move.piece] || "Figur";
  if (move.capture) {
    return {
      ...base,
      text: `Mit ${move.san} wird der ${piece} aktiv und nimmt dabei gegnerisches Material.`,
      evidenceIds: [move.evidenceId, "position.change.material"],
    };
  }
  if (move.givesCheck) {
    return {
      ...base,
      text: `${move.san} bringt den ${piece} mit Tempo ins Spiel, weil der König sofort reagieren muss.`,
      evidenceIds: [move.evidenceId, "move.played.properties"],
    };
  }
  return {
    ...base,
    text: move.piece === "p"
      ? `${move.san} zieht den Bauern von ${move.from} nach ${move.to}.`
      : `${move.san} bringt den ${piece} von ${move.from} nach ${move.to}.`,
    evidenceIds: [move.evidenceId],
  };
}

function changeDescription(evidence) {
  const color = evidence?.playedMove?.color;
  if (!color) return null;
  const development = evidence.changes?.development?.byColor?.[color];
  if (development?.countDelta > 0) {
    return {
      claimKind: "position_change",
      text: "Damit kommt eine Leichtfigur von ihrem Ausgangsfeld ins Spiel.",
      evidenceIds: ["position.change.development"],
      moveRefs: [],
      title: "Figurenentwicklung",
    };
  }
  const center = evidence.changes?.center?.byColor?.[color];
  if (
    center?.newlyOccupiedSquares?.length > 0
    || center?.newlyAttackedSquares?.length > 0
  ) {
    const newlyOccupied = center.newlyOccupiedSquares || [];
    const newlyAttacked = center.newlyAttackedSquares || [];
    const exactEffect = [
      newlyOccupied.length > 0
        ? `besetzt nun ${newlyOccupied.length === 1 ? "ein zusätzliches Zentrumsfeld" : "zusätzliche Zentrumsfelder"}`
        : "",
      newlyAttacked.length > 0
        ? `greift ${newlyAttacked.length === 1 ? "ein weiteres Zentrumsfeld" : "weitere Zentrumsfelder"} an`
        : "",
    ].filter(Boolean).join(" und ");
    return {
      claimKind: "position_change",
      text: `Der Zug ${exactEffect}.`,
      evidenceIds: ["position.change.center"],
      moveRefs: [],
      title: "Einfluss im Zentrum",
    };
  }
  const files = evidence.changes?.files;
  if (files?.newlyOpen?.length > 0) {
    return {
      claimKind: "position_change",
      text: `Dabei wird die ${files.newlyOpen.join("- und ")}-Linie geöffnet.`,
      evidenceIds: ["position.change.files"],
      moveRefs: [],
      title: "Offene Linien",
    };
  }
  const pawn = evidence.changes?.pawnStructure?.byColor?.[color];
  if (pawn?.newlyPassedPawns?.length > 0) {
    return {
      claimKind: "position_change",
      text: "Der Zug schafft einen Freibauern, der nun von den Figuren unterstützt werden sollte.",
      evidenceIds: ["position.change.pawn_structure"],
      moveRefs: [],
      title: "Bauernstruktur",
    };
  }
  const safety = evidence.changes?.pieceSafety;
  const opponent = color === "w" ? "b" : "w";
  const targets = safety?.newlyAttackedAndUndefended
    ?.filter((piece) => piece.color === opponent)
    .map((piece) => piece.square);
  if (targets?.length > 0) {
    return {
      claimKind: "position_change",
      text: "Nach dem Zug steht eine gegnerische Figur gleichzeitig angegriffen und ungedeckt.",
      evidenceIds: ["position.change.piece_safety"],
      moveRefs: [],
      title: "Konkrete Wirkung",
    };
  }
  return null;
}

function legalLineDescription(positionEvidence, learnerProfile, engineContext = null) {
  const subjectUci = positionEvidence?.playedMove?.uci;
  const playedLine = positionEvidence?.verifiedLines?.find(
    (entry) => (
      entry?.legal === true
      && entry?.complete === true
      && entry.moves?.[0]?.uci === subjectUci
    ),
  );
  const line = engineContext?.kind === "move_review"
    ? playedLine
      || positionEvidence?.verifiedLines?.find(
        (entry) => entry.rank === 1 && entry.legal && entry.complete,
      )
    : positionEvidence?.verifiedLines?.find(
      (entry) => entry.rank === 1 && entry.legal && entry.complete,
    );
  if (!line?.moves?.length) return null;
  const maximum = Math.max(
    2,
    Math.min(
      6,
      Number.parseInt(
        learnerProfile?.explanationLimits?.variations?.maximumPliesPerLine,
        10,
      ) || 4,
    ),
  );
  const sans = line.moves.slice(0, maximum).map((move) => move.san).filter(Boolean);
  if (sans.length < 2) return null;
  const uci = line.moves.slice(0, maximum).map((move) => move.uci).filter(Boolean);
  const moveRefs = [{
    lineEvidenceId: line.evidenceId,
    startPly: 0,
    uci,
  }];
  if (engineContext?.kind === "move_review" && line.moves[0]?.uci === subjectUci) {
    return {
      claimKind: "variation",
      text: `Nach ${sans[0]} kann die Partie konkret mit ${sans.slice(1).join(" ")} weitergehen.`,
      evidenceIds: [line.evidenceId],
      moveRefs,
      title: "Konkrete Antwort",
    };
  }
  return {
    claimKind: "variation",
    text: `In der Folge ${sans.join(" ")} wird die Idee am Brett sichtbar.`,
    evidenceIds: [line.evidenceId],
    moveRefs,
    title: "Möglicher Verlauf",
  };
}

function detailedChangeDescription(positionEvidence) {
  const color = positionEvidence?.playedMove?.color;
  const move = positionEvidence?.playedMove;
  if (!color || !move) return null;
  const development = positionEvidence.changes?.development?.byColor?.[color];
  if (development?.newlyOffOriginalSquares?.length > 0) {
    return {
      claimKind: "position_change",
      title: "Entwicklung im Detail",
      text: "Die entwickelte Leichtfigur hat jetzt ihr ursprüngliches Feld verlassen.",
      evidenceIds: ["position.change.development"],
      moveRefs: [],
    };
  }
  const center = positionEvidence.changes?.center?.byColor?.[color];
  const occupiedCount = center?.newlyOccupiedSquares?.length || 0;
  const attackedCount = center?.newlyAttackedSquares?.length || 0;
  if (occupiedCount > 0 || attackedCount > 0) {
    const effects = [
      occupiedCount > 0
        ? `${occupiedCount === 1 ? "ein Zentrumsfeld ist" : `${occupiedCount} Zentrumsfelder sind`} neu besetzt`
        : "",
      attackedCount > 0
        ? `${attackedCount === 1 ? "ein Zentrumsfeld wird" : `${attackedCount} Zentrumsfelder werden`} zusätzlich angegriffen`
        : "",
    ].filter(Boolean);
    return {
      claimKind: "position_change",
      title: "Zentrumsfelder",
      text: `Im Zentrum gilt nun: ${effects.join("; ")}.`,
      evidenceIds: ["position.change.center"],
      moveRefs: [],
    };
  }
  const files = positionEvidence.changes?.files;
  if (files?.newlyOpen?.length > 0) {
    return {
      claimKind: "position_change",
      title: "Geöffnete Linien",
      text: `Durch den Zug ist nun die ${files.newlyOpen.join("- und ")}-Linie offen.`,
      evidenceIds: ["position.change.files"],
      moveRefs: [],
    };
  }
  return {
    claimKind: "move_effect",
    title: "Konkreter Stellungswechsel",
    text: `${move.san} bringt die ${PIECE_NAMES[move.piece] || "Figur"} von ${move.from} nach ${move.to}.`,
    evidenceIds: [move.evidenceId],
    moveRefs: singleMoveReference(
      positionEvidence,
      move.uci,
      { preferPlayed: true },
    ),
  };
}

function detailedLegalLineDescription(
  positionEvidence,
  learnerProfile,
  engineContext = null,
) {
  const base = legalLineDescription(
    positionEvidence,
    learnerProfile,
    engineContext,
  );
  const reference = base?.moveRefs?.[0];
  if (!base || !reference?.lineEvidenceId || !reference.uci?.length) return null;
  const line = positionEvidence.verifiedLines?.find(
    (entry) => entry?.evidenceId === reference.lineEvidenceId,
  );
  const sans = line?.moves
    ?.slice(reference.startPly, reference.startPly + reference.uci.length)
    .map((move) => move.san)
    .filter(Boolean);
  if (!sans?.length) return null;
  return {
    claimKind: "variation",
    title: "Zugfolge am Brett",
    text: `Die legal geprüfte Folge umfasst ${sans.length} Halbzüge: ${sans.join(" ")}.`,
    evidenceIds: [reference.lineEvidenceId],
    moveRefs: [reference],
  };
}

function alternativeDescription(positionEvidence, engineContext, subject) {
  const review = engineContext?.moveReview;
  const best = review?.bestMove;
  if (!best?.san || !best?.uci || cleanUci(best.uci) === subject.uci) return null;
  const moveRefs = singleMoveReference(positionEvidence, best.uci);
  if (moveRefs.length === 0) return null;
  return {
    claimKind: "alternative",
    text: `${best.san} ist die genauere Alternative; der konkrete Unterschied steht in der geprüften Antwortfolge.`,
    evidenceIds: ["engine.move_assessment", "engine.pv.1"],
    moveRefs,
    title: "Bessere Möglichkeit",
  };
}

function semanticClaim(text, evidenceIds, moveRefs = []) {
  const cleaned = cleanText(text);
  return cleaned
    ? {
      text: cleaned,
      evidenceIds: [...new Set(evidenceIds.filter(Boolean))],
      moveRefs,
    }
    : null;
}

function pieceName(type) {
  return PIECE_NAMES[type] || "Figur";
}

function effectText(facts, san) {
  const effects = Array.isArray(facts?.immediateEffects) ? facts.immediateEffects : [];
  const first = (type) => effects.find((effect) => effect.type === type);
  if (first("gives_checkmate")) return `${san} setzt den gegnerischen König matt.`;
  if (first("gives_check")) return `${san} gibt sofort Schach und zwingt den König zu einer Antwort.`;
  const capture = first("capture");
  if (capture) {
    return `${san} nimmt auf ${capture.square} ${capture.capturedPiece === "p" ? "einen Bauern" : `eine ${pieceName(capture.capturedPiece)}`}.`;
  }
  const castle = first("castles");
  if (castle) {
    return `${san} rochiert ${castle.side === "kingside" ? "kurz" : "lang"}: Der König verlässt die Mitte und der Turm kommt ins Spiel.`;
  }
  const developed = first("develops_piece");
  if (developed) {
    return `${san} entwickelt den ${pieceName(developed.piece)} nach ${developed.square}.`;
  }
  const occupied = first("occupies_center");
  const controlled = effects.find(
    (effect) => (
      effect.type === "controls_new_square"
      && effect.square !== occupied?.square
    ),
  );
  if (occupied && controlled) {
    return `${san} besetzt ${occupied.square} und kontrolliert zusätzlich ${controlled.square}.`;
  }
  if (occupied) return `${san} besetzt das Zentrumsfeld ${occupied.square}.`;
  if (controlled) return `${san} übernimmt neu die Kontrolle über ${controlled.square}.`;
  const opened = first("opens_file") || first("creates_semi_open_file");
  if (opened) return `${san} öffnet die ${opened.file}-Linie für die Schwerfiguren.`;
  const loose = first("piece_attacked_and_undefended");
  if (loose) {
    return `${san} lässt den ${pieceName(loose.piece)} auf ${loose.square} angegriffen und ungedeckt stehen.`;
  }
  const moved = first("moves_piece");
  if (!moved) return "";
  return moved.piece === "p"
    ? `${san} zieht den Bauern von ${moved.from} nach ${moved.to}.`
    : `${san} bringt den ${pieceName(moved.piece)} von ${moved.from} nach ${moved.to}.`;
}

function lineMoveReference(positionEvidence, line, startPly, length = 1) {
  if (!line?.evidenceId || !Array.isArray(line.moves)) return [];
  const uci = line.moves
    .slice(startPly, startPly + length)
    .map((move) => cleanUci(move?.uci))
    .filter(Boolean);
  return uci.length === length
    ? [{ lineEvidenceId: line.evidenceId, startPly, uci }]
    : [];
}

function comparisonDifferenceText(comparison) {
  if (comparison?.onlyMove) {
    return "Schon die zweitbeste geprüfte Möglichkeit fällt klar ab; deshalb ist hier Genauigkeit besonders wichtig.";
  }
  const differences = Array.isArray(comparison?.differences) ? comparison.differences : [];
  const difference = differences[0];
  if (!difference) return "";
  if (difference.type === "allows_check") {
    const reply = comparison.played?.opponentBestReply;
    return `Der entscheidende Unterschied: Der gespielte Zug erlaubt ${reply?.san || "ein sofortiges Schach"}${reply?.givesCheckmate ? " mit Matt" : " mit Schach"}, die bessere Fortsetzung nicht.`;
  }
  if (difference.type === "allows_checkmate") {
    return `Der entscheidende Unterschied: Nach dem gespielten Zug folgt ${comparison.played?.opponentBestReply?.san || "Matt"}, die bessere Fortsetzung verhindert das.`;
  }
  if (difference.type === "material_outcome") {
    return "Der entscheidende Unterschied zeigt sich beim Material: In der geprüften Folge schneidet die bessere Fortsetzung konkret besser ab.";
  }
  if (difference.type === "develops_piece") {
    return `Der entscheidende Unterschied: Die Alternative entwickelt eine Figur nach ${difference.square}, der gespielte Zug nicht.`;
  }
  if (difference.type === "avoids_loose_piece") {
    return `Der entscheidende Unterschied: Die Alternative vermeidet, dass die Figur auf ${difference.square} ungedeckt bleibt.`;
  }
  if (difference.type === "improves_king_safety") {
    return "Der entscheidende Unterschied: Die Alternative bringt den König direkt aus der Mitte.";
  }
  if (difference.type === "improves_center_control") {
    return `Der entscheidende Unterschied liegt im Zentrum: Die Alternative greift ${difference.square || "ein wichtiges Feld"} direkt an.`;
  }
  return "";
}

function takeawayText(comparison) {
  const types = new Set((comparison?.differences || []).map((difference) => difference.type));
  if (types.has("allows_check") || types.has("allows_checkmate")) {
    return "Lernregel: Prüfe vor deinem Zug immer zuerst alle gegnerischen Schachs.";
  }
  if (types.has("material_outcome") || types.has("avoids_loose_piece")) {
    return "Lernregel: Kontrolliere nach jedem Kandidatenzug, ob eine Figur angegriffen und ungedeckt bleibt.";
  }
  if (types.has("develops_piece")) {
    return "Lernregel: Wenn nichts Taktisches brennt, entwickle eine Figur mit einer konkreten Aufgabe.";
  }
  if (types.has("improves_king_safety")) {
    return "Lernregel: Bring den König in Sicherheit, bevor du am Flügel weitere Bauern ziehst.";
  }
  return null;
}

export function buildLocalMoveExplanation({
  positionEvidence = null,
  engineContext = null,
  openingContext = null,
} = {}) {
  if (!positionEvidence?.valid) return null;
  const trusted = buildTrustedExplanationEvidence({
    positionEvidence,
    engineContext,
    openingContext,
  });
  const subject = resolveExplanationSubject(positionEvidence, engineContext);
  const comparison = positionEvidence.moveComparison;
  if (!subject.uci || !subject.san || !comparison?.played) return null;
  const review = engineContext?.moveReview;
  const assessmentEvidenceId = review ? "engine.move_assessment" : "engine.best_move";
  const quality = review?.quality || "good";
  let verdictText = comparison.explanationType === "best_move"
    ? "Das ist hier die genaueste Wahl."
    : comparison.explanationType === "equivalent"
      ? "Das ist praktisch genauso gut wie die erste Wahl."
      : quality === "blunder"
        ? "Das ist ein schwerer Fehler, weil die geprüfte Antwortfolge die Stellung klar kippen lässt."
        : quality === "mistake"
          ? "Das ist ein Fehler, weil die stärkste Antwort deine Stellung konkret verschlechtert."
          : quality === "inaccuracy"
            ? "Das ist etwas ungenau, weil du eine präzisere Möglichkeit auslässt."
            : "Der Zug ist spielbar, löst die wichtigste Aufgabe aber nicht so genau wie die Alternative.";
  const playedLine = positionEvidence.verifiedLines?.find(
    (line) => line.moves?.[0]?.uci === subject.uci,
  );
  const primaryDifference = comparison.differences?.[0];
  if (["inaccuracy", "mistake", "blunder"].includes(quality)) {
    if (primaryDifference?.type === "allows_check") {
      verdictText = `Das Problem: Der Zug erlaubt sofort ${playedLine?.moves?.[1]?.san || "ein Schach"}.`;
    } else if (primaryDifference?.type === "allows_checkmate") {
      verdictText = `Das Problem: Der Zug lässt ${playedLine?.moves?.[1]?.san || "eine direkte Mattfolge"} zu.`;
    } else if (primaryDifference?.type === "material_outcome") {
      verdictText = "Das Problem: In der geprüften Antwortfolge schneidet dein Zug beim Material schlechter ab.";
    } else if (primaryDifference?.type === "avoids_loose_piece") {
      verdictText = `Das Problem: Die Figur auf ${primaryDifference.square} bleibt nach deinem Zug locker stehen.`;
    }
  }
  const opponent = comparison.played.opponentBestReply;
  const opponentMove = playedLine?.moves?.[1];
  const opponentText = opponent
    ? `Darauf kommt am stärksten ${opponent.san}${opponent.givesCheckmate ? " mit Matt" : opponent.givesCheck ? " mit Schach" : opponent.capture ? ` und einem Schlag auf ${opponent.capture.square}` : ""}.`
    : "";
  let consequence = null;
  if (opponent?.givesCheckmate) {
    consequence = "Du musst die Mattdrohung sofort beantworten.";
  } else if (opponent?.givesCheck) {
    consequence = "Du musst sofort auf das Schach reagieren und verlierst dadurch Zeit für deinen eigenen Plan.";
  } else if (comparison.played.materialBalanceDelta < 0) {
    consequence = "In der geprüften Folge geht für dich Material verloren.";
  } else if (opponent?.capture) {
    consequence = `Die stärkste Antwort nimmt auf ${opponent.capture.square} Material.`;
  }
  const alternative = comparison.alternative;
  const alternativeLine = alternative
    ? positionEvidence.verifiedLines?.find(
      (line) => line.moves?.[0]?.uci === alternative.move?.uci,
    )
    : null;
  const alternativeIdea = alternative
    ? effectText(
      {
        immediateEffects: alternative.immediateEffects
          || (alternative.move?.uci === comparison.best.move?.uci
            ? comparison.best.immediateEffects
            : []),
      },
      alternative.move.san,
    )
    : "";
  let alternativeText = "";
  if (alternative) {
    if (comparison.onlyMove && subject.uci === comparison.best.move?.uci) {
      alternativeText = `${alternative.move.san} ist die nächste geprüfte Möglichkeit, fällt aber klar ab. ${alternativeIdea}`;
    } else if (alternative.relation === "equivalent") {
      alternativeText = `${alternative.move.san} war praktisch gleichwertig. ${alternativeIdea}`;
    } else if (alternative.relation === "inferior") {
      alternativeText = `${alternative.move.san} war ebenfalls möglich, aber etwas weniger genau. ${alternativeIdea}`;
    } else if (alternative.relation === "only_move") {
      alternativeText = `${alternative.move.san} war hier der einzige Zug, der die Stellung hält. ${alternativeIdea}`;
    } else {
      alternativeText = alternativeIdea
        ? `Genauer war ${alternative.move.san}: ${alternativeIdea}`
        : `${alternative.move.san} war die genauere Alternative. Der konkrete Unterschied zeigt sich in der geprüften Antwortfolge.`;
    }
  }
  const differenceText = comparisonDifferenceText(comparison);
  const candidate = {
    schemaVersion: MOVE_EXPLANATION_SCHEMA_VERSION,
    subjectUci: subject.uci,
    subjectSan: subject.san,
    verdict: semanticClaim(
      verdictText,
      [assessmentEvidenceId, "engine.move_comparison"],
      ["allows_check", "allows_checkmate"].includes(primaryDifference?.type)
        ? lineMoveReference(positionEvidence, playedLine, 1)
        : [],
    ),
    moveIdea: semanticClaim(
      effectText(comparison.played, subject.san),
      [positionEvidence.playedMove.evidenceId, "engine.move_comparison"],
      singleMoveReference(positionEvidence, subject.uci, { preferPlayed: true }),
    ),
    opponentReply: opponentText
      ? semanticClaim(
        opponentText,
        [playedLine?.evidenceId, "engine.move_comparison"].filter(Boolean),
        opponentMove ? lineMoveReference(positionEvidence, playedLine, 1) : [],
      )
      : null,
    concreteConsequence: consequence
      ? semanticClaim(
        consequence,
        [playedLine?.evidenceId, "engine.move_comparison"].filter(Boolean),
      )
      : null,
    alternative: alternativeText
      ? semanticClaim(
        alternativeText,
        [alternativeLine?.evidenceId, assessmentEvidenceId, "engine.move_comparison"]
          .filter(Boolean),
        lineMoveReference(positionEvidence, alternativeLine, 0),
      )
      : null,
    comparison: differenceText
      ? semanticClaim(
        differenceText,
        ["engine.move_comparison.differences", "engine.move_comparison"],
        ["allows_check", "allows_checkmate"].includes(primaryDifference?.type)
          ? lineMoveReference(positionEvidence, playedLine, 1)
          : [],
      )
      : null,
    takeaway: takeawayText(comparison)
      ? semanticClaim(
        takeawayText(comparison),
        ["engine.move_comparison.differences"],
      )
      : null,
    confidence: (
      positionEvidence.candidateLines?.length >= 2
      && (Number.parseInt(engineContext?.depth, 10) || 0) >= 15
    )
      ? "high"
      : positionEvidence.candidateLines?.length >= 1
        ? "medium"
        : "limited",
  };
  const checked = verifyMoveExplanation(candidate, {
    positionEvidence: trusted,
    engineContext,
  });
  return checked.valid ? checked.value : null;
}

export function verifyMoveExplanation(
  value,
  {
    positionEvidence = null,
    knowledgeContext = null,
    engineContext = null,
  } = {},
) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["Erklärung ist kein Objekt."], value: null };
  }

  const directPositionEvidence = underlyingPositionEvidence(positionEvidence);
  const expected = resolveExplanationSubject(directPositionEvidence, engineContext);
  const subjectUci = cleanUci(value.subjectUci);
  const subjectSan = cleanText(value.subjectSan, 24);
  if (!expected.uci || !expected.san) errors.push("Der zu erklärende Zug fehlt.");
  if (subjectUci !== expected.uci) errors.push("Der erklärte UCI-Zug stimmt nicht überein.");
  if (normalizeToken(subjectSan) !== normalizeToken(expected.san)) {
    errors.push("Der erklärte SAN-Zug stimmt nicht überein.");
  }
  const evidenceRecords = evidenceRecordMap(positionEvidence, knowledgeContext);
  const legalLines = verifiedLineMap(positionEvidence);
  const legacy = Array.isArray(value.summary);
  const legacyClaim = (kinds) => value.summary?.find(
    (claim) => kinds.includes(claim?.claimKind),
  ) || null;
  const source = legacy
    ? {
      verdict: legacyClaim(["assessment"]),
      moveIdea: legacyClaim(["move_effect", "position_change"]),
      opponentReply: legacyClaim(["variation"]),
      concreteConsequence: null,
      alternative: legacyClaim(["alternative"]),
      comparison: null,
      takeaway: legacyClaim(["principle"]),
    }
    : value;
  if (!legacy && value.schemaVersion !== MOVE_EXPLANATION_SCHEMA_VERSION) {
    errors.push("Unbekannte Erklärungsversion.");
  }
  if (legacy && ![2, MOVE_EXPLANATION_SCHEMA_VERSION].includes(value.schemaVersion)) {
    errors.push("Unbekannte Erklärungsversion.");
  }
  const fieldKinds = {
    verdict: "assessment",
    moveIdea: "move_effect",
    opponentReply: "variation",
    concreteConsequence: "variation",
    alternative: "alternative",
    comparison: "position_change",
    takeaway: "position_change",
  };
  const required = new Set(["verdict", "moveIdea"]);
  const normalized = {};
  Object.entries(fieldKinds).forEach(([field, claimKind]) => {
    const claim = source[field];
    if (claim == null) {
      if (required.has(field)) errors.push(`${field}: Pflichtfeld fehlt.`);
      normalized[field] = null;
      return;
    }
    const checked = normalizeClaim(
      { ...claim, claimKind },
      evidenceRecords,
      legalLines,
      engineContext,
      expected,
      errors,
      field,
    );
    normalized[field] = {
      text: checked.text,
      evidenceIds: checked.evidenceIds,
      moveRefs: checked.moveRefs,
    };
  });
  if (
    ["inaccuracy", "mistake", "blunder"].includes(engineContext?.moveReview?.quality)
    && normalized.alternative
    && !normalized.verdict?.text
  ) {
    errors.push("Die bessere Alternative darf erst nach der Erklärung des gespielten Fehlers kommen.");
  }
  const allClaims = Object.values(normalized).filter(Boolean);
  const normalizedClaimTexts = new Set();
  allClaims.forEach((claim, index) => {
    const normalizedText = cleanText(claim?.text)
      .toLocaleLowerCase("de-DE")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (!normalizedText) return;
    if (normalizedClaimTexts.has(normalizedText)) {
      errors.push(`Aussage ${index + 1}: wiederholt eine bereits verwendete Erklärung.`);
    }
    normalizedClaimTexts.add(normalizedText);
  });
  const confidence = ["high", "medium", "limited"].includes(value.confidence)
    ? value.confidence
    : "limited";
  if (confidence !== value.confidence) errors.push("Unbekannte Konfidenz.");

  return {
    valid: errors.length === 0,
    errors,
    value: errors.length > 0
      ? null
      : {
        schemaVersion: MOVE_EXPLANATION_SCHEMA_VERSION,
        subjectUci,
        subjectSan,
        ...normalized,
        confidence,
      },
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function sha256Hex(value) {
  const source = new TextEncoder().encode(
    JSON.stringify(stableValue(value)),
  );
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = source.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  const rotateRight = (word, bits) => (
    (word >>> bits) | (word << (32 - bits))
  );

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + (index * 4), false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 = (
        rotateRight(previous15, 7)
        ^ rotateRight(previous15, 18)
        ^ (previous15 >>> 3)
      );
      const sigma1 = (
        rotateRight(previous2, 17)
        ^ rotateRight(previous2, 19)
        ^ (previous2 >>> 10)
      );
      words[index] = (
        words[index - 16]
        + sigma0
        + words[index - 7]
        + sigma1
      ) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first = (h + bigSigma1 + choose + constants[index] + words[index]) >>> 0;
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (bigSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return [...hash]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

export function moveExplanationCacheKey({
  fen = "",
  subjectUci = "",
  engineDepth = 0,
  learnerProfile = null,
  openingContext = null,
  engineContext = null,
  positionEvidence = null,
  knowledgeContext = null,
} = {}) {
  const opening = openingContext?.matched
    ? openingContext
    : openingContext?.suggestedOpening?.matched
      ? openingContext.suggestedOpening
      : openingContext;
  const citableEvidence = [...evidenceRecordMap(positionEvidence, knowledgeContext)]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, record]) => ({
      id,
      kind: record.kind || null,
      phase: record.phase || null,
      source: record.source || null,
      fact: record.fact || null,
      principle: record.principle || null,
      paraphrase: record.paraphrase || null,
      conceptIds: record.conceptIds || null,
      matchedFeatures: record.matchedFeatures || null,
      confidence: record.confidence ?? null,
      reviewStatus: record.reviewStatus || null,
    }));
  return `v${MOVE_EXPLANATION_CACHE_VERSION}:${sha256Hex({
    fen: cleanText(fen, 120),
    subjectUci: cleanUci(subjectUci),
    engineDepth: Math.max(0, Math.min(99, Number.parseInt(engineDepth, 10) || 0)),
    learnerProfile,
    opening: {
      eco: cleanText(opening?.eco, 3),
      displayName: cleanText(opening?.displayName, 240),
      family: cleanText(opening?.family, 160),
      variation: cleanText(opening?.variation, 160),
      subvariation: cleanText(opening?.subvariation, 160),
      matchedPly: Number.parseInt(opening?.matchedPly, 10) || 0,
      source: cleanText(opening?.source, 80),
    },
    announcement: openingContext?.announcement
      ? {
        id: cleanText(openingContext.announcement.id, 300),
        kind: cleanText(openingContext.announcement.kind, 40),
        triggerPly:
          Number.parseInt(openingContext.announcement.triggerPly, 10) || 0,
        familyKey: cleanText(openingContext.announcement.familyKey, 160),
        variationKey: cleanText(openingContext.announcement.variationKey, 200),
        displayName: cleanText(openingContext.announcement.displayName, 240),
        transposition: openingContext.announcement.transposition === true,
        sequenceExitMove: cleanUci(
          openingContext.announcement.sequenceExitMove,
        ),
      }
      : null,
    engineContext,
    citableEvidence,
  })}`;
}

export function moveExplanationToMarkdown(explanation, { deep = false } = {}) {
  if (!explanation || typeof explanation !== "object") return "";
  if (explanation.schemaVersion === MOVE_EXPLANATION_SCHEMA_VERSION) {
    const labels = {
      verdict: "",
      moveIdea: "",
      alternative: "Alternative",
      opponentReply: "Stärkste Antwort",
      concreteConsequence: "Konkrete Folge",
      comparison: "Der Unterschied",
      takeaway: "Merksatz",
    };
    const fields = [
      "verdict",
      "moveIdea",
      "alternative",
      ...(deep
        ? ["opponentReply", "concreteConsequence", "comparison", "takeaway"]
        : []),
    ];
    const lines = [];
    const seen = new Set();
    fields.forEach((field) => {
      const text = cleanText(explanation[field]?.text);
      const normalized = text.toLocaleLowerCase("de-DE");
      if (!text || seen.has(normalized)) return;
      seen.add(normalized);
      lines.push(labels[field] ? `**${labels[field]}:** ${text}` : text);
    });
    return lines.join("\n\n");
  }
  const lines = [];
  const headline = cleanText(explanation.headline, 160);
  if (headline) lines.push(`**${headline}**`);
  const summary = Array.isArray(explanation.summary) ? explanation.summary : [];
  const summarySeen = new Set();
  const summaryClaims = summary
    .map((claim) => cleanText(claim?.text))
    .filter((text) => {
      if (!text) return false;
      const normalized = text.toLocaleLowerCase("de-DE")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
      if (!normalized || summarySeen.has(normalized)) return false;
      summarySeen.add(normalized);
      return true;
    });
  const summaryText = summaryClaims.join(" ");
  if (summaryText) lines.push(summaryText);
  if (deep) {
    const seen = new Set(summaryClaims.map((text) => text.toLocaleLowerCase("de-DE")));
    (Array.isArray(explanation.deepDive) ? explanation.deepDive : []).forEach((section) => {
      const title = cleanText(section?.title, 80);
      const text = cleanText(section?.text);
      const normalized = text.toLocaleLowerCase("de-DE");
      if (title && text && !seen.has(normalized)) {
        lines.push(`**${title}:** ${text}`);
        seen.add(normalized);
      }
    });
  }
  return lines.join("\n\n");
}

export function compactMoveExplanationClaims(explanation, { maximum = 2 } = {}) {
  if (explanation?.schemaVersion === MOVE_EXPLANATION_SCHEMA_VERSION) {
    return [
      explanation.verdict
        ? { ...explanation.verdict, claimKind: "assessment", semanticField: "verdict" }
        : null,
      explanation.moveIdea
        ? { ...explanation.moveIdea, claimKind: "move_effect", semanticField: "moveIdea" }
        : null,
      explanation.alternative
        ? { ...explanation.alternative, claimKind: "alternative", semanticField: "alternative" }
        : null,
    ]
      .filter(Boolean)
      .slice(0, Math.max(1, Math.min(4, Number.parseInt(maximum, 10) || 2)));
  }
  const claims = Array.isArray(explanation?.summary) ? explanation.summary : [];
  const priority = new Map([
    ["position_change", 0],
    ["move_effect", 1],
    ["principle", 2],
    ["alternative", 3],
    ["assessment", 4],
    ["variation", 5],
    ["opening", 6],
  ]);
  const seen = new Set();
  return claims
    .map((claim, index) => ({ claim, index }))
    .filter(({ claim }) => {
      const text = cleanText(claim?.text);
      const normalized = text.toLocaleLowerCase("de-DE");
      if (!text || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .sort((left, right) => (
      (priority.get(left.claim?.claimKind) ?? 99)
      - (priority.get(right.claim?.claimKind) ?? 99)
      || left.index - right.index
    ))
    .slice(0, Math.max(1, Math.min(4, Number.parseInt(maximum, 10) || 2)))
    .map(({ claim }) => claim);
}

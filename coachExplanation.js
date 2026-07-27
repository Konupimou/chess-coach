const MAX_TEXT_LENGTH = 700;
const MOVE_TOKEN_PATTERN =
  /\b(?:[a-h][1-8][a-h][1-8][qrbn]?|(?:O-O(?:-O)?|0-0(?:-0)?)[+#]?|[KQRBNDTLS][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBNDTLS])?[+#]?|[a-h](?:x[a-h])?[1-8](?:=[QRBNDTLS])?[+#]?)\b/gi;

export const MOVE_EXPLANATION_SCHEMA_VERSION = 2;
export const MOVE_EXPLANATION_CACHE_VERSION = 3;

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
      "headline",
      "summary",
      "deepDive",
      "confidence",
    ],
    properties: {
      schemaVersion: { type: "integer", enum: [MOVE_EXPLANATION_SCHEMA_VERSION] },
      subjectUci: {
        type: "string",
        pattern: "^[a-h][1-8][a-h][1-8][qrbn]?$",
      },
      subjectSan: { type: "string", minLength: 1, maxLength: 24 },
      headline: { type: "string", minLength: 1, maxLength: 160 },
      summary: {
        type: "array",
        minItems: 4,
        maxItems: 6,
        items: CLAIM_SCHEMA,
      },
      deepDive: {
        type: "array",
        minItems: 2,
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["claimKind", "title", "text", "evidenceIds", "moveRefs"],
          properties: {
            claimKind: { type: "string", enum: CLAIM_KINDS },
            title: { type: "string", minLength: 1, maxLength: 80 },
            text: { type: "string", minLength: 1, maxLength: MAX_TEXT_LENGTH },
            evidenceIds: CLAIM_SCHEMA.properties.evidenceIds,
            moveRefs: CLAIM_SCHEMA.properties.moveRefs,
          },
        },
      },
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
  if (tokens.length === 0) return referencedMoves.length === 0;
  if (referencedMoves.length !== tokens.length) return false;
  return tokens.every((token, index) => (
    tokenMatchesPly(token, { moves: referencedMoves }, index)
  ));
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
      || id.startsWith("engine.pv.");
  }
  if (claimKind === "move_effect") {
    return id.startsWith("move.played.")
      || kind.startsWith("move.")
      || id.startsWith("position.change.");
  }
  if (claimKind === "position_change") {
    return id.startsWith("position.change.")
      || kind.startsWith("position.");
  }
  if (claimKind === "variation") return id.startsWith("engine.pv.");
  if (claimKind === "alternative") {
    return ["engine.best_move", "engine.move_assessment"].includes(id)
      || id.startsWith("engine.pv.");
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
  ) {
    errors.push(`${label}: Zugbewertung benötigt den konkreten Bewertungsbeleg.`);
  }
  if (
    claimKind === "alternative"
    && !ids.has("engine.best_move")
    && !ids.has("engine.move_assessment")
  ) {
    errors.push(`${label}: Alternative benötigt den belegten besten Zug.`);
  }
  if (
    claimKind === "variation"
    && !recordsForClaim.some((record) => record.id.startsWith("engine.pv."))
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
  const hasMeaningful = (id) => (
    ids.has(id) && factContainsChange(records.get(id))
  );
  const requireChange = (pattern, evidenceId, description) => {
    if (pattern.test(normalized) && !hasMeaningful(evidenceId)) {
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
    if (!bestUci || firstReferenced !== bestUci) {
      errors.push(`${label}: genannte Alternative ist nicht der belegte beste Zug.`);
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
    headline: "Genau die richtige Entscheidung",
    sentence: "Der Zug löst die Anforderungen der Stellung sehr genau.",
  },
  excellent: {
    headline: "Eine sehr starke Entscheidung",
    sentence: "Der Zug erhält die Qualität der Stellung nahezu vollständig.",
  },
  good: {
    headline: "Eine solide Entscheidung",
    sentence: "Der Zug bleibt gut spielbar und gibt nur wenig von der Stellungsqualität ab.",
  },
  inaccuracy: {
    headline: "Eine kleine Ungenauigkeit",
    sentence: "Der Zug lässt einen Teil der bisherigen Möglichkeiten ungenutzt.",
  },
  mistake: {
    headline: "Hier war mehr Genauigkeit nötig",
    sentence: "Der Zug verschlechtert die Stellung merklich.",
  },
  blunder: {
    headline: "Ein entscheidender Moment",
    sentence: "Der Zug verändert die Stellung deutlich zu Ungunsten der ziehenden Seite.",
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
      ? `Mit ${move.san} rückt der Bauer vor und verändert die Bauernstellung.`
      : `Mit ${move.san} wechselt der ${piece} auf sein Zielfeld.`,
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
  return {
    claimKind: "variation",
    text: "Sein genauer Wert zeigt sich vor allem in der geprüften Fortsetzung.",
    evidenceIds: ["engine.pv.1"],
    moveRefs: [],
    title: "Konkrete Idee",
  };
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
    text: `Mit ${move.san} wechselt die ${PIECE_NAMES[move.piece] || "Figur"} konkret ihr Feld.`,
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
    text: `Genauer war ${best.san}; diese Möglichkeit hielt die Stellung besser zusammen.`,
    evidenceIds: ["engine.move_assessment", "engine.pv.1"],
    moveRefs,
    title: "Bessere Möglichkeit",
  };
}

export function buildLocalMoveExplanation({
  positionEvidence = null,
  engineContext = null,
  openingContext = null,
  learnerProfile = null,
} = {}) {
  if (!positionEvidence?.valid) return null;
  const trusted = buildTrustedExplanationEvidence({
    positionEvidence,
    engineContext,
    openingContext,
  });
  const subject = resolveExplanationSubject(positionEvidence, engineContext);
  if (!subject.uci || !subject.san) return null;
  const assessment = assessmentCopy(engineContext, subject);
  const assessmentRefs = textMoveTokens(assessment.sentence).length > 0
    ? singleMoveReference(positionEvidence, subject.uci, { preferPlayed: true })
    : [];
  const summary = [
    {
      claimKind: assessment.claimKind,
      text: assessment.sentence,
      evidenceIds: assessment.evidenceIds,
      moveRefs: assessmentRefs,
    },
    moveDescription(positionEvidence),
    changeDescription(positionEvidence),
    legalLineDescription(positionEvidence, learnerProfile, engineContext),
    alternativeDescription(positionEvidence, engineContext, subject),
  ].filter(Boolean);
  const opening = openingContext?.matched
    ? openingContext
    : openingContext?.suggestedOpening?.matched
      ? openingContext.suggestedOpening
      : null;
  const openingName = cleanText(opening?.displayName, 240);
  const openingAnnouncement = openingContext?.announcement;
  if (
    opening
    && opening?.source === "lichess-chess-openings"
    && openingName
    && ["family", "variation"].includes(openingAnnouncement?.kind)
    && summary.length < 6
  ) {
    summary.splice(1, 0, {
      claimKind: "opening",
      text: openingAnnouncement.transposition
        ? `Per Zugumstellung ist jetzt ${openingAnnouncement.displayName || openingName} erreicht.`
        : `Jetzt ist ${openingAnnouncement.displayName || openingName} erreicht.`,
      evidenceIds: [`opening.name:${cleanText(opening.eco, 3) || "known"}`],
      moveRefs: [],
    });
  }
  while (summary.length < 4) {
    const completeLine = positionEvidence.verifiedLines?.find(
      (line) => line?.legal === true && line?.complete === true,
    );
    summary.push({
      claimKind: "variation",
      text: "Für die weitere Entscheidung bleibt die verifizierte Hauptfortsetzung der sichere Bezugspunkt.",
      evidenceIds: completeLine
        ? [completeLine.evidenceId]
        : [positionEvidence.playedMove.evidenceId],
      moveRefs: [],
    });
  }
  const deepDive = [
    detailedChangeDescription(positionEvidence),
    detailedLegalLineDescription(
      positionEvidence,
      learnerProfile,
      engineContext,
    ),
  ].filter(Boolean).map((entry) => ({
    claimKind: entry.claimKind,
    title: entry.title || "Zugidee",
    text: entry.text,
    evidenceIds: entry.evidenceIds,
    moveRefs: entry.moveRefs,
  }));
  if (deepDive.length < 2) {
    deepDive.push({
      claimKind: "move_effect",
      title: "Am Brett prüfen",
      text: "Vergleiche die Stellung vor und nach dem Zug und folge anschließend der verifizierten Hauptfortsetzung.",
      evidenceIds: [positionEvidence.playedMove.evidenceId],
      moveRefs: [],
    });
  }
  const candidate = {
    schemaVersion: MOVE_EXPLANATION_SCHEMA_VERSION,
    subjectUci: subject.uci,
    subjectSan: subject.san,
    headline: assessment.headline,
    summary: summary.slice(0, 6),
    deepDive: deepDive.slice(0, 5),
    confidence: (
      positionEvidence.verifiedLines?.some((line) => line?.legal && line?.complete)
      && (Number.parseInt(engineContext?.depth, 10) || 0) >= 15
    )
      ? "high"
      : "medium",
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
  if (value.schemaVersion !== MOVE_EXPLANATION_SCHEMA_VERSION) {
    errors.push("Unbekannte Erklärungsversion.");
  }

  const evidenceRecords = evidenceRecordMap(positionEvidence, knowledgeContext);
  const legalLines = verifiedLineMap(positionEvidence);
  const summarySource = Array.isArray(value.summary) ? value.summary : [];
  if (summarySource.length < 4 || summarySource.length > 6) {
    errors.push("Die Kurzfassung muss vier bis sechs belegte Sätze enthalten.");
  }
  const summary = summarySource
    .slice(0, 6)
    .map((claim, index) => normalizeClaim(
      claim,
      evidenceRecords,
      legalLines,
      engineContext,
      expected,
      errors,
      `Kurzsatz ${index + 1}`,
    ));

  const deepSource = Array.isArray(value.deepDive) ? value.deepDive : [];
  if (deepSource.length < 2 || deepSource.length > 5) {
    errors.push("Die Vertiefung muss zwei bis fünf Abschnitte enthalten.");
  }
  const deepDive = deepSource.slice(0, 5).map((section, index) => {
    const title = cleanText(section?.title, 80);
    if (!title) errors.push(`Vertiefung ${index + 1}: Überschrift fehlt.`);
    if (textMoveTokens(title).length > 0) {
      errors.push(`Vertiefung ${index + 1}: Zugnotation gehört in den belegten Text, nicht in die Überschrift.`);
    }
    if (
      /\b(?:gewinn|verlust|matt|schach|patzer|fehler)\b/i.test(title)
      && !["assessment", "alternative"].includes(section?.claimKind)
    ) {
      errors.push(`Vertiefung ${index + 1}: wertende Überschrift ist nicht passend belegt.`);
    }
    const claim = normalizeClaim(
      section,
      evidenceRecords,
      legalLines,
      engineContext,
      expected,
      errors,
      `Vertiefung ${index + 1}`,
    );
    return { title, ...claim };
  });

  const normalizedClaimTexts = new Set();
  const allClaims = [...summary, ...deepDive];
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
  const comparativeClaims = allClaims.filter((claim) => (
    /\b(?:beste|besten|stärkste|stärksten|erste wahl|besser|genauer)\b/i
      .test(claim?.text || "")
  ));
  if (comparativeClaims.length > 1) {
    errors.push("Die Erklärung wiederholt den Vergleich mit der besten Möglichkeit.");
  }

  if (!cleanText(value.headline, 160)) errors.push("Überschrift fehlt.");
  const headline = expected.uci && expected.san
    ? assessmentCopy(engineContext, expected).headline
    : "";
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
        headline,
        summary,
        deepDive,
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

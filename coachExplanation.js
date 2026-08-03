const MAX_TEXT_LENGTH = 700;
const MOVE_TOKEN_PATTERN =
  /\b(?:[a-h][1-8][a-h][1-8][qrbn]?|(?:O-O(?:-O)?|0-0(?:-0)?)[+#]?|[KQRBNDTLS][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBNDTLS])?[+#]?|[a-h](?:x[a-h])?[1-8](?:=[QRBNDTLS])?[+#]?)\b/gi;

export const MOVE_EXPLANATION_SCHEMA_VERSION = 3;
export const MOVE_EXPLANATION_CACHE_VERSION = 7;

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
  const source = cleanText(value, MAX_TEXT_LENGTH * 2);
  return [...source.matchAll(MOVE_TOKEN_PATTERN)]
    .filter((match) => {
      const token = match[0];
      if (!/^[a-h][1-8]$/i.test(token)) return true;
      const before = source.slice(Math.max(0, match.index - 42), match.index);
      const after = source.slice(
        match.index + token.length,
        match.index + token.length + 24,
      );
      const explicitSquareContext = (
        /(?:feld(?:es)?|quadrat|auf|von|nach|bis|über|kontrolliert|besetzt|deckt|greift)\s+$/iu
        .test(before)
        || /^\s*(?:-|als feld|wird kontrolliert|ist besetzt)/iu.test(after)
      );
      return !explicitSquareContext;
    })
    .map((match) => match[0]);
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
  if (referencedMoves.length === 0) return tokens.length === 0;
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
      || id === "engine.move_comparison"
      || id === "engine.move_comparison.necessity"
      || id.startsWith("engine.move_comparison.difference.");
  }
  if (claimKind === "move_effect") {
    return id.startsWith("move.played.")
      || kind.startsWith("move.")
      || id.startsWith("position.change.")
      || id === "engine.move_comparison.played"
      || id.startsWith("engine.move_comparison.difference.")
      || id.startsWith("position.danger.");
  }
  if (claimKind === "position_change") {
    return id.startsWith("position.change.")
      || kind.startsWith("position.")
      || id.startsWith("engine.move_comparison.difference.")
      || id === "engine.move_comparison.necessity";
  }
  if (claimKind === "variation") {
    return id.startsWith("engine.pv.")
      || id === "engine.played_line"
      || id.startsWith("opening.continuation:")
      || id.startsWith("engine.move_comparison.difference.")
      || id.startsWith("position.danger.");
  }
  if (claimKind === "alternative") {
    return ["engine.best_move", "engine.move_assessment"].includes(id)
      || id.startsWith("engine.pv.")
      || id === "engine.move_comparison.alternative"
      || id === "engine.move_comparison.best"
      || id === "engine.move_comparison.necessity"
      || id.startsWith("engine.move_comparison.difference.");
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
    && !ids.has("engine.move_comparison")
    && !ids.has("engine.move_comparison.necessity")
  ) {
    errors.push(`${label}: Zugbewertung benötigt den konkreten Bewertungsbeleg.`);
  }
  if (
    claimKind === "alternative"
    && !ids.has("engine.best_move")
    && !ids.has("engine.move_assessment")
    && !ids.has("engine.move_comparison.alternative")
    && !ids.has("engine.move_comparison.best")
    && !ids.has("engine.move_comparison.necessity")
  ) {
    errors.push(`${label}: Alternative benötigt den belegten besten Zug.`);
  }
  if (
    claimKind === "variation"
    && !recordsForClaim.some((record) => (
      record.id.startsWith("engine.pv.")
      || record.id === "engine.played_line"
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
  const comparisonFacts = [...ids]
    .map((id) => records.get(id)?.fact)
    .filter((fact) => fact && typeof fact === "object");
  const hasDifference = (...types) => comparisonFacts.some(
    (fact) => types.includes(fact.type),
  );
  const hasComparisonEffect = (...types) => comparisonFacts.some(
    (fact) => (
      Array.isArray(fact.immediateEffects)
      && fact.immediateEffects.some((effect) => types.includes(effect.type))
    ),
  );
  const hasMeaningful = (id) => (
    ids.has(id) && factContainsChange(records.get(id))
  );
  const requireChange = (pattern, evidenceId, description) => {
    if (
      pattern.test(normalized)
      && !hasMeaningful(evidenceId)
      && !(
        evidenceId === "position.change.center"
          ? hasDifference("improves_center_control")
            || hasComparisonEffect(
              "occupies_center",
              "controls_new_square",
              "king_centralization",
            )
          : evidenceId === "position.change.development"
            ? hasDifference("develops_piece")
              || hasComparisonEffect("develops_piece")
            : evidenceId === "position.change.files"
              ? hasDifference("opens_file")
                || hasComparisonEffect(
                  "opens_file",
                  "creates_semi_open_file",
                  "rook_on_open_file",
                  "rook_on_semi_open_file",
                )
              : evidenceId === "position.change.pawn_structure"
                ? hasDifference("pawn_structure")
                  || hasComparisonEffect(
                    "creates_doubled_pawns",
                    "creates_isolated_pawn",
                    "creates_passed_pawn",
                  )
                : evidenceId === "position.change.piece_safety"
                  ? hasDifference("avoids_loose_piece", "allows_material_threat")
                    || hasComparisonEffect(
                      "piece_newly_attacked",
                      "piece_newly_undefended",
                      "piece_attacked_and_undefended",
                    )
                  : false
      )
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
    && !hasDifference("improves_king_safety", "allows_check", "allows_checkmate")
    && !hasComparisonEffect("castles", "gives_check", "gives_checkmate")
  ) {
    errors.push(`${label}: die behauptete Königssicherheit ist nicht konkret nachgewiesen.`);
  }
  if (
    /\b(?:material|nimmt|schlägt)\w*/i.test(normalized)
    && !hasMeaningful("position.change.material")
    && !hasMeaningful("move.played.properties")
    && !hasDifference("material_outcome", "allows_material_threat")
    && !hasComparisonEffect("capture")
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

const MATERIAL_CLAIM_PIECES = Object.freeze({
  bauer: "p",
  bauern: "p",
  springer: "n",
  läufer: "b",
  turm: "r",
  türme: "r",
  dame: "q",
  figur: "figure",
  figuren: "figure",
  material: "material",
});

function explicitMaterialClaims(text) {
  const piece = "(Bauer|Bauern|Springer|Läufer|Turm|Türme|Dame|Figur|Figuren|Material)";
  const owner = "(?:(?:dein|sein|ihr|unser|euer)(?:e|en|er|em|es)?|ein(?:e|en|er|em|es)?|der|die|das|den|dem)";
  const subject = "(?:du\\s+)?";
  const square = "(?:\\s+auf\\s+([a-h][1-8]))?";
  const patterns = [
    { action: "set", pattern: new RegExp(`\\bstell(?:st|t|en)\\s+${subject}(?:${owner}\\s+)?${piece}${square}\\s+ein\\b`, "giu") },
    { action: "lose", pattern: new RegExp(`\\bverlier(?:st|t|en)\\s+${subject}(?:${owner}\\s+)?${piece}${square}`, "giu") },
    { action: "take", pattern: new RegExp(`\\bnimm(?:st|t|en)\\s+${subject}(?:${owner}\\s+)?${piece}${square}`, "giu") },
    { action: "lose", pattern: new RegExp(`\\b${piece}${square}\\s+(?:geht|gehen|ging|gingen)\\s+verloren\\b`, "giu") },
  ];
  return patterns.flatMap(({ action, pattern }) => [...text.matchAll(pattern)].map((match) => ({
    action,
    sample: match[0],
    piece: MATERIAL_CLAIM_PIECES[
      String(match[1] || "").toLocaleLowerCase("de-DE")
    ] || "",
    square: String(match[2] || "").toLowerCase(),
  })));
}

function referencedCaptures(moves) {
  return moves.flatMap((move) => {
    const capturedPiece = cleanText(
      move?.capture?.capturedPiece || move?.captured,
      1,
    ).toLowerCase();
    if (!capturedPiece) return [];
    return [{
      piece: capturedPiece,
      square: cleanText(move?.capture?.square || move?.to, 2).toLowerCase(),
    }];
  });
}

function captureSupportsMaterialClaim(capture, claim) {
  if (!capture || !claim?.piece) return false;
  if (claim.square && capture.square !== claim.square) return false;
  if (claim.piece === "material") return true;
  if (claim.piece === "figure") return ["n", "b", "r", "q"].includes(capture.piece);
  return capture.piece === claim.piece;
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
  const captures = referencedCaptures(referencedMoves);
  const materialClaims = explicitMaterialClaims(text);
  const supportedMaterialClaims = materialClaims.filter((claim) => (
    captures.some((capture) => captureSupportsMaterialClaim(capture, claim))
  ));
  materialClaims.forEach((claim) => {
    if (supportedMaterialClaims.includes(claim)) return;
    errors.push(
      `${label}: behauptete Figurenart oder behauptetes Schlagfeld in „${claim.sample}“ stimmt nicht mit dem referenzierten Schlagzug überein.`,
    );
  });
  const materialPiece = "(?:dame|turm|türme|läufer|springer|bauer|bauern|material|figur|figuren)";
  const broadlyWordedMaterialClaims = [
    {
      action: "set",
      pattern: new RegExp(`\\bstell(?:st|t|en)\\b[^.!?]{0,60}\\b${materialPiece}\\b[^.!?]{0,24}\\bein\\b`, "iu"),
    },
    {
      action: "lose",
      pattern: new RegExp(`\\bverlier(?:st|t|en)\\b[^.!?]{0,60}\\b${materialPiece}\\b`, "iu"),
    },
    {
      action: "take",
      pattern: new RegExp(`\\bnimm(?:st|t|en)\\b[^.!?]{0,60}\\b${materialPiece}\\b`, "iu"),
    },
    {
      action: "lose",
      pattern: new RegExp(`\\b${materialPiece}\\b[^.!?]{0,40}\\b(?:geht|gehen|ging|gingen)\\b[^.!?]{0,16}\\bverloren\\b`, "iu"),
    },
  ];
  broadlyWordedMaterialClaims.forEach(({ action, pattern }) => {
    if (
      !pattern.test(normalized)
      || supportedMaterialClaims.some((claim) => claim.action === action)
    ) return;
    errors.push(`${label}: Materialbehauptung ist nicht eindeutig an den referenzierten Schlagzug gebunden.`);
  });
  const bestMove = engineContext?.moveReview?.bestMove || engineContext?.bestMove;
  const bestUci = cleanUci(bestMove?.uci);
  const outcomeClaim =
    /\b(?:gewinnt|erobert|verschenkt|opfert|entscheidet|erzwingt)\b.{0,50}\b(?:dame|turm|läufer|springer|bauer|bauern|material|figur|figuren)\b/i
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
    const playedUci = cleanUci(
      engineContext?.moveReview?.playedMove?.uci || expected?.uci,
    );
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
    && /\b(?:beste|stärkste)\s+(?:wahl|zug|fortsetzung|möglichkeit)\b/i.test(text)
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

function trustedOpeningContinuation(openingContext, uci) {
  const move = cleanUci(uci);
  if (
    !move
    || openingContext?.matched !== true
    || openingContext?.source !== "lichess-chess-openings"
  ) return null;
  return (Array.isArray(openingContext.continuations)
    ? openingContext.continuations
    : [])
    .find((continuation) => (
      cleanUci(continuation?.uci) === move
      && (
        !continuation?.source
        || continuation.source === "lichess-chess-openings"
      )
    )) || null;
}

function openingContinuationEvidenceId(uci) {
  const move = cleanUci(uci);
  return move ? `opening.continuation:${move}` : "";
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
  if (
    openingContext?.matched === true
    && openingContext?.source === "lichess-chess-openings"
  ) {
    (Array.isArray(openingContext.continuations)
      ? openingContext.continuations
      : [])
      .slice(0, 5)
      .forEach((continuation) => {
        const uci = cleanUci(continuation?.uci);
        const san = cleanText(continuation?.san, 24);
        if (
          !uci
          || !san
          || (
            continuation?.source
            && continuation.source !== "lichess-chess-openings"
          )
        ) return;
        supplementalEvidence.push({
          id: openingContinuationEvidenceId(uci),
          kind: "opening.continuation",
          source: "lichess-chess-openings",
          fact: {
            uci,
            san,
            variationCount: Math.max(
              1,
              Number.parseInt(continuation?.variationCount, 10) || 1,
            ),
          },
        });
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

function branchMotifs(branch) {
  return (branch?.tacticalMotifs || [])
    .map((entry) => entry?.motif || entry)
    .filter((motif) => motif && typeof motif === "object");
}

function branchFirstMove(branch) {
  return branch?.lineEvents?.[0] || null;
}

function branchHasEffect(branch, type, predicate = () => true) {
  return (branch?.immediateEffects || [])
    .some((effect) => effect?.type === type && predicate(effect));
}

const FEATURE_PIECE_VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 });

function isSevereDanger(danger) {
  if (!danger || typeof danger !== "object") return false;
  if (["mate", "back_rank_mate"].includes(danger.type)) return true;
  if (danger.type === "loose_piece") {
    return (FEATURE_PIECE_VALUES[danger.piece] || 0) >= 3;
  }
  if (danger.type !== "material_capture") return false;
  const captured = FEATURE_PIECE_VALUES[
    danger.capture?.capturedPiece || danger.move?.capture?.capturedPiece
  ] || 0;
  const attacker = FEATURE_PIECE_VALUES[danger.move?.piece] || 0;
  return captured > 0 && (attacker === 0 ? captured >= 3 : captured >= attacker);
}

function isBehindPawn(rookSquare, pawnSquare, pawnColor) {
  if (!rookSquare || !pawnSquare || rookSquare[0] !== pawnSquare[0]) return false;
  const rookRank = Number.parseInt(rookSquare[1], 10);
  const pawnRank = Number.parseInt(pawnSquare[1], 10);
  if (!Number.isInteger(rookRank) || !Number.isInteger(pawnRank)) return false;
  return pawnColor === "w" ? rookRank < pawnRank : rookRank > pawnRank;
}

function snapshotOccupiedSquares(snapshot) {
  return new Set([
    ...["w", "b"].flatMap((color) => (
      snapshot?.pieceSafety?.byColor?.[color]?.pieces || []
    ).map((piece) => piece.square)),
    snapshot?.kingSafety?.byColor?.w?.kingSquare,
    snapshot?.kingSafety?.byColor?.b?.kingSquare,
  ].filter(Boolean));
}

function branchMovesRookBehindPassedPawn(branch, snapshot) {
  const move = branchFirstMove(branch)
    || (branch?.immediateEffects || []).find((effect) => effect?.type === "moves_piece");
  if (move?.piece !== "r" || !move.to) return false;
  const occupied = snapshotOccupiedSquares(snapshot);
  occupied.delete(move.from);
  occupied.delete(move.to);
  return ["w", "b"].some((pawnColor) => (
    (snapshot?.pawnStructure?.byColor?.[pawnColor]?.passedPawns || [])
      .some((square) => {
        if (!isBehindPawn(move.to, square, pawnColor)) return false;
        const fromRank = Number.parseInt(move.to[1], 10);
        const toRank = Number.parseInt(square[1], 10);
        const step = Math.sign(toRank - fromRank);
        for (let rank = fromRank + step; rank !== toRank; rank += step) {
          if (occupied.has(`${square[0]}${rank}`)) return false;
        }
        return true;
      })
  ));
}

function materialHasOnly(material, allowedTypes) {
  const allowed = new Set(allowedTypes);
  return ["w", "b"].every((color) => (
    ["n", "b", "r", "q"].every((type) => (
      allowed.has(type) || (material?.byColor?.[color]?.counts?.[type] || 0) === 0
    ))
  ));
}

function flankPawnCount(pawnStructure, color, files) {
  return files.reduce(
    (sum, file) => sum + (pawnStructure?.byColor?.[color]?.fileCounts?.[file] || 0),
    0,
  );
}

function advancedPassedPawnCanMove(snapshot) {
  const occupied = snapshotOccupiedSquares(snapshot);
  return ["w", "b"].some((color) => (
    (snapshot?.pawnStructure?.byColor?.[color]?.passedPawns || []).some((square) => {
      const rank = Number.parseInt(square[1], 10);
      const advanced = color === "w" ? rank >= 5 : rank <= 4;
      const nextRank = rank + (color === "w" ? 1 : -1);
      return advanced && nextRank >= 1 && nextRank <= 8
        && !occupied.has(`${square[0]}${nextRank}`);
    })
  ));
}

function branchProvesPieceTrade(branch) {
  const [first, reply] = branch?.lineEvents || [];
  return Boolean(
    first
    && reply
    && first.piece !== "p"
    && first.capture?.capturedPiece
    && first.capture.capturedPiece !== "p"
    && reply.capture?.capturedPiece === first.piece
    && reply.capture?.square === first.to,
  );
}

function branchProvesOverload(branch, beforeSnapshot, attackingColor) {
  const [first, reply, payoff] = branch?.lineEvents || [];
  if (!first?.capture || !reply?.capture || !payoff?.capture) return false;
  const defendingColor = attackingColor === "w" ? "b" : "w";
  const targets = (beforeSnapshot?.pieceSafety?.byColor?.[defendingColor]?.pieces || [])
    .filter((piece) => (
      (FEATURE_PIECE_VALUES[piece.type] || 0) >= 3
      && piece.attackers?.length > 0
      && piece.defenders?.length === 1
    ));
  const groups = new Map();
  targets.forEach((target) => {
    const defenderSquare = target.defenders[0];
    const duties = groups.get(defenderSquare) || [];
    duties.push(target);
    groups.set(defenderSquare, duties);
  });
  return [...groups.entries()]
    .filter(([, duties]) => duties.length >= 2)
    .some(([defenderSquare, duties]) => {
      const firstDuty = duties.find((duty) => duty.square === first.capture.square);
      const payoffDuty = duties.find((duty) => duty.square === payoff.capture.square);
      const gained = (FEATURE_PIECE_VALUES[firstDuty?.type] || 0)
        + (FEATURE_PIECE_VALUES[payoffDuty?.type] || 0);
      return Boolean(
        firstDuty
        && payoffDuty
        && firstDuty.square !== payoffDuty.square
        && reply.from === defenderSquare
        && reply.capture.square === first.to
        && gained >= (FEATURE_PIECE_VALUES[first.piece] || 0),
      );
    });
}

export function knowledgeFeatureIdsFromPositionEvidence(positionEvidence) {
  if (!positionEvidence?.valid) return [];
  const ids = new Set(["decision.candidate_selected"]);
  const color = positionEvidence.playedMove?.color;
  const opponent = color === "w" ? "b" : "w";
  const after = positionEvidence.after;
  const changes = positionEvidence.changes;
  if (!color || !after || !changes) return [...ids];
  const phase = phaseFromPositionEvidence(positionEvidence);
  const comparison = positionEvidence.moveComparison;
  const branches = [comparison?.played, comparison?.best].filter(Boolean);
  const allMotifs = branches.flatMap(branchMotifs);

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
    positionEvidence.playedMove.capture?.capturedPiece === "p"
  ) {
    ids.add("material.pawn_capture_available");
  }

  if (phase !== "opening") {
    const flankFiles = {
      queenside: ["a", "b", "c"],
      kingside: ["f", "g", "h"],
    };
    Object.entries(flankFiles).forEach(([flank, files]) => {
      const ownCount = flankPawnCount(after.pawnStructure, color, files);
      const opposingCount = flankPawnCount(after.pawnStructure, opponent, files);
      if (ownCount >= 2 && ownCount > opposingCount) {
        ids.add("pawn.majority");
        ids.add(`pawn.${flank}_majority`);
      }
    });
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

  const existingDangers = (positionEvidence.dangers?.dangerAlreadyExisted || [])
    .filter(isSevereDanger);
  if (existingDangers.length > 0) ids.add("opponent.threat");
  if ((positionEvidence.dangers?.dangerPreventedByMove || []).some(isSevereDanger)) {
    ids.add("prophylaxis.prevented_concrete_threat");
  }

  if (branches.some((branch) => branchProvesOverload(
    branch,
    positionEvidence.before,
    color,
  ))) {
    ids.add("tactic.overloaded_defender");
  }
  if (allMotifs.some((motif) => motif.type === "deflection")) {
    ids.add("tactic.deflection");
    ids.add("tactic.removing_defender");
    ids.add("exchange.key_defender_available");
    ids.add("attack.target_after_exchange");
  }
  const exchangeMotifs = allMotifs.filter((motif) => (
    ["equal_exchange", "favorable_exchange", "unfavorable_exchange"].includes(motif.type)
  ));
  if (branches.some(branchProvesPieceTrade)) ids.add("exchange.piece_trade_available");
  if (exchangeMotifs.some((motif) => motif.type === "favorable_exchange")) {
    ids.add("exchange.favorable");
  }
  if (exchangeMotifs.some((motif) => motif.type === "unfavorable_exchange")) {
    ids.add("exchange.unfavorable");
  }

  const bestEvents = comparison?.best?.lineEvents || [];
  if (
    bestEvents[0]?.piece === "r"
    && ["b", "n"].includes(bestEvents[0]?.capture?.capturedPiece)
    && bestEvents[1]?.capture?.capturedPiece === "r"
    && bestEvents[1]?.capture?.square === bestEvents[0]?.to
  ) {
    ids.add("exchange.quality_sacrifice_in_best_line");
  }

  const beforeBackRankMate = positionEvidence.dangers?.before?.tacticalMotifs
    ?.some((entry) => entry?.motif?.type === "back_rank_mate");
  if (beforeBackRankMate) {
    ids.add("king.back_rank_weakness");
    ids.add("tactic.back_rank_mate");
  }

  const bestIsActiveDefence = existingDangers.length > 0 && (
    branchHasEffect(comparison?.best, "gives_check")
    || branchHasEffect(comparison?.best, "capture")
    || branchMotifs(comparison?.best).some((motif) => motif.type === "counterattack")
  );
  if (bestIsActiveDefence) ids.add("defence.active_resource");
  if (branchMotifs(comparison?.best).some((motif) => motif.type === "stalemate_resource")) {
    ids.add("defence.stalemate_resource");
  }

  if (phase === "endgame") {
    const material = after.material;
    const counts = material?.byColor;
    const passedPawns = ["w", "b"].flatMap(
      (side) => after.pawnStructure?.byColor?.[side]?.passedPawns || [],
    );
    const totalRooks = (counts?.w?.counts?.r || 0) + (counts?.b?.counts?.r || 0);
    const totalMinors = ["w", "b"].reduce((sum, side) => (
      sum + (counts?.[side]?.counts?.b || 0) + (counts?.[side]?.counts?.n || 0)
    ), 0);

    if (materialHasOnly(material, [])) ids.add("endgame.pawn_endgame");
    if (materialHasOnly(material, ["b", "n"]) && totalMinors > 0) {
      ids.add("endgame.minor_piece_endgame");
    }
    if (
      totalRooks === 2
      && (counts?.w?.counts?.r || 0) === 1
      && (counts?.b?.counts?.r || 0) === 1
      && materialHasOnly(material, ["r"])
    ) {
      ids.add("endgame.rook_endgame");
    }
    if (
      materialHasOnly(material, [])
      && advancedPassedPawnCanMove(after)
    ) {
      ids.add("endgame.pawn_race");
    }
    if (
      !positionEvidence.before?.kingSafety?.byColor?.[color]?.inCheck
      && branchHasEffect(comparison?.best, "king_centralization")
    ) {
      ids.add("endgame.king_can_activate");
    }
    if (
      totalRooks === 2
      && (counts?.w?.counts?.r || 0) === 1
      && (counts?.b?.counts?.r || 0) === 1
      && passedPawns.length > 0
      && materialHasOnly(material, ["r"])
    ) {
      ids.add("endgame.rook_and_passed_pawn");
      const playedBehind = branchMovesRookBehindPassedPawn(
        comparison?.played,
        after,
      );
      const bestBehind = branchMovesRookBehindPassedPawn(
        comparison?.best,
        positionEvidence.before,
      );
      if (playedBehind || bestBehind) ids.add("endgame.rook_can_reach_behind");
    }
    const playedCapturesPawn = comparison?.played?.lineEvents?.[0]
      ?.capture?.capturedPiece === "p";
    const bestImprovesRook = branchHasEffect(
      comparison?.best,
      "improves_piece_activity",
      (effect) => effect.piece === "r",
    );
    if (playedCapturesPawn && bestImprovesRook) {
      ids.add("endgame.rook_activity_choice");
      ids.add("material.pawn_capture_available");
    }
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

function accusativePiece(piece) {
  const name = PIECE_NAMES[piece] || "Figur";
  return `${piece === "q" || !PIECE_NAMES[piece] ? "die" : "den"} ${name}`;
}

function ownedAccusativePiece(piece) {
  const name = PIECE_NAMES[piece] || "Figur";
  return `${piece === "q" || !PIECE_NAMES[piece] ? "deine" : "deinen"} ${name}`;
}

function ownedNominativePiece(piece) {
  if (piece === "p") return "dein Bauer";
  const name = PIECE_NAMES[piece] || "Figur";
  return `${piece === "q" || !PIECE_NAMES[piece] ? "deine" : "dein"} ${name}`;
}

function piecePronoun(piece) {
  return piece === "q" || !PIECE_NAMES[piece] ? "sie" : "ihn";
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
      text: `${move.san} bringt den ${piece} nach ${move.to} und gibt Schach.`,
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
  const comparisonAlternative = positionEvidence?.moveComparison?.alternative;
  const equivalent = (
    comparisonAlternative?.relation === "equivalent"
    && cleanUci(comparisonAlternative?.move?.uci) === cleanUci(best.uci)
  );
  return {
    claimKind: "alternative",
    text: equivalent
      ? `${best.san} ist eine genauso gute Möglichkeit.`
      : `${best.san} ist die genauere Alternative; der konkrete Unterschied steht in der geprüften Antwortfolge.`,
    evidenceIds: ["engine.move_assessment", "engine.pv.1"],
    moveRefs,
    title: equivalent ? "Genauso gute Möglichkeit" : "Bessere Möglichkeit",
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
  const subject = san || "Der Zug";
  const effects = Array.isArray(facts?.immediateEffects) ? facts.immediateEffects : [];
  const first = (type) => effects.find((effect) => effect.type === type);
  if (first("gives_checkmate")) return `${subject} setzt den gegnerischen König matt.`;
  if (first("gives_check")) return `${subject} gibt sofort Schach und zwingt den König zu einer Antwort.`;
  const capture = first("capture");
  if (capture) {
    return `${subject} nimmt ${accusativePiece(capture.capturedPiece)} auf ${capture.square}.`;
  }
  const castle = first("castles");
  if (castle) {
    return `${subject} rochiert ${castle.side === "kingside" ? "kurz" : "lang"}: Der König verlässt die Mitte und der Turm kommt ins Spiel.`;
  }
  const developed = first("develops_piece");
  if (developed) {
    return `${subject} entwickelt den ${pieceName(developed.piece)} nach ${developed.square}.`;
  }
  const pawnBreak = first("pawn_break");
  if (pawnBreak) {
    return `${subject} greift die Bauern auf ${pawnBreak.targets.join(" und ")} an.`;
  }
  const outpost = first("creates_outpost");
  if (outpost) {
    return `${subject} stellt die Figur geschützt nach ${outpost.square}.`;
  }
  const rookFile = first("rook_on_open_file") || first("rook_on_semi_open_file");
  if (rookFile) {
    return `${subject} stellt den Turm auf die ${rookFile.file}-Linie.`;
  }
  const kingCentralization = first("king_centralization");
  if (kingCentralization) {
    return `${subject} bringt den König von ${kingCentralization.from} näher ins Zentrum nach ${kingCentralization.to}.`;
  }
  const occupied = first("occupies_center");
  const controlled = effects.find(
    (effect) => (
      effect.type === "controls_new_square"
      && effect.square !== occupied?.square
    ),
  );
  if (occupied && controlled) {
    return `${subject} besetzt ${occupied.square} und kontrolliert zusätzlich ${controlled.square}.`;
  }
  if (occupied) return `${subject} besetzt das Zentrumsfeld ${occupied.square}.`;
  if (controlled) return `${subject} übernimmt neu die Kontrolle über ${controlled.square}.`;
  const opened = first("opens_file") || first("creates_semi_open_file");
  if (opened) return `${subject} öffnet die ${opened.file}-Linie.`;
  const loose = first("piece_attacked_and_undefended");
  if (loose) {
    return `${subject} lässt ${accusativePiece(loose.piece)} auf ${loose.square} angegriffen und ungedeckt stehen.`;
  }
  const activity = first("improves_piece_activity");
  if (activity) {
    return `${subject} gibt ${accusativePiece(activity.piece)} auf ${activity.square} mehr Felder.`;
  }
  const moved = first("moves_piece");
  if (!moved) return "";
  return moved.piece === "p"
    ? `${subject} zieht den Bauern nach ${moved.to}.`
    : `${subject} stellt ${accusativePiece(moved.piece)} nach ${moved.to}.`;
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
    if (comparison.moveNecessity?.type === "only_legal_move") {
      return "Es gibt in dieser Stellung genau einen legalen Zug.";
    }
    if (comparison.moveNecessity?.type === "only_move_to_avoid_loss") {
      return "Nur dieser Zug verhindert hier einen klaren Nachteil.";
    }
    if (comparison.moveNecessity?.type === "only_move_to_keep_advantage") {
      return "Nur dieser Zug behält den klaren Vorteil. Der andere gibt viel davon ab.";
    }
  }
  const differences = Array.isArray(comparison?.differences) ? comparison.differences : [];
  const difference = differences[0];
  if (!difference) return "";
  if (difference.type === "allows_check") {
    const reply = comparison.played?.opponentBestReply;
    if (!reply?.uci || (difference.move && difference.move !== reply.uci)) return "";
    return `Dein Zug erlaubt ${reply?.san || "ein sofortiges Schach"}${reply?.givesCheckmate ? " mit Matt" : " mit Schach"}. Die andere Fortsetzung verhindert das.`;
  }
  if (difference.type === "allows_checkmate") {
    if (
      difference.move
      && difference.move !== comparison.played?.opponentBestReply?.uci
    ) return "";
    return `Nach deinem Zug folgt ${comparison.played?.opponentBestReply?.san || "Matt"}. Die andere Fortsetzung verhindert das.`;
  }
  if (difference.type === "material_outcome") {
    return "Mit der anderen Fortsetzung verlierst du weniger Material.";
  }
  if (difference.type === "develops_piece") {
    return `Der andere Zug entwickelt eine Figur nach ${difference.square}.`;
  }
  if (difference.type === "avoids_loose_piece") {
    return `Der andere Zug schützt die Figur auf ${difference.square}.`;
  }
  if (difference.type === "improves_king_safety") {
    return "Der andere Zug bringt deinen König aus der Mitte.";
  }
  if (difference.type === "improves_center_control") {
    return `Der andere Zug kämpft direkt um ${difference.square || "das Zentrum"}.`;
  }
  return "";
}

function takeawayText(comparison) {
  const types = new Set((comparison?.differences || []).map((difference) => difference.type));
  if (types.has("allows_check") || types.has("allows_checkmate")) {
    return "Schau vor deinem Zug kurz: Kann dein Gegner deinen König direkt angreifen?";
  }
  if (types.has("avoids_loose_piece")) {
    return "Schau nach deinem Zug: Ist eine deiner Figuren angegriffen und ungedeckt?";
  }
  if (types.has("material_outcome") || types.has("allows_material_threat")) {
    return "Schau vor deinem Zug: Kann dein Gegner eine Figur schlagen?";
  }
  if (types.has("develops_piece")) {
    return "Wenn nichts angegriffen ist, bring eine neue Figur ins Spiel.";
  }
  if (types.has("improves_king_safety")) {
    return "Bring zuerst deinen König in Sicherheit.";
  }
  return null;
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
  const comparison = positionEvidence.moveComparison;
  if (!subject.uci || !subject.san || !comparison?.played) return null;
  const review = engineContext?.moveReview;
  const analysis = positionEvidence.coachAnalysis;
  const assessmentEvidenceId = review ? "engine.move_assessment" : "engine.best_move";
  const reportedQuality = review?.quality || "good";
  const hasMeasuredLoss = Number.isFinite(comparison.lossCp);
  const significantDrop = hasMeasuredLoss && comparison.lossCp >= 140;
  const severeDrop = hasMeasuredLoss && comparison.lossCp >= 300;
  const quality = severeDrop
    ? "blunder"
    : significantDrop
      ? "mistake"
      : hasMeasuredLoss && comparison.lossCp > 70
        ? "inaccuracy"
      : hasMeasuredLoss && comparison.lossCp > 30
          ? "good"
          : hasMeasuredLoss && comparison.lossCp > 10
            ? "excellent"
            : hasMeasuredLoss
              ? reportedQuality === "best"
                ? "best"
                : "excellent"
              : ["best", "excellent", "good", "inaccuracy"].includes(reportedQuality)
                ? reportedQuality
                : "good";
  const simpleLearner = ["foundations", "building"]
    .includes(learnerProfile?.responseStyle?.id);
  const openingPhase = phaseFromPositionEvidence(positionEvidence) === "opening";
  const recognizedOpening = Boolean(
    openingPhase
    && openingContext?.matched === true
    && openingContext?.source === "lichess-chess-openings",
  );
  const hasEquivalentAlternative = (
    comparison.explanationType === "equivalent"
    || comparison.alternative?.relation === "equivalent"
  );
  let verdictText = comparison.moveNecessity?.type === "only_legal_move"
    ? "Der Zug ist erzwungen: Es gibt keinen anderen legalen Zug."
    : openingPhase && !["mistake", "blunder"].includes(quality)
      ? "Der Zug ist in dieser Eröffnung gut spielbar."
    : comparison.explanationType === "best_move" && !hasEquivalentAlternative
    ? "Das ist hier die genaueste Wahl."
    : hasEquivalentAlternative
      ? "Der Zug hält deine Stellung."
      : quality === "blunder"
        ? "Das ist ein grober Fehler. Deine Stellung wird dadurch viel schlechter."
        : quality === "mistake"
          ? "Das ist ein klarer Fehler. Deine Stellung wird dadurch deutlich schlechter."
      : quality === "inaccuracy"
            ? "Das ist etwas ungenau. Du lässt eine bessere Möglichkeit aus."
            : "Der Zug ist spielbar. Die Alternative löst die wichtigste Aufgabe besser.";
  const playedLine = positionEvidence.verifiedLines?.find(
    (line) => line.moves?.[0]?.uci === subject.uci,
  );
  const primaryDifference = comparison.differences?.[0];
  if (["inaccuracy", "mistake", "miss", "blunder"].includes(quality)) {
    if (primaryDifference?.type === "allows_check") {
      verdictText = `Das Problem: Der Zug erlaubt sofort ${playedLine?.moves?.[1]?.san || "ein Schach"}.`;
    } else if (primaryDifference?.type === "allows_checkmate") {
      verdictText = `Das Problem: Der Zug lässt ${playedLine?.moves?.[1]?.san || "eine direkte Mattfolge"} zu.`;
    } else if (
      primaryDifference?.type === "material_outcome"
      && comparison.played.materialBalanceDelta < 0
    ) {
      verdictText = `${severeDrop ? "Das ist ein grober Fehler" : significantDrop ? "Das ist ein klarer Fehler" : "Der Zug ist ungenau"}. In der kurzen Zugfolge verlierst du Material.`;
    } else if (primaryDifference?.type === "avoids_loose_piece") {
      verdictText = `${severeDrop ? "Das ist ein grober Fehler" : significantDrop ? "Das ist ein klarer Fehler" : "Der Zug ist ungenau"}. Mit ${subject.san} bleibt ${ownedNominativePiece(primaryDifference.piece)} auf ${primaryDifference.square} angegriffen und ungedeckt.`;
    }
  }
  const opponent = comparison.played.opponentBestReply;
  const opponentMove = playedLine?.moves?.[1];
  const opponentActions = [
    opponent?.capture
      ? `nimmt ${ownedAccusativePiece(opponent.capture.capturedPiece)} auf ${opponent.capture.square}`
      : "",
    opponent?.givesCheckmate
      ? "setzt matt"
      : opponent?.givesCheck
        ? "gibt Schach"
        : "",
  ].filter(Boolean);
  const opponentActionText = opponentActions.join(" und ");
  const typicalOpeningReply = recognizedOpening
    ? trustedOpeningContinuation(openingContext, opponent?.uci)
    : null;
  const errorGrade = severeDrop
    ? "ein grober Fehler"
    : significantDrop
      ? "ein klarer Fehler"
      : "ungenau";
  const clearlyBad = significantDrop;
  const immediateRecapture = Boolean(
    playedLine?.moves?.[2]?.capture
    && playedLine.moves[2].to === opponentMove?.to,
  );
  const recaptureMove = immediateRecapture ? playedLine.moves[2] : null;
  const clearDirectLoss = Boolean(
    clearlyBad
    && opponent?.capture
    && comparison.played.materialBalanceDelta < 0
    && !immediateRecapture,
  );
  const impactText = severeDrop
    ? "Deine Stellung wird dadurch viel schlechter."
    : significantDrop
      ? "Deine Stellung wird dadurch deutlich schlechter."
      : "";
  if (clearDirectLoss && opponent?.san) {
    const capturedPiece = opponent.capture.capturedPiece;
    const ending = opponent.givesCheckmate
      ? `nimmt ${piecePronoun(capturedPiece)} und setzt matt`
      : opponent.givesCheck
        ? `nimmt ${piecePronoun(capturedPiece)} mit Schach`
        : `nimmt ${piecePronoun(capturedPiece)}`;
    verdictText = [
      `${subject.san} ist ${errorGrade}.`,
      `Du stellst ${ownedAccusativePiece(capturedPiece)} auf ${opponent.capture.square} ein: ${opponent.san} ${ending}.`,
      impactText,
    ].filter(Boolean).join(" ");
  } else if (
    ["inaccuracy", "mistake", "miss", "blunder"].includes(quality)
    && ["allows_check", "allows_checkmate"].includes(primaryDifference?.type)
    && opponent?.san
  ) {
    verdictText = [
      `${subject.san} ist ${errorGrade}.`,
      opponent.givesCheckmate
        ? `${opponent.san} setzt dich matt.`
        : `${opponent.san} gibt Schach.`,
      impactText,
    ].filter(Boolean).join(" ");
  } else if (clearlyBad && impactText) {
    verdictText = `${severeDrop ? "Das ist ein grober Fehler" : "Das ist ein klarer Fehler"}. ${impactText}`;
  }
  const opponentText = opponent && (!recognizedOpening || typicalOpeningReply)
    ? opponentActionText
      ? recaptureMove?.san && recaptureMove.capture
        ? `${opponent.san} ${opponentActionText}. Danach nimmst du mit ${recaptureMove.san} ${accusativePiece(recaptureMove.capture.capturedPiece)} zurück.`
        : `${opponent.san} ${opponentActionText}.`
      : recognizedOpening
        ? `Danach folgt oft ${opponent.san}.`
        : `Danach folgt ${opponent.san}.`
    : "";
  let consequence = null;
  if (opponent?.givesCheckmate) {
    consequence = `Nach ${opponent.san} ist die Partie matt.`;
  } else if (opponent?.givesCheck) {
    consequence = `Nach ${opponent.san} musst du sofort auf das Schach reagieren.`;
  } else if (opponent?.capture) {
    consequence = `Nach ${opponent.san} ist ${ownedNominativePiece(opponent.capture.capturedPiece)} weg.`;
  } else if (comparison.played.materialBalanceDelta < 0) {
    consequence = "In der kurzen Zugfolge verlierst du Material.";
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
      alternative.move?.san,
    )
    : "";
  let alternativeText = "";
  if (alternative && (!openingPhase || ["mistake", "blunder"].includes(quality))) {
    if (simpleLearner && alternative.relation === "better") {
      const developed = alternative.immediateEffects?.find(
        (effect) => effect.type === "develops_piece",
      );
      alternativeText = developed
        ? `Besser war ${alternative.move.san}. Damit entwickelst du ${accusativePiece(developed.piece)}.`
        : alternativeIdea
          ? `Besser: ${alternativeIdea}`
          : `${alternative.move.san} war besser.`;
    } else if (comparison.onlyMove && subject.uci === comparison.best.move?.uci) {
      alternativeText = `${alternative.move.san} ist möglich, aber deutlich schwächer. ${alternativeIdea}`;
    } else if (alternative.relation === "equivalent") {
      alternativeText = alternativeIdea
        ? `Genauso gut: ${alternativeIdea}`
        : `Genauso gut geht ${alternative.move.san}.`;
    } else if (alternative.relation === "inferior") {
      alternativeText = alternativeIdea
        ? `Weitere Möglichkeit: ${alternativeIdea}`
        : `${alternative.move.san} ist ebenfalls möglich.`;
    } else if (alternative.relation === "only_move") {
      alternativeText = alternativeIdea
        ? `Einziger haltender Zug: ${alternativeIdea}`
        : `${alternative.move.san} war hier der einzige Zug, der die Stellung hält.`;
    } else {
      alternativeText = alternativeIdea
        ? `${simpleLearner ? "Besser" : "Genauer"}: ${alternativeIdea}`
        : simpleLearner
          ? `${alternative.move.san} ist besser.`
          : `${alternative.move.san} war die genauere Alternative. Den Unterschied zeigt die kurze Variante.`;
    }
  }
  const differenceText = comparisonDifferenceText(comparison);
  const differenceEvidenceId = primaryDifference?.evidenceId;
  const necessityEvidenceId = comparison.moveNecessity
    ? "engine.move_comparison.necessity"
    : null;
  const comparisonEvidenceId = comparison.onlyMove
    ? necessityEvidenceId
    : differenceEvidenceId;
  const takeaway = takeawayText(comparison);
  const takeawayDifference = (comparison.differences || []).find((difference) => {
    if (/Schach|König direkt angreifen/i.test(takeaway || "")) {
      return ["allows_check", "allows_checkmate"].includes(difference.type);
    }
    if (/ungedeckt/i.test(takeaway || "")) {
      return difference.type === "avoids_loose_piece";
    }
    if (/Schlagzüge|Rückschläge|Figur schlagen/i.test(takeaway || "")) {
      return ["material_outcome", "allows_material_threat"].includes(difference.type);
    }
    if (/entwickle|ins Spiel/i.test(takeaway || "")) return difference.type === "develops_piece";
    if (/Rochade|König/i.test(takeaway || "")) {
      return difference.type === "improves_king_safety";
    }
    return false;
  });
  const playedEffects = comparison.played.immediateEffects || [];
  const foundationsDevelopment = simpleLearner
    ? playedEffects.find((effect) => effect.type === "develops_piece")
    : null;
  const foundationsCenterPawn = simpleLearner
    && positionEvidence.playedMove.piece === "p"
    && playedEffects.some((effect) => effect.type === "occupies_center");
  const foundationsMoveIdea = foundationsDevelopment
    ? `Damit entwickelst du ${accusativePiece(foundationsDevelopment.piece)}!`
    : foundationsCenterPawn
      ? "Damit stellst du einen Bauern ins Zentrum!"
      : simpleLearner
        ? `Damit ziehst du ${ownedAccusativePiece(positionEvidence.playedMove.piece)} nach ${positionEvidence.playedMove.to}.`
        : "";
  const moveIdeaText = foundationsMoveIdea
    || effectText(comparison.played, subject.san);
  const candidate = {
    schemaVersion: MOVE_EXPLANATION_SCHEMA_VERSION,
    subjectUci: subject.uci,
    subjectSan: subject.san,
    verdict: semanticClaim(
      verdictText,
      [assessmentEvidenceId, necessityEvidenceId, differenceEvidenceId]
        .filter(Boolean),
      opponent?.san && (
        ["allows_check", "allows_checkmate"].includes(primaryDifference?.type)
        || clearDirectLoss
      )
        ? lineMoveReference(positionEvidence, playedLine, 0, 2)
        : [],
    ),
    moveIdea: semanticClaim(
      moveIdeaText,
      [positionEvidence.playedMove.evidenceId, "engine.move_comparison.played"],
      foundationsMoveIdea
        ? []
        : singleMoveReference(positionEvidence, subject.uci, { preferPlayed: true }),
    ),
    opponentReply: opponentText
      ? semanticClaim(
        opponentText,
        [
          playedLine?.evidenceId,
          typicalOpeningReply
            ? openingContinuationEvidenceId(typicalOpeningReply.uci)
            : null,
        ].filter(Boolean),
        opponentMove
          ? lineMoveReference(positionEvidence, playedLine, 1, recaptureMove ? 2 : 1)
          : [],
      )
      : null,
    concreteConsequence: consequence
      ? semanticClaim(
        consequence,
        [playedLine?.evidenceId, differenceEvidenceId].filter(Boolean),
        opponentMove ? lineMoveReference(positionEvidence, playedLine, 1) : [],
      )
      : null,
    alternative: alternativeText
      ? semanticClaim(
        alternativeText,
        [
          alternativeLine?.evidenceId,
          assessmentEvidenceId,
          "engine.move_comparison.alternative",
          necessityEvidenceId,
          differenceEvidenceId,
        ]
          .filter(Boolean),
        lineMoveReference(positionEvidence, alternativeLine, 0),
      )
      : null,
    comparison: differenceText
      ? semanticClaim(
        differenceText,
        [comparisonEvidenceId].filter(Boolean),
        !comparison.onlyMove
          && ["allows_check", "allows_checkmate"].includes(primaryDifference?.type)
          ? lineMoveReference(positionEvidence, playedLine, 1)
          : [],
      )
      : null,
    takeaway: takeaway
      ? semanticClaim(
        takeaway,
        [takeawayDifference?.evidenceId].filter(Boolean),
      )
      : null,
    confidence: (
      analysis?.verdict?.confidence === "high"
        ? "high"
        : positionEvidence.candidateLines?.length >= 2
      && (Number.parseInt(engineContext?.depth, 10) || 0) >= 15
    )
      ? "high"
      : positionEvidence.candidateLines?.length >= 1
        ? "medium"
        : "limited",
  };
  if (candidate.opponentReply && candidate.concreteConsequence) {
    candidate.concreteConsequence = null;
  }
  if (simpleLearner) {
    // Für 800/1000 Elo reicht eine klare Wirkung, die wichtigste Antwort und
    // höchstens eine Alternative. Die ausführlichen Felder wiederholen sonst
    // denselben taktischen Punkt in fünf verschiedenen Abschnitten.
    candidate.comparison = null;
    if (clearlyBad && (
      clearDirectLoss
      || ["allows_check", "allows_checkmate"].includes(primaryDifference?.type)
    )) {
      candidate.opponentReply = null;
      candidate.concreteConsequence = null;
    }
    candidate.takeaway = candidate.alternative ? null : candidate.takeaway;
  } else if (Number(learnerProfile?.rating) <= 1400) {
    if (candidate.alternative && candidate.comparison) {
      candidate.comparison = null;
    }
  }
  const checked = verifyMoveExplanation(candidate, {
    positionEvidence: trusted,
    engineContext,
  });
  if (checked.valid) return checked.value;
  if (globalThis.process?.env?.COACH_EXPLANATION_DEBUG === "1") {
    console.warn("[Local move explanation]", subject.san, checked.errors.join(" "));
  }

  const fallbackAlternativeText = alternative
    ? alternative.relation === "equivalent"
      ? `Genauso gut geht ${alternative.move.san}.`
      : `${alternative.move.san} ist besser.`
    : "";
  const fallback = {
    schemaVersion: MOVE_EXPLANATION_SCHEMA_VERSION,
    subjectUci: subject.uci,
    subjectSan: subject.san,
    verdict: semanticClaim(
      severeDrop
        ? "Der Zug macht deine Stellung viel schlechter."
        : significantDrop
          ? "Der Zug macht deine Stellung deutlich schlechter."
        : quality === "inaccuracy"
          ? "Der Zug gibt einen kleinen Teil deiner Stellung ab."
          : "Der Zug hält deine Stellung gut.",
      [assessmentEvidenceId],
    ),
    moveIdea: semanticClaim(
      positionEvidence.playedMove.piece === "p"
        ? "Damit bringst du deinen Bauern weiter nach vorne."
        : `Damit stellst du ${accusativePiece(positionEvidence.playedMove.piece)} neu auf.`,
      [positionEvidence.playedMove.evidenceId],
      [],
    ),
    opponentReply: null,
    concreteConsequence: null,
    alternative: fallbackAlternativeText
      ? semanticClaim(
        fallbackAlternativeText,
        [alternativeLine?.evidenceId, assessmentEvidenceId].filter(Boolean),
        lineMoveReference(positionEvidence, alternativeLine, 0),
      )
      : null,
    comparison: null,
    takeaway: null,
    confidence: "limited",
  };
  const checkedFallback = verifyMoveExplanation(fallback, {
    positionEvidence: trusted,
    engineContext,
  });
  if (
    !checkedFallback.valid
    && globalThis.process?.env?.COACH_EXPLANATION_DEBUG === "1"
  ) {
    console.warn(
      "[Local move explanation fallback]",
      subject.san,
      checkedFallback.errors.join(" "),
    );
  }
  return checkedFallback.valid ? checkedFallback.value : null;
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
    ["inaccuracy", "mistake", "miss", "blunder"].includes(engineContext?.moveReview?.quality)
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
    const typicalOpeningReply = explanation.opponentReply?.evidenceIds
      ?.some((id) => cleanText(id, 120).startsWith("opening.continuation:"));
    const labels = {
      verdict: "",
      moveIdea: "",
      alternative: "Alternative",
      opponentReply: typicalOpeningReply
        ? "Typische Antwort"
        : "Stärkste Antwort",
      concreteConsequence: "Konkrete Folge",
      comparison: "Der Unterschied",
      takeaway: "Merksatz",
    };
    const fields = [
      "moveIdea",
      "verdict",
      "opponentReply",
      "concreteConsequence",
      "alternative",
      ...(deep
        ? ["comparison", "takeaway"]
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
      explanation.opponentReply
        ? { ...explanation.opponentReply, claimKind: "variation", semanticField: "opponentReply" }
        : null,
      explanation.concreteConsequence
        ? { ...explanation.concreteConsequence, claimKind: "variation", semanticField: "concreteConsequence" }
        : null,
      explanation.comparison
        ? { ...explanation.comparison, claimKind: "position_change", semanticField: "comparison" }
        : null,
      explanation.alternative
        ? { ...explanation.alternative, claimKind: "alternative", semanticField: "alternative" }
        : null,
      explanation.takeaway
        ? { ...explanation.takeaway, claimKind: "principle", semanticField: "takeaway" }
        : null,
    ]
      .filter(Boolean)
      .slice(0, Math.max(1, Math.min(7, Number.parseInt(maximum, 10) || 2)));
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

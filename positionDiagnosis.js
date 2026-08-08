import { evaluationToPlayerCp } from "./moveNecessity.js";

export const POSITION_DIAGNOSIS_VERSION = 2;

const PIECE_VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 });
const DIRECT_TACTICAL_CONCEPTS = new Set([
  "back_rank_mate",
  "checkmate",
  "decoy",
  "deflection",
  "discovered_attack",
  "discovered_check",
  "double_attack",
  "double_check",
  "fork",
  "mate_motif",
  "overload",
  "overloaded_defender",
  "pin",
  "remove_defender",
  "removes_defender",
  "sacrifice",
  "skewer",
  "trapped_piece",
  "zwischenzug",
]);

const DIFFERENCE_CONCEPTS = Object.freeze({
  allows_checkmate: ["tactical", "mating_attack"],
  allows_check: ["king_safety", "unsafe_king"],
  material_outcome: ["material", "material_loss"],
  allows_material_threat: ["material", "hanging_piece"],
  avoids_loose_piece: ["material", "hanging_piece"],
  allows_tactical_motif: ["tactical", null],
  develops_piece: ["development", "development_advantage"],
  improves_king_safety: ["king_safety", "king_safety"],
  improves_center_control: ["positional", "center_control"],
  opens_file: ["positional", "open_file"],
});

const EFFECT_CONCEPTS = Object.freeze({
  gives_checkmate: ["tactical", "mating_attack"],
  gives_check: ["tactical", "forcing_check"],
  capture: ["material", "material_change"],
  develops_piece: ["development", "development_advantage"],
  castles: ["king_safety", "king_safety"],
  occupies_center: ["positional", "center_control"],
  controls_new_square: ["positional", "center_control"],
  opens_file: ["positional", "open_file"],
  creates_semi_open_file: ["positional", "semi_open_file"],
  creates_doubled_pawns: ["pawn_structure", "doubled_pawns"],
  creates_isolated_pawn: ["pawn_structure", "isolated_pawn"],
  creates_passed_pawn: ["pawn_structure", "passed_pawn"],
  improves_piece_activity: ["activity", "piece_activity"],
  reduces_piece_activity: ["activity", "passive_piece"],
  pawn_break: ["pawn_structure", "pawn_break"],
  creates_outpost: ["positional", "outpost"],
  rook_on_open_file: ["activity", "rook_on_open_file"],
  rook_on_semi_open_file: ["activity", "rook_on_semi_open_file"],
  bad_bishop: ["activity", "bad_bishop"],
  active_bishop: ["activity", "good_bishop"],
  king_centralization: ["activity", "king_activity_endgame"],
  piece_newly_attacked: ["material", "attacked_piece"],
  piece_newly_undefended: ["material", "loose_piece"],
  piece_attacked_and_undefended: ["material", "hanging_piece"],
});

const SPECIFICITY = Object.freeze({
  mating_attack: 10,
  checkmate: 9,
  back_rank_mate: 9,
  fork: 8,
  pin: 8,
  discovered_attack: 8,
  skewer: 8,
  zwischenzug: 8,
  unfavorable_exchange: 8,
  hanging_piece: 7,
  trapped_piece: 6,
  pawn_break: 6,
  passed_pawn: 6,
  outpost: 6,
  rook_on_open_file: 6,
  isolated_pawn: 5,
  backward_pawn: 5,
  space_advantage: 4,
  development_advantage: 4,
  king_activity_endgame: 5,
  center_control: 1,
  piece_activity: 1,
  unsafe_king: 4,
  material_loss: 3,
  material_change: 1,
  initiative: 7,
  compensation: 8,
  prophylaxis: 7,
});

const unique = (values) => [...new Set(values.filter(Boolean))];
const clamp = (value, minimum = 0, maximum = 1) => (
  Math.max(minimum, Math.min(maximum, value))
);

function phaseFromEvidence(evidence) {
  const supplied = evidence?.coachAnalysis?.verdict?.explanationType;
  if (["opening", "endgame"].includes(supplied)) return supplied;
  const material = evidence?.before?.material?.byColor;
  const queens = (material?.w?.counts?.q || 0) + (material?.b?.counts?.q || 0);
  const points = (material?.w?.points || 0) + (material?.b?.points || 0);
  if (queens === 0 || points <= 26) return "endgame";
  const fullmove = Number.parseInt(
    String(evidence?.input?.fenBefore || evidence?.before?.fen || "").split(/\s+/u)[5],
    10,
  ) || 1;
  return fullmove <= 12 ? "opening" : "middlegame";
}

function normalizedEvaluation(value) {
  if (!value || !["cp", "mate"].includes(value.unit) || !Number.isFinite(value.value)) {
    return null;
  }
  return {
    unit: value.unit,
    value: Math.round(value.value),
    perspective: value.perspective === "white" ? "white" : "player",
  };
}

function evaluationSummary(engineContext, positionEvidence) {
  const comparison = positionEvidence?.moveComparison;
  const review = engineContext?.moveReview;
  const before = normalizedEvaluation(
    comparison?.best?.evaluation || review?.evaluationBefore || engineContext?.evaluation,
  );
  const after = normalizedEvaluation(
    comparison?.played?.evaluation || review?.evaluationAfter || before,
  );
  const beforeCp = evaluationToPlayerCp(before);
  const afterCp = evaluationToPlayerCp(after);
  const changeCp = Number.isFinite(beforeCp) && Number.isFinite(afterCp)
    ? Math.round(afterCp - beforeCp)
    : Number.isFinite(review?.evaluationDeltaCp)
      ? Math.round(review.evaluationDeltaCp)
      : null;
  return {
    before,
    after,
    changeCp,
    lossCp: Number.isFinite(comparison?.lossCp)
      ? Math.max(0, Math.round(comparison.lossCp))
      : Number.isFinite(review?.lossCp)
        ? Math.max(0, Math.round(review.lossCp))
        : null,
  };
}

function lineEvidenceId(positionEvidence, branch) {
  const target = positionEvidence?.moveComparison?.[branch]?.move?.uci;
  return positionEvidence?.verifiedLines?.find(
    (line) => line?.legal && line?.complete && line.moves?.[0]?.uci === target,
  )?.evidenceId || "";
}

function pvEvidence(positionEvidence) {
  const comparison = positionEvidence?.moveComparison;
  const branches = comparison?.played?.move?.uci === comparison?.best?.move?.uci
    ? ["best"]
    : ["played", "best"];
  return branches.flatMap((branch) => {
    const facts = comparison?.[branch];
    if (!facts) return [];
    const evidenceId = lineEvidenceId(positionEvidence, branch);
    const events = (facts.lineEvents || []).flatMap((move, ply) => {
      const result = [];
      if (move.capture) {
        result.push({
          branch,
          ply,
          type: "capture",
          move: { uci: move.uci, san: move.san },
          capturedPiece: move.capture.capturedPiece,
          square: move.capture.square,
          evidenceId,
        });
      }
      if (move.givesCheckmate) {
        result.push({ branch, ply, type: "checkmate", move: { uci: move.uci, san: move.san }, evidenceId });
      } else if (move.givesCheck) {
        result.push({ branch, ply, type: "check", move: { uci: move.uci, san: move.san }, evidenceId });
      }
      if (move.promotion) {
        result.push({ branch, ply, type: "promotion", move: { uci: move.uci, san: move.san }, evidenceId });
      }
      return result;
    });
    const motifs = (facts.tacticalMotifs || []).map((entry) => ({
      branch,
      ply: Number.isInteger(entry?.ply) ? entry.ply : null,
      type: "tactical_motif",
      concept: entry?.motif?.type || entry?.type || "tactical_motif",
      moveUci: entry?.move || "",
      details: entry?.motif || entry,
      evidenceId,
    }));
    const material = facts.materialBalanceDelta
      ? [{
        branch,
        type: "material_balance_change",
        delta: facts.materialBalanceDelta,
        horizon: facts.comparisonHorizon,
        evidenceId,
      }]
      : [];
    return [...events, ...motifs, ...material];
  });
}

function signal(id, weight, evidence = null) {
  return { id, weight, ...(evidence ? { evidence } : {}) };
}

function candidate({
  id,
  type,
  concept,
  description,
  source,
  featureId = "",
  squares = [],
  pieces = [],
  signals = [],
  evidenceIds = [],
  details = null,
  kind = "primitive_feature",
  causalPriority = 0,
}) {
  const relevanceScore = Math.min(100, signals.reduce((sum, item) => sum + item.weight, 0));
  const independentEvidence = new Set(signals.map((item) => item.id.split(":")[0])).size;
  const confidence = clamp(
    0.2
      + relevanceScore / 140
      + Math.min(0.12, Math.max(0, independentEvidence - 1) * 0.04),
  );
  return {
    id,
    type,
    concept,
    description,
    source,
    featureId: featureId || null,
    relevanceScore,
    confidence: Number(confidence.toFixed(2)),
    evidenceStrength: independentEvidence,
    signals,
    evidenceIds: unique(evidenceIds),
    squares: unique(squares),
    pieces: unique(pieces),
    details,
    kind,
    causalPriority,
  };
}

function descriptionForDifference(difference) {
  if (difference.type === "allows_checkmate") return "Der gespielte Zug erlaubt eine konkrete Mattfolge, die die bessere Fortsetzung vermeidet.";
  if (difference.type === "allows_check") return "Der gespielte Zug erlaubt ein unmittelbares Schach, das die bessere Fortsetzung vermeidet.";
  if (difference.type === "material_outcome") return "Die geprüfte Zugfolge nach dem gespielten Zug hat ein schlechteres materielles Ergebnis als die beste Fortsetzung.";
  if (difference.type === "allows_material_threat") return `Nach dem gespielten Zug kann Material auf ${difference.square || "einem konkreten Feld"} geschlagen werden.`;
  if (difference.type === "avoids_loose_piece") return `Die bessere Fortsetzung verhindert, dass die Figur auf ${difference.square || "dem Brett"} angegriffen und ungedeckt bleibt.`;
  if (difference.type === "allows_tactical_motif") return `Der gespielte Zug erlaubt das taktische Motiv ${difference.motif || "in der geprüften Folge"}.`;
  if (difference.type === "develops_piece") return `Die bessere Fortsetzung entwickelt eine Figur nach ${difference.square || "ein aktiveres Feld"}.`;
  if (difference.type === "improves_king_safety") return "Die bessere Fortsetzung verbessert die Königssicherheit unmittelbar.";
  if (difference.type === "improves_center_control") return `Die bessere Fortsetzung gewinnt konkreten Einfluss auf ${difference.square || "das Zentrum"}.`;
  if (difference.type === "opens_file") return "Die bessere Fortsetzung öffnet eine Linie für die eigenen Figuren.";
  return "Die geprüften Fortsetzungen unterscheiden sich in einer konkret gemessenen Stellungsfolge.";
}

function consequenceSignals(difference, pvItems) {
  const signals = [];
  const playedItems = pvItems.filter((item) => item.branch === "played");
  const type = difference?.type;
  if (type === "allows_checkmate" && playedItems.some((item) => item.type === "checkmate")) {
    signals.push(signal("forcing:checkmate", 30));
  } else if (type === "allows_check" && playedItems.some((item) => ["check", "checkmate"].includes(item.type))) {
    signals.push(signal("forcing:check", 20));
  }
  if (["material_outcome", "allows_material_threat", "avoids_loose_piece"].includes(type)) {
    const material = playedItems.find((item) => item.type === "material_balance_change" && item.delta < 0);
    const capture = playedItems.find((item) => item.type === "capture");
    if (material) signals.push(signal("outcome:material", 24, material));
    if (capture) signals.push(signal("pv:capture", 14, capture));
  }
  if (type === "allows_tactical_motif") {
    const motif = playedItems.find(
      (item) => item.type === "tactical_motif" && item.concept === difference.motif,
    );
    if (motif) signals.push(signal("pv:motif", 24, motif));
  }
  return signals;
}

function dangerConcept(danger, relation) {
  if (relation === "prevented") return ["tactical", "prophylaxis"];
  if (["mate", "check"].includes(danger?.type)) return ["king_safety", danger.type === "mate" ? "mating_attack" : "unsafe_king"];
  if (["material_capture", "loose_piece"].includes(danger?.type)) return ["material", "hanging_piece"];
  if (DIRECT_TACTICAL_CONCEPTS.has(danger?.type)) return ["tactical", danger.type];
  return ["tactical", danger?.type || "direct_threat"];
}

function dangerDescription(danger, relation) {
  const move = danger?.move?.san || danger?.move?.uci || "die konkrete Antwort";
  if (relation === "prevented") return `Der Zug verhindert eine zuvor legal vorhandene direkte Gefahr (${move}).`;
  if (danger?.type === "mate") return `Der Zug erlaubt die konkrete Mattantwort ${move}.`;
  if (danger?.type === "check") return `Der Zug erlaubt das unmittelbare Schach ${move}.`;
  if (danger?.type === "material_capture") {
    const square = danger?.capture?.square || danger?.move?.capture?.square || "dem Angriffsfeld";
    return `Der Zug erlaubt einen konkreten Materialschlag auf ${square}.`;
  }
  if (danger?.type === "loose_piece") return `Eine Figur auf ${danger.square || "dem Brett"} bleibt angegriffen und ungedeckt.`;
  return `Der Zug ist mit der konkreten Gefahr ${danger?.type || "in der Antwortfolge"} verbunden.`;
}

function dangerCandidates(positionEvidence, evaluation, depth) {
  const dangers = positionEvidence?.dangers || {};
  const comparison = positionEvidence?.moveComparison;
  const bestIsPlayed = comparison?.best?.move?.uci === comparison?.played?.move?.uci;
  return [
    ["created", dangers.dangerCreatedByMove || []],
    ["ignored", dangers.dangerIgnoredByMove || []],
    ["prevented", dangers.dangerPreventedByMove || []],
  ].flatMap(([relation, items]) => items.flatMap((danger, index) => {
    const [type, concept] = dangerConcept(danger, relation);
    const dangerMove = danger?.move?.uci || danger?.uci || "";
    const replyUci = comparison?.played?.opponentBestReply?.uci || "";
    const matchesStrongestReply = Boolean(dangerMove && dangerMove === replyUci);
    const independentlyCritical = danger?.type === "mate" || (
      danger?.type === "loose_piece"
      && (PIECE_VALUES[danger?.piece] || 0) >= 3
    );
    if (
      relation !== "prevented"
      && !matchesStrongestReply
      && !independentlyCritical
    ) return [];
    const signals = [
      signal(`change:danger_${relation}`, relation === "ignored" ? 18 : 24, danger),
      signal("calculation:legal_danger", 16, danger),
    ];
    if (matchesStrongestReply) {
      signals.push(signal("pv:strongest_reply", 26, { uci: dangerMove }));
    }
    if (relation === "prevented" && bestIsPlayed) {
      signals.push(signal("engine:primary_move", 25, { uci: comparison.played.move.uci }));
    }
    if (Number.isFinite(evaluation.lossCp) && evaluation.lossCp >= 70 && relation !== "prevented") {
      signals.push(signal("evaluation:swing_corroborates", 8));
    }
    if (depth >= 15) signals.push(signal("engine:adequate_depth", 5, { depth }));
    return [candidate({
      id: `driver:danger:${relation}:${index + 1}:${concept}`,
      type,
      concept,
      description: dangerDescription(danger, relation),
      source: "danger_comparison",
      signals,
      evidenceIds: [
        "position.danger.comparison",
        relation === "prevented" ? "position.danger.before" : "position.danger.after",
      ],
      squares: [danger.square, danger.capture?.square, danger.move?.capture?.square],
      pieces: [danger.piece, danger.capture?.capturedPiece, danger.move?.capture?.capturedPiece],
      details: { relation, danger },
    })];
  }));
}

function differenceCandidates(positionEvidence, evaluation, pvItems, depth) {
  return (positionEvidence?.moveComparison?.differences || []).map((difference, index) => {
    const [type, mappedConcept] = DIFFERENCE_CONCEPTS[difference.type] || ["other", difference.type];
    const concept = difference.type === "allows_tactical_motif"
      ? difference.motif || "tactical_motif"
      : mappedConcept;
    const signals = [
      signal("comparison:equal_horizon", 34, {
        horizon: positionEvidence.moveComparison?.comparisonHorizon || null,
      }),
      ...consequenceSignals(difference, pvItems),
    ];
    if (Number.isFinite(evaluation.lossCp) && evaluation.lossCp >= 70) {
      signals.push(signal("evaluation:swing_corroborates", Math.min(12, 5 + Math.round(evaluation.lossCp / 100))));
    }
    if (depth >= 15) signals.push(signal("engine:adequate_depth", 6, { depth }));
    return candidate({
      id: `driver:difference:${index + 1}:${concept}`,
      type,
      concept,
      description: descriptionForDifference(difference),
      source: "move_comparison",
      signals,
      evidenceIds: [difference.evidenceId, "engine.move_comparison"],
      squares: [difference.square],
      pieces: [difference.piece],
      details: difference,
    });
  });
}

function effectDescription(effect, concept, branch) {
  const prefix = branch === "played" ? "Der gespielte Zug" : "Die beste Fortsetzung";
  if (effect.type === "gives_checkmate") return `${prefix} führt unmittelbar zum Matt.`;
  if (effect.type === "gives_check") return `${prefix} erzwingt eine Reaktion durch Schach.`;
  if (effect.type === "develops_piece") return `${prefix} entwickelt eine Figur nach ${effect.square}.`;
  if (effect.type === "castles") return `${prefix} bringt den König durch die Rochade in Sicherheit.`;
  if (effect.type === "creates_passed_pawn") return `${prefix} schafft einen Freibauern auf ${effect.square}.`;
  if (effect.type === "creates_outpost") return `${prefix} besetzt oder schafft den Vorposten ${effect.square}.`;
  if (effect.type === "king_centralization") return `${prefix} aktiviert den König im Endspiel auf ${effect.to}.`;
  if (effect.type === "pawn_break") return `${prefix} setzt einen Bauernhebel gegen ${(effect.targets || []).join(" und ") || "die Bauernstruktur"} an.`;
  if (effect.type === "piece_attacked_and_undefended") return `${prefix} lässt die Figur auf ${effect.square} angegriffen und ungedeckt zurück.`;
  if (effect.type === "piece_newly_undefended") return `${prefix} lässt die Figur auf ${effect.square} ungedeckt zurück.`;
  if (effect.type === "capture") return `${prefix} verändert das Material durch einen konkreten Schlagzug.`;
  return `${prefix} verändert die Stellung im Bereich ${concept}.`;
}

function effectCandidates(positionEvidence, evaluation, depth) {
  const comparison = positionEvidence?.moveComparison;
  return ["played", "best"].flatMap((branch) => {
    const facts = comparison?.[branch];
    if (!facts) return [];
    const effects = facts.immediateEffects || [];
    const hasKingCentralization = effects.some(
      (effect) => effect?.type === "king_centralization",
    );
    const evidenceId = branch === "played"
      ? "engine.move_comparison.played"
      : "engine.move_comparison.best";
    return effects.flatMap((effect, index) => {
      // Im Endspiel ist die Zentrumswirkung eines Königszugs die konkrete
      // Folge seiner Aktivierung, nicht ein eigenständiger Hauptgrund.
      if (
        hasKingCentralization
        && ["occupies_center", "controls_new_square"].includes(effect.type)
      ) return [];
      const mapping = EFFECT_CONCEPTS[effect.type];
      if (!mapping) return [];
      if (
        ["piece_newly_attacked", "piece_newly_undefended", "piece_attacked_and_undefended"]
          .includes(effect.type)
        && (PIECE_VALUES[effect.piece] || 0) < 3
      ) return [];
      const [type, concept] = mapping;
      const signals = [signal(`change:${branch}`, 19, effect)];
      if (facts.move?.uci === comparison?.best?.move?.uci) {
        signals.push(signal("engine:primary_move", 25, { uci: facts.move.uci }));
      }
      if (["gives_checkmate", "gives_check", "capture"].includes(effect.type)) {
        signals.push(signal(`forcing:${effect.type}`, effect.type === "gives_checkmate" ? 30 : 16));
      }
      if (Number.isFinite(evaluation.lossCp) && evaluation.lossCp >= 70 && branch === "best") {
        signals.push(signal("evaluation:alternative_corroborates", 8));
      }
      if (depth >= 15) signals.push(signal("engine:adequate_depth", 5, { depth }));
      return [candidate({
        id: `driver:effect:${branch}:${index + 1}:${concept}`,
        type,
        concept,
        description: effectDescription(effect, concept, branch),
        source: `${branch}_move_effect`,
        signals,
        evidenceIds: [evidenceId],
        squares: [effect.square, effect.to, ...(effect.targets || [])],
        pieces: [effect.piece, effect.capturedPiece],
        details: effect,
      })];
    });
  });
}

function descriptionForPvMotif(concept, details, branch) {
  const prefix = branch === "played" ? "Die geprüfte Folge nach dem gespielten Zug" : "Die beste Fortsetzung";
  if (concept === "unfavorable_exchange") return `${prefix} endet in einem ungünstigen Abtausch.`;
  if (concept === "favorable_exchange") return `${prefix} erreicht einen günstigen Abtausch.`;
  if (concept === "forced_capture_sequence") return `${prefix} enthält eine konkrete Folge erzwungener Schlagzüge.`;
  if (concept === "checkmate" || concept === "back_rank_mate") return `${prefix} führt zu einer konkreten Mattfolge.`;
  if (concept === "trapped_piece") return `${prefix} zeigt, dass eine angegriffene Figur keinen sicheren Rückzug hat.`;
  return `${prefix} bestätigt das taktische Motiv ${concept}.`;
}

function pvMotifCandidates(positionEvidence, evaluation, pvItems, depth) {
  const comparison = positionEvidence?.moveComparison;
  return pvItems.flatMap((item, index) => {
    if (item.type !== "tactical_motif" || !item.concept) return [];
    const facts = comparison?.[item.branch];
    const signals = [
      signal("pv:verified_motif", 28, item),
      signal(`line:${item.branch}`, 15, { move: facts?.move || null }),
    ];
    if (facts?.move?.uci === comparison?.best?.move?.uci) {
      signals.push(signal("engine:primary_move", 25, { uci: facts.move.uci }));
    }
    if (item.ply === 0) signals.push(signal("move:immediate_motif", 16));
    if (["unfavorable_exchange", "favorable_exchange"].includes(item.concept)) {
      signals.push(signal("outcome:exchange", 18, item.details));
    }
    if (Number.isFinite(evaluation.lossCp) && evaluation.lossCp >= 70 && item.branch === "played") {
      signals.push(signal("evaluation:swing_corroborates", 8));
    }
    if (depth >= 15) signals.push(signal("engine:adequate_depth", 5, { depth }));
    return [candidate({
      id: `driver:pv-motif:${item.branch}:${index + 1}:${item.concept}`,
      type: "tactical",
      concept: item.concept,
      description: descriptionForPvMotif(item.concept, item.details, item.branch),
      source: "verified_principal_variation",
      signals,
      evidenceIds: [item.evidenceId],
      squares: [
        item.details?.target,
        item.details?.target?.square,
        item.details?.pinned?.square,
      ],
      details: item,
    })];
  });
}

function patternTouchesPv(pattern, positionEvidence) {
  const squares = new Set(pattern?.criticalSquares || []);
  const moveUcis = new Set(
    (positionEvidence?.verifiedLines || []).flatMap((line) => (
      line?.legal && line?.complete ? line.moves.map((move) => move.uci) : []
    )),
  );
  if (pattern?.move?.uci && moveUcis.has(pattern.move.uci)) return "move";
  if (squares.size === 0) return "";
  return [...moveUcis].some((uci) => squares.has(uci.slice(0, 2)) || squares.has(uci.slice(2, 4)))
    ? "square"
    : "";
}

function patternCandidates(patterns, positionEvidence, evaluation, depth) {
  const subject = positionEvidence?.playedMove;
  return (patterns || []).flatMap((pattern, index) => {
    if (!pattern?.type || pattern.status === "refuted") return [];
    const signals = [signal("detection:board_geometry", 10, {
      confidence: Number.isFinite(pattern.confidence) ? pattern.confidence : null,
    })];
    const pvLink = patternTouchesPv(pattern, positionEvidence);
    const bestUci = positionEvidence?.moveComparison?.best?.move?.uci || "";
    const bestIsPlayed = bestUci === positionEvidence?.moveComparison?.played?.move?.uci;
    const adversePatternWithoutEvaluationSupport = Boolean(
      pattern.status === "warning"
      && bestIsPlayed
      && (!Number.isFinite(evaluation.lossCp) || evaluation.lossCp <= 30)
    );
    const bestTouchesCriticalSquare = Boolean(
      bestUci
      && (pattern.criticalSquares || []).some(
        (square) => square === bestUci.slice(0, 2) || square === bestUci.slice(2, 4),
      ),
    );
    if (!adversePatternWithoutEvaluationSupport && pattern.timing === "created") {
      signals.push(signal("change:pattern_created", 20));
    }
    if (!adversePatternWithoutEvaluationSupport && pattern.timing === "removed") {
      signals.push(signal("change:pattern_removed", 15));
    }
    if (pattern.move?.uci && pattern.move.uci === subject?.uci) {
      if (!adversePatternWithoutEvaluationSupport) {
        signals.push(signal("move:subject_creates_or_uses", 27, { uci: subject.uci }));
      }
    }
    if (
      subject?.to
      && (pattern.criticalSquares || []).includes(subject.to)
      && pattern.timing === "created"
      && !adversePatternWithoutEvaluationSupport
    ) {
      signals.push(signal("move:subject_square", 22, { square: subject.to }));
    }
    if (pattern.engineEvidence?.supportsMove && !adversePatternWithoutEvaluationSupport) {
      signals.push(signal("engine:primary_line", 25, pattern.engineEvidence));
    } else if (!adversePatternWithoutEvaluationSupport) {
      if (bestTouchesCriticalSquare) {
        signals.push(signal("engine:primary_square", 20, {
          uci: bestUci,
          squares: pattern.criticalSquares || [],
        }));
      }
      if (pvLink === "move") {
        signals.push(signal("pv:pattern_move", 22, { uci: pattern.move?.uci }));
      } else if (pvLink === "square" && !bestTouchesCriticalSquare) {
        signals.push(signal("pv:critical_square", 15, { squares: pattern.criticalSquares || [] }));
      }
    }
    if (pattern.proofLine?.length > 1) {
      signals.push(signal("calculation:proof_line", 12, { moves: pattern.proofLine.slice(0, 6) }));
    }
    if (Number.isFinite(pattern.materialGain) && pattern.materialGain > 0) {
      signals.push(signal("outcome:material_gain", 18, { pawns: pattern.materialGain }));
    }
    if (DIRECT_TACTICAL_CONCEPTS.has(pattern.type) && ["winning", "active"].includes(pattern.status)) {
      const motifInPv = (positionEvidence?.moveComparison?.played?.tacticalMotifs || [])
        .some((entry) => (entry?.motif?.type || entry?.type) === pattern.type);
      if (motifInPv) signals.push(signal("pv:tactical_confirmation", 22));
    }
    if (Number.isFinite(evaluation.lossCp) && evaluation.lossCp >= 70 && signals.length >= 2) {
      signals.push(signal("evaluation:swing_corroborates", 7));
    }
    if (depth >= 15 && signals.some((item) => item.id.startsWith("engine:") || item.id.startsWith("pv:"))) {
      signals.push(signal("engine:adequate_depth", 5, { depth }));
    }
    return [candidate({
      id: `driver:pattern:${index + 1}:${pattern.type}`,
      type: pattern.category === "tactical"
        ? "tactical"
        : pattern.type.includes("pawn") || pattern.type === "passed_pawn"
          ? "pawn_structure"
          : pattern.type.includes("king") || pattern.type.includes("mate")
            ? "king_safety"
            : "positional",
      concept: pattern.type,
      description: pattern.explanation || `Das erkannte Muster ${pattern.type} ist mit der geprüften Fortsetzung verbunden.`,
      source: "pattern_recognition",
      featureId: pattern.id,
      signals,
      squares: pattern.criticalSquares || [],
      pieces: [pattern.attacker, ...(pattern.targets || []).map((target) => target.piece)],
      details: {
        status: pattern.status,
        timing: pattern.timing,
        move: pattern.move || null,
        targets: pattern.targets || [],
        engineEvidence: pattern.engineEvidence || null,
      },
    })];
  });
}

function mergeCandidates(candidates) {
  const merged = new Map();
  for (const item of candidates) {
    const squareKey = item.squares.slice(0, 2).sort().join("-");
    const branch = item.details?.branch
      || (item.source.includes("played_move_effect")
      ? "played"
      : item.source.includes("best_move_effect")
        ? "best"
        : "shared");
    const causalMove = item.details?.moveUci || item.details?.move?.uci || "";
    const key = `${item.concept}|${squareKey}|${branch}|${causalMove}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, item);
      continue;
    }
    const signals = [...current.signals];
    item.signals.forEach((entry) => {
      if (!signals.some((existing) => existing.id === entry.id)) signals.push(entry);
    });
    merged.set(key, candidate({
      id: current.relevanceScore >= item.relevanceScore ? current.id : item.id,
      type: current.relevanceScore >= item.relevanceScore ? current.type : item.type,
      concept: current.concept,
      description: current.relevanceScore >= item.relevanceScore ? current.description : item.description,
      source: unique([current.source, item.source]).join("+"),
      featureId: current.featureId || item.featureId,
      signals,
      evidenceIds: [...current.evidenceIds, ...item.evidenceIds],
      squares: [...current.squares, ...item.squares],
      pieces: [...current.pieces, ...item.pieces],
      details: current.relevanceScore >= item.relevanceScore ? current.details : item.details,
      kind: current.kind === "candidate_explanation" || item.kind === "candidate_explanation"
        ? "candidate_explanation"
        : "primitive_feature",
      causalPriority: Math.max(current.causalPriority || 0, item.causalPriority || 0),
    }));
  }
  return [...merged.values()];
}

function publicReason(item, rank) {
  if (!item) return null;
  return {
    rank,
    type: item.type,
    concept: item.concept,
    description: item.description,
    confidence: item.confidence,
    relevanceScore: item.relevanceScore,
    evidenceStrength: item.evidenceStrength,
    evidenceIds: item.evidenceIds,
    signals: item.signals,
    squares: item.squares,
    pieces: item.pieces,
    source: item.source,
    featureId: item.featureId,
    details: item.details,
    kind: item.kind,
    causalScore: item.causalScore,
    causalValidation: item.causalValidation,
  };
}

function causalFamily(concept) {
  if (["material_loss", "hanging_piece", "loose_piece", "attacked_piece", "material_change"].includes(concept)) {
    return "material_loss";
  }
  if (["mating_attack", "unsafe_king", "forcing_check", "checkmate", "back_rank_mate"].includes(concept)) {
    return "king_attack";
  }
  return concept;
}

function lineEvaluationCp(line) {
  return evaluationToPlayerCp(line?.evaluation);
}

function completeCandidateLines(positionEvidence) {
  return (positionEvidence?.verifiedLines || [])
    .filter((line) => line?.role === "candidate" && line.legal && line.complete)
    .sort((left, right) => left.rank - right.rank);
}

function materialBalanceFor(positionEvidence, color) {
  const opponent = color === "w" ? "b" : "w";
  const material = positionEvidence?.before?.material?.byColor;
  if (!material?.[color] || !material?.[opponent]) return null;
  return material[color].points - material[opponent].points;
}

function minimumMaterialBalanceInLine(line, color, initialBalance, horizon = 8) {
  if (!Number.isFinite(initialBalance)) return null;
  let balance = initialBalance;
  let minimum = balance;
  for (const move of (line?.moves || []).slice(0, horizon)) {
    const captured = move?.capture?.capturedPiece;
    if (captured) {
      const delta = PIECE_VALUES[captured] || 0;
      balance += move.color === color ? delta : -delta;
      minimum = Math.min(minimum, balance);
    }
  }
  return minimum;
}

function finalMaterialBalanceInLine(line, color, initialBalance, horizon = 8) {
  if (!Number.isFinite(initialBalance)) return null;
  let balance = initialBalance;
  for (const move of (line?.moves || []).slice(0, horizon)) {
    const captured = move?.capture?.capturedPiece;
    if (!captured) continue;
    const delta = PIECE_VALUES[captured] || 0;
    balance += move.color === color ? delta : -delta;
  }
  return balance;
}

function selectedLineContext(positionEvidence) {
  const lines = completeCandidateLines(positionEvidence);
  const subjectUci = positionEvidence?.playedMove?.uci || "";
  const selected = lines.find((line) => line.moves?.[0]?.uci === subjectUci)
    || (positionEvidence?.verifiedLines || []).find(
      (line) => line?.role === "played" && line.legal && line.complete,
    )
    || null;
  const best = lines[0] || null;
  const second = lines[1] || null;
  const bestCp = lineEvaluationCp(best);
  const selectedCp = lineEvaluationCp(selected);
  const secondCp = lineEvaluationCp(second);
  const selectedLossCp = Number.isFinite(bestCp) && Number.isFinite(selectedCp)
    ? Math.max(0, Math.round(bestCp - selectedCp))
    : null;
  return {
    lines,
    selected,
    best,
    second,
    bestCp,
    selectedCp,
    secondCp,
    selectedLossCp,
    selectedIsBest: Boolean(
      selected?.moves?.[0]?.uci
      && selected.moves[0].uci === best?.moves?.[0]?.uci,
    ),
    selectedNearBest: Number.isFinite(selectedLossCp) && selectedLossCp <= 25,
  };
}

function strategicCandidateExplanations(positionEvidence, evaluation) {
  const context = selectedLineContext(positionEvidence);
  const color = positionEvidence?.playedMove?.color;
  const firstMove = context.selected?.moves?.[0] || null;
  if (!color || !firstMove || !Number.isFinite(context.selectedCp)) return [];
  const quietMove = !firstMove.capture && !firstMove.givesCheck && !firstMove.givesCheckmate;
  const phase = phaseFromEvidence(positionEvidence);
  const distinctCandidateMoves = new Set(
    context.lines.map((line) => line.moves?.[0]?.uci).filter(Boolean),
  ).size;
  const explanations = [];

  const initialMaterialBalance = materialBalanceFor(positionEvidence, color);
  const minimumMaterialBalance = minimumMaterialBalanceInLine(
    context.selected,
    color,
    initialMaterialBalance,
  );
  const finalMaterialBalance = finalMaterialBalanceInLine(
    context.selected,
    color,
    initialMaterialBalance,
  );
  const compensationDeficit = Number.isFinite(minimumMaterialBalance)
    ? Math.min(0, minimumMaterialBalance)
    : 0;
  const persistentDeficit = Number.isFinite(initialMaterialBalance)
    && initialMaterialBalance <= -1;
  const materialInvestment = Number.isFinite(initialMaterialBalance)
    && Number.isFinite(finalMaterialBalance)
    && finalMaterialBalance <= initialMaterialBalance - 2
    && (phase === "opening" || context.selectedCp <= 50);
  if (
    compensationDeficit <= -1
    && context.selectedCp >= -100
    && context.selectedCp <= 350
    && Number.isFinite(context.selectedLossCp)
    && context.selectedLossCp <= 100
    && (quietMove || materialInvestment)
    && phase !== "endgame"
    && (persistentDeficit || materialInvestment)
    && (
      distinctCandidateMoves >= 2
      || (
        materialInvestment
        && minimumMaterialBalance <= initialMaterialBalance - 2
      )
    )
  ) {
    const signals = [
      signal("position:material_deficit", 34, { pawns: Math.abs(compensationDeficit) }),
      signal("engine:evaluation_resilience", 26, { evaluationCp: context.selectedCp }),
      signal("engine:selected_line_supported", 16, { lossCp: context.selectedLossCp }),
    ];
    if (materialInvestment) {
      signals.push(signal("pv:material_investment", 30, {
        before: initialMaterialBalance,
        minimum: minimumMaterialBalance,
      }));
    }
    explanations.push(candidate({
      id: "explanation:compensation",
      type: "strategic",
      concept: "compensation",
      description: "Die Engine-Bewertung bleibt trotz des materiellen Rückstands stabil; die nichtmateriellen Vorteile tragen die Stellung.",
      source: "causal_synthesis",
      signals,
      evidenceIds: [context.selected.evidenceId, "position.before.material", "engine.move_comparison"],
      details: {
        materialBalanceBefore: initialMaterialBalance,
        minimumMaterialBalance,
        finalMaterialBalance,
        evaluationCp: context.selectedCp,
        selectedLossCp: context.selectedLossCp,
        horizon: Math.min(8, context.selected.moves.length),
      },
      kind: "candidate_explanation",
      causalPriority: 45,
    }));
  }

  const preventedDangers = positionEvidence?.dangers?.dangerPreventedByMove || [];
  const eligiblePreventedDangers = preventedDangers.filter((danger) => {
    const uci = danger?.move?.uci || danger?.uci || "";
    const destinationMatchesSubject = Boolean(
      firstMove.piece === "p"
      && uci.slice(2, 4)
      && uci.slice(2, 4) === firstMove.to,
    );
    const seriousDirectThreat = ["mate", "check", "material_capture"].includes(danger?.type);
    const appearsAsCounterfactualReply = context.lines.some(
      (line) => line !== context.selected && line.moves?.[1]?.uci === uci,
    );
    return destinationMatchesSubject || (seriousDirectThreat && appearsAsCounterfactualReply);
  });
  const selectedReply = context.selected.moves?.[1]?.uci || "";
  const inferiorReplyCounts = new Map();
  for (const line of context.lines.filter((line) => line !== context.selected)) {
    const reply = line.moves?.[1]?.uci || "";
    if (!reply || reply === selectedReply) continue;
    const row = inferiorReplyCounts.get(reply) || { count: 0, bestCp: -Infinity };
    row.count += 1;
    row.bestCp = Math.max(row.bestCp, lineEvaluationCp(line));
    inferiorReplyCounts.set(reply, row);
  }
  const suppressedReply = [...inferiorReplyCounts.entries()]
    .filter(([, row]) => row.count >= 2 && context.selectedCp - row.bestCp >= 20)
    .sort((left, right) => right[1].count - left[1].count || right[1].bestCp - left[1].bestCp)[0]
    || null;
  if (
    quietMove
    && context.selectedNearBest
    && distinctCandidateMoves >= 2
    && (eligiblePreventedDangers.length > 0 || suppressedReply)
  ) {
    const signals = [
      signal("engine:selected_move_supported", 24, { lossCp: context.selectedLossCp }),
      signal("move:quiet_prevention", 12, { uci: firstMove.uci }),
    ];
    if (eligiblePreventedDangers.length > 0) {
      signals.push(signal("change:danger_prevented", 42, eligiblePreventedDangers[0]));
    }
    if (suppressedReply) {
      signals.push(signal("multipv:opponent_reply_suppressed", 34, {
        uci: suppressedReply[0],
        alternatives: suppressedReply[1].count,
        evaluationGapCp: Math.round(context.selectedCp - suppressedReply[1].bestCp),
      }));
    }
    if (
      Number.isFinite(context.secondCp)
      && context.selectedIsBest
      && context.selectedCp - context.secondCp >= 25
    ) {
      signals.push(signal("multipv:prevention_is_critical", 18, {
        gapCp: Math.round(context.selectedCp - context.secondCp),
      }));
    }
    explanations.push(candidate({
      id: "explanation:prophylaxis",
      type: "strategic",
      concept: "prophylaxis",
      description: "Der Zug nimmt dem Gegner eine konkrete Ressource, die in den schwächeren MultiPV-Alternativen verfügbar bleibt.",
      source: "causal_synthesis",
      signals,
      evidenceIds: unique([
        context.selected.evidenceId,
        "position.danger.comparison",
        "engine.move_comparison",
        ...context.lines.filter((line) => line !== context.selected).map((line) => line.evidenceId),
      ]),
      details: {
        danger: eligiblePreventedDangers[0] || null,
        preventedDangerCount: eligiblePreventedDangers.length,
        suppressedReply: suppressedReply?.[0] || null,
        counterfactualLines: suppressedReply?.[1]?.count || 0,
      },
      kind: "candidate_explanation",
      causalPriority: 16,
    }));
  }

  const multiPvGap = Number.isFinite(context.bestCp) && Number.isFinite(context.secondCp)
    ? Math.round(context.bestCp - context.secondCp)
    : null;
  const pressureEvent = context.selected.moves.slice(2, 7).find(
    (move) => move.color === color && (move.givesCheck || move.givesCheckmate || move.capture),
  ) || null;
  if (
    phase !== "endgame"
    && context.selectedIsBest
    && quietMove
    && context.selectedCp >= 50
    && Number.isFinite(multiPvGap)
    && multiPvGap >= 35
    && (pressureEvent || multiPvGap >= 80)
  ) {
    const signals = [
      signal("multipv:initiative_gap", 34, { gapCp: multiPvGap }),
      signal("move:quiet_tempo", 14, { uci: firstMove.uci }),
      signal("engine:advantage_preserved", 15, { evaluationCp: context.selectedCp }),
    ];
    if (pressureEvent) {
      signals.push(signal("pv:pressure_continues", 22, {
        uci: pressureEvent.uci,
        san: pressureEvent.san,
        givesCheck: pressureEvent.givesCheck,
        capture: pressureEvent.capture || null,
      }));
    }
    explanations.push(candidate({
      id: "explanation:initiative",
      type: "strategic",
      concept: "initiative",
      description: "Der Zug hält den Handlungsdruck aufrecht; ruhigere Alternativen geben laut MultiPV einen wesentlichen Teil des Vorteils ab.",
      source: "causal_synthesis",
      signals,
      evidenceIds: unique([
        context.selected.evidenceId,
        context.second?.evidenceId,
        "engine.move_comparison",
      ]),
      details: {
        multiPvGapCp: multiPvGap,
        evaluationCp: context.selectedCp,
        pressureMove: pressureEvent
          ? { uci: pressureEvent.uci, san: pressureEvent.san }
          : null,
      },
      kind: "candidate_explanation",
      causalPriority: 10,
    }));
  }
  return explanations;
}

function validateCandidateCausality(item, positionEvidence, evaluation) {
  const context = selectedLineContext(positionEvidence);
  const tactical = item.type === "tactical" || DIRECT_TACTICAL_CONCEPTS.has(item.concept);
  const reasons = [];
  let status = "validated";
  let role = item.kind === "candidate_explanation" ? "evaluation_cause" : "local_mechanism";

  if (item.kind !== "candidate_explanation" && item.source.includes("verified_principal_variation")) {
    const branchMove = positionEvidence?.moveComparison?.[item.details?.branch]?.move?.uci || "";
    const immediate = item.details?.ply === 0 && item.details?.moveUci === branchMove;
    const singleLineLegacy = context.lines.length <= 1;
    if (!immediate && !singleLineLegacy) {
      status = "supporting_only";
      role = "pv_feature";
      reasons.push("motif_is_not_the_branch_start_or_unique_to_the_evaluation_change");
    } else {
      reasons.push(immediate ? "motif_is_executed_by_branch_move" : "single_verified_pv");
    }
  }

  if (item.kind !== "candidate_explanation" && item.source.includes("pattern_recognition") && tactical) {
    const directSubjectMove = Boolean(
      item.details?.move?.uci
      && item.details.move.uci === positionEvidence?.playedMove?.uci,
    );
    const engineSupportsSubject = item.details?.engineEvidence?.supportsMove === true;
    if (!directSubjectMove || !engineSupportsSubject) {
      status = "supporting_only";
      role = "primitive_feature";
      reasons.push("geometric_pattern_does_not_match_the_engine_selected_subject_move");
    } else {
      reasons.push("pattern_move_matches_engine_selected_subject_move");
    }
  }

  const adverseComparison = item.source.includes("move_comparison")
    || item.source.includes("danger_comparison");
  const relation = item.details?.relation;
  if (
    item.kind !== "candidate_explanation"
    && adverseComparison
    && (
      context.selectedIsBest
      || (Number.isFinite(evaluation.lossCp) && evaluation.lossCp <= 30)
    )
    && relation !== "prevented"
  ) {
    status = "supporting_only";
    role = "primitive_feature";
    reasons.push("adverse_feature_does_not_explain_an_engine_approved_move");
  }

  if (item.kind === "candidate_explanation") {
    reasons.push("cross_validated_by_position_pv_and_multipv");
  }
  const causalScore = status === "validated"
    ? item.relevanceScore + (item.causalPriority || 0)
    : Math.min(47, Math.round(item.relevanceScore * 0.4));
  return {
    ...item,
    causalScore,
    causalValidation: {
      status,
      role,
      reasons: unique(reasons),
    },
  };
}

export function buildPositionDiagnosis({
  engineContext = null,
  positionEvidence = null,
  recognizedPatterns = [],
} = {}) {
  if (!positionEvidence?.valid) {
    return {
      version: POSITION_DIAGNOSIS_VERSION,
      valid: false,
      mode: engineContext?.kind || "position",
      phase: null,
      subject: null,
      evaluation: { before: null, after: null, changeCp: null, lossCp: null },
      primaryReason: null,
      secondaryReasons: [],
      detectedFeatures: [],
      evaluationDrivers: [],
      backgroundFeatures: [],
      candidateExplanations: [],
      causalValidation: {
        primitiveFeatures: 0,
        candidateExplanations: 0,
        validatedDrivers: 0,
        supportingOnly: 0,
      },
      pvEvidence: [],
      uncertainties: [{ code: "invalid_position_evidence", severity: "high" }],
      confidence: { value: 0, level: "limited" },
    };
  }

  const depth = Math.max(0, Number.parseInt(engineContext?.depth, 10) || 0);
  const evaluation = evaluationSummary(engineContext, positionEvidence);
  const pvItems = pvEvidence(positionEvidence);
  const primitiveCandidates = mergeCandidates([
    ...differenceCandidates(positionEvidence, evaluation, pvItems, depth),
    ...dangerCandidates(positionEvidence, evaluation, depth),
    ...pvMotifCandidates(positionEvidence, evaluation, pvItems, depth),
    ...patternCandidates(recognizedPatterns, positionEvidence, evaluation, depth),
    ...effectCandidates(positionEvidence, evaluation, depth),
  ]);
  const explanationCandidates = strategicCandidateExplanations(positionEvidence, evaluation);
  const allCandidates = [...primitiveCandidates, ...explanationCandidates]
    .map((item) => validateCandidateCausality(item, positionEvidence, evaluation))
    .sort((left, right) => (
    right.causalScore - left.causalScore
      || right.relevanceScore - left.relevanceScore
      || (SPECIFICITY[right.concept] || 0) - (SPECIFICITY[left.concept] || 0)
      || right.confidence - left.confidence
      || left.id.localeCompare(right.id, "en")
  ));

  const driverCandidates = allCandidates.filter((item) => (
    item.causalValidation.status === "validated"
      && item.causalScore >= 48
      && (
    item.relevanceScore >= 48
      && item.evidenceStrength >= 2
      && item.confidence >= 0.58
      )
  ));
  let primary = driverCandidates[0] || null;
  const runnerUp = driverCandidates[1] || null;
  const uncertainties = [];
  if (!positionEvidence?.moveComparison) {
    uncertainties.push({ code: "missing_comparable_engine_lines", severity: "high" });
  }
  if (depth > 0 && depth < 12) {
    uncertainties.push({ code: "shallow_engine_analysis", severity: "medium", depth });
  }
  if ((positionEvidence?.verifiedLines || []).filter((line) => line?.legal && line?.complete).length === 0) {
    uncertainties.push({ code: "missing_complete_pv", severity: "high" });
  }
  if (!primary) {
    uncertainties.push({
      code: "no_causal_feature_confirmed",
      severity: "high",
      message: "Kein erkanntes Merkmal ist stark genug mit Zugvergleich, Stellungsänderung oder Hauptvariante verbunden.",
    });
  } else if (
    runnerUp
    && runnerUp.concept !== primary.concept
    && primary.causalScore - runnerUp.causalScore <= 5
    && (SPECIFICITY[primary.concept] || 0) - (SPECIFICITY[runnerUp.concept] || 0) < 3
  ) {
    uncertainties.push({
      code: "multiple_plausible_drivers",
      severity: "medium",
      concepts: [primary.concept, runnerUp.concept],
    });
    primary = { ...primary, confidence: Number(Math.max(0.55, primary.confidence - 0.08).toFixed(2)) };
  }

  const secondaryPool = primary
    ? driverCandidates.filter((item) => (
        item.id !== primary.id
        && item.concept !== primary.concept
        && causalFamily(item.concept) !== causalFamily(primary.concept)
        && !(
          ["tactical", "material", "king_safety"].includes(primary.type)
          && ["positional", "activity", "development", "pawn_structure"].includes(item.type)
          && item.causalScore < primary.causalScore - 5
        )
      ))
    : [];
  const secondaryFamilies = new Set();
  const secondaries = secondaryPool.filter((item) => {
    const family = causalFamily(item.concept);
    if (secondaryFamilies.has(family)) return false;
    secondaryFamilies.add(family);
    return true;
  }).slice(0, 3);
  const background = allCandidates.filter((item) => (
    !primary || item.id !== primary.id
  ) && !secondaries.some((secondary) => secondary.id === item.id));
  const overallConfidence = primary
    ? Math.min(
      primary.confidence,
      uncertainties.some((item) => item.severity === "high") ? 0.55 : 1,
    )
    : 0.25;

  return {
    version: POSITION_DIAGNOSIS_VERSION,
    valid: true,
    mode: engineContext?.kind || "position",
    phase: phaseFromEvidence(positionEvidence),
    subject: positionEvidence.playedMove
      ? { uci: positionEvidence.playedMove.uci, san: positionEvidence.playedMove.san }
      : null,
    evaluation,
    primaryReason: publicReason(primary, 1),
    secondaryReasons: secondaries.map((item, index) => publicReason(item, index + 2)),
    detectedFeatures: allCandidates.map((item) => ({
      concept: item.concept,
      type: item.type,
      featureId: item.featureId,
      source: item.source,
      relevance: primary?.id === item.id
        ? "primary"
        : secondaries.some((secondary) => secondary.id === item.id)
          ? "secondary"
          : "background",
      relevanceScore: item.relevanceScore,
      causalScore: item.causalScore,
      confidence: item.confidence,
      squares: item.squares,
      causalValidation: item.causalValidation,
    })),
    candidateExplanations: allCandidates
      .filter((item) => item.kind === "candidate_explanation")
      .map((item, index) => publicReason(item, index + 1)),
    causalValidation: {
      primitiveFeatures: primitiveCandidates.length,
      candidateExplanations: explanationCandidates.length,
      validatedDrivers: driverCandidates.length,
      supportingOnly: allCandidates.filter(
        (item) => item.causalValidation.status === "supporting_only",
      ).length,
    },
    evaluationDrivers: [primary, ...secondaries]
      .filter(Boolean)
      .map((item, index) => publicReason(item, index + 1)),
    backgroundFeatures: background.slice(0, 8).map((item) => publicReason(item, null)),
    pvEvidence: pvItems.slice(0, 24),
    uncertainties,
    confidence: {
      value: Number(overallConfidence.toFixed(2)),
      level: overallConfidence >= 0.8 ? "high" : overallConfidence >= 0.58 ? "medium" : "limited",
    },
  };
}

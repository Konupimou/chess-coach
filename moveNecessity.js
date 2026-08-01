export const MOVE_NECESSITY = Object.freeze({
  onlyLegalMove: "only_legal_move",
  onlyMoveToAvoidLoss: "only_move_to_avoid_loss",
  onlyMoveToKeepAdvantage: "only_move_to_keep_advantage",
  clearlyBest: "clearly_best",
  practicallyEquivalent: "practically_equivalent",
  normal: "normal",
  unknown: "unknown",
});

const MATE_CP = 100_000;

export function evaluationToPlayerCp(evaluation) {
  if (!evaluation || typeof evaluation !== "object") return null;
  if (evaluation.unit === "cp" && Number.isFinite(evaluation.value)) {
    return Math.max(-MATE_CP, Math.min(MATE_CP, Math.round(evaluation.value)));
  }
  if (evaluation.unit === "mate" && Number.isFinite(evaluation.value)) {
    if (evaluation.value === 0) return 0;
    return evaluation.value > 0 ? MATE_CP : -MATE_CP;
  }
  return null;
}

export function classifyMoveNecessity({
  bestEvaluation = null,
  secondEvaluation = null,
  legalMoveCount = null,
} = {}) {
  if (Number.isInteger(legalMoveCount) && legalMoveCount === 1) {
    return {
      type: MOVE_NECESSITY.onlyLegalMove,
      onlyMove: true,
      gapCp: null,
      bestCp: evaluationToPlayerCp(bestEvaluation),
      secondCp: null,
      reason: "exactly_one_legal_move",
    };
  }

  const bestCp = evaluationToPlayerCp(bestEvaluation);
  const secondCp = evaluationToPlayerCp(secondEvaluation);
  if (!Number.isFinite(bestCp) || !Number.isFinite(secondCp)) {
    return {
      type: MOVE_NECESSITY.unknown,
      onlyMove: false,
      gapCp: null,
      bestCp,
      secondCp,
      reason: "missing_comparable_rank_two_evaluation",
    };
  }

  const gapCp = Math.max(0, Math.round(bestCp - secondCp));
  if (gapCp <= 30) {
    return {
      type: MOVE_NECESSITY.practicallyEquivalent,
      onlyMove: false,
      gapCp,
      bestCp,
      secondCp,
      reason: "rank_two_within_practical_equivalence_band",
    };
  }
  if (bestCp > -100 && secondCp <= -150) {
    return {
      type: MOVE_NECESSITY.onlyMoveToAvoidLoss,
      onlyMove: true,
      gapCp,
      bestCp,
      secondCp,
      reason: "rank_two_crosses_losing_result_band",
    };
  }
  if (bestCp >= 150 && secondCp < 100) {
    return {
      type: MOVE_NECESSITY.onlyMoveToKeepAdvantage,
      onlyMove: true,
      gapCp,
      bestCp,
      secondCp,
      reason: "rank_two_gives_up_clear_advantage",
    };
  }
  if (gapCp >= 100) {
    return {
      type: MOVE_NECESSITY.clearlyBest,
      onlyMove: false,
      gapCp,
      bestCp,
      secondCp,
      reason: "large_gap_without_result_band_crossing",
    };
  }
  return {
    type: MOVE_NECESSITY.normal,
    onlyMove: false,
    gapCp,
    bestCp,
    secondCp,
    reason: "meaningful_but_non_forcing_preference",
  };
}

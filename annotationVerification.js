import { Chess } from "chess.js";

export const KNOWLEDGE_LIFECYCLE = Object.freeze({
  generated: "generated",
  automaticallyVerified: "automatically_verified",
  humanApproved: "human_approved",
});

function playerCp(evaluation) {
  if (!evaluation || typeof evaluation !== "object") return null;
  if (evaluation.unit === "mate" && Number.isFinite(evaluation.value)) {
    return evaluation.value > 0 ? 100_000 : evaluation.value < 0 ? -100_000 : 0;
  }
  return Number.isFinite(evaluation.value) ? evaluation.value : null;
}

function legalUci(fen, uci) {
  try {
    const game = new Chess(fen);
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
    });
    return move ? { san: move.san, fenAfter: game.fen() } : null;
  } catch {
    return null;
  }
}

function engineLines(analysis) {
  return (Array.isArray(analysis?.lines) ? analysis.lines : [])
    .filter((line) => typeof line?.uci === "string" && legalUci(analysis.fen, line.uci))
    .map((line) => ({ ...line, cp: playerCp(line.evaluation) }))
    .filter((line) => Number.isFinite(line.cp))
    .sort((left, right) => right.cp - left.cp);
}

export function verifyAnnotationRecord(record, analysis, {
  equivalentToleranceCp = 20,
  compatibleToleranceCp = 70,
} = {}) {
  if (!record?.fenBefore || !record?.uci || analysis?.fen !== record.fenBefore) {
    return {
      recordId: record?.id || "",
      verificationStatus: "invalid",
      confidence: 0,
      reason: "analysis_position_mismatch",
      claims: [],
    };
  }
  if (!legalUci(record.fenBefore, record.uci)) {
    return {
      recordId: record.id,
      verificationStatus: "invalid",
      confidence: 1,
      reason: "illegal_played_move",
      claims: [],
    };
  }
  const lines = engineLines(analysis);
  const best = lines[0] || null;
  const alternatives = record.annotation?.alternatives || [];
  const recommendation = alternatives[0] || null;
  if (recommendation && !legalUci(record.fenBefore, recommendation.uci)) {
    return {
      recordId: record.id,
      verificationStatus: "invalid",
      confidence: 1,
      reason: "illegal_human_alternative",
      claims: [],
    };
  }
  const recommendedLine = recommendation
    ? lines.find((line) => line.uci === recommendation.uci)
    : null;
  const delta = best && recommendedLine ? best.cp - recommendedLine.cp : null;
  let verificationStatus = "unverified";
  let reason = "no_verifiable_recommendation";
  if (!recommendation && record.annotation?.type === "strategic") {
    verificationStatus = "strategic_only";
    reason = "strategic_comment_without_concrete_move";
  } else if (recommendation && best?.uci === recommendation.uci) {
    verificationStatus = "engine_confirmed";
    reason = "same_recommendation";
  } else if (Number.isFinite(delta) && delta <= equivalentToleranceCp) {
    verificationStatus = "compatible";
    reason = "different_but_equivalent";
  } else if (Number.isFinite(delta) && delta <= compatibleToleranceCp) {
    verificationStatus = "compatible";
    reason = "strategically_plausible_within_tolerance";
  } else if (Number.isFinite(delta)) {
    verificationStatus = "conflicting";
    reason = "concrete_engine_conflict";
  }
  const claims = (record.annotation?.claims || []).map((claim) => {
    if (["strategicMotif", "longTermDanger", "learningPrinciple"].includes(claim.field)) {
      return { ...claim, verificationStatus: "strategic_only" };
    }
    if (["recommendedAlternative", "concreteVariation"].includes(claim.field)) {
      return { ...claim, verificationStatus };
    }
    return { ...claim, verificationStatus: "unverified" };
  });
  return {
    recordId: record.id,
    verificationStatus,
    confidence: best ? 0.95 : 0.45,
    reason,
    engine: {
      version: analysis.engineVersion || "",
      limit: analysis.limit || null,
      depth: analysis.depth || 0,
      bestUci: best?.uci || "",
      recommendedUci: recommendation?.uci || "",
      deltaCp: Number.isFinite(delta) ? delta : null,
      lines: lines.slice(0, 5),
    },
    claims,
    lifecycle: verificationStatus === "conflicting" || verificationStatus === "invalid"
      ? KNOWLEDGE_LIFECYCLE.generated
      : KNOWLEDGE_LIFECYCLE.automaticallyVerified,
  };
}

export function approveVerifiedAnnotation(verification, { reviewer, reviewedAt } = {}) {
  if (!verification || !["engine_confirmed", "compatible", "strategic_only"].includes(verification.verificationStatus)) {
    throw new Error("Nur kompatible oder bestätigte Annotationen können freigegeben werden.");
  }
  if (typeof reviewer !== "string" || !reviewer.trim()) {
    throw new Error("Für die menschliche Freigabe fehlt der Reviewer.");
  }
  return {
    ...verification,
    lifecycle: KNOWLEDGE_LIFECYCLE.humanApproved,
    approval: {
      reviewer: reviewer.trim().slice(0, 120),
      reviewedAt: reviewedAt || new Date().toISOString(),
    },
  };
}

function scoreToMoverPawns(score, sideToMove) {
  if (!score || typeof score !== "object" || score.unit === "mate") return null;
  const whitePawns = Number.isFinite(score.pawns)
    ? score.pawns
    : score.unit === "cp" && Number.isFinite(score.value)
      ? score.value / 100
      : null;
  if (!Number.isFinite(whitePawns)) return null;
  return sideToMove === "b" ? -whitePawns : whitePawns;
}

function formatPawnGap(value) {
  return value.toFixed(2).replace(".", ",");
}

export function technicalSuggestionReason({
  rank = 1,
  sanMoves = [],
  score = null,
  bestScore = null,
  sideToMove = "w",
} = {}) {
  const firstMove = Array.isArray(sanMoves) ? String(sanMoves[0] || "") : "";

  if (firstMove.includes("#")) {
    return "Der Zug setzt sofort matt.";
  }
  if (firstMove.includes("+")) {
    return "Der Zug beginnt mit Schach und zwingt eine direkte Antwort.";
  }
  if (/O-O(?:-O)?/.test(firstMove)) {
    return rank === 1
      ? "Stockfish bewertet die Rochade in dieser Stellung als stärkste Fortsetzung."
      : "Stockfish bewertet die Rochade in dieser Stellung als spielbare Alternative.";
  }
  if (firstMove.includes("x")) {
    return "Die Idee beginnt mit einem konkreten Schlagzug.";
  }
  if (firstMove.includes("=")) {
    return "Der Zug wandelt einen Bauern um und schafft sofort neues Material.";
  }

  if (rank > 1) {
    const bestMoverPawns = scoreToMoverPawns(bestScore, sideToMove);
    const moverPawns = scoreToMoverPawns(score, sideToMove);
    if (Number.isFinite(bestMoverPawns) && Number.isFinite(moverPawns)) {
      const gap = Math.max(0, bestMoverPawns - moverPawns);
      return gap <= 0.5
        ? `Diese Alternative liegt laut Stockfish nur ${formatPawnGap(gap)} Bauerneinheiten hinter der besten Idee.`
        : `Diese Alternative ist laut Stockfish ${formatPawnGap(gap)} Bauerneinheiten schwächer als die beste Idee.`;
    }
    return "Stockfish bewertet diese Fortsetzung als spielbare Alternative.";
  }

  if (score?.unit === "mate" && Number.isFinite(score.value)) {
    const moverMate = score.value * (sideToMove === "b" ? -1 : 1);
    if (moverMate > 0) return "Stockfish sieht in dieser Variante einen erzwungenen Mattweg.";
  }

  return "Stockfish bewertet diese Fortsetzung in der aktuellen Stellung am stärksten.";
}

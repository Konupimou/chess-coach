import { Chess } from "chess.js";
import { deepFreeze } from "./freeze.js";

const FILES = "abcdefgh";
const STARTING_MINOR_SQUARES = {
  w: ["b1", "c1", "f1", "g1"],
  b: ["b8", "c8", "f8", "g8"],
};
const STARTING_KING_SQUARE = { w: "e1", b: "e8" };
const STARTING_QUEEN_SQUARE = { w: "d1", b: "d8" };
const EMPTY_RESULT = deepFreeze({ phase: null, phases: [], side: null, signals: [], evidence: [] });

function loadPosition(fen) {
  if (typeof fen !== "string" || !fen.trim()) return null;
  try {
    return new Chess(fen.trim());
  } catch {
    return null;
  }
}

function allPieces(chess) {
  const pieces = [];
  chess.board().forEach((rank) => {
    rank.forEach((piece) => {
      if (piece) pieces.push(piece);
    });
  });
  return pieces;
}

export function determineGamePhase(fen) {
  const chess = loadPosition(fen);
  if (!chess) return null;

  const pieces = allPieces(chess);
  const nonPawnMaterial = pieces.filter((piece) => !["p", "k"].includes(piece.type));
  const fullmove = Number.parseInt(chess.fen().split(" ")[5], 10) || 1;

  if (nonPawnMaterial.length <= 4) return "endgame";
  if (fullmove <= 12 && nonPawnMaterial.length >= 8) return "opening";
  return "middlegame";
}

function opposite(color) {
  return color === "w" ? "b" : "w";
}

function pieceName(type) {
  return {
    q: "Dame",
    r: "Turm",
    b: "Läufer",
    n: "Springer",
  }[type] || "Figur";
}

function sideName(color) {
  return color === "w" ? "Weiß" : "Schwarz";
}

function sideAdjective(color) {
  return color === "w" ? "weiße" : "schwarze";
}

function squareRank(square) {
  return Number.parseInt(square?.[1], 10);
}

function queenMoveFromReview(chess, engineContext, side) {
  const move = engineContext?.moveReview?.playedMove;
  const uci = typeof move?.uci === "string" ? move.uci.toLowerCase() : "";
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const piece = chess.get(from);
  if (piece?.color !== side || piece.type !== "q") return null;

  const reviewPosition = new Chess(chess.fen());
  try {
    const legalMove = reviewPosition.move({
      from,
      to,
      promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
    });
    if (!legalMove || legalMove.color !== side || legalMove.piece !== "q") return null;
  } catch {
    return null;
  }
  return { from, to };
}

function countUndevelopedMinors(chess, color) {
  return STARTING_MINOR_SQUARES[color].filter((square) => {
    const piece = chess.get(square);
    return piece?.color === color && ["b", "n"].includes(piece.type);
  }).length;
}

function addBoardEvidence(chess, side, phase, add, engineContext) {
  const enemy = opposite(side);
  const fullmove = Number.parseInt(chess.fen().split(" ")[5], 10) || 1;
  const undeveloped = countUndevelopedMinors(chess, side);
  const enemyUndeveloped = countUndevelopedMinors(chess, enemy);

  if (phase === "opening" && undeveloped >= 2) {
    add(
      "minor-pieces-on-starting-squares",
      "board",
      `${sideName(side)} hat noch ${undeveloped} Leichtfiguren auf ihren Ausgangsfeldern.`,
    );
  }
  if (phase === "opening" && undeveloped >= 2 && undeveloped - enemyUndeveloped >= 2) {
    add(
      "more-minor-pieces-on-starting-squares-than-opponent",
      "board",
      `${sideName(side)} hat mindestens zwei Leichtfiguren mehr auf Ausgangsfeldern als die Gegenseite.`,
    );
  }

  const reviewedQueenMove = queenMoveFromReview(chess, engineContext, side);
  const queenSquare = allBoardSquares().find((square) => {
    const piece = chess.get(square);
    return piece?.color === side && piece.type === "q";
  });
  if (phase === "opening" && fullmove <= 10 && reviewedQueenMove) {
    add(
      "early-queen-move-observed",
      "review",
      `Der geprüfte Zug führt die ${sideAdjective(side)} Dame von ${reviewedQueenMove.from} nach ${reviewedQueenMove.to}.`,
    );
  }
  if (
    phase === "opening"
    && fullmove <= 10
    && queenSquare
    && queenSquare !== STARTING_QUEEN_SQUARE[side]
  ) {
    add("early-queen-move-observed", "board", `${sideName(side)}s Dame steht vor Zug 11 nicht mehr auf dem Ausgangsfeld, sondern auf ${queenSquare}.`);
  }

  const kingSquare = STARTING_KING_SQUARE[side];
  const king = chess.get(kingSquare);
  const castlingRights = chess.getCastlingRights(side);
  if (
    phase === "opening"
    && fullmove >= 10
    && king?.type === "k"
    && king.color === side
    && (castlingRights.k || castlingRights.q)
  ) {
    add("king-on-starting-square-after-move-9", "board", `${sideName(side)}s König steht ab Zug 10 noch auf ${kingSquare}.`);
    add("castling-rights-retained", "board", `${sideName(side)} besitzt noch mindestens ein Rochaderecht.`);
  }

  for (const square of allBoardSquares()) {
    const piece = chess.get(square);
    if (piece?.color !== side || !["q", "r", "b", "n"].includes(piece.type)) continue;
    const attackers = chess.attackers(square, enemy);
    const defenders = chess.attackers(square, side);
    if (attackers.length === 0 || defenders.length > 0) continue;
    const detail = `${pieceName(piece.type)} auf ${square} ist angegriffen und durch keine andere eigene Figur gedeckt.`;
    add("loose-piece", "board", detail);
  }

  addPawnEvidence(chess, side, add);
  addOppositionEvidence(chess, phase, add);
}

function allBoardSquares() {
  const squares = [];
  for (let rank = 1; rank <= 8; rank += 1) {
    for (const file of FILES) squares.push(`${file}${rank}`);
  }
  return squares;
}

function pawnSquares(chess, color) {
  return allBoardSquares().filter((square) => {
    const piece = chess.get(square);
    return piece?.type === "p" && piece.color === color;
  });
}

function addPawnEvidence(chess, side, add) {
  const ownPawns = pawnSquares(chess, side);
  const enemyPawns = pawnSquares(chess, opposite(side));
  const ownFiles = new Set(ownPawns.map((square) => FILES.indexOf(square[0])));

  for (const square of ownPawns) {
    const file = FILES.indexOf(square[0]);
    const rank = squareRank(square);
    const isolated = !ownFiles.has(file - 1) && !ownFiles.has(file + 1);
    if (isolated) {
      add("isolated-pawn", "board", `Der Bauer auf ${square} hat keinen eigenen Bauern auf einer Nachbarlinie.`);
    }

    const blockedByEnemyPawn = enemyPawns.some((enemySquare) => {
      const enemyFile = FILES.indexOf(enemySquare[0]);
      const enemyRank = squareRank(enemySquare);
      const sameCorridor = Math.abs(enemyFile - file) <= 1;
      const isAhead = side === "w" ? enemyRank > rank : enemyRank < rank;
      return sameCorridor && isAhead;
    });
    if (!blockedByEnemyPawn) {
      add("passed-pawn", "board", `Vor dem Bauern auf ${square} steht auf seiner oder einer Nachbarlinie kein gegnerischer Bauer.`);
      if (chess.attackers(square, side).some((defenderSquare) => chess.get(defenderSquare)?.type === "p")) {
        add("protected-passed-pawn", "board", `Der Freibauer auf ${square} wird von einem eigenen Bauern gedeckt.`);
      }
    }
  }
}

function kingSquare(chess, color) {
  return allBoardSquares().find((square) => {
    const piece = chess.get(square);
    return piece?.type === "k" && piece.color === color;
  }) || null;
}

function addOppositionEvidence(chess, phase, add) {
  if (phase !== "endgame") return;
  const pieces = allPieces(chess);
  if (pieces.some((piece) => !["k", "p"].includes(piece.type))) return;

  add("king-pawn-endgame", "board", "Auf dem Brett stehen neben den Königen nur noch Bauern.");
  const whiteKing = kingSquare(chess, "w");
  const blackKing = kingSquare(chess, "b");
  if (!whiteKing || !blackKing) return;
  const fileDistance = Math.abs(FILES.indexOf(whiteKing[0]) - FILES.indexOf(blackKing[0]));
  const rankDistance = Math.abs(squareRank(whiteKing) - squareRank(blackKing));
  if ((fileDistance === 0 && rankDistance === 2) || (rankDistance === 0 && fileDistance === 2)) {
    add("opposition", "board", `Die Könige auf ${whiteKing} und ${blackKing} stehen sich mit genau einem Feld dazwischen gegenüber.`);
  }
}

function firstSan(engineContext) {
  return engineContext?.moveReview?.pv?.san?.[0]
    || engineContext?.primaryVariation?.san?.[0]
    || engineContext?.lines?.[0]?.pv?.san?.[0]
    || "";
}

function addStockfishEvidence(engineContext, add) {
  if (engineContext?.source !== "stockfish") return;

  const review = engineContext?.moveReview;
  const classification = String(review?.classification || "").toLowerCase();
  if (/fehler|mistake|patzer|blunder/.test(classification)) {
    add(
      "engine-classified-error",
      "stockfish",
      "Die übergebene Stockfish-Klassifikation markiert den geprüften Zug als Fehler oder Patzer.",
    );
  }
  if (/patzer|blunder/.test(classification)) {
    add(
      "engine-classified-blunder",
      "stockfish",
      "Die übergebene Stockfish-Klassifikation markiert den geprüften Zug als Patzer.",
    );
  }

  const validLines = Array.isArray(engineContext?.lines)
    ? engineContext.lines.filter((line) => Array.isArray(line?.pv?.uci) && line.pv.uci.length > 0)
    : [];
  if (new Set(validLines.map((line) => line.pv.uci[0])).size >= 2) {
    add(
      "multiple-engine-lines",
      "stockfish",
      "Die Engine-Daten enthalten mindestens zwei unterschiedliche erste Züge.",
    );
  }

  const san = firstSan(engineContext);
  if (/[x+#]/.test(san)) {
    add(
      "pv-starts-with-check-or-capture",
      "stockfish",
      "Der erste SAN-Zug der gelieferten Hauptvariante enthält ein Schach-, Matt- oder Schlagzeichen.",
    );
  }

  const evaluations = [
    engineContext?.evaluation,
    review?.evaluationBefore,
    ...(validLines.map((line) => line.evaluation)),
  ];
  if (evaluations.some((evaluation) => evaluation?.unit === "mate")) {
    add(
      "mate-evaluation-present",
      "stockfish",
      "Mindestens eine gelieferte Stockfish-Bewertung verwendet die Einheit Matt.",
    );
  }
}

function detectSinglePosition(engineContext) {
  const evidence = [];
  const seen = new Set();
  const add = (signal, source, detail) => {
    const key = `${signal}|${source}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    evidence.push({ signal, source, detail });
  };

  addStockfishEvidence(engineContext, add);

  const chess = loadPosition(engineContext?.fen);
  const phase = chess ? determineGamePhase(engineContext.fen) : null;
  const side = chess ? chess.turn() : null;
  if (chess) addBoardEvidence(chess, side, phase, add, engineContext);

  if (!phase && evidence.length === 0) return EMPTY_RESULT;
  return deepFreeze({
    phase,
    phases: phase ? [phase] : [],
    side,
    signals: [...new Set(evidence.map((entry) => entry.signal))],
    evidence,
  });
}

function contextForReviewMoment(moment) {
  return {
    source: "stockfish",
    kind: "move_review",
    fen: moment?.fen || "",
    depth: moment?.depth || 0,
    evaluation: moment?.evaluationBefore || null,
    bestMove: moment?.bestMove || null,
    primaryVariation: moment?.pv || { uci: [], san: [] },
    lines: Array.isArray(moment?.pv?.uci) && moment.pv.uci.length > 0
      ? [{ rank: 1, evaluation: moment?.evaluationBefore || null, pv: moment.pv }]
      : [],
    moveReview: moment,
  };
}

function combineReviewEvidence(reviewMoments) {
  const results = reviewMoments
    .map((moment, index) => ({ index, result: detectSinglePosition(contextForReviewMoment(moment)) }))
    .filter(({ result }) => result.phase || result.evidence.length > 0);
  if (results.length === 0) return EMPTY_RESULT;

  const evidence = [];
  const seen = new Set();
  for (const { index, result } of results) {
    const prefix = `Moment ${index + 1}: `;
    for (const entry of result.evidence) {
      const combined = { ...entry, detail: `${prefix}${entry.detail}` };
      const key = `${combined.signal}|${combined.source}|${combined.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push(combined);
    }
  }

  const phases = [...new Set(results.flatMap(({ result }) => result.phases))];
  const sides = [...new Set(results.map(({ result }) => result.side).filter(Boolean))];
  return deepFreeze({
    phase: phases.length === 1 ? phases[0] : null,
    phases,
    side: sides.length === 1 ? sides[0] : null,
    signals: [...new Set(evidence.map((entry) => entry.signal))],
    evidence,
  });
}

export function detectKnowledgeEvidence(input = {}) {
  const engineContext = input && typeof input === "object" ? input.engineContext : null;
  if (engineContext?.kind === "game_review" && Array.isArray(engineContext.reviewMoments)) {
    return combineReviewEvidence(engineContext.reviewMoments);
  }
  return detectSinglePosition(engineContext);
}

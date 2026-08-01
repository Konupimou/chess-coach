import { Chess, SQUARES } from "chess.js";
import {
  classifyMoveNecessity,
  evaluationToPlayerCp,
} from "./moveNecessity.js";

export const POSITION_EVIDENCE_VERSION = 3;

export const EVIDENCE_KINDS = Object.freeze({
  legalMove: "move.legal",
  moveProperties: "move.properties",
  material: "position.material",
  materialChange: "position.material.change",
  development: "position.development",
  developmentChange: "position.development.change",
  center: "position.center",
  centerChange: "position.center.change",
  kingSafety: "position.king_safety",
  kingSafetyChange: "position.king_safety.change",
  files: "position.files",
  filesChange: "position.files.change",
  pawnStructure: "position.pawn_structure",
  pawnStructureChange: "position.pawn_structure.change",
  pieceSafety: "position.piece_safety",
  pieceSafetyChange: "position.piece_safety.change",
  principalVariation: "engine.pv.legal",
  moveComparison: "engine.move_comparison",
  danger: "position.danger",
  tacticalMotif: "position.tactical_motif",
});

const COLORS = Object.freeze(["w", "b"]);
const FILES = Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h"]);
const CORE_CENTER = Object.freeze(["d4", "e4", "d5", "e5"]);
const PIECE_TYPES = Object.freeze(["p", "n", "b", "r", "q"]);
const PIECE_VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 });
const HOME_MINOR_SQUARES = Object.freeze({
  w: Object.freeze({ b1: "n", c1: "b", f1: "b", g1: "n" }),
  b: Object.freeze({ b8: "n", c8: "b", f8: "b", g8: "n" }),
});
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/i;

const opposite = (color) => (color === "w" ? "b" : "w");
const squareFileIndex = (square) => FILES.indexOf(square[0]);
const squareRank = (square) => Number.parseInt(square[1], 10);
const uniqueSorted = (values) => [...new Set(values)].sort();

function loadGame(fen) {
  if (typeof fen !== "string" || !fen.trim()) return null;
  try {
    return new Chess(fen.trim());
  } catch {
    return null;
  }
}

function normalizeUci(value) {
  if (typeof value !== "string") return "";
  const uci = value.trim().toLowerCase();
  return UCI_PATTERN.test(uci) ? uci : "";
}

function normalizeEvaluation(value) {
  if (!value || typeof value !== "object") return null;
  const unit = value.unit === "mate" ? "mate" : value.unit === "cp" ? "cp" : "";
  if (!unit || !Number.isFinite(value.value)) return null;
  return {
    unit,
    value: Math.max(-100_000, Math.min(100_000, Math.round(value.value))),
    perspective: value.perspective === "player" ? "player" : "white",
  };
}

function positionKey(fen) {
  return typeof fen === "string" ? fen.split(/\s+/).slice(0, 4).join(" ") : "";
}

function moveFromUci(game, uci) {
  const normalized = normalizeUci(uci);
  if (!game || !normalized) return null;
  try {
    return game.move({
      from: normalized.slice(0, 2),
      to: normalized.slice(2, 4),
      promotion: normalized.length === 5 ? normalized[4] : undefined,
    });
  } catch {
    return null;
  }
}

function pieceInventory(game) {
  return SQUARES.flatMap((square) => {
    const piece = game.get(square);
    return piece ? [{ square, color: piece.color, type: piece.type }] : [];
  });
}

function materialFeature(pieces, evidenceId) {
  const byColor = {};
  for (const color of COLORS) {
    const counts = Object.fromEntries(PIECE_TYPES.map((type) => [type, 0]));
    for (const piece of pieces) {
      if (piece.color === color && piece.type !== "k") counts[piece.type] += 1;
    }
    byColor[color] = {
      counts,
      points: PIECE_TYPES.reduce(
        (sum, type) => sum + counts[type] * PIECE_VALUES[type],
        0,
      ),
    };
  }
  return {
    evidenceId,
    pieceValues: { ...PIECE_VALUES },
    byColor,
    balanceWhiteMinusBlack: byColor.w.points - byColor.b.points,
  };
}

function developmentFeature(pieces, evidenceId) {
  const byColor = {};
  for (const color of COLORS) {
    const onHomeSquares = [];
    const offHomeSquares = [];
    for (const [square, expectedType] of Object.entries(HOME_MINOR_SQUARES[color])) {
      const piece = pieces.find((candidate) => candidate.square === square);
      if (piece?.color === color && piece.type === expectedType) {
        onHomeSquares.push(square);
      }
    }
    for (const piece of pieces) {
      if (piece.color !== color || !["n", "b"].includes(piece.type)) continue;
      if (HOME_MINOR_SQUARES[color][piece.square] !== piece.type) {
        offHomeSquares.push(piece.square);
      }
    }
    byColor[color] = {
      minorPiecesOnOriginalSquares: onHomeSquares.sort(),
      minorPiecesOffOriginalSquares: offHomeSquares.sort(),
      offOriginalSquareCount: offHomeSquares.length,
    };
  }
  return {
    evidenceId,
    definition: "placement_relative_to_original_minor_piece_squares",
    byColor,
  };
}

function centerFeature(game, pieces, evidenceId) {
  const occupants = CORE_CENTER.flatMap((square) => {
    const piece = pieces.find((candidate) => candidate.square === square);
    return piece ? [{ square, color: piece.color, type: piece.type }] : [];
  });
  const byColor = {};
  for (const color of COLORS) {
    const attackedSquares = CORE_CENTER.flatMap((square) => {
      const attackers = uniqueSorted(game.attackers(square, color));
      return attackers.length > 0 ? [{ square, attackers }] : [];
    });
    const occupiedSquares = occupants
      .filter((piece) => piece.color === color)
      .map((piece) => piece.square)
      .sort();
    byColor[color] = {
      occupiedSquares,
      attackedSquares,
      influencedSquares: uniqueSorted([
        ...occupiedSquares,
        ...attackedSquares.map((entry) => entry.square),
      ]),
    };
  }
  return {
    evidenceId,
    definition: "occupation_or_direct_attack_of_d4_e4_d5_e5",
    squares: [...CORE_CENTER],
    occupants,
    byColor,
  };
}

function pawnShield(game, color, kingSquare) {
  if (!kingSquare) return { candidateSquares: [], occupiedByFriendlyPawn: [] };
  const direction = color === "w" ? 1 : -1;
  const rank = squareRank(kingSquare) + direction;
  const file = squareFileIndex(kingSquare);
  if (rank < 1 || rank > 8) {
    return { candidateSquares: [], occupiedByFriendlyPawn: [] };
  }
  const candidateSquares = [file - 1, file, file + 1]
    .filter((index) => index >= 0 && index < FILES.length)
    .map((index) => `${FILES[index]}${rank}`);
  const occupiedByFriendlyPawn = candidateSquares.filter((square) => {
    const piece = game.get(square);
    return piece?.color === color && piece.type === "p";
  });
  return { candidateSquares, occupiedByFriendlyPawn };
}

function kingSafetyFeature(game, evidenceId) {
  const castlingRights = game.fen().split(/\s+/)[2] || "-";
  const byColor = {};
  for (const color of COLORS) {
    const kingSquare = game.findPiece({ color, type: "k" })[0] || "";
    const attackingColor = opposite(color);
    const attackers = kingSquare
      ? uniqueSorted(game.attackers(kingSquare, attackingColor))
      : [];
    const shield = pawnShield(game, color, kingSquare);
    byColor[color] = {
      kingSquare,
      attackedBy: attackers,
      inCheck: attackers.length > 0,
      castlingRights: {
        kingside: castlingRights.includes(color === "w" ? "K" : "k"),
        queenside: castlingRights.includes(color === "w" ? "Q" : "q"),
      },
      frontAdjacentPawnSquares: shield.candidateSquares,
      frontAdjacentFriendlyPawns: shield.occupiedByFriendlyPawn,
    };
  }
  return {
    evidenceId,
    definition: "king_square_direct_attack_castling_rights_and_front_adjacent_pawns",
    byColor,
  };
}

function filesFeature(pieces, evidenceId) {
  const pawnFiles = { w: {}, b: {} };
  for (const color of COLORS) {
    for (const file of FILES) pawnFiles[color][file] = [];
  }
  for (const piece of pieces) {
    if (piece.type === "p") pawnFiles[piece.color][piece.square[0]].push(piece.square);
  }
  for (const color of COLORS) {
    for (const file of FILES) pawnFiles[color][file].sort();
  }
  const open = FILES.filter(
    (file) => pawnFiles.w[file].length === 0 && pawnFiles.b[file].length === 0,
  );
  const semiOpen = {};
  for (const color of COLORS) {
    semiOpen[color] = FILES.filter(
      (file) => (
        pawnFiles[color][file].length === 0
        && pawnFiles[opposite(color)][file].length > 0
      ),
    );
  }
  return {
    evidenceId,
    definition: "open_has_no_pawns_semi_open_has_no_friendly_but_enemy_pawn",
    pawnFiles,
    open,
    semiOpen,
  };
}

function pawnIsPassed(pawn, opposingPawns) {
  const file = squareFileIndex(pawn.square);
  const rank = squareRank(pawn.square);
  return !opposingPawns.some((opponent) => {
    const opponentFile = squareFileIndex(opponent.square);
    const opponentRank = squareRank(opponent.square);
    const onRelevantFile = Math.abs(opponentFile - file) <= 1;
    const ahead = pawn.color === "w" ? opponentRank > rank : opponentRank < rank;
    return onRelevantFile && ahead;
  });
}

function pawnStructureFeature(pieces, evidenceId) {
  const pawns = Object.fromEntries(
    COLORS.map((color) => [
      color,
      pieces.filter((piece) => piece.color === color && piece.type === "p"),
    ]),
  );
  const byColor = {};
  for (const color of COLORS) {
    const fileCounts = Object.fromEntries(
      FILES.map((file) => [
        file,
        pawns[color].filter((pawn) => pawn.square[0] === file).length,
      ]),
    );
    const occupiedFileIndexes = FILES
      .map((file, index) => (fileCounts[file] > 0 ? index : -1))
      .filter((index) => index >= 0);
    let islandCount = 0;
    occupiedFileIndexes.forEach((fileIndex, index) => {
      if (index === 0 || fileIndex > occupiedFileIndexes[index - 1] + 1) islandCount += 1;
    });
    const isolated = pawns[color]
      .filter((pawn) => {
        const file = squareFileIndex(pawn.square);
        return [file - 1, file + 1]
          .filter((index) => index >= 0 && index < FILES.length)
          .every((index) => fileCounts[FILES[index]] === 0);
      })
      .map((pawn) => pawn.square)
      .sort();
    const passed = pawns[color]
      .filter((pawn) => pawnIsPassed(pawn, pawns[opposite(color)]))
      .map((pawn) => pawn.square)
      .sort();
    byColor[color] = {
      pawns: pawns[color].map((pawn) => pawn.square).sort(),
      fileCounts,
      doubledFiles: FILES.filter((file) => fileCounts[file] >= 2),
      isolatedPawns: isolated,
      passedPawns: passed,
      islandCount,
    };
  }
  return {
    evidenceId,
    definitions: {
      doubled: "at_least_two_friendly_pawns_on_one_file",
      isolated: "no_friendly_pawn_on_either_adjacent_file",
      passed: "no_enemy_pawn_ahead_on_same_or_adjacent_file",
      island: "contiguous_group_of_pawn_occupied_files",
    },
    byColor,
  };
}

function pieceSafetyFeature(game, pieces, evidenceId) {
  const byColor = {};
  for (const color of COLORS) {
    const nonKings = pieces.filter((piece) => piece.color === color && piece.type !== "k");
    const records = nonKings.map((piece) => ({
      square: piece.square,
      type: piece.type,
      attackers: uniqueSorted(game.attackers(piece.square, opposite(color))),
      defenders: uniqueSorted(game.attackers(piece.square, color)),
    }));
    byColor[color] = {
      pieces: records,
      attacked: records.filter((piece) => piece.attackers.length > 0),
      undefended: records.filter((piece) => piece.defenders.length === 0),
      attackedAndUndefended: records.filter(
        (piece) => piece.attackers.length > 0 && piece.defenders.length === 0,
      ),
    };
  }
  return {
    evidenceId,
    definition: "direct_geometric_attack_and_defence_of_non_king_pieces",
    byColor,
  };
}

function positionSnapshot(game, phase) {
  const pieces = pieceInventory(game);
  return {
    fen: game.fen(),
    turn: game.turn(),
    material: materialFeature(pieces, `position.${phase}.material`),
    development: developmentFeature(pieces, `position.${phase}.development`),
    center: centerFeature(game, pieces, `position.${phase}.center`),
    kingSafety: kingSafetyFeature(game, `position.${phase}.king_safety`),
    files: filesFeature(pieces, `position.${phase}.files`),
    pawnStructure: pawnStructureFeature(
      pieces,
      `position.${phase}.pawn_structure`,
    ),
    pieceSafety: pieceSafetyFeature(game, pieces, `position.${phase}.piece_safety`),
  };
}

function listDifference(after, before) {
  const previous = new Set(before);
  return after.filter((value) => !previous.has(value)).sort();
}

function materialChange(before, after) {
  const byColor = {};
  for (const color of COLORS) {
    byColor[color] = {
      points: after.byColor[color].points - before.byColor[color].points,
      counts: Object.fromEntries(
        PIECE_TYPES.map((type) => [
          type,
          after.byColor[color].counts[type] - before.byColor[color].counts[type],
        ]),
      ),
    };
  }
  return {
    evidenceId: "position.change.material",
    byColor,
    balanceWhiteMinusBlack:
      after.balanceWhiteMinusBlack - before.balanceWhiteMinusBlack,
  };
}

function developmentChange(before, after, playedMove) {
  const byColor = {};
  for (const color of COLORS) {
    const beforeOff = before.byColor[color].minorPiecesOffOriginalSquares;
    const afterOff = after.byColor[color].minorPiecesOffOriginalSquares;
    const movedMinor = playedMove.color === color && ["n", "b"].includes(playedMove.piece);
    const wasOffOriginalSquare = movedMinor && beforeOff.includes(playedMove.from);
    const isOffOriginalSquare = movedMinor && afterOff.includes(playedMove.to);
    byColor[color] = {
      newlyOffOriginalSquares:
        movedMinor && !wasOffOriginalSquare && isOffOriginalSquare
          ? [playedMove.to]
          : [],
      returnedToOriginalSquare:
        movedMinor && wasOffOriginalSquare && !isOffOriginalSquare
          ? [playedMove.to]
          : [],
      countDelta:
        after.byColor[color].offOriginalSquareCount
        - before.byColor[color].offOriginalSquareCount,
    };
  }
  return { evidenceId: "position.change.development", byColor };
}

function centerChange(before, after) {
  const byColor = {};
  for (const color of COLORS) {
    const beforeInfluence = before.byColor[color].influencedSquares;
    const afterInfluence = after.byColor[color].influencedSquares;
    byColor[color] = {
      newlyOccupiedSquares: listDifference(
        after.byColor[color].occupiedSquares,
        before.byColor[color].occupiedSquares,
      ),
      noLongerOccupiedSquares: listDifference(
        before.byColor[color].occupiedSquares,
        after.byColor[color].occupiedSquares,
      ),
      newlyAttackedSquares: listDifference(
        after.byColor[color].attackedSquares.map((entry) => entry.square),
        before.byColor[color].attackedSquares.map((entry) => entry.square),
      ),
      noLongerAttackedSquares: listDifference(
        before.byColor[color].attackedSquares.map((entry) => entry.square),
        after.byColor[color].attackedSquares.map((entry) => entry.square),
      ),
      influencedSquareCountDelta: afterInfluence.length - beforeInfluence.length,
    };
  }
  return { evidenceId: "position.change.center", byColor };
}

function kingSafetyChange(before, after, playedMove) {
  const byColor = {};
  for (const color of COLORS) {
    byColor[color] = {
      kingFrom: before.byColor[color].kingSquare,
      kingTo: after.byColor[color].kingSquare,
      newlyInCheck: !before.byColor[color].inCheck && after.byColor[color].inCheck,
      noLongerInCheck: before.byColor[color].inCheck && !after.byColor[color].inCheck,
      castlingRightsLost: {
        kingside:
          before.byColor[color].castlingRights.kingside
          && !after.byColor[color].castlingRights.kingside,
        queenside:
          before.byColor[color].castlingRights.queenside
          && !after.byColor[color].castlingRights.queenside,
      },
      frontAdjacentFriendlyPawnCountDelta:
        after.byColor[color].frontAdjacentFriendlyPawns.length
        - before.byColor[color].frontAdjacentFriendlyPawns.length,
    };
  }
  return {
    evidenceId: "position.change.king_safety",
    castled: playedMove.castle,
    byColor,
  };
}

function filesChange(before, after) {
  return {
    evidenceId: "position.change.files",
    newlyOpen: listDifference(after.open, before.open),
    noLongerOpen: listDifference(before.open, after.open),
    byColor: Object.fromEntries(
      COLORS.map((color) => [
        color,
        {
          newlySemiOpen: listDifference(after.semiOpen[color], before.semiOpen[color]),
          noLongerSemiOpen: listDifference(
            before.semiOpen[color],
            after.semiOpen[color],
          ),
        },
      ]),
    ),
  };
}

function pawnIdentity(color, square, phase, playedMove) {
  if (playedMove.piece === "p" && playedMove.color === color) {
    if (phase === "before" && square === playedMove.from) return "played-pawn";
    if (
      phase === "after"
      && !playedMove.promotion
      && square === playedMove.to
    ) {
      return "played-pawn";
    }
  }
  return `${color}:${square}`;
}

function pawnStructureChange(before, after, playedMove) {
  const byColor = {};
  for (const color of COLORS) {
    const beforePawns = new Map(
      before.byColor[color].pawns.map((square) => [
        pawnIdentity(color, square, "before", playedMove),
        {
          square,
          isolated: before.byColor[color].isolatedPawns.includes(square),
          passed: before.byColor[color].passedPawns.includes(square),
        },
      ]),
    );
    const afterPawns = new Map(
      after.byColor[color].pawns.map((square) => [
        pawnIdentity(color, square, "after", playedMove),
        {
          square,
          isolated: after.byColor[color].isolatedPawns.includes(square),
          passed: after.byColor[color].passedPawns.includes(square),
        },
      ]),
    );
    const survivingIds = [...afterPawns.keys()].filter((id) => beforePawns.has(id));
    const became = (property) => survivingIds
      .filter((id) => !beforePawns.get(id)[property] && afterPawns.get(id)[property])
      .map((id) => afterPawns.get(id).square)
      .sort();
    const ceased = (property) => survivingIds
      .filter((id) => beforePawns.get(id)[property] && !afterPawns.get(id)[property])
      .map((id) => afterPawns.get(id).square)
      .sort();
    byColor[color] = {
      newlyDoubledFiles: listDifference(
        after.byColor[color].doubledFiles,
        before.byColor[color].doubledFiles,
      ),
      noLongerDoubledFiles: listDifference(
        before.byColor[color].doubledFiles,
        after.byColor[color].doubledFiles,
      ),
      newlyIsolatedPawns: became("isolated"),
      noLongerIsolatedPawns: ceased("isolated"),
      newlyPassedPawns: became("passed"),
      noLongerPassedPawns: ceased("passed"),
      islandCountDelta:
        after.byColor[color].islandCount - before.byColor[color].islandCount,
    };
  }
  return { evidenceId: "position.change.pawn_structure", byColor };
}

function pieceIdentity(piece, phase, playedMove) {
  if (piece.color === playedMove.color) {
    if (
      phase === "before"
      && piece.square === playedMove.from
      && piece.type === playedMove.piece
    ) {
      return "played-piece";
    }
    if (
      phase === "after"
      && piece.square === playedMove.to
      && piece.type === (playedMove.promotion || playedMove.piece)
    ) {
      return "played-piece";
    }
    if (playedMove.castle) {
      const rank = playedMove.color === "w" ? "1" : "8";
      const rookFrom = playedMove.castle === "kingside" ? `h${rank}` : `a${rank}`;
      const rookTo = playedMove.castle === "kingside" ? `f${rank}` : `d${rank}`;
      if (piece.type === "r" && phase === "before" && piece.square === rookFrom) {
        return "castling-rook";
      }
      if (piece.type === "r" && phase === "after" && piece.square === rookTo) {
        return "castling-rook";
      }
    }
  }
  return `${piece.color}:${piece.square}:${piece.type}`;
}

function pieceSafetyChange(before, after, playedMove) {
  const states = (feature, phase) => {
    const result = new Map();
    for (const color of COLORS) {
      for (const piece of feature.byColor[color].pieces) {
        result.set(pieceIdentity({ ...piece, color }, phase, playedMove), {
          ...piece,
          color,
          attacked: piece.attackers.length > 0,
          undefended: piece.defenders.length === 0,
        });
      }
    }
    return result;
  };
  const beforeStates = states(before, "before");
  const afterStates = states(after, "after");
  const survivingIds = [...afterStates.keys()].filter((id) => beforeStates.has(id));
  const became = (predicate) => survivingIds
    .filter((id) => !predicate(beforeStates.get(id)) && predicate(afterStates.get(id)))
    .map((id) => afterStates.get(id));
  const ceased = (predicate) => survivingIds
    .filter((id) => predicate(beforeStates.get(id)) && !predicate(afterStates.get(id)))
    .map((id) => beforeStates.get(id));
  const isAttacked = (piece) => piece.attacked;
  const isUndefended = (piece) => piece.undefended;
  const isAttackedAndUndefended = (piece) => piece.attacked && piece.undefended;
  return {
    evidenceId: "position.change.piece_safety",
    newlyAttacked: became(isAttacked),
    noLongerAttacked: ceased(isAttacked),
    newlyUndefended: became(isUndefended),
    noLongerUndefended: ceased(isUndefended),
    newlyAttackedAndUndefended: became(isAttackedAndUndefended),
    noLongerAttackedAndUndefended: ceased(isAttackedAndUndefended),
  };
}

function moveDescriptor(move, gameAfter, evidenceId) {
  const uci = `${move.from}${move.to}${move.promotion || ""}`.toLowerCase();
  const isCapture = typeof move.isCapture === "function"
    ? move.isCapture()
    : Boolean(move.captured);
  const isPromotion = typeof move.isPromotion === "function"
    ? move.isPromotion()
    : Boolean(move.promotion);
  const isEnPassant = typeof move.isEnPassant === "function"
    ? move.isEnPassant()
    : move.flags?.includes("e");
  const kingside = typeof move.isKingsideCastle === "function"
    ? move.isKingsideCastle()
    : move.flags?.includes("k");
  const queenside = typeof move.isQueensideCastle === "function"
    ? move.isQueensideCastle()
    : move.flags?.includes("q");
  const captureSquare = isCapture
    ? isEnPassant
      ? `${move.to[0]}${move.from[1]}`
      : move.to
    : "";
  return {
    evidenceId,
    legal: true,
    uci,
    san: move.san,
    color: move.color,
    from: move.from,
    to: move.to,
    piece: move.piece,
    capture: isCapture
      ? {
        capturedPiece: move.captured || "p",
        square: captureSquare,
        enPassant: isEnPassant,
      }
      : null,
    promotion: isPromotion ? move.promotion || "" : "",
    castle: kingside ? "kingside" : queenside ? "queenside" : "",
    givesCheck: gameAfter.isCheck(),
    givesCheckmate: gameAfter.isCheckmate(),
    givesStalemate: gameAfter.isStalemate(),
    fenBefore: move.before,
    fenAfter: move.after,
  };
}

function gameWithTurn(fen, color) {
  const parts = String(fen || "").trim().split(/\s+/);
  if (parts.length < 6 || !COLORS.includes(color)) return null;
  parts[1] = color;
  parts[3] = "-";
  return loadGame(parts.join(" "));
}

function rayTacticalMotifs(game, move) {
  if (!game || !move || !["b", "r", "q"].includes(move.piece)) return [];
  const diagonal = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const straight = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const directions = move.piece === "b"
    ? diagonal
    : move.piece === "r"
      ? straight
      : [...diagonal, ...straight];
  const startFile = squareFileIndex(move.to);
  const startRank = squareRank(move.to);
  const enemy = opposite(move.color);
  const motifs = [];
  for (const [fileStep, rankStep] of directions) {
    const encountered = [];
    for (let distance = 1; distance < 8; distance += 1) {
      const fileIndex = startFile + fileStep * distance;
      const rank = startRank + rankStep * distance;
      if (fileIndex < 0 || fileIndex >= FILES.length || rank < 1 || rank > 8) break;
      const square = `${FILES[fileIndex]}${rank}`;
      const piece = game.get(square);
      if (piece) encountered.push({ ...piece, square });
      if (encountered.length >= 2) break;
    }
    const [first, second] = encountered;
    if (first?.color !== enemy || second?.color !== enemy) continue;
    if (second.type === "k" && first.type !== "k") {
      motifs.push({
        type: "pin",
        attacker: { piece: move.piece, square: move.to },
        pinned: { piece: first.type, square: first.square },
        king: { square: second.square },
      });
    } else if (
      first.type === "k"
      && second.type !== "k"
      && PIECE_VALUES[second.type] >= 3
    ) {
      motifs.push({
        type: "skewer",
        attacker: { piece: move.piece, square: move.to },
        king: { square: first.square },
        target: { piece: second.type, square: second.square },
      });
    }
  }
  return motifs;
}

function tacticalMotifsAfterMove(game, move) {
  if (!game || !move) return [];
  const enemy = opposite(move.color);
  const attackedTargets = pieceInventory(game)
    .filter((piece) => (
      piece.color === enemy
      && game.attackers(piece.square, move.color).includes(move.to)
    ))
    .map((piece) => ({
      piece: piece.type,
      square: piece.square,
      value: PIECE_VALUES[piece.type],
    }))
    .filter((piece) => piece.piece === "k" || piece.value >= 3)
    .sort((left, right) => right.value - left.value);
  const motifs = [];
  if (attackedTargets.length >= 2) {
    motifs.push({
      type: ["p", "n"].includes(move.piece) ? "fork" : "double_attack",
      attacker: { piece: move.piece, square: move.to },
      targets: attackedTargets.slice(0, 4),
    });
  }
  motifs.push(...rayTacticalMotifs(game, move));
  const enemyKing = game.findPiece({ color: enemy, type: "k" })[0] || "";
  const checkAttackers = enemyKing ? game.attackers(enemyKing, move.color) : [];
  if (move.givesCheck && checkAttackers.length >= 2) {
    motifs.push({
      type: "double_check",
      attackers: checkAttackers,
      king: enemyKing,
    });
  } else if (move.givesCheck && !checkAttackers.includes(move.to)) {
    motifs.push({
      type: "discovered_check",
      movedPiece: { piece: move.piece, from: move.from, to: move.to },
      attacker: checkAttackers[0] || "",
      king: enemyKing,
    });
  }
  if (move.givesCheckmate) {
    motifs.push({
      type: "checkmate",
      attacker: { piece: move.piece, square: move.to },
      target: `${enemy}_king`,
    });
  } else if (move.givesCheck && move.capture) {
    motifs.push({
      type: "capture_with_check",
      attacker: { piece: move.piece, square: move.to },
      capture: move.capture,
    });
  }
  if (move.promotion) {
    motifs.push({
      type: "promotion_tactic",
      square: move.to,
      piece: move.promotion,
    });
  }
  if (move.givesStalemate) {
    motifs.push({ type: "stalemate_resource", sideWithNoMoves: enemy });
  }
  if (
    move.givesCheckmate
    && enemyKing
    && squareRank(enemyKing) === (enemy === "w" ? 1 : 8)
  ) {
    motifs.push({
      type: "back_rank_mate",
      king: enemyKing,
      attacker: { piece: move.piece, square: move.to },
    });
  }

  const enemyGame = gameWithTurn(game.fen(), enemy);
  attackedTargets
    .filter((target) => target.piece !== "k" && target.value >= 3)
    .forEach((target) => {
      if (enemyGame?.moves({ square: target.square, verbose: true }).length === 0) {
        motifs.push({
          type: "trapped_piece",
          attacker: { piece: move.piece, square: move.to },
          target,
        });
      }
    });

  const beforeGame = loadGame(move.fenBefore);
  if (beforeGame) {
    const discoveredTargets = pieceInventory(game)
      .filter((piece) => piece.color === enemy && piece.type !== "k")
      .map((piece) => {
        const beforeAttackers = new Set(beforeGame.attackers(piece.square, move.color));
        const newAttackers = game.attackers(piece.square, move.color)
          .filter((square) => square !== move.to && !beforeAttackers.has(square));
        return newAttackers.length > 0
          ? {
            piece: piece.type,
            square: piece.square,
            attackers: newAttackers,
          }
          : null;
      })
      .filter(Boolean);
    if (discoveredTargets.length > 0) {
      motifs.push({
        type: "discovered_attack",
        movedPiece: { piece: move.piece, from: move.from, to: move.to },
        targets: discoveredTargets,
      });
    }

    const overloaded = pieceInventory(game)
      .filter((piece) => piece.color === enemy && piece.type !== "k")
      .map((defender) => {
        const duties = pieceInventory(game)
          .filter((target) => (
            target.color === enemy
            && target.square !== defender.square
            && target.type !== "k"
            && game.attackers(target.square, move.color).length > 0
          ))
          .filter((target) => {
            const defenders = game.attackers(target.square, enemy);
            return defenders.length === 1 && defenders[0] === defender.square;
          })
          .map((target) => ({
            piece: target.type,
            square: target.square,
          }));
        return duties.length >= 2
          ? {
            defender: { piece: defender.type, square: defender.square },
            duties,
          }
          : null;
      })
      .filter(Boolean);
    overloaded.forEach((entry) => {
      motifs.push({ type: "overload", ...entry });
    });

    const wasAttacked = beforeGame.attackers(move.from, enemy).length > 0;
    if (wasAttacked && attackedTargets.some((target) => target.value > PIECE_VALUES[move.piece])) {
      motifs.push({
        type: "counterattack",
        movedPiece: { piece: move.piece, from: move.from, to: move.to },
        targets: attackedTargets.filter(
          (target) => target.value > PIECE_VALUES[move.piece],
        ),
      });
    }
    if (move.capture) {
      const capturedSquare = move.capture.square;
      const defendedTargets = pieceInventory(beforeGame)
        .filter((piece) => (
          piece.color === enemy
          && piece.square !== capturedSquare
          && piece.type !== "k"
          && beforeGame.attackers(piece.square, enemy).includes(capturedSquare)
        ))
        .map((piece) => ({ piece: piece.type, square: piece.square }));
      if (defendedTargets.length > 0) {
        motifs.push({
          type: "removes_defender",
          removed: {
            piece: move.capture.capturedPiece,
            square: capturedSquare,
          },
          previouslyDefended: defendedTargets,
        });
      }
    }
  }
  return motifs;
}

function dangerFeature(fen, threatenedColor, evidenceId, { hypothetical = false } = {}) {
  const attacker = opposite(threatenedColor);
  const source = hypothetical ? gameWithTurn(fen, attacker) : loadGame(fen);
  if (!source || source.turn() !== attacker) {
    return {
      evidenceId,
      threatenedColor,
      attacker,
      hypothetical,
      legalChecks: [],
      legalCaptures: [],
      matingMoves: [],
      materialThreats: [],
      tacticalMotifs: [],
      attackedAndUndefended: [],
    };
  }
  const snapshot = positionSnapshot(source, "danger");
  const legalChecks = [];
  const legalCaptures = [];
  const matingMoves = [];
  const tacticalMotifs = [];
  for (const candidate of source.moves({ verbose: true })) {
    const game = loadGame(source.fen());
    const played = moveFromUci(
      game,
      `${candidate.from}${candidate.to}${candidate.promotion || ""}`,
    );
    if (!played) continue;
    const descriptor = moveDescriptor(
      played,
      game,
      `${evidenceId}.move:${candidate.from}${candidate.to}${candidate.promotion || ""}`,
    );
    const compact = {
      uci: descriptor.uci,
      san: descriptor.san,
      piece: descriptor.piece,
      from: descriptor.from,
      to: descriptor.to,
      capture: descriptor.capture,
      givesCheck: descriptor.givesCheck,
      givesCheckmate: descriptor.givesCheckmate,
    };
    if (descriptor.givesCheck || descriptor.givesCheckmate) legalChecks.push(compact);
    if (descriptor.givesCheckmate) matingMoves.push(compact);
    if (descriptor.capture) legalCaptures.push(compact);
    tacticalMotifsAfterMove(game, descriptor).forEach((motif) => {
      tacticalMotifs.push({ move: compact, motif });
    });
  }
  const attackedAndUndefended = snapshot.pieceSafety.byColor[threatenedColor]
    .attackedAndUndefended
    .map((piece) => compactPiece({ ...piece, color: threatenedColor }));
  return {
    evidenceId,
    threatenedColor,
    attacker,
    hypothetical,
    legalChecks,
    legalCaptures,
    matingMoves,
    materialThreats: legalCaptures.filter(
      (move) => PIECE_VALUES[move.capture?.capturedPiece] >= 3,
    ),
    tacticalMotifs,
    attackedAndUndefended,
  };
}

function dangerItemKey(item) {
  if (!item || typeof item !== "object") return "";
  const type = item.type || item.motif?.type || "";
  const move = item.move || item;
  const target = item.target
    || item.capture?.square
    || move.capture?.square
    || item.square
    || item.motif?.target?.square
    || item.motif?.pinned?.square
    || "";
  const piece = item.piece
    || item.capture?.capturedPiece
    || move.capture?.capturedPiece
    || item.motif?.target?.piece
    || item.motif?.pinned?.piece
    || "";
  return [type, move.uci || "", piece, target].join("|");
}

function dangerItems(feature) {
  return [
    ...(feature.matingMoves || []).map((move) => ({ type: "mate", move })),
    ...(feature.legalChecks || [])
      .filter((move) => !move.givesCheckmate)
      .map((move) => ({ type: "check", move })),
    ...(feature.materialThreats || []).map((move) => ({
      type: "material_capture",
      move,
      capture: move.capture,
    })),
    ...(feature.attackedAndUndefended || []).map((piece) => ({
      type: "loose_piece",
      piece: piece.piece,
      square: piece.square,
      attackers: piece.attackers,
    })),
    ...(feature.tacticalMotifs || []).map((entry) => ({
      type: entry.motif?.type || "tactical_motif",
      move: entry.move,
      motif: entry.motif,
    })),
  ];
}

function compareDangers(before, after) {
  const beforeItems = dangerItems(before);
  const afterItems = dangerItems(after);
  const beforeKeys = new Set(beforeItems.map(dangerItemKey));
  const afterKeys = new Set(afterItems.map(dangerItemKey));
  return {
    dangerAlreadyExisted: beforeItems,
    dangerCreatedByMove: afterItems.filter((item) => !beforeKeys.has(dangerItemKey(item))),
    dangerIgnoredByMove: afterItems.filter((item) => beforeKeys.has(dangerItemKey(item))),
    dangerPreventedByMove: beforeItems.filter((item) => !afterKeys.has(dangerItemKey(item))),
  };
}

function purposeSummary(facts) {
  const effects = facts?.immediateEffects || [];
  const first = (type) => effects.find((effect) => effect.type === type);
  if (first("gives_checkmate")) return "setzt den gegnerischen König matt";
  if (first("gives_check")) return "gibt dem gegnerischen König Schach";
  const capture = first("capture");
  if (capture) return `schlägt auf ${capture.square}`;
  const castle = first("castles");
  if (castle) {
    return `rochiert ${castle.side === "kingside" ? "kurz" : "lang"} und aktiviert den Turm`;
  }
  const development = first("develops_piece");
  if (development) {
    return `entwickelt die Figur nach ${development.square}`;
  }
  const pawnBreak = first("pawn_break");
  if (pawnBreak) return `setzt einen Bauernhebel gegen ${pawnBreak.targets.join(" und ")} an`;
  const outpost = first("creates_outpost");
  if (outpost) return `setzt die Figur auf den gestützten Außenposten ${outpost.square}`;
  const rookFile = first("rook_on_open_file") || first("rook_on_semi_open_file");
  if (rookFile) return `stellt den Turm auf die ${rookFile.file}-Linie`;
  const king = first("king_centralization");
  if (king) return `führt den König im Endspiel von ${king.from} näher ins Zentrum nach ${king.to}`;
  const center = first("occupies_center");
  if (center) return `besetzt das Zentrumsfeld ${center.square}`;
  const control = first("controls_new_square");
  if (control) return `kontrolliert neu das Zentrumsfeld ${control.square}`;
  const file = first("opens_file") || first("creates_semi_open_file");
  if (file) return `öffnet die ${file.file}-Linie`;
  const activity = first("improves_piece_activity");
  if (activity) {
    return `erhöht die legalen Zugmöglichkeiten der Figur auf ${activity.square} von ${activity.beforeMobility} auf ${activity.afterMobility}`;
  }
  const loose = first("piece_attacked_and_undefended");
  if (loose) {
    return `greift die ungedeckte Figur auf ${loose.square} an`;
  }
  const moved = first("moves_piece");
  return moved
    ? `bringt ${moved.piece} von ${moved.from} nach ${moved.to}`
    : "";
}

function strategicMotifsFor(facts, fenBefore) {
  const motifs = [];
  const effects = facts?.immediateEffects || [];
  const addFromEffect = (effectType, motifType) => {
    effects.filter((effect) => effect.type === effectType).forEach((effect) => {
      motifs.push({ type: motifType, effect });
    });
  };
  addFromEffect("develops_piece", "development");
  addFromEffect("castles", "castling");
  addFromEffect("occupies_center", "center_control");
  addFromEffect("controls_new_square", "center_control");
  addFromEffect("opens_file", "open_file");
  addFromEffect("creates_semi_open_file", "semi_open_file");
  addFromEffect("creates_doubled_pawns", "doubled_pawns");
  addFromEffect("creates_isolated_pawn", "isolated_pawn");
  addFromEffect("creates_passed_pawn", "passed_pawn");
  addFromEffect("improves_piece_activity", "piece_activity");
  addFromEffect("reduces_piece_activity", "passive_piece");
  addFromEffect("pawn_break", "pawn_break");
  addFromEffect("creates_outpost", "outpost");
  addFromEffect("rook_on_open_file", "rook_on_open_file");
  addFromEffect("rook_on_semi_open_file", "rook_on_semi_open_file");
  addFromEffect("bad_bishop", "bad_bishop");
  addFromEffect("active_bishop", "active_bishop");
  addFromEffect("king_centralization", "king_activity");
  const firstMove = facts?.lineEvents?.[0];
  const fullmoveNumber = Number.parseInt(String(fenBefore || "").split(/\s+/)[5], 10);
  if (
    firstMove?.piece === "q"
    && Number.isFinite(fullmoveNumber)
    && fullmoveNumber <= 10
  ) {
    motifs.push({
      type: "early_queen_move",
      piece: "q",
      from: firstMove.from,
      to: firstMove.to,
    });
  }
  return motifs;
}

function positionPhase(snapshot, fen) {
  const queens = (
    snapshot?.material?.byColor?.w?.counts?.q || 0
  ) + (
    snapshot?.material?.byColor?.b?.counts?.q || 0
  );
  const totalPoints = (
    snapshot?.material?.byColor?.w?.points || 0
  ) + (
    snapshot?.material?.byColor?.b?.points || 0
  );
  const fullmove = Number.parseInt(String(fen || "").split(/\s+/)[5], 10) || 1;
  if (queens === 0 || totalPoints <= 26) return "endgame";
  if (fullmove <= 12) return "opening";
  return "middlegame";
}

function qualityFromInput(input, comparison) {
  const supplied = String(input?.quality || "");
  if (["best", "excellent", "good", "inaccuracy", "mistake", "blunder"].includes(supplied)) {
    return supplied;
  }
  const loss = Number.isFinite(comparison?.lossCp) ? comparison.lossCp : 0;
  if (comparison?.played?.move?.uci === comparison?.best?.move?.uci) return "best";
  if (loss <= 20) return "excellent";
  if (loss <= 50) return "good";
  if (loss <= 100) return "inaccuracy";
  if (loss <= 200) return "mistake";
  return "blunder";
}

function lessonFromAnalysis(dangers, tacticalMotifs, strategicMotifs) {
  const dangerTypes = new Set(
    [
      ...(dangers?.dangerCreatedByMove || []),
      ...(dangers?.dangerIgnoredByMove || []),
    ].map((danger) => danger.type),
  );
  const tacticalTypes = new Set(
    (tacticalMotifs || []).map((entry) => entry?.motif?.type || entry?.type),
  );
  const strategicTypes = new Set((strategicMotifs || []).map((entry) => entry.type));
  if (dangerTypes.has("mate") || dangerTypes.has("check")) {
    return {
      questionToAsk: "Welche Schachs hat der Gegner nach meinem Kandidatenzug?",
      takeaway: "Prüfe vor dem Ziehen zuerst alle gegnerischen Schachs.",
    };
  }
  if (
    dangerTypes.has("material_capture")
    || dangerTypes.has("loose_piece")
    || tacticalTypes.has("fork")
    || tacticalTypes.has("pin")
    || tacticalTypes.has("skewer")
  ) {
    return {
      questionToAsk: "Welche meiner Figuren sind danach angegriffen oder ungedeckt?",
      takeaway: "Kontrolliere nach jedem Kandidatenzug Schachs, Schlagzüge und Doppelangriffe.",
    };
  }
  if (strategicTypes.has("development")) {
    return {
      questionToAsk: "Welche konkrete Aufgabe bekommt die entwickelte Figur?",
      takeaway: "Entwickle Figuren mit Einfluss auf ein konkretes Feld oder eine konkrete Gefahr.",
    };
  }
  if (strategicTypes.has("castling")) {
    return {
      questionToAsk: "Kann ich meinen König sichern, bevor ich einen neuen Plan beginne?",
      takeaway: "Nutze die Rochade, wenn sie den König sichert und zugleich einen Turm aktiviert.",
    };
  }
  return {
    questionToAsk: "Was ändert mein Zug konkret, und was ist danach die stärkste Antwort?",
    takeaway: "Wenn kein konkreter Unterschied belegbar ist, rechne die stärkste Antwortfolge weiter.",
  };
}

function differenceSummary(comparison) {
  const difference = comparison?.differences?.[0];
  if (!difference) return "";
  if (difference.type === "allows_check" || difference.type === "allows_checkmate") {
    const reply = comparison.played?.opponentBestReply;
    return `Der gespielte Zug erlaubt ${reply?.san || "ein gegnerisches Schach"}, die Alternative nicht.`;
  }
  if (difference.type === "material_outcome") {
    return `Nach demselben Horizont von ${comparison.comparisonHorizon} Halbzügen ist die Materialbilanz der Alternative besser.`;
  }
  if (difference.type === "develops_piece") {
    return `Die Alternative entwickelt eine Figur nach ${difference.square}; der gespielte Zug tut das nicht.`;
  }
  if (difference.type === "avoids_loose_piece") {
    return `Die Alternative vermeidet die ungedeckte Figur auf ${difference.square}.`;
  }
  if (difference.type === "improves_king_safety") {
    return "Die Alternative bringt den König unmittelbar aus der Mitte.";
  }
  if (difference.type === "improves_center_control") {
    return `Die Alternative gewinnt konkret Einfluss auf ${difference.square}.`;
  }
  if (difference.type === "allows_material_threat") {
    return `Der gespielte Zug erlaubt einen Schlag auf ${difference.square}, die Alternative nicht.`;
  }
  if (difference.type === "allows_tactical_motif") {
    return `Der gespielte Zug erlaubt das konkrete Motiv ${difference.motif}, die Alternative nicht.`;
  }
  return "";
}

function buildCoachAnalysis(input, comparison, dangers, beforeSnapshot) {
  if (!comparison?.played) return null;
  const strategicMotifs = strategicMotifsFor(comparison.played, input.fenBefore);
  if (dangers?.dangerPreventedByMove?.length > 0) {
    strategicMotifs.push({
      type: "prophylaxis",
      preventedDangers: dangers.dangerPreventedByMove,
    });
  }
  const strongestReplyUci = comparison.played.opponentBestReply?.uci || "";
  const relevantDangers = (dangers?.dangerCreatedByMove || []).filter((danger) => {
    const dangerMove = danger.move?.uci || danger.uci || "";
    return (
      ["mate", "loose_piece"].includes(danger.type)
      || (strongestReplyUci && dangerMove === strongestReplyUci)
    );
  });
  const tacticalMotifs = [
    ...(comparison.played.tacticalMotifs || []),
    ...relevantDangers
      .filter((danger) => (
        ["mate", "check", "material_capture", "fork", "double_attack", "pin", "skewer"]
          .includes(danger.type)
      )),
  ];
  const phase = positionPhase(beforeSnapshot, input.fenBefore);
  const forced = comparison.moveNecessity?.onlyMove === true;
  const explanationType = forced
    ? "forced"
    : tacticalMotifs.length > 0 && strategicMotifs.length > 0
      ? "mixed"
      : tacticalMotifs.length > 0
        ? "tactical"
        : phase === "opening"
          ? "opening"
          : phase === "endgame"
            ? "endgame"
            : "strategic";
  const confidence = (
    Number.parseInt(input.engineDepth, 10) >= 15
    && input.candidateLines?.length >= 2
  )
    ? "high"
    : input.candidateLines?.length >= 2
      ? "medium"
      : "limited";
  const alternative = comparison.alternative;
  const concreteDifference = differenceSummary(comparison);
  return {
    verdict: {
      quality: qualityFromInput(input, comparison),
      confidence,
      explanationType,
    },
    movePurpose: {
      summary: purposeSummary(comparison.played),
      concreteEffects: comparison.played.immediateEffects,
    },
    threatBeforeMove: {
      existed: dangers.dangerAlreadyExisted.length > 0,
      threats: dangers.dangerAlreadyExisted,
      evidence: ["position.danger.before"],
    },
    playedMoveConsequences: {
      immediateEffects: comparison.played.immediateEffects,
      strongestOpponentReply: comparison.played.opponentBestReply,
      tacticalConsequences: tacticalMotifs,
      strategicConsequences: strategicMotifs,
      newDangers: dangers.dangerCreatedByMove,
      preventedDangers: dangers.dangerPreventedByMove,
      ignoredDangers: dangers.dangerIgnoredByMove,
    },
    alternative: {
      move: alternative?.move || null,
      relation: alternative?.relation || "none",
      purpose: alternative ? purposeSummary(alternative) : "",
      concreteDifference,
      strongestOpponentReply: alternative?.opponentBestReply || null,
    },
    lesson: lessonFromAnalysis(dangers, tacticalMotifs, strategicMotifs),
  };
}

function extractPv(line) {
  if (Array.isArray(line)) return line;
  if (!line || typeof line !== "object") return [];
  if (Array.isArray(line.pv)) return line.pv;
  if (Array.isArray(line.pv?.uci)) return line.pv.uci;
  if (Array.isArray(line.bestPvUci)) return line.bestPvUci;
  if (Array.isArray(line.pvUci)) return line.pvUci;
  if (Array.isArray(line.moves)) return line.moves;
  if (Array.isArray(line.uci)) return line.uci;
  return [];
}

function lineCandidates(input) {
  const supplied = input.candidateLines
    ?? input.lines
    ?? input.bestLines
    ?? input.pvs
    ?? [];
  const candidates = (Array.isArray(supplied)
    ? supplied.every((move) => typeof move === "string")
      ? [supplied]
      : supplied
    : [])
    .map((line, index) => ({
      ...(Array.isArray(line) ? { pv: line } : line),
      role: "candidate",
      rank: Number.isInteger(line?.rank) ? line.rank : index + 1,
    }));
  if (input.playedLine && typeof input.playedLine === "object") {
    candidates.push({
      ...input.playedLine,
      role: "played",
      rank: null,
    });
  }
  if (Array.isArray(input.bestPvUci) && input.bestPvUci.length > 0) {
    return [{ pv: input.bestPvUci, role: "candidate", rank: 1 }, ...candidates];
  }
  if (Array.isArray(input.primaryVariation?.uci)) {
    return [{ ...input.primaryVariation, role: "candidate", rank: 1 }, ...candidates];
  }
  return candidates;
}

export function verifyLegalPrincipalVariation(fen, pv, options = {}) {
  const game = loadGame(fen);
  const supplied = Array.isArray(pv) ? pv : [];
  const maximum = Number.isInteger(options.limit)
    ? Math.max(1, Math.min(options.limit, 100))
    : 30;
  if (!game) {
    return {
      legal: false,
      complete: false,
      suppliedMoveCount: supplied.length,
      rejectedAt: 0,
      rejectedMove: supplied[0] ?? null,
      moves: [],
    };
  }
  const moves = [];
  let rejectedAt = null;
  let rejectedMove = null;
  for (const rawMove of supplied.slice(0, maximum)) {
    const before = game.fen();
    const move = moveFromUci(game, rawMove);
    if (!move) {
      rejectedAt = moves.length;
      rejectedMove = rawMove;
      break;
    }
    moves.push(
      moveDescriptor(
        move,
        game,
        `engine.pv.move.${moves.length + 1}:${normalizeUci(rawMove)}`,
      ),
    );
    if (before === game.fen()) {
      throw new Error("Legal move verification did not advance the position.");
    }
  }
  const limited = supplied.length > maximum;
  return {
    legal: moves.length > 0 && rejectedAt === null,
    complete: rejectedAt === null && !limited,
    suppliedMoveCount: supplied.length,
    rejectedAt,
    rejectedMove,
    truncatedByLimit: limited,
    moves,
  };
}

function verifyLines(input, fenBefore) {
  const seen = new Set();
  const verifiedLines = [];
  const rejectedLines = [];
  lineCandidates(input).forEach((line, index) => {
    const pv = extractPv(line);
    const signature = pv.join(" ");
    if (!signature || seen.has(signature)) return;
    seen.add(signature);
    const role = line?.role === "played" ? "played" : "candidate";
    const rank = role === "played"
      ? null
      : Number.isInteger(line?.rank) && line.rank > 0
        ? line.rank
        : index + 1;
    const result = verifyLegalPrincipalVariation(fenBefore, pv, {
      limit: input.pvLimit,
    });
    const record = {
      evidenceId: role === "played" ? "engine.played_line" : `engine.pv.${rank}`,
      rank,
      role,
      evaluation: normalizeEvaluation(line?.evaluation),
      ...result,
    };
    if (result.moves.length > 0 && result.legal && result.complete) {
      verifiedLines.push(record);
    } else {
      rejectedLines.push(record);
    }
  });
  return { verifiedLines, rejectedLines };
}

function positionEvidenceEntries(snapshot, phase) {
  return [
    [EVIDENCE_KINDS.material, snapshot.material],
    [EVIDENCE_KINDS.development, snapshot.development],
    [EVIDENCE_KINDS.center, snapshot.center],
    [EVIDENCE_KINDS.kingSafety, snapshot.kingSafety],
    [EVIDENCE_KINDS.files, snapshot.files],
    [EVIDENCE_KINDS.pawnStructure, snapshot.pawnStructure],
    [EVIDENCE_KINDS.pieceSafety, snapshot.pieceSafety],
  ].map(([kind, fact]) => ({
    id: fact.evidenceId,
    kind,
    phase,
    source: "chess.js",
    fact,
  }));
}

function changeEvidenceEntries(changes) {
  return [
    [EVIDENCE_KINDS.materialChange, changes.material],
    [EVIDENCE_KINDS.developmentChange, changes.development],
    [EVIDENCE_KINDS.centerChange, changes.center],
    [EVIDENCE_KINDS.kingSafetyChange, changes.kingSafety],
    [EVIDENCE_KINDS.filesChange, changes.files],
    [EVIDENCE_KINDS.pawnStructureChange, changes.pawnStructure],
    [EVIDENCE_KINDS.pieceSafetyChange, changes.pieceSafety],
  ].map(([kind, fact]) => ({
    id: fact.evidenceId,
    kind,
    phase: "change",
    source: "derived_from_verified_positions",
    fact,
  }));
}

function compactPiece(record) {
  if (!record) return null;
  return {
    color: record.color,
    piece: record.type,
    square: record.square,
    attackers: record.attackers || [],
    defenders: record.defenders || [],
  };
}

function legalMobilityFrom(fen, color, square) {
  const game = gameWithTurn(fen, color);
  if (!game || !square) return 0;
  return game.moves({ square, verbose: true }).length;
}

function squareColor(square) {
  return (squareFileIndex(square) + squareRank(square)) % 2;
}

function positionalMoveEffects(move) {
  const beforeGame = loadGame(move.fenBefore);
  const afterGame = loadGame(move.fenAfter);
  if (!beforeGame || !afterGame) return [];
  const effects = [];
  const beforeMobility = legalMobilityFrom(move.fenBefore, move.color, move.from);
  const afterMobility = legalMobilityFrom(move.fenAfter, move.color, move.to);
  if (move.piece !== "p" && afterMobility > beforeMobility) {
    effects.push({
      type: "improves_piece_activity",
      piece: move.piece,
      square: move.to,
      beforeMobility,
      afterMobility,
    });
  } else if (move.piece !== "p" && afterMobility < beforeMobility) {
    effects.push({
      type: "reduces_piece_activity",
      piece: move.piece,
      square: move.to,
      beforeMobility,
      afterMobility,
    });
  }

  if (move.piece === "p") {
    const attackedEnemyPawns = pieceInventory(afterGame)
      .filter((piece) => (
        piece.color === opposite(move.color)
        && piece.type === "p"
        && afterGame.attackers(piece.square, move.color).includes(move.to)
      ))
      .map((piece) => piece.square);
    if (attackedEnemyPawns.length > 0) {
      effects.push({
        type: "pawn_break",
        pawn: move.to,
        targets: attackedEnemyPawns,
      });
    }
  }

  if (move.piece === "r") {
    const piecesOnFile = pieceInventory(afterGame)
      .filter((piece) => piece.type === "p" && piece.square[0] === move.to[0]);
    const friendlyPawns = piecesOnFile.filter((piece) => piece.color === move.color);
    const enemyPawns = piecesOnFile.filter((piece) => piece.color !== move.color);
    if (friendlyPawns.length === 0 && enemyPawns.length === 0) {
      effects.push({ type: "rook_on_open_file", square: move.to, file: move.to[0] });
    } else if (friendlyPawns.length === 0 && enemyPawns.length > 0) {
      effects.push({ type: "rook_on_semi_open_file", square: move.to, file: move.to[0] });
    }
  }

  if (["n", "b"].includes(move.piece)) {
    const ownPawnDefenders = afterGame.attackers(move.to, move.color)
      .filter((square) => afterGame.get(square)?.type === "p");
    const enemyPawnAttackers = afterGame.attackers(move.to, opposite(move.color))
      .filter((square) => afterGame.get(square)?.type === "p");
    const advanced = move.color === "w" ? squareRank(move.to) >= 5 : squareRank(move.to) <= 4;
    if (advanced && ownPawnDefenders.length > 0 && enemyPawnAttackers.length === 0) {
      effects.push({
        type: "creates_outpost",
        piece: move.piece,
        square: move.to,
        pawnDefenders: ownPawnDefenders,
      });
    }
  }

  if (move.piece === "b") {
    const ownPawnsOnColor = pieceInventory(afterGame).filter((piece) => (
      piece.color === move.color
      && piece.type === "p"
      && squareColor(piece.square) === squareColor(move.to)
    )).length;
    if (afterMobility <= 3 && ownPawnsOnColor >= 3) {
      effects.push({
        type: "bad_bishop",
        square: move.to,
        mobility: afterMobility,
        ownPawnsOnColor,
      });
    } else if (afterMobility >= 6 && ownPawnsOnColor <= 2) {
      effects.push({
        type: "active_bishop",
        square: move.to,
        mobility: afterMobility,
        ownPawnsOnColor,
      });
    }
  }

  if (move.piece === "k") {
    const material = materialFeature(pieceInventory(afterGame), "temporary.material");
    const totalPoints = material.byColor.w.points + material.byColor.b.points;
    const centerDistance = (square) => Math.min(
      ...CORE_CENTER.map((center) => (
        Math.abs(squareFileIndex(square) - squareFileIndex(center))
        + Math.abs(squareRank(square) - squareRank(center))
      )),
    );
    if (totalPoints <= 20 && centerDistance(move.to) < centerDistance(move.from)) {
      effects.push({
        type: "king_centralization",
        from: move.from,
        to: move.to,
      });
    }
  }
  return effects;
}

function immediateEffects(move, changes) {
  const effects = [{
    type: "moves_piece",
    color: move.color,
    piece: move.piece,
    from: move.from,
    to: move.to,
  }];
  if (move.capture) effects.push({ type: "capture", ...move.capture });
  if (move.givesCheck) effects.push({ type: "gives_check", target: `${opposite(move.color)}_king` });
  if (move.givesCheckmate) effects.push({ type: "gives_checkmate", target: `${opposite(move.color)}_king` });
  if (move.castle) effects.push({ type: "castles", side: move.castle });
  if (move.promotion) effects.push({ type: "promotes", piece: move.promotion, square: move.to });
  const development = changes.development?.byColor?.[move.color];
  (development?.newlyOffOriginalSquares || []).forEach((square) => {
    effects.push({ type: "develops_piece", piece: move.piece, square });
  });
  const center = changes.center?.byColor?.[move.color];
  (center?.newlyOccupiedSquares || []).forEach((square) => {
    effects.push({ type: "occupies_center", square });
  });
  (center?.newlyAttackedSquares || []).forEach((square) => {
    effects.push({ type: "controls_new_square", square });
  });
  (center?.noLongerAttackedSquares || []).forEach((square) => {
    effects.push({ type: "loses_control_of_square", square });
  });
  (changes.files?.newlyOpen || []).forEach((file) => {
    effects.push({ type: "opens_file", file });
  });
  (changes.files?.byColor?.[move.color]?.newlySemiOpen || []).forEach((file) => {
    effects.push({ type: "creates_semi_open_file", file });
  });
  const pawn = changes.pawnStructure?.byColor?.[move.color];
  [
    ["newlyDoubledFiles", "creates_doubled_pawns"],
    ["newlyIsolatedPawns", "creates_isolated_pawn"],
    ["newlyPassedPawns", "creates_passed_pawn"],
  ].forEach(([key, type]) => {
    (pawn?.[key] || []).forEach((square) => effects.push({ type, square }));
  });
  (changes.pieceSafety?.newlyAttacked || []).forEach((piece) => {
    effects.push({ type: "piece_newly_attacked", ...compactPiece(piece) });
  });
  (changes.pieceSafety?.newlyUndefended || []).forEach((piece) => {
    effects.push({ type: "piece_newly_undefended", ...compactPiece(piece) });
  });
  (changes.pieceSafety?.newlyAttackedAndUndefended || []).forEach((piece) => {
    effects.push({ type: "piece_attacked_and_undefended", ...compactPiece(piece) });
  });
  effects.push(...positionalMoveEffects(move));
  return effects;
}

function materialBalanceFor(snapshot, color) {
  const own = snapshot?.material?.byColor?.[color]?.points;
  const opponent = snapshot?.material?.byColor?.[opposite(color)]?.points;
  return Number.isFinite(own) && Number.isFinite(opponent) ? own - opponent : 0;
}

function lineFacts(fenBefore, line, evaluation, { horizon = null } = {}) {
  if (!line?.moves?.length) return null;
  const game = loadGame(fenBefore);
  if (!game) return null;
  const comparableHorizon = Number.isInteger(horizon)
    ? Math.max(1, Math.min(horizon, line.moves.length))
    : line.moves.length;
  const comparedMoves = line.moves.slice(0, comparableHorizon);
  const initial = positionSnapshot(game, "line_before");
  const firstRaw = comparedMoves[0]?.uci;
  const firstMove = moveFromUci(game, firstRaw);
  if (!firstMove) return null;
  const first = moveDescriptor(firstMove, game, line.moves[0].evidenceId);
  const afterFirst = positionSnapshot(game, "line_after");
  const changes = {
    material: materialChange(initial.material, afterFirst.material),
    development: developmentChange(initial.development, afterFirst.development, first),
    center: centerChange(initial.center, afterFirst.center),
    kingSafety: kingSafetyChange(initial.kingSafety, afterFirst.kingSafety, first),
    files: filesChange(initial.files, afterFirst.files),
    pawnStructure: pawnStructureChange(initial.pawnStructure, afterFirst.pawnStructure, first),
    pieceSafety: pieceSafetyChange(initial.pieceSafety, afterFirst.pieceSafety, first),
  };
  const lineEvents = [first];
  const tacticalMotifs = tacticalMotifsAfterMove(game, first)
    .map((motif) => ({ ply: 0, move: first.uci, motif }));
  for (const descriptor of comparedMoves.slice(1)) {
    const move = moveFromUci(game, descriptor.uci);
    if (!move) break;
    const event = moveDescriptor(move, game, descriptor.evidenceId);
    lineEvents.push(event);
    tacticalMotifsAfterMove(game, event).forEach((motif) => {
      tacticalMotifs.push({
        ply: lineEvents.length - 1,
        move: event.uci,
        motif,
      });
    });
  }
  lineEvents.forEach((event, index) => {
    const previous = lineEvents[index - 1];
    if (
      index > 0
      && previous?.capture
      && event.givesCheck
      && !event.capture
    ) {
      tacticalMotifs.push({
        ply: index,
        move: event.uci,
        motif: {
          type: "zwischenzug",
          previousCapture: previous.uci,
          checkMove: event.uci,
        },
      });
    }
    if (previous?.capture && event.capture) {
      tacticalMotifs.push({
        ply: index,
        move: event.uci,
        motif: {
          type: "forced_capture_sequence",
          moves: [previous.uci, event.uci],
        },
      });
    }
  });
  const firstMotifs = tacticalMotifs
    .filter((entry) => entry.ply === 0)
    .map((entry) => entry.motif);
  const firstRemovesDefender = firstMotifs.find(
    (motif) => motif.type === "removes_defender",
  );
  const thirdMove = lineEvents[2];
  if (
    firstRemovesDefender
    && thirdMove?.capture
    && firstRemovesDefender.previouslyDefended.some(
      (target) => target.square === thirdMove.to,
    )
  ) {
    tacticalMotifs.push({
      ply: 2,
      move: thirdMove.uci,
      motif: {
        type: "deflection",
        defenderMove: first.uci,
        targetMove: thirdMove.uci,
        removedDefender: firstRemovesDefender.removed,
        target: thirdMove.to,
      },
    });
  }
  const reply = lineEvents[1];
  if (
    reply?.capture?.square === first.to
    && thirdMove
    && (thirdMove.givesCheckmate || thirdMove.capture)
  ) {
    const firstPieceValue = PIECE_VALUES[first.piece] || 0;
    const replyCapturedValue = PIECE_VALUES[reply.capture.capturedPiece] || 0;
    const thirdCapturedValue = PIECE_VALUES[thirdMove.capture?.capturedPiece] || 0;
    const yieldsConcreteGain = (
      thirdMove.givesCheckmate
      || thirdCapturedValue > replyCapturedValue
      || firstPieceValue <= replyCapturedValue
    );
    if (yieldsConcreteGain) {
      tacticalMotifs.push({
        ply: 2,
        move: thirdMove.uci,
        motif: {
          type: "sacrifice",
          offeredMove: first.uci,
          acceptingMove: reply.uci,
          payoffMove: thirdMove.uci,
          payoff: thirdMove.givesCheckmate ? "checkmate" : "material",
        },
      });
      tacticalMotifs.push({
        ply: 2,
        move: thirdMove.uci,
        motif: {
          type: "decoy",
          offeredSquare: first.to,
          acceptingMove: reply.uci,
          payoffMove: thirdMove.uci,
        },
      });
    }
  }
  if (first.capture && reply?.capture?.square === first.to) {
    const gained = PIECE_VALUES[first.capture.capturedPiece] || 0;
    const conceded = PIECE_VALUES[reply.capture.capturedPiece] || 0;
    tacticalMotifs.push({
      ply: 1,
      move: reply.uci,
      motif: {
        type: gained > conceded
          ? "favorable_exchange"
          : gained < conceded
            ? "unfavorable_exchange"
            : "equal_exchange",
        sequence: [first.uci, reply.uci],
        gained,
        conceded,
      },
    });
  }
  const resulting = positionSnapshot(game, "line_result");
  return {
    move: { uci: first.uci, san: first.san },
    evaluation: evaluation || null,
    immediateEffects: immediateEffects(first, changes),
    opponentBestReply: lineEvents[1]
      ? {
        uci: lineEvents[1].uci,
        san: lineEvents[1].san,
        givesCheck: lineEvents[1].givesCheck,
        givesCheckmate: lineEvents[1].givesCheckmate,
        capture: lineEvents[1].capture,
      }
      : null,
    lineEvents: lineEvents.map((event) => ({
      uci: event.uci,
      san: event.san,
      color: event.color,
      piece: event.piece,
      from: event.from,
      to: event.to,
      capture: event.capture,
      givesCheck: event.givesCheck,
      givesCheckmate: event.givesCheckmate,
      givesStalemate: event.givesStalemate,
      castle: event.castle,
      promotion: event.promotion,
    })),
    tacticalMotifs,
    resultingPosition: {
      fen: resulting.fen,
      material: resulting.material,
      kingSafety: resulting.kingSafety,
      pieceSafety: resulting.pieceSafety,
      files: resulting.files,
      pawnStructure: resulting.pawnStructure,
    },
    suppliedLineLength: line.moves.length,
    comparisonHorizon: comparableHorizon,
    horizonComplete: comparableHorizon === line.moves.length,
    changes,
    materialBalanceDelta:
      materialBalanceFor(resulting, first.color) - materialBalanceFor(initial, first.color),
  };
}

function evaluationForPlayer(evaluation, color) {
  const normalized = normalizeEvaluation(evaluation);
  if (!normalized || normalized.perspective === "player") return normalized;
  return {
    ...normalized,
    value: color === "b" ? -normalized.value : normalized.value,
    perspective: "player",
  };
}

function compareLineFacts(played, best) {
  if (!played || !best) return [];
  const differences = [];
  const playedReply = played.opponentBestReply;
  const bestReply = best.opponentBestReply;
  if (playedReply?.givesCheck && !bestReply?.givesCheck) {
    differences.push({
      type: "allows_check",
      side: "played",
      move: playedReply.uci,
      target: `${played.lineEvents[0]?.color || "player"}_king`,
    });
    differences.push({
      type: "avoids_check",
      side: "best",
      move: best.move.uci,
    });
  }
  if (playedReply?.givesCheckmate && !bestReply?.givesCheckmate) {
    differences.push({
      type: "allows_checkmate",
      side: "played",
      move: playedReply.uci,
    });
  }
  if (played.materialBalanceDelta < best.materialBalanceDelta) {
    differences.push({
      type: "material_outcome",
      side: "best",
      playedDelta: played.materialBalanceDelta,
      bestDelta: best.materialBalanceDelta,
    });
  }
  const effectTypes = (facts) => new Set(facts.immediateEffects.map((effect) => effect.type));
  const playedTypes = effectTypes(played);
  const bestTypes = effectTypes(best);
  [
    ["develops_piece", "develops_piece"],
    ["castles", "improves_king_safety"],
    ["occupies_center", "improves_center_control"],
    ["opens_file", "opens_file"],
  ].forEach(([effectType, differenceType]) => {
    if (bestTypes.has(effectType) && !playedTypes.has(effectType)) {
      const effect = best.immediateEffects.find((candidate) => candidate.type === effectType);
      differences.push({ type: differenceType, side: "best", ...effect });
    }
  });
  const playedLoose = played.immediateEffects.find(
    (effect) => (
      ["piece_newly_undefended", "piece_attacked_and_undefended"].includes(effect.type)
      && effect.color === played.lineEvents[0]?.color
    ),
  );
  const bestLoose = best.immediateEffects.find(
    (effect) => (
      ["piece_newly_undefended", "piece_attacked_and_undefended"].includes(effect.type)
      && effect.color === best.lineEvents[0]?.color
    ),
  );
  if (playedLoose && !bestLoose) {
    differences.push({
      type: "avoids_loose_piece",
      side: "best",
      piece: playedLoose.piece,
      square: playedLoose.square,
    });
  }
  return differences;
}

function buildMoveComparison(input, verifiedLines, playedMove) {
  const candidates = verifiedLines
    .filter((line) => line.role === "candidate")
    .sort((left, right) => left.rank - right.rank);
  const bestLine = candidates.find((line) => line.rank === 1) || candidates[0] || null;
  const playedLine = candidates.find((line) => line.moves[0]?.uci === playedMove.uci)
    || verifiedLines.find((line) => line.role === "played")
    || null;
  if (!bestLine || !playedLine) return null;
  const commonHorizon = Math.max(
    1,
    Math.min(playedLine.moves.length, bestLine.moves.length),
  );
  const played = lineFacts(
    input.fenBefore,
    playedLine,
    evaluationForPlayer(playedLine.evaluation, playedMove.color),
    { horizon: commonHorizon },
  );
  const best = lineFacts(
    input.fenBefore,
    bestLine,
    evaluationForPlayer(bestLine.evaluation, playedMove.color),
    { horizon: commonHorizon },
  );
  if (!played || !best) return null;
  const second = candidates.find((line) => line.rank === 2) || null;
  const alternativeLine = playedMove.uci === best.move.uci ? second : bestLine;
  const alternativeFacts = alternativeLine
    ? lineFacts(
      input.fenBefore,
      alternativeLine,
      evaluationForPlayer(alternativeLine.evaluation, playedMove.color),
    )
    : null;
  const playedCp = evaluationToPlayerCp(played.evaluation);
  const alternativeCp = evaluationToPlayerCp(alternativeFacts?.evaluation);
  const equivalent = Number.isFinite(playedCp)
    && Number.isFinite(alternativeCp)
    && Math.abs(playedCp - alternativeCp) <= 20;
  const secondEvaluation = candidates.find((line) => line.rank === 2)?.evaluation
    ? evaluationForPlayer(
      candidates.find((line) => line.rank === 2).evaluation,
      playedMove.color,
    )
    : null;
  const legalMoveCount = input.onlyMoveEvidence?.type === "only_legal_move"
    && input.onlyMoveEvidence?.legalMoveCount === 1
    ? 1
    : null;
  const moveNecessity = classifyMoveNecessity({
    bestEvaluation: best.evaluation,
    secondEvaluation,
    legalMoveCount,
  });
  const onlyMove = moveNecessity.onlyMove;
  const differences = compareLineFacts(played, best);
  for (const danger of input.dangers?.dangerCreatedByMove || []) {
    const reply = danger.move || danger;
    const difference = danger.type === "mate"
      ? {
        type: "allows_checkmate",
        side: "played",
        move: reply.uci || "",
        target: `${playedMove.color}_king`,
      }
      : danger.type === "check"
        ? {
          type: "allows_check",
          side: "played",
          move: reply.uci || "",
          target: `${playedMove.color}_king`,
        }
        : danger.type === "material_capture"
          ? {
            type: "allows_material_threat",
            side: "played",
            move: reply.uci || "",
            piece: danger.capture?.capturedPiece || reply.capture?.capturedPiece || "",
            square: danger.capture?.square || reply.capture?.square || "",
          }
          : ["fork", "double_attack", "pin", "skewer"].includes(danger.type)
            ? {
              type: "allows_tactical_motif",
              motif: danger.type,
              side: "played",
              move: reply.uci || "",
            }
            : null;
    if (
      difference
      && !differences.some((entry) => (
        entry.type === difference.type
        && entry.move === difference.move
      ))
    ) {
      differences.push(difference);
    }
  }
  differences.forEach((difference, index) => {
    difference.evidenceId = `engine.move_comparison.difference.${index + 1}`;
  });
  return {
    played,
    best,
    alternative: alternativeFacts
      ? {
        move: alternativeFacts.move,
        evaluation: alternativeFacts.evaluation,
        immediateEffects: alternativeFacts.immediateEffects,
        opponentBestReply: alternativeFacts.opponentBestReply,
        relation: onlyMove && alternativeFacts.move.uci === best.move.uci
          ? "only_move"
          : equivalent
            ? "equivalent"
            : alternativeFacts.move.uci === best.move.uci
              ? "better"
              : "inferior",
      }
      : null,
    differences,
    comparisonHorizon: commonHorizon,
    materialComparison: {
      horizon: commonHorizon,
      equalLength: played.comparisonHorizon === best.comparisonHorizon,
      playedDelta: played.materialBalanceDelta,
      bestDelta: best.materialBalanceDelta,
    },
    lossCp: Number.isFinite(input.lossCp) ? Math.max(0, Math.round(input.lossCp)) : 0,
    onlyMove,
    moveNecessity,
    onlyMoveEvidence: moveNecessity.onlyMove
      ? {
        type: moveNecessity.type,
        legalMoveCount,
        gapCp: moveNecessity.gapCp,
        bestCp: moveNecessity.bestCp,
        secondCp: moveNecessity.secondCp,
        reason: moveNecessity.reason,
      }
      : null,
    explanationType: onlyMove
      ? moveNecessity.type
      : played.move.uci === best.move.uci
        ? "best_move"
        : equivalent
          ? "equivalent"
          : "improvement",
  };
}

export function buildPositionEvidence(input = {}) {
  const beforeGame = loadGame(input.fenBefore);
  if (!beforeGame) {
    return {
      version: POSITION_EVIDENCE_VERSION,
      valid: false,
      issues: [{ code: "invalid_fen_before" }],
      playedMove: null,
      verifiedLines: [],
      rejectedLines: [],
      evidence: [],
    };
  }

  const normalizedBeforeFen = beforeGame.fen();
  const before = positionSnapshot(beforeGame, "before");
  const playedMove = moveFromUci(beforeGame, input.playedUci);
  const { verifiedLines, rejectedLines } = verifyLines(input, normalizedBeforeFen);
  if (!playedMove) {
    return {
      version: POSITION_EVIDENCE_VERSION,
      valid: false,
      issues: [{ code: "illegal_played_move", move: input.playedUci ?? null }],
      input: {
        fenBefore: normalizedBeforeFen,
        playedUci: normalizeUci(input.playedUci),
      },
      before,
      after: null,
      playedMove: null,
      changes: null,
      verifiedLines,
      rejectedLines,
      evidence: positionEvidenceEntries(before, "before"),
    };
  }

  const after = positionSnapshot(beforeGame, "after");
  const move = moveDescriptor(
    playedMove,
    beforeGame,
    `move.played.legal:${normalizeUci(input.playedUci)}`,
  );
  const issues = [];
  const suppliedAfter = typeof input.fenAfter === "string" && input.fenAfter.trim()
    ? loadGame(input.fenAfter)
    : null;
  const suppliedAfterWasProvided =
    typeof input.fenAfter === "string" && input.fenAfter.trim().length > 0;
  if (suppliedAfterWasProvided && !suppliedAfter) {
    issues.push({ code: "invalid_fen_after" });
  } else if (
    suppliedAfter
    && positionKey(suppliedAfter.fen()) !== positionKey(after.fen)
  ) {
    issues.push({
      code: "fen_after_position_mismatch",
      expected: positionKey(after.fen),
      received: positionKey(suppliedAfter.fen()),
    });
  }

  const changes = {
    material: materialChange(before.material, after.material),
    development: developmentChange(
      before.development,
      after.development,
      move,
    ),
    center: centerChange(before.center, after.center),
    kingSafety: kingSafetyChange(before.kingSafety, after.kingSafety, move),
    files: filesChange(before.files, after.files),
    pawnStructure: pawnStructureChange(
      before.pawnStructure,
      after.pawnStructure,
      move,
    ),
    pieceSafety: pieceSafetyChange(
      before.pieceSafety,
      after.pieceSafety,
      move,
    ),
  };
  const suppliedAfterPositionMatches = suppliedAfter
    ? positionKey(suppliedAfter.fen()) === positionKey(after.fen)
    : null;
  const dangerBefore = dangerFeature(
    normalizedBeforeFen,
    move.color,
    "position.danger.before",
    { hypothetical: true },
  );
  const dangerAfter = dangerFeature(
    after.fen,
    move.color,
    "position.danger.after",
  );
  const dangers = compareDangers(dangerBefore, dangerAfter);
  const moveComparison = buildMoveComparison(
    {
      ...input,
      fenBefore: normalizedBeforeFen,
      dangers,
    },
    verifiedLines,
    move,
  );
  const coachAnalysis = buildCoachAnalysis(
    {
      ...input,
      fenBefore: normalizedBeforeFen,
    },
    moveComparison,
    dangers,
    before,
  );

  const evidence = [
    {
      id: move.evidenceId,
      kind: EVIDENCE_KINDS.legalMove,
      phase: "move",
      source: "chess.js",
      fact: move,
    },
    {
      id: "move.played.properties",
      kind: EVIDENCE_KINDS.moveProperties,
      phase: "move",
      source: "chess.js",
      fact: {
        capture: move.capture,
        promotion: move.promotion,
        castle: move.castle,
        givesCheck: move.givesCheck,
        givesCheckmate: move.givesCheckmate,
      },
    },
    ...positionEvidenceEntries(before, "before"),
    ...positionEvidenceEntries(after, "after"),
    ...changeEvidenceEntries(changes),
    ...verifiedLines.map((line) => ({
      id: line.evidenceId,
      kind: EVIDENCE_KINDS.principalVariation,
      phase: "line",
      source: "chess.js",
      fact: line,
    })),
    {
      id: dangerBefore.evidenceId,
      kind: EVIDENCE_KINDS.danger,
      phase: "before",
      source: "legal_move_generation_and_board_geometry",
      fact: dangerBefore,
    },
    {
      id: dangerAfter.evidenceId,
      kind: EVIDENCE_KINDS.danger,
      phase: "after",
      source: "legal_move_generation_and_board_geometry",
      fact: dangerAfter,
    },
    {
      id: "position.danger.comparison",
      kind: EVIDENCE_KINDS.danger,
      phase: "comparison",
      source: "derived_from_danger_snapshots",
      fact: dangers,
    },
    ...(moveComparison
      ? [{
        id: "engine.move_comparison",
        kind: EVIDENCE_KINDS.moveComparison,
        phase: "comparison",
        source: "derived_from_verified_engine_lines",
        fact: moveComparison,
      }, {
        id: "engine.move_comparison.differences",
        kind: EVIDENCE_KINDS.moveComparison,
        phase: "comparison",
        source: "derived_from_verified_engine_lines",
        fact: moveComparison.differences,
      }, {
        id: "engine.move_comparison.played",
        kind: EVIDENCE_KINDS.moveComparison,
        phase: "comparison",
        source: "derived_from_verified_engine_lines",
        fact: moveComparison.played,
      }, {
        id: "engine.move_comparison.best",
        kind: EVIDENCE_KINDS.moveComparison,
        phase: "comparison",
        source: "derived_from_verified_engine_lines",
        fact: moveComparison.best,
      }, {
        id: "engine.move_comparison.alternative",
        kind: EVIDENCE_KINDS.moveComparison,
        phase: "comparison",
        source: "derived_from_verified_engine_lines",
        fact: moveComparison.alternative,
      }, {
        id: "engine.move_comparison.necessity",
        kind: EVIDENCE_KINDS.moveComparison,
        phase: "comparison",
        source: "derived_from_comparable_engine_evaluations",
        fact: moveComparison.moveNecessity,
      }, ...moveComparison.differences.map((difference) => ({
        id: difference.evidenceId,
        kind: EVIDENCE_KINDS.moveComparison,
        phase: "comparison",
        source: "derived_from_equal_horizon_line_comparison",
        fact: difference,
      }))]
      : []),
  ];

  return {
    version: POSITION_EVIDENCE_VERSION,
    valid: true,
    issues,
    input: {
      fenBefore: normalizedBeforeFen,
      playedUci: move.uci,
      fenAfterProvided: suppliedAfterWasProvided,
      fenAfterPositionMatches: suppliedAfterPositionMatches,
    },
    before,
    after,
    playedMove: move,
    changes,
    verifiedLines,
    rejectedLines,
    candidateLines: verifiedLines
      .filter((line) => line.role === "candidate")
      .map((line) => ({
        rank: line.rank,
        evaluation: evaluationForPlayer(line.evaluation, move.color),
        pvUci: line.moves.map((entry) => entry.uci),
        pvSan: line.moves.map((entry) => entry.san),
      })),
    playedLine: verifiedLines.find((line) => line.role === "played")
      ? {
        evaluation: evaluationForPlayer(
          verifiedLines.find((line) => line.role === "played").evaluation,
          move.color,
        ),
        pvUci: verifiedLines.find((line) => line.role === "played").moves.map((entry) => entry.uci),
        pvSan: verifiedLines.find((line) => line.role === "played").moves.map((entry) => entry.san),
      }
      : null,
    moveComparison,
    dangers: {
      before: dangerBefore,
      after: dangerAfter,
      ...dangers,
    },
    coachAnalysis,
    evidence,
  };
}

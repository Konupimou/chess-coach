import { Chess, SQUARES } from "chess.js";

export const POSITION_EVIDENCE_VERSION = 1;

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
    fenBefore: move.before,
    fenAfter: move.after,
  };
}

function extractPv(line) {
  if (Array.isArray(line)) return line;
  if (!line || typeof line !== "object") return [];
  if (Array.isArray(line.pv)) return line.pv;
  if (Array.isArray(line.pv?.uci)) return line.pv.uci;
  if (Array.isArray(line.bestPvUci)) return line.bestPvUci;
  if (Array.isArray(line.moves)) return line.moves;
  if (Array.isArray(line.uci)) return line.uci;
  return [];
}

function lineCandidates(input) {
  const supplied = input.lines ?? input.bestLines ?? input.pvs ?? [];
  const candidates = Array.isArray(supplied)
    ? supplied.every((move) => typeof move === "string")
      ? [supplied]
      : supplied
    : [];
  if (Array.isArray(input.bestPvUci) && input.bestPvUci.length > 0) {
    return [input.bestPvUci, ...candidates];
  }
  if (Array.isArray(input.primaryVariation?.uci)) {
    return [input.primaryVariation, ...candidates];
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
    const rank = Number.isInteger(line?.rank) && line.rank > 0 ? line.rank : index + 1;
    const result = verifyLegalPrincipalVariation(fenBefore, pv, {
      limit: input.pvLimit,
    });
    const record = {
      evidenceId: `engine.pv.${rank}`,
      rank,
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
    evidence,
  };
}

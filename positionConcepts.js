import { Chess, SQUARES } from "chess.js";

export const CONCEPT_FINGERPRINT_VERSION = 1;

export const TRANSFER_CONCEPT_CATALOGUE = Object.freeze([
  "isolated_pawn", "hanging_pawns", "backward_pawn", "minority_attack",
  "flank_pawn_majority", "outpost", "good_bishop", "bad_bishop", "rook_on_open_file",
  "development_advantage", "opposite_side_castling_attack", "open_center_against_uncastled_king",
  "space_advantage", "favorable_exchange", "prophylaxis", "exchange_sacrifice",
  "pin", "fork", "deflection", "overloaded_defender", "remove_defender",
  "back_rank_weakness", "mate_motif", "passed_pawn", "opposition", "king_activity_endgame",
]);

const CONCEPT_RULES = Object.freeze({
  isolated_pawn: [["use_open_files", "seek_piece_activity", "prepare_pawn_advance"], ["blockade_pawn", "attack_pawn"], ["pawn_advance_loses_material", "activity_is_missing"]],
  passed_pawn: [["support_pawn_advance", "activate_king"], ["blockade_pawn", "attack_pawn_from_behind"], ["advance_allows_tactical_loss"]],
  hanging_pawns: [["use_space_and_activity", "prepare_central_break"], ["blockade_front_squares"], ["central_break_is_tactically_refuted"]],
  backward_pawn: [["prepare_pawn_advance", "defend_weak_pawn"], ["occupy_front_square", "attack_backward_pawn"], ["advance_square_remains_tactically_controlled"]],
  minority_attack: [["create_enemy_pawn_weakness", "open_file_for_rook"], ["advance_majority", "close_flank"], ["pawn_advance_opens_own_king", "opponent_attack_is_faster"]],
  queenside_pawn_majority: [["create_passed_pawn_on_queenside"], ["blockade_pawn_majority"], ["pawn_advance_opens_king"]],
  kingside_pawn_majority: [["create_outside_passed_pawn"], ["activate_king"], ["king_cannot_support_pawns"]],
  outpost: [["keep_piece_on_outpost", "use_outpost_for_attack"], ["exchange_outpost_piece"], ["outpost_piece_can_be_traded_favorably"]],
  bad_bishop: [["move_pawns_off_bishop_color", "trade_bad_bishop"], ["fix_pawns_on_bishop_color"], ["bishop_has_active_role_outside_pawn_chain"]],
  good_bishop: [["keep_diagonals_open", "attack_fixed_pawns"], ["block_bishop_diagonal"], ["bishop_is_tactically_trapped"]],
  development_advantage: [["open_center", "create_forcing_moves", "activate_rooks"], ["close_center", "exchange_active_attackers"], ["opening_center_loses_material"]],
  open_center_against_uncastled_king: [["open_center", "occupy_open_file", "use_forcing_moves"], ["close_center", "trade_attackers"], ["center_break_loses_material", "forced_queen_trade"]],
  opposite_side_castling_attack: [["advance_pawns_toward_enemy_king", "open_lines_with_tempo"], ["race_against_enemy_attack"], ["opponent_attack_is_faster"]],
  rook_on_open_file: [["invade_seventh_rank", "double_rooks"], ["contest_open_file"], ["entry_square_is_tactically_controlled"]],
  loose_piece: [["move_or_defend_piece"], ["attack_loose_piece_with_tempo"], []],
  space_advantage: [["improve_worst_piece", "restrict_counterplay", "prepare_break"], ["trade_cramped_pieces"], ["overextended_pawns_become_targets"]],
  king_activity_endgame: [["centralize_king", "support_passed_pawn"], ["cut_off_enemy_king"], ["king_move_allows_tactical_loss"]],
  opposition: [["use_opposition_to_gain_key_square"], ["use_distant_opposition"], ["pawn_race_is_more_urgent"]],
  pin: [["increase_pressure_on_pinned_piece", "exploit_immobility"], ["break_pin", "move_king"], ["pinned_piece_can_move_tactically", "attacker_is_loose"]],
  fork: [["exploit_multiple_attack"], ["remove_forking_piece"], ["forking_piece_can_be_captured"]],
  overloaded_defender: [["deflect_overloaded_defender", "attack_one_duty_with_tempo"], ["add_second_defender"], ["defender_has_tactical_counterplay"]],
  mate_motif: [["play_forced_mate"], [], []],
});

const FILES = "abcdefgh";
const COLORS = ["w", "b"];
const PIECE_VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 });
const CENTER = new Set(["c3", "d3", "e3", "f3", "c4", "d4", "e4", "f4", "c5", "d5", "e5", "f5", "c6", "d6", "e6", "f6"]);
const CORE_CENTER = ["d4", "e4", "d5", "e5"];

const opposite = (color) => (color === "w" ? "b" : "w");
const fileIndex = (square) => FILES.indexOf(square?.[0] || "");
const rankNumber = (square) => Number.parseInt(square?.[1], 10);
const unique = (values) => [...new Set(values)].sort();

function loadPosition(fen) {
  if (typeof fen !== "string") return null;
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 4) return null;
  try {
    return new Chess(`${fields.slice(0, 4).join(" ")} 0 1`);
  } catch {
    return null;
  }
}

function pieces(game) {
  return SQUARES.flatMap((square) => {
    const piece = game.get(square);
    return piece ? [{ square, ...piece }] : [];
  });
}

function phaseForPieces(items) {
  const nonPawn = items.reduce(
    (sum, piece) => sum + (!["p", "k"].includes(piece.type) ? PIECE_VALUES[piece.type] : 0),
    0,
  );
  if (nonPawn <= 12) return "endgame";
  if (nonPawn >= 40) return "opening";
  return "middlegame";
}

function sideViewSquare(square, turn) {
  if (turn === "w") return square;
  return `${square[0]}${9 - rankNumber(square)}`;
}

function sideViewColor(color, turn) {
  return turn === "w" ? color : opposite(color);
}

function pawnStructure(items, color) {
  const own = items.filter((piece) => piece.color === color && piece.type === "p");
  const enemy = items.filter((piece) => piece.color === opposite(color) && piece.type === "p");
  const byFile = Array.from({ length: 8 }, () => []);
  own.forEach((pawn) => byFile[fileIndex(pawn.square)].push(pawn.square));
  const occupiedFiles = byFile.flatMap((list, index) => (list.length ? [index] : []));
  const islands = occupiedFiles.reduce(
    (count, file, index) => count + (index === 0 || occupiedFiles[index - 1] !== file - 1 ? 1 : 0),
    0,
  );
  const isolated = own.filter((pawn) => {
    const file = fileIndex(pawn.square);
    return (byFile[file - 1]?.length || 0) === 0 && (byFile[file + 1]?.length || 0) === 0;
  }).map((pawn) => pawn.square);
  const doubled = byFile.flatMap((list) => (list.length > 1 ? list : []));
  const passed = own.filter((pawn) => {
    const file = fileIndex(pawn.square);
    const rank = rankNumber(pawn.square);
    return !enemy.some((candidate) => (
      Math.abs(fileIndex(candidate.square) - file) <= 1
      && (color === "w"
        ? rankNumber(candidate.square) > rank
        : rankNumber(candidate.square) < rank)
    ));
  }).map((pawn) => pawn.square);
  const pawnChains = own.filter((pawn) => {
    const rank = rankNumber(pawn.square) + (color === "w" ? -1 : 1);
    return [fileIndex(pawn.square) - 1, fileIndex(pawn.square) + 1].some((file) => {
      if (file < 0 || file > 7 || rank < 1 || rank > 8) return false;
      return own.some((candidate) => candidate.square === `${FILES[file]}${rank}`);
    });
  }).map((pawn) => pawn.square);
  return {
    pawns: own.map((pawn) => pawn.square).sort(),
    files: byFile.map((list) => list.length),
    islands,
    isolated: isolated.sort(),
    doubled: doubled.sort(),
    passed: passed.sort(),
    chains: pawnChains.sort(),
  };
}

function fileFeatures(items) {
  const pawnFiles = { w: new Set(), b: new Set() };
  items.filter((piece) => piece.type === "p").forEach((pawn) => {
    pawnFiles[pawn.color].add(pawn.square[0]);
  });
  const open = [...FILES].filter((file) => !pawnFiles.w.has(file) && !pawnFiles.b.has(file));
  const semiOpen = Object.fromEntries(COLORS.map((color) => [
    color,
    [...FILES].filter((file) => (
      !pawnFiles[color].has(file) && pawnFiles[opposite(color)].has(file)
    )),
  ]));
  return { open, semiOpen };
}

function materialFeature(items) {
  const counts = {};
  for (const color of COLORS) {
    counts[color] = Object.fromEntries(["p", "n", "b", "r", "q"].map((type) => [
      type,
      items.filter((piece) => piece.color === color && piece.type === type).length,
    ]));
    counts[color].points = Object.entries(counts[color]).reduce(
      (sum, [type, count]) => sum + (PIECE_VALUES[type] || 0) * count,
      0,
    );
  }
  return {
    byColor: counts,
    balanceWhite: counts.w.points - counts.b.points,
  };
}

function developmentFeature(items) {
  const home = {
    w: new Set(["b1", "c1", "f1", "g1"]),
    b: new Set(["b8", "c8", "f8", "g8"]),
  };
  return Object.fromEntries(COLORS.map((color) => {
    const minors = items.filter((piece) => piece.color === color && ["n", "b"].includes(piece.type));
    const developed = minors.filter((piece) => !home[color].has(piece.square));
    return [color, {
      developed: developed.map((piece) => piece.square).sort(),
      count: developed.length,
      home: minors.filter((piece) => home[color].has(piece.square)).map((piece) => piece.square).sort(),
    }];
  }));
}

function kingFeature(game, items, color) {
  const king = items.find((piece) => piece.color === color && piece.type === "k");
  const square = king?.square || "";
  const enemy = opposite(color);
  const attackers = square ? game.attackers(square, enemy) : [];
  const zone = square ? SQUARES.filter((candidate) => (
    Math.abs(fileIndex(candidate) - fileIndex(square)) <= 1
    && Math.abs(rankNumber(candidate) - rankNumber(square)) <= 1
  )) : [];
  const zoneAttackers = unique(zone.flatMap((candidate) => game.attackers(candidate, enemy)));
  const zoneDefenders = unique(zone.flatMap((candidate) => game.attackers(candidate, color)));
  const castled = color === "w"
    ? ["g1", "c1"].includes(square)
    : ["g8", "c8"].includes(square);
  const rights = game.getCastlingRights(color);
  return {
    square,
    castled,
    canCastle: Boolean(rights.k || rights.q),
    inCheck: attackers.length > 0,
    attackers: zoneAttackers,
    defenders: zoneDefenders,
    open: zoneAttackers.length > zoneDefenders.length + 1,
  };
}

function pieceActivity(game, items, color) {
  return items
    .filter((piece) => piece.color === color && piece.type !== "p")
    .map((piece) => {
      let mobility = 0;
      if (piece.type !== "k") {
        mobility = game.moves({ square: piece.square, verbose: true }).length;
      }
      const attackedBy = game.attackers(piece.square, opposite(color));
      const defendedBy = game.attackers(piece.square, color);
      return {
        piece: piece.type,
        square: piece.square,
        mobility,
        loose: attackedBy.length > 0 && defendedBy.length === 0,
        underdefended: attackedBy.length > defendedBy.length,
        center: CENTER.has(piece.square),
      };
    });
}

function centerFeature(game, items) {
  const pawns = items.filter((piece) => piece.type === "p" && CORE_CENTER.includes(piece.square));
  const tension = pawns.flatMap((pawn) => (
    game.attackers(pawn.square, opposite(pawn.color))
      .filter((square) => game.get(square)?.type === "p")
      .map((square) => `${square}x${pawn.square}`)
  ));
  const influence = Object.fromEntries(COLORS.map((color) => [
    color,
    CORE_CENTER.filter((square) => game.attackers(square, color).length > 0),
  ]));
  return { pawns: pawns.map((pawn) => pawn.square).sort(), tension: unique(tension), influence };
}

function squareColor(square) {
  return (fileIndex(square) + rankNumber(square)) % 2;
}

function lineSquares(from, to) {
  const fileStep = Math.sign(fileIndex(to) - fileIndex(from));
  const rankStep = Math.sign(rankNumber(to) - rankNumber(from));
  const fileDistance = Math.abs(fileIndex(to) - fileIndex(from));
  const rankDistance = Math.abs(rankNumber(to) - rankNumber(from));
  if (!(fileDistance === 0 || rankDistance === 0 || fileDistance === rankDistance)) return [];
  const squares = [];
  let file = fileIndex(from) + fileStep;
  let rank = rankNumber(from) + rankStep;
  while (`${FILES[file]}${rank}` !== to) {
    squares.push(`${FILES[file]}${rank}`);
    file += fileStep;
    rank += rankStep;
  }
  return squares;
}

function pinFeatures(items, color) {
  const king = items.find((piece) => piece.color === color && piece.type === "k");
  if (!king) return [];
  return items.filter((piece) => piece.color === opposite(color) && ["b", "r", "q"].includes(piece.type))
    .flatMap((slider) => {
      const between = lineSquares(slider.square, king.square);
      if (between.length === 0) return [];
      const diagonal = fileIndex(slider.square) !== fileIndex(king.square) && rankNumber(slider.square) !== rankNumber(king.square);
      if (diagonal && !["b", "q"].includes(slider.type)) return [];
      if (!diagonal && !["r", "q"].includes(slider.type)) return [];
      const blockers = between.flatMap((square) => {
        const piece = items.find((candidate) => candidate.square === square);
        return piece ? [{ square, ...piece }] : [];
      });
      return blockers.length === 1 && blockers[0].color === color
        ? [{ pinnedSquare: blockers[0].square, attackerSquare: slider.square, kingSquare: king.square }]
        : [];
    });
}

function forkFeatures(game, items, color) {
  return items.filter((piece) => piece.color === color && piece.type !== "k").flatMap((piece) => {
    const targets = items.filter((target) => (
      target.color === opposite(color)
      && target.type !== "p"
      && game.attackers(target.square, color).includes(piece.square)
    ));
    return targets.length >= 2
      ? [{ attacker: piece.square, targets: targets.map((target) => target.square).sort() }]
      : [];
  });
}

function overloadedDefenders(game, items, color) {
  const enemy = opposite(color);
  return items.filter((piece) => piece.color === color && piece.type !== "k").flatMap((defender) => {
    const soleDuties = items.filter((piece) => piece.color === color && piece.square !== defender.square)
      .filter((piece) => game.attackers(piece.square, enemy).length > 0)
      .filter((piece) => {
        const defenders = game.attackers(piece.square, color);
        return defenders.length === 1 && defenders[0] === defender.square;
      });
    return soleDuties.length >= 2
      ? [{ defender: defender.square, duties: soleDuties.map((piece) => piece.square).sort() }]
      : [];
  });
}

function matingMoves(game) {
  return game.moves({ verbose: true }).flatMap((move) => {
    const copy = new Chess(game.fen());
    const played = copy.move({ from: move.from, to: move.to, promotion: move.promotion });
    return played && copy.isCheckmate() ? [`${move.from}${move.to}${move.promotion || ""}`] : [];
  });
}

function concept(id, side, {
  prerequisites = [],
  typicalPlan = [],
  counterplan = [],
  failureConditions = [],
  criticalSquares = [],
  pawnBreaks = [],
  relevantPieces = [],
  confidence = 0.75,
  polarity = "positive",
} = {}) {
  return {
    id,
    side,
    prerequisites,
    typicalPlan,
    counterplan,
    failureConditions,
    criticalSquares: unique(criticalSquares),
    pawnBreaks: unique(pawnBreaks),
    relevantPieces: unique(relevantPieces),
    confidence,
    polarity,
  };
}

function detectConcepts(game, items, features) {
  const concepts = [];
  for (const color of COLORS) {
    const ownPawn = features.pawns[color];
    const enemyPawn = features.pawns[opposite(color)];
    const ownDevelopment = features.development[color];
    const enemyDevelopment = features.development[opposite(color)];
    const ownKing = features.king[color];
    const enemyKing = features.king[opposite(color)];
    const ownActivity = features.activity[color];

    for (const square of ownPawn.isolated) {
      concepts.push(concept("isolated_pawn", color, {
        prerequisites: [`isolated_pawn:${square}`],
        typicalPlan: ["use_open_files", "seek_piece_activity", "prepare_pawn_advance"],
        counterplan: ["blockade_pawn", "exchange_active_pieces", "attack_pawn"],
        failureConditions: ["pawn_advance_loses_material", "activity_is_missing"],
        criticalSquares: [square],
        relevantPieces: ownActivity.filter((piece) => ["r", "n"].includes(piece.piece)).map((piece) => piece.square),
        confidence: 0.96,
      }));
    }
    for (const square of ownPawn.passed) {
      concepts.push(concept("passed_pawn", color, {
        prerequisites: [`passed_pawn:${square}`],
        typicalPlan: ["support_pawn_advance", "activate_king", "tie_down_blockader"],
        counterplan: ["blockade_pawn", "attack_pawn_from_behind"],
        failureConditions: ["advance_allows_tactical_loss"],
        criticalSquares: [square],
        confidence: 0.97,
      }));
    }
    for (const pawn of ownPawn.pawns) {
      const file = fileIndex(pawn);
      const rank = rankNumber(pawn);
      const advance = `${pawn[0]}${rank + (color === "w" ? 1 : -1)}`;
      const adjacentSupportCanCatchUp = ownPawn.pawns.some((candidate) => (
        Math.abs(fileIndex(candidate) - file) === 1
        && (color === "w" ? rankNumber(candidate) <= rank : rankNumber(candidate) >= rank)
      ));
      const enemyPawnControlsAdvance = game.attackers(advance, opposite(color))
        .some((square) => game.get(square)?.type === "p");
      if (!ownPawn.isolated.includes(pawn) && !adjacentSupportCanCatchUp && enemyPawnControlsAdvance) {
        concepts.push(concept("backward_pawn", color, {
          prerequisites: [`backward_pawn:${pawn}`, `controlled_advance_square:${advance}`],
          typicalPlan: ["prepare_pawn_advance", "defend_weak_pawn", "seek_piece_activity"],
          counterplan: ["occupy_front_square", "attack_backward_pawn"],
          failureConditions: ["advance_square_remains_tactically_controlled"],
          criticalSquares: [pawn, advance],
          confidence: 0.78,
          polarity: "negative",
        }));
      }
    }
    const centralPawns = ownPawn.pawns.filter((square) => ["c4", "d4", "e4", "c5", "d5", "e5"].includes(square));
    if (centralPawns.length >= 2 && centralPawns.some((square) => ownPawn.isolated.includes(square))) {
      concepts.push(concept("hanging_pawns", color, {
        prerequisites: centralPawns.map((square) => `central_pawn:${square}`),
        typicalPlan: ["use_space_and_activity", "prepare_central_break"],
        counterplan: ["blockade_front_squares", "force_one_pawn_to_advance"],
        failureConditions: ["central_break_is_tactically_refuted"],
        criticalSquares: centralPawns,
        confidence: 0.68,
      }));
    }
    const queenSideOwn = ownPawn.files.slice(0, 4).reduce((sum, count) => sum + count, 0);
    const queenSideEnemy = enemyPawn.files.slice(0, 4).reduce((sum, count) => sum + count, 0);
    if (queenSideOwn > queenSideEnemy && features.phase !== "opening") {
      concepts.push(concept("queenside_pawn_majority", color, {
        prerequisites: ["queenside_pawn_majority"],
        typicalPlan: ["create_passed_pawn_on_queenside"],
        counterplan: ["blockade_pawn_majority", "create_counterplay_elsewhere"],
        failureConditions: ["pawn_advance_opens_king"],
        confidence: 0.82,
      }));
    }
    const kingSideOwn = ownPawn.files.slice(4).reduce((sum, count) => sum + count, 0);
    const kingSideEnemy = enemyPawn.files.slice(4).reduce((sum, count) => sum + count, 0);
    if (kingSideOwn > kingSideEnemy && features.phase === "endgame") {
      concepts.push(concept("kingside_pawn_majority", color, {
        prerequisites: ["kingside_pawn_majority", "endgame"],
        typicalPlan: ["create_outside_passed_pawn"],
        counterplan: ["activate_king", "fix_pawns"],
        failureConditions: ["king_cannot_support_pawns"],
        confidence: 0.84,
      }));
    }
    for (const [files, flank] of [[[0, 1, 2, 3], "queenside"], [[4, 5, 6, 7], "kingside"]]) {
      const ownCount = files.reduce((sum, file) => sum + ownPawn.files[file], 0);
      const enemyCount = files.reduce((sum, file) => sum + enemyPawn.files[file], 0);
      const advanced = ownPawn.pawns.some((square) => (
        files.includes(fileIndex(square))
        && (color === "w" ? rankNumber(square) >= 4 : rankNumber(square) <= 5)
      ));
      if (ownCount > 0 && ownCount < enemyCount && advanced && features.phase !== "endgame") {
        concepts.push(concept("minority_attack", color, {
          prerequisites: [`pawn_minority:${flank}`, `advanced_pawn:${flank}`],
          typicalPlan: ["create_enemy_pawn_weakness", "open_file_for_rook"],
          counterplan: ["advance_majority", "close_flank"],
          failureConditions: ["pawn_advance_opens_own_king", "opponent_attack_is_faster"],
          confidence: 0.76,
        }));
      }
    }
    for (const knight of items.filter((piece) => piece.color === color && piece.type === "n")) {
      const rank = rankNumber(knight.square);
      const enemyHalf = color === "w" ? rank >= 5 : rank <= 4;
      const pawnDefended = game.attackers(knight.square, color)
        .some((square) => game.get(square)?.type === "p");
      const enemyPawnCanChallenge = game.attackers(knight.square, opposite(color))
        .some((square) => game.get(square)?.type === "p");
      if (enemyHalf && pawnDefended && !enemyPawnCanChallenge) {
        concepts.push(concept("outpost", color, {
          prerequisites: [`supported_piece:${knight.square}`, "cannot_be_challenged_by_enemy_pawn"],
          typicalPlan: ["keep_piece_on_outpost", "use_outpost_for_attack"],
          counterplan: ["exchange_outpost_piece", "challenge_supporting_pawn"],
          failureConditions: ["outpost_piece_can_be_traded_favorably"],
          criticalSquares: [knight.square],
          relevantPieces: [knight.square],
          confidence: 0.9,
        }));
      }
    }
    for (const bishop of items.filter((piece) => piece.color === color && piece.type === "b")) {
      const sameColorPawns = ownPawn.pawns.filter((square) => squareColor(square) === squareColor(bishop.square));
      if (sameColorPawns.length >= 4) {
        concepts.push(concept("bad_bishop", color, {
          prerequisites: [`bishop:${bishop.square}`, `same_color_pawns:${sameColorPawns.length}`],
          typicalPlan: ["move_pawns_off_bishop_color", "trade_bad_bishop", "activate_bishop_outside_chain"],
          counterplan: ["fix_pawns_on_bishop_color"],
          failureConditions: ["bishop_has_active_role_outside_pawn_chain"],
          criticalSquares: [bishop.square, ...sameColorPawns],
          confidence: 0.74,
          polarity: "negative",
        }));
      } else if (sameColorPawns.length <= 1 && features.phase !== "opening") {
        concepts.push(concept("good_bishop", color, {
          prerequisites: [`bishop:${bishop.square}`, "few_own_pawns_on_bishop_color"],
          typicalPlan: ["keep_diagonals_open", "attack_fixed_pawns"],
          counterplan: ["block_bishop_diagonal", "trade_active_bishop"],
          failureConditions: ["bishop_is_tactically_trapped"],
          criticalSquares: [bishop.square],
          confidence: 0.72,
        }));
      }
    }
    if (ownDevelopment.count >= enemyDevelopment.count + 2) {
      const centerCanOpen = features.center.tension.length > 0 || features.center.pawns.length < 3;
      concepts.push(concept("development_advantage", color, {
        prerequisites: ["development_lead", centerCanOpen ? "center_can_open" : "center_closed"],
        typicalPlan: centerCanOpen
          ? ["open_center", "create_forcing_moves", "activate_rooks"]
          : ["complete_development", "prepare_center_break"],
        counterplan: ["close_center", "exchange_active_attackers", "complete_development"],
        failureConditions: ["opening_center_loses_material", "development_lead_not_relevant"],
        criticalSquares: CORE_CENTER,
        relevantPieces: ownDevelopment.developed,
        confidence: centerCanOpen ? 0.91 : 0.78,
      }));
      if (!enemyKing.castled && !enemyKing.canCastle && centerCanOpen) {
        concepts.push(concept("open_center_against_uncastled_king", color, {
          prerequisites: ["development_lead", "enemy_king_uncastled", "center_can_open"],
          typicalPlan: ["open_center", "occupy_open_file", "use_forcing_moves"],
          counterplan: ["close_center", "trade_attackers", "move_king_to_safety"],
          failureConditions: ["center_break_loses_material", "forced_queen_trade"],
          criticalSquares: [enemyKing.square, ...CORE_CENTER],
          confidence: 0.92,
        }));
      }
    }
    if (ownKing.castled && enemyKing.castled && fileIndex(ownKing.square) <= 2 !== fileIndex(enemyKing.square) <= 2) {
      concepts.push(concept("opposite_side_castling_attack", color, {
        prerequisites: ["both_kings_castled_opposite_wings"],
        typicalPlan: ["advance_pawns_toward_enemy_king", "open_lines_with_tempo"],
        counterplan: ["race_against_enemy_attack", "keep_lines_closed"],
        failureConditions: ["own_king_attack_arrives_first", "pawn_push_weakens_own_king"],
        criticalSquares: [ownKing.square, enemyKing.square],
        confidence: 0.94,
      }));
    }
    if (features.files.open.length > 0 && ownActivity.some((piece) => piece.piece === "r" && features.files.open.includes(piece.square[0]))) {
      concepts.push(concept("rook_on_open_file", color, {
        prerequisites: ["open_file", "rook_on_open_file"],
        typicalPlan: ["invade_seventh_rank", "double_rooks", "occupy_entry_square"],
        counterplan: ["contest_open_file", "control_entry_squares"],
        failureConditions: ["entry_square_is_tactically_controlled"],
        criticalSquares: ownActivity.filter((piece) => piece.piece === "r").map((piece) => piece.square),
        confidence: 0.9,
      }));
    }
    for (const piece of ownActivity.filter((entry) => entry.loose)) {
      concepts.push(concept("loose_piece", color, {
        prerequisites: [`loose_piece:${piece.piece}:${piece.square}`],
        typicalPlan: ["move_or_defend_piece"],
        counterplan: ["attack_loose_piece_with_tempo"],
        failureConditions: [],
        criticalSquares: [piece.square],
        relevantPieces: [piece.square],
        confidence: 0.98,
        polarity: "negative",
      }));
    }
    for (const pin of pinFeatures(items, opposite(color))) {
      concepts.push(concept("pin", color, {
        prerequisites: [`pinned_piece:${pin.pinnedSquare}`, `king:${pin.kingSquare}`],
        typicalPlan: ["increase_pressure_on_pinned_piece", "exploit_immobility"],
        counterplan: ["break_pin", "move_king", "interpose_piece"],
        failureConditions: ["pinned_piece_can_move_tactically", "attacker_is_loose"],
        criticalSquares: [pin.attackerSquare, pin.pinnedSquare, pin.kingSquare],
        confidence: 0.96,
      }));
    }
    for (const fork of forkFeatures(game, items, color)) {
      concepts.push(concept("fork", color, {
        prerequisites: [`forking_piece:${fork.attacker}`, ...fork.targets.map((square) => `target:${square}`)],
        typicalPlan: ["exploit_multiple_attack"],
        counterplan: ["move_with_tempo", "remove_forking_piece"],
        failureConditions: ["forking_piece_can_be_captured", "one_target_has_forcing_reply"],
        criticalSquares: [fork.attacker, ...fork.targets],
        confidence: 0.94,
      }));
    }
    for (const overload of overloadedDefenders(game, items, opposite(color))) {
      concepts.push(concept("overloaded_defender", color, {
        prerequisites: [`defender:${overload.defender}`, ...overload.duties.map((square) => `duty:${square}`)],
        typicalPlan: ["deflect_overloaded_defender", "attack_one_duty_with_tempo"],
        counterplan: ["add_second_defender", "remove_attacker"],
        failureConditions: ["defender_has_tactical_counterplay"],
        criticalSquares: [overload.defender, ...overload.duties],
        confidence: 0.9,
      }));
    }
    const space = features.space[color] - features.space[opposite(color)];
    if (space >= 4) {
      concepts.push(concept("space_advantage", color, {
        prerequisites: ["more_controlled_squares_in_enemy_half"],
        typicalPlan: ["improve_worst_piece", "restrict_counterplay", "prepare_break"],
        counterplan: ["trade_cramped_pieces", "challenge_pawn_chain"],
        failureConditions: ["overextended_pawns_become_targets"],
        confidence: 0.78,
      }));
    }
    if (features.phase === "endgame") {
      concepts.push(concept("king_activity_endgame", color, {
        prerequisites: ["endgame"],
        typicalPlan: ["centralize_king", "support_passed_pawn"],
        counterplan: ["cut_off_enemy_king"],
        failureConditions: ["king_move_allows_tactical_loss"],
        criticalSquares: [ownKing.square],
        confidence: 0.72,
      }));
      const whiteKing = features.king.w.square;
      const blackKing = features.king.b.square;
      const fileDistance = Math.abs(fileIndex(whiteKing) - fileIndex(blackKing));
      const rankDistance = Math.abs(rankNumber(whiteKing) - rankNumber(blackKing));
      if ((fileDistance === 0 && rankDistance === 2) || (rankDistance === 0 && fileDistance === 2)) {
        concepts.push(concept("opposition", color, {
          prerequisites: [`kings:${whiteKing}:${blackKing}`, "one_square_between_kings"],
          typicalPlan: ["use_opposition_to_gain_key_square"],
          counterplan: ["use_distant_opposition", "gain_tempo_with_pawn_move"],
          failureConditions: ["pawn_race_is_more_urgent"],
          criticalSquares: [whiteKing, blackKing],
          confidence: 0.98,
        }));
      }
    }
  }
  for (const uci of matingMoves(game)) {
    concepts.push(concept("mate_motif", game.turn(), {
      prerequisites: [`legal_mating_move:${uci}`],
      typicalPlan: ["play_forced_mate"],
      counterplan: [],
      failureConditions: [],
      criticalSquares: [uci.slice(2, 4)],
      confidence: 1,
    }));
  }
  return concepts.sort((left, right) => left.id.localeCompare(right.id) || left.side.localeCompare(right.side));
}

function normalizedKey(items, turn, predicate) {
  return items
    .filter(predicate)
    .map((piece) => `${sideViewColor(piece.color, turn)}${piece.type}${sideViewSquare(piece.square, turn)}`)
    .sort()
    .join("");
}

function compactConcept(value) {
  return [
    value.id,
    value.side,
    value.criticalSquares,
    value.relevantPieces,
    Math.round(value.confidence * 100),
    value.polarity,
  ];
}

function expandConcept(value) {
  if (!Array.isArray(value)) return value;
  const rules = CONCEPT_RULES[value[0]] || [[`apply_${value[0]}_plan`], [], [`tactical_refutation_of_${value[0]}`]];
  return {
    id: value[0], side: value[1],
    prerequisites: [`concept_active:${value[0]}`, ...(value[2] || []).map((square) => `critical_square:${square}`)],
    typicalPlan: rules[0], counterplan: rules[1], failureConditions: rules[2], criticalSquares: value[2] || [],
    pawnBreaks: [], relevantPieces: value[3] || [], confidence: (value[4] || 0) / 100,
    polarity: value[5] || "positive",
  };
}

export function buildPositionConceptFingerprint(fen) {
  const game = loadPosition(fen);
  if (!game) return null;
  const items = pieces(game);
  const turn = game.turn();
  const activity = Object.fromEntries(COLORS.map((color) => [color, pieceActivity(game, items, color)]));
  const features = {
    phase: phaseForPieces(items),
    turn,
    material: materialFeature(items),
    pawns: Object.fromEntries(COLORS.map((color) => [color, pawnStructure(items, color)])),
    files: fileFeatures(items),
    development: developmentFeature(items),
    king: Object.fromEntries(COLORS.map((color) => [color, kingFeature(game, items, color)])),
    activity,
    center: centerFeature(game, items),
    space: Object.fromEntries(COLORS.map((color) => [
      color,
      SQUARES.filter((square) => {
        const rank = rankNumber(square);
        const enemyHalf = color === "w" ? rank >= 5 : rank <= 4;
        return enemyHalf && game.attackers(square, color).length > 0;
      }).length,
    ])),
  };
  const concepts = detectConcepts(game, items, features);
  const sidePawnKey = normalizedKey(items, turn, (piece) => piece.type === "p");
  const sideMaterialKey = COLORS.map((color) => {
    const view = sideViewColor(color, turn);
    const counts = features.material.byColor[color];
    return `${view}${counts.p}${counts.n}${counts.b}${counts.r}${counts.q}`;
  }).sort().join("|");
  return {
    version: CONCEPT_FINGERPRINT_VERSION,
    phase: features.phase,
    turn,
    structuralKey: `${features.phase}|${sidePawnKey}|${sideMaterialKey}`,
    pawnKey: sidePawnKey,
    materialKey: sideMaterialKey,
    kingKey: COLORS.map((color) => {
      const view = sideViewColor(color, turn);
      const data = features.king[color];
      return `${view}${sideViewSquare(data.square, turn)}${data.castled ? "c" : data.canCastle ? "u" : "n"}`;
    }).sort().join("|"),
    conceptIds: unique(concepts.map((entry) => entry.id)),
    tacticalKeys: unique(concepts.filter((entry) => [
      "loose_piece", "pin", "fork", "overloaded_defender", "back_rank_weakness", "mate_motif",
    ].includes(entry.id)).map((entry) => entry.id)),
    concepts,
    summary: {
      pawnIslands: { w: features.pawns.w.islands, b: features.pawns.b.islands },
      openFiles: features.files.open,
      semiOpenFiles: features.files.semiOpen,
      centerTension: features.center.tension,
      space: features.space,
      loosePieces: Object.fromEntries(COLORS.map((color) => [
        color,
        activity[color].filter((piece) => piece.loose).map((piece) => `${piece.piece}:${piece.square}`),
      ])),
    },
  };
}

export function compactConceptFingerprint(value) {
  if (!value) return null;
  return [
    value.version,
    value.pawnKey,
    value.materialKey,
    value.kingKey,
    value.conceptIds,
    value.tacticalKeys,
    value.concepts.map(compactConcept),
  ];
}

export function expandConceptFingerprint(value) {
  if (!Array.isArray(value)) return value || null;
  return {
    version: value[0], phase: "", structuralKey: "", pawnKey: value[1],
    materialKey: value[2], kingKey: value[3], conceptIds: value[4] || [], tacticalKeys: value[5] || [],
    concepts: (value[6] || []).map(expandConcept), summary: {},
  };
}

export function compareConceptFingerprints(queryValue, candidateValue) {
  const query = expandConceptFingerprint(queryValue);
  const candidate = expandConceptFingerprint(candidateValue);
  if (!query || !candidate || query.phase !== candidate.phase) return null;
  const sharedConcepts = query.conceptIds.filter((id) => candidate.conceptIds.includes(id));
  const sharedTactics = query.tacticalKeys.filter((id) => candidate.tacticalKeys.includes(id));
  const tacticalMismatch = (
    (query.tacticalKeys.length > 0 || candidate.tacticalKeys.length > 0)
    && (
      sharedTactics.length === 0
      || sharedTactics.length !== query.tacticalKeys.length
      || sharedTactics.length !== candidate.tacticalKeys.length
    )
  );
  let score = 8;
  const sharedFeatures = ["phase"];
  if (query.structuralKey === candidate.structuralKey) {
    score += 48;
    sharedFeatures.push("structural_fingerprint");
  } else {
    if (query.pawnKey === candidate.pawnKey) {
      score += 30;
      sharedFeatures.push("pawn_structure");
    }
    if (query.materialKey === candidate.materialKey) {
      score += 13;
      sharedFeatures.push("material");
    }
  }
  if (query.kingKey === candidate.kingKey) {
    score += 10;
    sharedFeatures.push("king_setup");
  }
  score += Math.min(24, sharedConcepts.length * 8);
  if (sharedConcepts.length) sharedFeatures.push(...sharedConcepts.map((id) => `concept:${id}`));
  if (sharedTactics.length) score += 16;
  if (tacticalMismatch) score -= 35;

  const transferableConcepts = sharedConcepts.flatMap((id) => {
    const current = query.concepts.find((entry) => entry.id === id);
    const historical = candidate.concepts.find((entry) => entry.id === id);
    if (!current || !historical) return [];
    const currentSquares = new Set(current.criticalSquares || []);
    const historicalSquares = new Set(historical.criticalSquares || []);
    const sharedPrerequisites = [
      `concept_active:${id}`,
      ...current.prerequisites.filter((item) => historical.prerequisites.includes(item)),
      ...(current.criticalSquares || [])
        .filter((square) => historicalSquares.has(square))
        .map((square) => `critical_square:${square}`),
    ];
    const differences = [
      ...(current.criticalSquares || [])
        .filter((square) => !historicalSquares.has(square))
        .map((square) => `current_only:critical_square:${square}`),
      ...(historical.criticalSquares || [])
        .filter((square) => !currentSquares.has(square))
        .map((square) => `historical_only:critical_square:${square}`),
    ].slice(0, 6);
    const blocked = tacticalMismatch || current.failureConditions.some((condition) => (
      query.tacticalKeys.includes(condition)
    ));
    return [{
      id,
      sharedPrerequisites,
      differences,
      transferablePlan: blocked ? [] : current.typicalPlan.slice(0, 3),
      counterplan: current.counterplan.slice(0, 2),
      failureConditions: current.failureConditions.slice(0, 3),
      blocked,
      confidence: Math.min(current.confidence, historical.confidence, Math.max(0, score / 100)),
    }];
  });
  return {
    score: Math.max(0, Math.min(100, score)),
    matchType: query.structuralKey === candidate.structuralKey
      ? "concept_structure"
      : sharedConcepts.length > 0
        ? "concept_transfer"
        : query.pawnKey === candidate.pawnKey
          ? "pawn_structure"
          : "position_pattern",
    shared: unique(sharedFeatures),
    differences: transferableConcepts.flatMap((entry) => entry.differences).slice(0, 6),
    transferableConcepts,
    tacticalMismatch,
  };
}

export function conceptSearchTokens(value) {
  const fingerprint = expandConceptFingerprint(value);
  if (!fingerprint) return [];
  return unique([
    `phase:${fingerprint.phase}`,
    `structure:${fingerprint.structuralKey}`,
    `pawn:${fingerprint.pawnKey}`,
    `material:${fingerprint.materialKey}`,
    ...fingerprint.conceptIds.map((id) => `concept:${id}`),
    ...fingerprint.tacticalKeys.map((id) => `tactic:${id}`),
  ]);
}

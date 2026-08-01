import { Chess } from "chess.js";

const FORBIDDEN_GENERIC_CLAIMS = Object.freeze([
  "wechselt auf ihr Zielfeld",
  "verändert die Bauernstellung",
  "hält die Stellung zusammen",
  "genaue Wert zeigt sich",
  "verifizierte Hauptvariante",
  "sichere Bezugspunkt",
  "ist gut spielbar",
  "packt die wichtigste Aufgabe",
]);

function uci(move) {
  return `${move.from}${move.to}${move.promotion || ""}`.toLowerCase();
}

function legalSan(fen, moveUci) {
  const game = new Chess(fen);
  const move = game.move({
    from: moveUci.slice(0, 2),
    to: moveUci.slice(2, 4),
    promotion: moveUci[4],
  });
  if (!move) throw new Error(`Illegal fixture move ${moveUci} in ${fen}`);
  return move.san;
}

function legalLine(fen, moves) {
  const game = new Chess(fen);
  return moves.map((moveUci) => {
    const move = game.move({
      from: moveUci.slice(0, 2),
      to: moveUci.slice(2, 4),
      promotion: moveUci[4],
    });
    if (!move) throw new Error(`Illegal fixture line ${moves.join(" ")} in ${fen}`);
    return move.san;
  });
}

function alternateMove(fen, excluded) {
  const game = new Chess(fen);
  const legal = game.moves({ verbose: true }).map(uci);
  return legal.find((move) => move !== excluded) || "";
}

function makeCase({
  id,
  category,
  fen,
  playedMove,
  bestMove = playedMove,
  playedReply = "",
  bestReply = "",
  playedContinuation = [],
  bestContinuation = [],
  expectedQuality = bestMove === playedMove ? "best" : "mistake",
  expectedExplanationType = "strategic",
  requiredFacts = [],
  expectedAlternative = "",
  expectedDanger = [],
  expectedMotifs = [],
  bestCp = bestMove === playedMove ? 35 : 20,
  playedCp = bestMove === playedMove ? 35 : -180,
  secondCp = 20,
  legalMoveCount = null,
  groups = [],
} = {}) {
  const fallbackAlternative = alternateMove(fen, playedMove);
  const alternative = expectedAlternative
    || (bestMove === playedMove ? fallbackAlternative : bestMove);
  const rankOne = [
    bestMove,
    bestReply,
    ...(bestMove === playedMove ? playedContinuation : bestContinuation),
  ].filter(Boolean);
  const rankTwoFirst = bestMove === playedMove ? alternative : playedMove;
  const rankTwoReply = bestMove === playedMove ? "" : playedReply;
  const rankTwo = [
    rankTwoFirst,
    rankTwoReply,
    ...(bestMove === playedMove ? bestContinuation : playedContinuation),
  ].filter(Boolean);
  legalLine(fen, rankOne);
  if (rankTwo.length > 0) legalLine(fen, rankTwo);
  const candidateLines = [
    {
      rank: 1,
      evaluation: { unit: "cp", value: bestCp, perspective: "player" },
      pvUci: rankOne,
      pvSan: legalLine(fen, rankOne),
    },
    ...(rankTwo.length > 0 ? [{
      rank: 2,
      evaluation: {
        unit: "cp",
        value: bestMove === playedMove ? secondCp : playedCp,
        perspective: "player",
      },
      pvUci: rankTwo,
      pvSan: legalLine(fen, rankTwo),
    }] : []),
  ];
  const playedCandidate = candidateLines.find((line) => line.pvUci[0] === playedMove);
  return {
    id,
    category,
    groups: [...new Set([category, ...groups])],
    fen,
    playedMove,
    candidateLines,
    playedLine: {
      evaluation: playedCandidate.evaluation,
      pvUci: playedCandidate.pvUci,
      pvSan: playedCandidate.pvSan,
    },
    expectedQuality,
    expectedExplanationType,
    requiredFacts,
    forbiddenClaims: [...FORBIDDEN_GENERIC_CLAIMS],
    expectedAlternative: alternative,
    expectedDanger,
    expectedMotifs,
    legalMoveCount,
    playedSan: legalSan(fen, playedMove),
  };
}

function openingCases(prefix, moves, categories) {
  const game = new Chess();
  return moves.map((playedMove, index) => {
    const fen = game.fen();
    const category = categories[index] || "ruhiger_eröffnungszug";
    const piece = game.get(playedMove.slice(0, 2))?.type;
    const from = playedMove.slice(0, 2);
    const to = playedMove.slice(2, 4);
    const isDevelopment = (
      ["n", "b"].includes(piece)
      && ["b1", "c1", "f1", "g1", "b8", "c8", "f8", "g8"].includes(from)
    );
    const isCastle = piece === "k" && Math.abs(
      from.charCodeAt(0) - to.charCodeAt(0),
    ) === 2;
    const requiredFacts = isCastle
      ? ["castles"]
      : isDevelopment
        ? ["develops_piece"]
        : ["moves_piece"];
    const item = makeCase({
      id: `${prefix}-${String(index + 1).padStart(2, "0")}`,
      category,
      fen,
      playedMove,
      expectedExplanationType: "opening",
      requiredFacts,
      expectedMotifs: isCastle
        ? ["castling"]
        : isDevelopment
          ? ["development"]
          : [],
    });
    game.move({
      from: playedMove.slice(0, 2),
      to: playedMove.slice(2, 4),
      promotion: playedMove[4],
    });
    return item;
  });
}

const italian = openingCases(
  "italian",
  [
    "e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6",
    "e1g1", "f8e7", "d2d3", "e8g8", "f1e1", "d7d6",
  ],
  [
    "ruhiger_eröffnungszug", "zentrum_antwort", "gute_entwicklung",
    "gute_entwicklung", "aktive_figur", "gute_entwicklung", "rochade",
    "gute_entwicklung", "ruhiger_eröffnungszug", "rochade",
    "turm_aktivierung", "bauernstruktur",
  ],
);

const queensGambit = openingCases(
  "queens-gambit",
  [
    "d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6",
    "c1g5", "f8e7", "e2e3", "e8g8", "g1f3", "h7h6",
  ],
  [
    "ruhiger_eröffnungszug", "zentrum_antwort", "bauernhebel",
    "bauernstruktur", "gute_entwicklung", "gute_entwicklung",
    "fesselung", "gute_entwicklung", "schlechter_läufer",
    "rochade", "gute_entwicklung", "taktischer_gegenangriff",
  ],
);

const sicilian = openingCases(
  "sicilian",
  [
    "e2e4", "c7c5", "g1f3", "d7d6", "d2d4",
    "c5d4", "f3d4", "g8f6", "b1c3", "a7a6",
  ],
  [
    "ruhiger_eröffnungszug", "bauernhebel", "gute_entwicklung",
    "bauernstruktur", "zentrum", "günstiger_abtausch", "entwicklung_mit_tempo",
    "gute_entwicklung", "gute_entwicklung", "prophylaxe",
  ],
);

const custom = [
  makeCase({
    id: "tactic-mate-threat",
    category: "mattdrohung",
    fen: "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR w KQkq - 0 2",
    playedMove: "f3f4",
    bestMove: "g1h3",
    playedReply: "d8h4",
    bestReply: "d8h4",
    expectedQuality: "blunder",
    expectedExplanationType: "forced",
    requiredFacts: ["allows_checkmate", "Qh4#"],
    expectedAlternative: "g1h3",
    expectedDanger: ["mate"],
    expectedMotifs: ["checkmate"],
    groups: ["einziger_zug_gegen_verlust"],
    bestCp: -20,
    playedCp: -1000,
  }),
  makeCase({
    id: "tactic-hanging-queen",
    category: "einzügiger_einsteller",
    fen: "3q2k1/8/8/8/8/8/3Q4/6K1 w - - 0 1",
    playedMove: "d2d3",
    bestMove: "d2e3",
    playedReply: "d8d3",
    bestReply: "g8f7",
    expectedQuality: "blunder",
    expectedExplanationType: "forced",
    requiredFacts: ["material_outcome", "capturedPiece"],
    expectedAlternative: "d2e3",
    expectedDanger: ["material_capture"],
    bestCp: 0,
    playedCp: -900,
  }),
  makeCase({
    id: "tactic-knight-fork",
    category: "gabel",
    fen: "r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1",
    playedMove: "b5c7",
    bestMove: "b5c7",
    bestReply: "e8d7",
    expectedQuality: "best",
    expectedExplanationType: "mixed",
    requiredFacts: ["fork"],
    expectedMotifs: ["fork"],
  }),
  makeCase({
    id: "tactic-pin",
    category: "fesselung",
    fen: "r1bqkbnr/ppp2ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
    playedMove: "f1b5",
    expectedQuality: "best",
    expectedExplanationType: "mixed",
    requiredFacts: ["pin"],
    expectedMotifs: ["pin"],
  }),
  makeCase({
    id: "tactic-skewer",
    category: "spieß",
    fen: "4q3/4k3/8/8/8/8/8/4R1K1 w - - 0 1",
    playedMove: "e1e2",
    expectedQuality: "best",
    expectedExplanationType: "mixed",
    requiredFacts: ["skewer"],
    expectedMotifs: ["skewer"],
  }),
  makeCase({
    id: "tactic-back-rank",
    category: "grundreihenschwäche",
    fen: "6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1",
    playedMove: "e1e8",
    expectedQuality: "best",
    expectedExplanationType: "mixed",
    requiredFacts: ["back_rank_mate", "gives_checkmate"],
    expectedMotifs: ["back_rank_mate"],
  }),
  makeCase({
    id: "strategy-missed-castle",
    category: "verpasste_rochade",
    fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
    playedMove: "e1f1",
    bestMove: "e1g1",
    expectedQuality: "mistake",
    expectedExplanationType: "forced",
    requiredFacts: ["castles", "castlingRightsLost"],
    expectedAlternative: "e1g1",
    expectedMotifs: [],
    bestCp: 40,
    playedCp: -180,
  }),
  makeCase({
    id: "strategy-prophylaxis",
    category: "prophylaktischer_zug",
    fen: "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2",
    playedMove: "g2g3",
    expectedQuality: "best",
    expectedExplanationType: "opening",
    requiredFacts: ["dangerPreventedByMove"],
    expectedDanger: [],
    expectedMotifs: ["prophylaxis"],
  }),
  makeCase({
    id: "strategy-pawn-break",
    category: "bauernhebel",
    fen: "6k1/8/8/4p3/8/8/5P2/6K1 w - - 0 1",
    playedMove: "f2f4",
    expectedQuality: "best",
    expectedExplanationType: "endgame",
    requiredFacts: ["pawn_break", "e5"],
    expectedMotifs: ["pawn_break"],
  }),
  makeCase({
    id: "strategy-outpost",
    category: "außenposten_und_schwaches_feld",
    fen: "6k1/8/8/8/4P3/2N5/8/6K1 w - - 0 1",
    playedMove: "c3d5",
    expectedQuality: "best",
    expectedExplanationType: "endgame",
    requiredFacts: ["creates_outpost", "d5"],
    expectedMotifs: ["outpost"],
    groups: ["schwaches_feld", "außenposten"],
  }),
  makeCase({
    id: "strategy-open-file-rook",
    category: "turm_auf_offener_linie",
    fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
    playedMove: "a1d1",
    expectedQuality: "best",
    expectedExplanationType: "endgame",
    requiredFacts: ["rook_on_open_file", "d"],
    expectedMotifs: ["rook_on_open_file"],
  }),
  makeCase({
    id: "endgame-king-centralization",
    category: "könig_und_bauern_endspiel",
    fen: "8/8/4k3/8/8/8/4K2P/8 w - - 0 1",
    playedMove: "e2e3",
    expectedQuality: "best",
    expectedExplanationType: "endgame",
    requiredFacts: ["king_centralization"],
    expectedMotifs: ["king_activity"],
  }),
  makeCase({
    id: "endgame-passed-pawn",
    category: "freibauer",
    fen: "7k/8/8/8/2p5/3P4/2P5/7K w - - 0 1",
    playedMove: "d3c4",
    expectedQuality: "best",
    expectedExplanationType: "endgame",
    requiredFacts: ["creates_passed_pawn"],
    expectedMotifs: ["passed_pawn"],
  }),
  makeCase({
    id: "tactic-promotion",
    category: "umwandlungstaktik",
    fen: "7k/P7/8/8/8/8/8/7K w - - 0 1",
    playedMove: "a7a8q",
    expectedQuality: "best",
    expectedExplanationType: "mixed",
    requiredFacts: ["promotion_tactic", "promotes"],
    expectedMotifs: ["promotion_tactic"],
  }),
  makeCase({
    id: "tactic-stalemate-resource",
    category: "pattressource",
    fen: "k7/2Q5/2K5/8/8/8/8/8 w - - 0 1",
    playedMove: "c7b6",
    expectedQuality: "mistake",
    expectedExplanationType: "forced",
    requiredFacts: ["stalemate_resource"],
    expectedMotifs: ["stalemate_resource"],
    bestMove: "c7b7",
    bestCp: 900,
    playedCp: 0,
  }),
  makeCase({
    id: "quiet-no-reliable-motif",
    category: "kein_zuverlässiges_motiv",
    fen: "8/8/8/4k3/8/8/4K3/8 w - - 0 1",
    playedMove: "e2f2",
    expectedQuality: "best",
    expectedExplanationType: "endgame",
    requiredFacts: ["moves_piece"],
    expectedMotifs: [],
  }),
  makeCase({
    id: "opening-early-queen",
    category: "früher_damenzug",
    fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    playedMove: "d1h5",
    bestMove: "g1f3",
    expectedQuality: "inaccuracy",
    expectedExplanationType: "mixed",
    requiredFacts: ["early_queen_move"],
    expectedAlternative: "g1f3",
    expectedMotifs: ["early_queen_move"],
    bestCp: 30,
    playedCp: -40,
  }),
  makeCase({
    id: "opening-poor-development",
    category: "schlechte_entwicklung",
    fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    playedMove: "b1a3",
    bestMove: "g1f3",
    expectedQuality: "inaccuracy",
    expectedExplanationType: "opening",
    requiredFacts: ["develops_piece"],
    expectedAlternative: "g1f3",
    expectedMotifs: ["development"],
    bestCp: 30,
    playedCp: -40,
  }),
  makeCase({
    id: "tactic-zwischenzug",
    category: "zwischenzug",
    fen: "4k3/8/q7/8/8/8/P7/4KB2 w - - 0 1",
    playedMove: "a2a3",
    playedReply: "a6a3",
    bestMove: "a2a3",
    bestReply: "a6a3",
    playedContinuation: ["f1b5"],
    expectedQuality: "best",
    expectedExplanationType: "mixed",
    requiredFacts: ["zwischenzug"],
    expectedMotifs: ["zwischenzug"],
  }),
  makeCase({
    id: "exchange-unfavorable",
    category: "ungünstiger_abtausch",
    fen: "q5k1/b7/8/8/8/8/7K/R7 w - - 0 1",
    playedMove: "a1a7",
    playedReply: "a8a7",
    bestMove: "a1b1",
    bestReply: "g8f7",
    expectedMotifs: ["unfavorable_exchange"],
    expectedQuality: "mistake",
    expectedExplanationType: "forced",
    requiredFacts: ["material_outcome", "forced_capture_sequence"],
    expectedAlternative: "a1b1",
    expectedMotifs: ["forced_capture_sequence"],
    groups: ["mehrzügiger_materialverlust"],
    bestCp: 0,
    playedCp: -300,
  }),
  makeCase({
    id: "endgame-rook",
    category: "turmendspiel",
    fen: "8/8/4k3/8/8/8/R3K3/7r w - - 0 1",
    playedMove: "e2e3",
    expectedQuality: "best",
    expectedExplanationType: "endgame",
    requiredFacts: ["king_centralization"],
    expectedMotifs: ["king_activity"],
  }),
  makeCase({
    id: "forced-only-legal",
    category: "einziger_legaler_zug",
    fen: "k1KQ4/8/8/8/8/8/8/8 b - - 0 1",
    playedMove: "a8a7",
    expectedQuality: "best",
    expectedExplanationType: "forced",
    requiredFacts: ["only_legal_move"],
    expectedAlternative: "",
    expectedMotifs: [],
    legalMoveCount: 1,
  }),
  makeCase({
    id: "equivalent-candidates",
    category: "mehrere_gleichwertige_züge",
    fen: "4k3/8/8/8/8/8/4K3/8 w - - 0 1",
    playedMove: "e2d2",
    expectedQuality: "best",
    expectedExplanationType: "endgame",
    requiredFacts: ["practically_equivalent"],
    expectedMotifs: [],
    bestCp: 5,
    secondCp: 0,
  }),
  makeCase({
    id: "quiet-best-without-tactic",
    category: "bester_zug_ohne_taktik",
    fen: "8/8/4k3/8/8/8/4K2P/8 w - - 0 1",
    playedMove: "h2h3",
    expectedQuality: "best",
    expectedExplanationType: "endgame",
    requiredFacts: ["moves_piece"],
    expectedMotifs: [],
  }),
  makeCase({
    id: "plausible-idea-bad-result",
    category: "schlechter_zug_mit_plausibler_idee",
    fen: "3q2k1/8/8/8/8/8/3Q4/6K1 w - - 0 1",
    playedMove: "d2d3",
    playedReply: "d8d3",
    bestMove: "d2e3",
    bestReply: "g8f7",
    expectedQuality: "blunder",
    expectedExplanationType: "forced",
    requiredFacts: ["material_outcome"],
    expectedAlternative: "d2e3",
    expectedDanger: ["material_capture"],
    bestCp: 0,
    playedCp: -900,
  }),
];

export const COACH_EVALUATION_CASES = Object.freeze([
  ...italian,
  ...queensGambit,
  ...sicilian,
  ...custom,
]);

export const REQUIRED_COACH_EVALUATION_GROUPS = Object.freeze([
  "ruhiger_eröffnungszug",
  "gute_entwicklung",
  "schlechte_entwicklung",
  "früher_damenzug",
  "rochade",
  "verpasste_rochade",
  "einzügiger_einsteller",
  "mehrzügiger_materialverlust",
  "gabel",
  "fesselung",
  "spieß",
  "zwischenzug",
  "mattdrohung",
  "grundreihenschwäche",
  "taktischer_gegenangriff",
  "prophylaktischer_zug",
  "bauernhebel",
  "schwaches_feld",
  "außenposten",
  "schlechter_läufer",
  "turm_auf_offener_linie",
  "günstiger_abtausch",
  "ungünstiger_abtausch",
  "freibauer",
  "könig_und_bauern_endspiel",
  "turmendspiel",
  "einziger_legaler_zug",
  "einziger_zug_gegen_verlust",
  "mehrere_gleichwertige_züge",
  "bester_zug_ohne_taktik",
  "schlechter_zug_mit_plausibler_idee",
  "kein_zuverlässiges_motiv",
]);

if (COACH_EVALUATION_CASES.length < 50) {
  throw new Error(`Coach evaluation needs at least 50 cases, got ${COACH_EVALUATION_CASES.length}.`);
}

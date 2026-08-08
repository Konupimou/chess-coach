import { Chess } from "chess.js";
import { MoveTreeNode, addMoveToTree } from "../moveTree.js";
import { nodePathFromRoot, serializeMoveTree } from "../gameStorage.js";
import { moveTreeToPgn } from "../moveTreeToPgn.js";

/** Converts a provider-neutral game into the existing single-game review input. */
export function normalizedGameToSavedRecord(game, now = new Date()) {
  const parsed = new Chess();
  parsed.loadPgn(game.pgn, { strict: false });
  const headers = parsed.getHeaders();
  const start = headers.SetUp === "1" && headers.FEN ? new Chess(headers.FEN) : new Chess();
  const root = new MoveTreeNode({ fen: start.fen() });
  let node = root;
  for (const move of parsed.history({ verbose: true })) {
    const replayed = start.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (!replayed) throw new Error(`Imported move could not be replayed: ${move.san}`);
    node = addMoveToTree(node, replayed, start.fen());
  }
  const result = game.userColor === "white"
    ? game.result === "win" ? "1-0" : game.result === "loss" ? "0-1" : "1/2-1/2"
    : game.result === "win" ? "0-1" : game.result === "loss" ? "1-0" : "1/2-1/2";
  node.result = result;
  const opponent = game.userColor === "white" ? game.black : game.white;
  const own = game.userColor === "white" ? game.white : game.black;
  const savedAt = new Date(now).toISOString();
  return {
    id: game.id,
    title: `${game.provider === "chesscom" ? "Chess.com" : "Lichess"} gegen ${opponent.username}`,
    createdAt: game.playedAt,
    updatedAt: savedAt,
    manualSavedAt: savedAt,
    result,
    plyCount: parsed.history().length,
    currentFen: node.fen,
    currentPath: nodePathFromRoot(node),
    pgn: moveTreeToPgn(root),
    tree: serializeMoveTree(root),
    review: game.analysis?.review || null,
    metadata: {
      playerColor: game.userColor === "white" ? "w" : "b",
      playedAt: game.playedAt.slice(0, 10),
      whitePlayer: game.white.username,
      blackPlayer: game.black.username,
      opponent: opponent.username,
      opponentType: "",
      engineLevel: "",
      opening: game.opening?.name || "",
      timeFormat: game.timeControl.category === "unknown" ? "training" : game.timeControl.category,
      timeControl: game.timeControl.raw,
      platform: game.provider === "chesscom" ? "Chess.com" : "Lichess",
      event: game.rated ? "Gewertete Online-Partie" : "Ungewertete Online-Partie",
      playerRating: own.rating,
      opponentRating: opponent.rating,
      rated: game.rated,
      notes: `Synchronisiert · ${game.providerUrl}`,
    },
  };
}

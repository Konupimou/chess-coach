import { Chess } from "chess.js";
import {
  nodePathFromRoot,
  serializeMoveTree,
} from "./gameStorage.js";
import { MoveTreeNode, addMoveToTree } from "./moveTree.js";
import { moveTreeToPgn } from "./moveTreeToPgn.js";

const SPEED_TO_FORMAT = Object.freeze({
  ultraBullet: "bullet",
  bullet: "bullet",
  blitz: "blitz",
  rapid: "rapid",
  classical: "classical",
  correspondence: "correspondence",
});

function validDate(value, fallback) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function playerIdentity(player) {
  return String(player?.user?.id || player?.user?.name || "").trim().toLowerCase();
}

function playerDisplayName(player) {
  const title = String(player?.user?.title || "").trim();
  const name = String(player?.user?.name || "").trim();
  if (name) return `${title ? `${title} ` : ""}${name}`.trim();
  if (Number.isInteger(player?.aiLevel)) return `Lichess-Computer Stufe ${player.aiLevel}`;
  return "Lichess-Gast";
}

function gameResult(game) {
  if (game.winner === "white") return "1-0";
  if (game.winner === "black") return "0-1";
  return "1/2-1/2";
}

function timeControl(game) {
  if (
    Number.isInteger(game.clock?.initial)
    && Number.isInteger(game.clock?.increment)
  ) {
    return `${game.clock.initial}+${game.clock.increment}`;
  }
  if (Number.isInteger(game.daysPerTurn)) return `${game.daysPerTurn} Tage/Zug`;
  return "";
}

export function lichessImportability(game, username) {
  if (!game || typeof game !== "object") return "Ungültige Partie";
  if (game.variant !== "standard") return "Nur Standardschach wird unterstützt";
  if (!game.moves?.trim()) return "Partie enthält keine Züge";
  if (["created", "started", "aborted", "noStart"].includes(game.status)) {
    return "Die Partie ist nicht abgeschlossen";
  }
  const identity = String(username || "").trim().toLowerCase();
  const white = playerIdentity(game.players?.white);
  const black = playerIdentity(game.players?.black);
  if (!identity || (identity !== white && identity !== black)) {
    return "Lichess-Spieler konnte nicht zugeordnet werden";
  }
  return "";
}

export function lichessGameToSavedRecord(game, username, now = new Date()) {
  const importError = lichessImportability(game, username);
  if (importError) throw new Error(importError);

  const identity = String(username).trim().toLowerCase();
  const playerColor = playerIdentity(game.players.white) === identity ? "w" : "b";
  const opponent = playerColor === "w" ? game.players.black : game.players.white;
  const playedAtDate = validDate(game.createdAt, now);
  const playedAt = playedAtDate.toISOString().slice(0, 10);
  const rootGame = new Chess();
  if (game.initialFen && game.initialFen !== "startpos") {
    rootGame.load(game.initialFen);
  }
  const root = new MoveTreeNode({ fen: rootGame.fen() });
  let node = root;
  const sanMoves = game.moves.trim().split(/\s+/).slice(0, 600);
  for (const san of sanMoves) {
    let move;
    try {
      move = rootGame.move(san);
    } catch {
      move = null;
    }
    if (!move) throw new Error(`Der Lichess-Zug „${san}“ konnte nicht gelesen werden.`);
    node = addMoveToTree(node, move, rootGame.fen());
  }
  if (node === root) throw new Error("Partie enthält keine lesbaren Züge.");

  const result = gameResult(game);
  node.result = result;
  const opponentName = playerDisplayName(opponent);
  const createdAt = playedAtDate.toISOString();
  const savedAt = validDate(now, new Date()).toISOString();
  const format = SPEED_TO_FORMAT[game.speed] || SPEED_TO_FORMAT[game.perf] || "training";
  const opening = String(game.opening?.name || "").trim().slice(0, 100);
  const displayDate = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" })
    .format(playedAtDate);

  return {
    id: `lichess:${game.id}`,
    title: `Lichess gegen ${opponentName} · ${displayDate}`,
    createdAt,
    updatedAt: savedAt,
    manualSavedAt: savedAt,
    result,
    plyCount: sanMoves.length,
    currentFen: node.fen,
    currentPath: nodePathFromRoot(node),
    pgn: moveTreeToPgn(root),
    tree: serializeMoveTree(root),
    review: null,
    metadata: {
      playerColor,
      playedAt,
      opponent: opponentName,
      opponentType: "",
      engineLevel: "",
      opening,
      timeFormat: format,
      timeControl: timeControl(game),
      platform: "Lichess",
      event: `${game.rated ? "Gewertete" : "Ungewertete"} Lichess-Partie`,
      playerRating: playerColor === "w"
        ? game.players.white?.rating
        : game.players.black?.rating,
      opponentRating: opponent?.rating,
      rated: game.rated === true,
      notes: `Importiert von Lichess · https://lichess.org/${game.id}`,
    },
  };
}

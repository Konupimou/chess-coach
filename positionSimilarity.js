import { Chess } from "chess.js";
import {
  buildPositionConceptFingerprint,
  compactConceptFingerprint,
  compareConceptFingerprints,
  expandConceptFingerprint,
} from "./positionConcepts.js";

const FILES = "abcdefgh";
const PIECE_VALUE = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 });
const PROFILE_VERSION = 2;

function cleanOpeningFamily(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

function gameFromFen(fen) {
  if (typeof fen !== "string") return null;
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 4) return null;
  try {
    return new Chess(`${fields.slice(0, 4).join(" ")} 0 1`);
  } catch {
    return null;
  }
}

function squareAt(rowIndex, fileIndex) {
  return `${FILES[fileIndex]}${8 - rowIndex}`;
}

function kingZone(square) {
  const file = FILES.indexOf(square?.[0] || "");
  if (file <= 2) return "q";
  if (file >= 5) return "k";
  return "c";
}

function countDistance(left, right) {
  const a = String(left || "").split("").map(Number);
  const b = String(right || "").split("").map(Number);
  if (a.length !== b.length || a.some(Number.isNaN) || b.some(Number.isNaN)) return 99;
  return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0);
}

function openingOverlap(left, right) {
  const rightSet = new Set(right || []);
  return (left || []).some((family) => rightSet.has(family));
}

export function positionSimilarityProfile(fen, { openingFamily = "" } = {}) {
  const game = gameFromFen(fen);
  if (!game) return null;
  const counts = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
  const pawns = { w: [], b: [] };
  const pawnFiles = { w: Array(8).fill(0), b: Array(8).fill(0) };
  const kings = { w: "", b: "" };
  const homeMinors = {
    w: new Set(["b1", "g1", "c1", "f1"]),
    b: new Set(["b8", "g8", "c8", "f8"]),
  };
  const developed = { w: 0, b: 0 };
  let nonPawnMaterial = 0;

  game.board().forEach((row, rowIndex) => {
    row.forEach((piece, fileIndex) => {
      if (!piece) return;
      const square = squareAt(rowIndex, fileIndex);
      if (piece.type === "k") {
        kings[piece.color] = square;
        return;
      }
      counts[piece.color][piece.type] += 1;
      if (piece.type === "p") {
        pawns[piece.color].push(square);
        pawnFiles[piece.color][fileIndex] += 1;
      } else {
        nonPawnMaterial += PIECE_VALUE[piece.type] || 0;
        if (["n", "b"].includes(piece.type) && !homeMinors[piece.color].has(square)) {
          developed[piece.color] += 1;
        }
      }
    });
  });

  const phase = nonPawnMaterial >= 48
    ? "o"
    : nonPawnMaterial >= 20
      ? "m"
      : "e";
  const castling = game.fen().split(/\s+/)[2] || "-";
  const opening = cleanOpeningFamily(openingFamily);
  return {
    version: PROFILE_VERSION,
    turn: game.turn(),
    phase,
    pawnExact: `${pawns.w.sort().join("")}|${pawns.b.sort().join("")}`,
    pawnFiles: `${pawnFiles.w.join("")}|${pawnFiles.b.join("")}`,
    material: ["w", "b"].map((color) => (
      ["p", "n", "b", "r", "q"].map((piece) => counts[color][piece]).join("")
    )).join("|"),
    king: `${kingZone(kings.w)}${castling.includes("K") || castling.includes("Q") ? "u" : "m"}|${kingZone(kings.b)}${castling.includes("k") || castling.includes("q") ? "u" : "m"}`,
    development: `${developed.w}${developed.b}`,
    openingFamilies: opening ? [opening] : [],
    concepts: buildPositionConceptFingerprint(fen),
  };
}

export function addOpeningFamilyToProfile(profile, openingFamily) {
  if (!profile) return profile;
  const family = cleanOpeningFamily(openingFamily);
  if (family && !profile.openingFamilies.includes(family)) {
    profile.openingFamilies.push(family);
    profile.openingFamilies.sort((left, right) => left.localeCompare(right, "en"));
  }
  return profile;
}

export function compactPositionSimilarityProfile(profile) {
  if (!profile) return null;
  return [
    profile.turn,
    profile.phase,
    profile.pawnExact,
    profile.pawnFiles,
    profile.material,
    profile.king,
    profile.development,
    profile.openingFamilies || [],
    compactConceptFingerprint(profile.concepts),
  ];
}

export function expandPositionSimilarityProfile(value) {
  if (!Array.isArray(value) || value.length < 7) return value || null;
  const concepts = expandConceptFingerprint(value[8]);
  if (concepts) {
    const conceptPhase = ({ o: "opening", m: "middlegame", e: "endgame" })[value[1]] || value[1];
    concepts.phase = conceptPhase;
    concepts.structuralKey = `${conceptPhase}|${concepts.pawnKey}|${concepts.materialKey}`;
  }
  return {
    version: PROFILE_VERSION,
    turn: value[0],
    phase: value[1],
    pawnExact: value[2],
    pawnFiles: value[3],
    material: value[4],
    king: value[5],
    development: value[6],
    openingFamilies: Array.isArray(value[7]) ? value[7] : [],
    concepts,
  };
}

export function comparePositionSimilarity(queryValue, candidateValue) {
  const query = expandPositionSimilarityProfile(queryValue);
  const candidate = expandPositionSimilarityProfile(candidateValue);
  if (!query || !candidate) return null;

  const sameTurn = query.turn === candidate.turn;
  let score = sameTurn ? 10 : 4;
  const shared = [sameTurn ? "same_turn" : "normalized_side_to_move"];
  const sameOpening = openingOverlap(query.openingFamilies, candidate.openingFamilies);
  if (sameOpening) {
    score += 28;
    shared.push("opening");
  }
  if (query.phase === candidate.phase) {
    score += 12;
    shared.push("phase");
  }
  if (sameTurn && query.pawnExact === candidate.pawnExact) {
    score += 40;
    shared.push("pawn_structure");
  } else if (query.pawnFiles === candidate.pawnFiles) {
    score += 25;
    shared.push("pawn_files");
  } else if (countDistance(query.pawnFiles, candidate.pawnFiles) <= 2) {
    score += 14;
    shared.push("similar_pawn_files");
  }
  if (sameTurn && query.material === candidate.material) {
    score += 18;
    shared.push("material");
  } else if (countDistance(query.material, candidate.material) <= 2) {
    score += 9;
    shared.push("similar_material");
  }
  if (sameTurn && query.king === candidate.king) {
    score += 8;
    shared.push("king_setup");
  }
  if (sameTurn && query.development === candidate.development) {
    score += 5;
    shared.push("development");
  }

  const conceptMatch = compareConceptFingerprints(query.concepts, candidate.concepts);
  if (conceptMatch) {
    score = Math.max(score, conceptMatch.score);
    score += Math.min(20, conceptMatch.transferableConcepts.length * 5);
    shared.push(...conceptMatch.shared);
  }

  const matchType = conceptMatch?.matchType === "concept_structure"
    ? "concept_structure"
    : conceptMatch?.matchType === "concept_transfer"
      ? "concept_transfer"
      : sameOpening && shared.includes("pawn_structure")
    ? "opening_structure"
    : shared.includes("pawn_structure")
      ? "pawn_structure"
      : sameOpening
        ? "opening_pattern"
        : "position_pattern";
  return {
    score: Math.min(100, score),
    matchType,
    shared: [...new Set(shared)],
    conceptTransfer: conceptMatch
      ? {
        differences: conceptMatch.differences,
        transferableConcepts: conceptMatch.transferableConcepts,
        tacticalMismatch: conceptMatch.tacticalMismatch,
      }
      : null,
  };
}

export function positionSimilarityLabel(matchType) {
  return ({
    exact: "Exakte Stellung",
    concept_structure: "Gleicher konzeptueller Stellungsaufbau",
    concept_transfer: "Übertragbares Stellungskonzept",
    opening_structure: "Gleiche Eröffnung und Bauernstruktur",
    pawn_structure: "Gleiche Bauernstruktur",
    opening_pattern: "Gleiches Eröffnungsmuster",
    position_pattern: "Ähnliches Stellungsmuster",
  })[matchType] || "Ähnliches Stellungsmuster";
}

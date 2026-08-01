import { MOVE_QUALITY } from "./gameReview.js";

export const ENGINE_LEVELS = Object.freeze({
  easy: Object.freeze({
    label: "Einfach",
    depth: 7,
    elo: 1320,
    description: "ruhiges Einstiegsniveau",
  }),
  medium: Object.freeze({
    label: "Mittel",
    depth: 10,
    elo: 1700,
    description: "solides Vereinsniveau",
  }),
  hard: Object.freeze({
    label: "Schwer",
    depth: 14,
    elo: 2200,
    description: "starkes Turnierniveau",
  }),
  expert: Object.freeze({
    label: "Experte",
    depth: 18,
    elo: 2800,
    description: "sehr hohe Spielstärke",
  }),
});

export function normalizeEngineLevel(value) {
  return Object.hasOwn(ENGINE_LEVELS, value) ? value : "medium";
}

export function resolvePlayerColor(preference, random = Math.random) {
  if (preference === "w" || preference === "b") return preference;
  const value = Number(random());
  return Number.isFinite(value) && value >= 0.5 ? "b" : "w";
}

export function engineOpponentLabel(level) {
  const normalized = normalizeEngineLevel(level);
  return `Stockfish · ${ENGINE_LEVELS[normalized].label}`;
}

export function nextStrongMoveStreak(current, quality) {
  const streak = Number.isInteger(current) && current > 0 ? current : 0;
  return quality === "best" || quality === "excellent"
    ? Math.min(99, streak + 1)
    : 0;
}

export function describeLiveMove(move) {
  if (!move || typeof move !== "object") return null;
  const quality = Object.hasOwn(MOVE_QUALITY, move.quality) ? move.quality : "good";
  const definition = MOVE_QUALITY[quality];
  const moveNumber = Number.isFinite(move.moveNumber) ? Math.max(1, move.moveNumber) : null;
  const prefix = moveNumber
    ? `${moveNumber}${move.color === "b" ? "…" : "."} ${move.san || "dein Zug"}`
    : move.san || "Dein Zug";
  let message;
  if (quality === "best") {
    message = "Das war der beste Zug.";
  } else if (quality === "excellent") {
    message = "Das war ein starker Zug.";
  } else if (quality === "good") {
    message = "Der Zug passt.";
  } else if (quality === "inaccuracy") {
    message = "Etwas ungenau. Da war ein besserer Zug.";
  } else if (quality === "mistake") {
    message = "Das ist ein klarer Fehler. Deine Stellung wird deutlich schlechter.";
  } else {
    message = "Das ist ein grober Fehler. Deine Stellung wird viel schlechter.";
  }

  return {
    tone: definition.tone,
    badge: definition.label,
    title: prefix,
    detail: message,
  };
}

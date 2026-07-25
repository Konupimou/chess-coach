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

function formattedAccuracy(value) {
  return Number.isFinite(value)
    ? `${value.toFixed(1).replace(".", ",")} % Genauigkeit`
    : "";
}

export function describeLiveMove(move) {
  if (!move || typeof move !== "object") return null;
  const quality = Object.hasOwn(MOVE_QUALITY, move.quality) ? move.quality : "good";
  const definition = MOVE_QUALITY[quality];
  const moveNumber = Number.isFinite(move.moveNumber) ? Math.max(1, move.moveNumber) : null;
  const prefix = moveNumber
    ? `${moveNumber}${move.color === "b" ? "…" : "."} ${move.san || "dein Zug"}`
    : move.san || "Dein Zug";
  const accuracy = formattedAccuracy(move.accuracy);
  const alternative = typeof move.bestSan === "string"
    && move.bestSan
    && move.bestSan !== move.san
      ? move.bestSan
      : "";

  let message;
  if (quality === "best") {
    message = "Du hast die stärkste Fortsetzung gefunden.";
  } else if (quality === "excellent") {
    message = "Sehr präzise – die Stellung bleibt voll unter Kontrolle.";
  } else if (quality === "good") {
    message = "Ein solider Zug, der deine Stellung zusammenhält.";
  } else if (quality === "inaccuracy") {
    message = alternative
      ? `Etwas genauer war ${alternative}.`
      : "Eine kleine Ungenauigkeit, aber die Partie bleibt gut spielbar.";
  } else if (quality === "mistake") {
    message = alternative
      ? `Das gibt etwas Vorteil ab. Besser war ${alternative}.`
      : "Der Zug gibt spürbar Vorteil ab.";
  } else {
    message = alternative
      ? `Das war ein kritischer Fehler. Deutlich besser war ${alternative}.`
      : "Das war ein kritischer Fehler – prüfe unmittelbare Drohungen.";
  }

  return {
    tone: definition.tone,
    badge: definition.label,
    title: prefix,
    detail: [message, accuracy].filter(Boolean).join(" · "),
  };
}

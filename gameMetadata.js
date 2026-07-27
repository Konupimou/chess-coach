import { detectOpeningFromPath } from "./openingRecognition.js";

export const TIME_FORMAT_LABELS = Object.freeze({
  bullet: "Bullet",
  blitz: "Blitz",
  rapid: "Rapid",
  classical: "Klassisch",
  correspondence: "Korrespondenz",
  training: "Training / ohne Uhr",
});

export const RESULT_LABELS = Object.freeze({
  "1-0": "1–0",
  "0-1": "0–1",
  "1/2-1/2": "Remis",
  "*": "Noch nicht beendet",
});

function dateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return dateInputValue(new Date());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createGameSaveDraft(record = null, now = new Date()) {
  const metadata = record?.metadata || {};
  return {
    title: typeof record?.title === "string" ? record.title : "",
    result: Object.hasOwn(RESULT_LABELS, record?.result) ? record.result : "*",
    playerColor: metadata.playerColor === "w" || metadata.playerColor === "b"
      ? metadata.playerColor
      : "",
    playedAt: /^\d{4}-\d{2}-\d{2}$/.test(metadata.playedAt)
      ? metadata.playedAt
      : dateInputValue(now),
    whitePlayer: typeof metadata.whitePlayer === "string" ? metadata.whitePlayer : "",
    blackPlayer: typeof metadata.blackPlayer === "string" ? metadata.blackPlayer : "",
    opponent: typeof metadata.opponent === "string" ? metadata.opponent : "",
    opponentType: metadata.opponentType === "engine" ? "engine" : "",
    engineLevel: ["easy", "medium", "hard", "expert"].includes(metadata.engineLevel)
      ? metadata.engineLevel
      : "",
    opening: typeof metadata.opening === "string" ? metadata.opening : "",
    timeFormat: Object.hasOwn(TIME_FORMAT_LABELS, metadata.timeFormat)
      ? metadata.timeFormat
      : "",
    timeControl: typeof metadata.timeControl === "string" ? metadata.timeControl : "",
    platform: typeof metadata.platform === "string" ? metadata.platform : "",
    event: typeof metadata.event === "string" ? metadata.event : "",
    playerRating: Number.isInteger(metadata.playerRating) ? String(metadata.playerRating) : "",
    opponentRating: Number.isInteger(metadata.opponentRating) ? String(metadata.opponentRating) : "",
    rated: metadata.rated === true ? "yes" : metadata.rated === false ? "no" : "",
    notes: typeof metadata.notes === "string" ? metadata.notes : "",
  };
}

export function inferOpeningFromPath(path, openingBook) {
  return detectOpeningFromPath(path, openingBook).displayName || "";
}

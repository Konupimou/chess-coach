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
    opponent: typeof metadata.opponent === "string" ? metadata.opponent : "",
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

function normalizedSanMoves(path) {
  return (Array.isArray(path) ? path : [])
    .slice(1, 9)
    .map((node) => node?.move?.san)
    .filter((san) => typeof san === "string")
    .map((san) => san.replace(/[+#?!]/g, ""));
}

export function inferOpeningFromPath(path) {
  const moves = normalizedSanMoves(path);
  const begins = (...sequence) => sequence.every((move, index) => moves[index] === move);

  if (begins("e4", "e5", "Nf3", "Nc6", "Bb5")) return "Spanische Partie";
  if (begins("e4", "e5", "Nf3", "Nc6", "Bc4")) return "Italienische Partie";
  if (begins("e4", "e5", "Nf3", "Nc6", "d4")) return "Schottische Partie";
  if (begins("e4", "e5", "f4")) return "Königsgambit";
  if (begins("e4", "c5")) return "Sizilianische Verteidigung";
  if (begins("e4", "e6")) return "Französische Verteidigung";
  if (begins("e4", "c6")) return "Caro-Kann-Verteidigung";
  if (begins("e4", "d5")) return "Skandinavische Verteidigung";
  if (begins("e4", "d6")) return "Pirc-Verteidigung";
  if (begins("e4", "g6")) return "Moderne Verteidigung";
  if (begins("e4", "Nf6")) return "Aljechin-Verteidigung";
  if (begins("d4", "Nf6", "c4", "e6", "Nc3", "Bb4")) return "Nimzo-Indische Verteidigung";
  if (begins("d4", "Nf6", "c4", "g6")) return "Königsindische Verteidigung";
  if (begins("d4", "Nf6", "c4", "e6", "Nf3", "b6")) return "Damenindische Verteidigung";
  if (begins("d4", "d5", "c4")) return "Damengambit";
  if (begins("d4", "d5", "Nf3", "Nf6", "Bf4")) return "London-System";
  if (begins("d4", "f5")) return "Holländische Verteidigung";
  if (begins("c4")) return "Englische Eröffnung";
  if (begins("Nf3")) return "Réti-Eröffnung";
  if (begins("f4")) return "Bird-Eröffnung";
  if (begins("d4", "Nf6")) return "Indische Verteidigung";
  if (begins("d4", "d5")) return "Geschlossenes Spiel";
  if (begins("e4", "e5")) return "Offenes Spiel";
  if (begins("e4")) return "Königsbauernspiel";
  if (begins("d4")) return "Damenbauernspiel";
  return "";
}

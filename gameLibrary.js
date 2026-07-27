import { RESULT_LABELS } from "./gameMetadata.js";

function cleanText(value, maximum = 120) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function dateLabel(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "Datum offen";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Datum offen";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(date);
}

export function gameLibraryModel({
  draft = {},
  profile = {},
  session = null,
  opening = "",
  result = "*",
} = {}) {
  const ownName = cleanText(profile?.name, 80) || "Du";
  const playerColor = session?.playerColor || draft?.playerColor;
  const opponent = cleanText(
    session?.opponent || draft?.opponent,
    80,
  );
  let white = cleanText(draft?.whitePlayer, 80);
  let black = cleanText(draft?.blackPlayer, 80);

  if (!white) {
    if (playerColor === "w") white = ownName;
    else if (playerColor === "b" && opponent) white = opponent;
  }
  if (!black) {
    if (playerColor === "b") black = ownName;
    else if (playerColor === "w" && opponent) black = opponent;
  }

  const liveResult = Object.hasOwn(RESULT_LABELS, result) ? result : "*";
  const draftResult = Object.hasOwn(RESULT_LABELS, draft?.result)
    ? draft.result
    : "*";
  const normalizedResult = liveResult !== "*" ? liveResult : draftResult;
  return {
    white: white || "Weiß",
    black: black || "Schwarz",
    date: dateLabel(draft?.playedAt),
    result: normalizedResult === "*"
      ? "Partie läuft"
      : RESULT_LABELS[normalizedResult],
    opening: cleanText(opening, 240)
      || cleanText(draft?.opening, 240)
      || "Noch nicht erkannt",
  };
}

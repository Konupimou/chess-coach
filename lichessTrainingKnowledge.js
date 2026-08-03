import trainingDocument from "./data/knowledge/lichess-puzzles-800.json" with { type: "json" };

export const LICHESS_TRAINING_SCHEMA = "chess-coach.lichess-puzzles.v1";
export const LICHESS_TRAINING_LICENSE = "CC0-1.0";
export const LICHESS_TRAINING_SOURCE_URL =
  "https://database.lichess.org/lichess_db_puzzle.csv.zst";

const ENTRY_KEYS = Object.freeze([
  "id",
  "rating",
  "solution",
  "theme",
  "themes",
  "trainingFen",
]);
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const ID_PATTERN = /^[a-f0-9]{16}$/;

const THEME_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "pawnEndgame",
    label: "Bauernendspiele",
    patterns: [
      /\b(?:bauernendspiele?|pawn endgames?|opposition|bauernrennen|pawn race|quadratregel|freibauer|bauernmehrheit)\b/,
    ],
  }),
  Object.freeze({
    id: "rookEndgame",
    label: "Turmendspiele",
    patterns: [/\b(?:turmendspiele?|rook endgames?|lucena|philidor)\b/],
  }),
  Object.freeze({
    id: "bishopEndgame",
    label: "Läuferendspiele",
    patterns: [/\b(?:lauferendspiele?|bishop endgames?|ungleichfarbige laufer)\b/],
  }),
  Object.freeze({
    id: "knightEndgame",
    label: "Springerendspiele",
    patterns: [/\b(?:springerendspiele?|knight endgames?)\b/],
  }),
  Object.freeze({
    id: "deflection",
    label: "Ablenkung",
    patterns: [/\b(?:ablenkung|ablenken|deflection|decoy)\b/],
  }),
  Object.freeze({
    id: "capturingDefender",
    label: "Verteidiger beseitigen",
    patterns: [
      /\b(?:verteidiger beseitigen|verteidiger entfernen|verteidiger schlagen|capturing defender|remove defender|removing the defender|uberlasteter verteidiger|uberlastung)\b/,
    ],
  }),
  Object.freeze({
    id: "backRankMate",
    label: "Grundreihe",
    patterns: [/\b(?:grundreihe|grundreihen\w*|back rank)\b/],
  }),
  Object.freeze({
    id: "defensiveMove",
    label: "Verteidigungsressourcen",
    patterns: [
      /\b(?:verteidigungsressource|defensivzug|defensive move|prophylaxe|prophylaxis|gegenplan|gegnerischer plan|gegnerische plane|schlechte stellung|counterplay)\b/,
    ],
  }),
  Object.freeze({
    id: "equality",
    label: "Ausgleich und Rettung",
    patterns: [/\b(?:ausgleich|remis|rettung|gleichgewicht|equality|drawing resource)\b/],
  }),
  Object.freeze({
    id: "sacrifice",
    label: "Opfer",
    patterns: [/\b(?:opfer|qualitatsopfer|sacrifice|exchange sacrifice)\b/],
  }),
]);

export const LICHESS_TRAINING_THEME_IDS = Object.freeze(
  THEME_DEFINITIONS.map((theme) => theme.id),
);

const THEME_ID_SET = new Set(LICHESS_TRAINING_THEME_IDS);
const THEME_BY_ID = new Map(THEME_DEFINITIONS.map((theme) => [theme.id, theme]));

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integerInRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function validFenShape(value) {
  if (typeof value !== "string") return false;
  const fields = value.trim().split(/\s+/);
  return (
    fields.length === 6
    && fields[0].split("/").length === 8
    && ["w", "b"].includes(fields[1])
    && /^(?:-|[KQkq]+)$/.test(fields[2])
    && /^(?:-|[a-h][36])$/.test(fields[3])
  );
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  return [...new Set(left)].sort().join("|") === [...right].sort().join("|");
}

/**
 * Validates the checked-in runtime artifact, not the upstream CSV. The runtime
 * deliberately keeps solutions only for future exercise delivery; this module
 * never exposes them to the coach prompt.
 */
export function validateLichessTrainingDocument(document) {
  const errors = [];
  const addError = (message) => {
    if (errors.length < 80) errors.push(message);
  };

  if (!isRecord(document)) {
    return { valid: false, errors: ["Das Lichess-Trainingsdokument muss ein Objekt sein."] };
  }
  if (document.schema !== LICHESS_TRAINING_SCHEMA) {
    addError(`Unbekanntes Trainingsschema: ${String(document.schema || "fehlt")}.`);
  }
  if (document.license !== LICHESS_TRAINING_LICENSE) {
    addError("Der Trainingsdatensatz muss ausdrücklich CC0-1.0 sein.");
  }
  if (document.sourceUrl !== LICHESS_TRAINING_SOURCE_URL) {
    addError("sourceUrl muss exakt auf die freigegebene Lichess-Puzzledatei zeigen.");
  }

  const filters = isRecord(document.filters) ? document.filters : null;
  if (!filters) {
    addError("filters fehlt.");
  } else {
    if (!integerInRange(filters.minRating, 0, 4000)) addError("filters.minRating ist ungültig.");
    if (!integerInRange(filters.maxRating, 0, 4000)) addError("filters.maxRating ist ungültig.");
    if (
      Number.isInteger(filters.minRating)
      && Number.isInteger(filters.maxRating)
      && filters.minRating > filters.maxRating
    ) {
      addError("filters.minRating darf nicht über filters.maxRating liegen.");
    }
    if (!sameStringSet(filters.themes, LICHESS_TRAINING_THEME_IDS)) {
      addError("filters.themes entspricht nicht der erlaubten Themenliste.");
    }
  }

  const entries = Array.isArray(document.entries) ? document.entries : [];
  if (entries.length === 0) addError("entries muss mindestens eine Übung enthalten.");
  const ids = new Set();
  const primaryCounts = Object.fromEntries(
    LICHESS_TRAINING_THEME_IDS.map((theme) => [theme, 0]),
  );
  entries.forEach((entry, index) => {
    const path = `entries[${index}]`;
    if (!isRecord(entry)) {
      addError(`${path} muss ein Objekt sein.`);
      return;
    }
    if (Object.keys(entry).sort().join("|") !== [...ENTRY_KEYS].sort().join("|")) {
      addError(`${path} enthält unerlaubte oder fehlende Felder.`);
    }
    if (!ID_PATTERN.test(entry.id || "")) addError(`${path}.id ist ungültig.`);
    if (ids.has(entry.id)) addError(`${path}.id ist doppelt.`);
    ids.add(entry.id);
    if (!THEME_ID_SET.has(entry.theme)) addError(`${path}.theme ist nicht erlaubt.`);
    else primaryCounts[entry.theme] += 1;
    if (
      !Array.isArray(entry.themes)
      || entry.themes.length === 0
      || !entry.themes.includes(entry.theme)
      || entry.themes.some((theme) => !THEME_ID_SET.has(theme))
    ) {
      addError(`${path}.themes ist ungültig.`);
    }
    if (
      !integerInRange(entry.rating, 0, 4000)
      || (Number.isInteger(filters?.minRating) && entry.rating < filters.minRating)
      || (Number.isInteger(filters?.maxRating) && entry.rating > filters.maxRating)
    ) {
      addError(`${path}.rating liegt außerhalb des freigegebenen Bereichs.`);
    }
    if (!validFenShape(entry.trainingFen)) addError(`${path}.trainingFen ist ungültig.`);
    if (
      !Array.isArray(entry.solution)
      || entry.solution.length === 0
      || entry.solution.length > 30
      || entry.solution.some((move) => !UCI_PATTERN.test(move))
    ) {
      addError(`${path}.solution ist ungültig.`);
    }
  });

  const counts = isRecord(document.counts) ? document.counts : null;
  if (!counts || counts.accepted !== entries.length) {
    addError("counts.accepted stimmt nicht mit entries überein.");
  }
  for (const theme of LICHESS_TRAINING_THEME_IDS) {
    if (counts?.byTheme?.[theme] !== primaryCounts[theme]) {
      addError(`counts.byTheme.${theme} stimmt nicht mit entries überein.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

const documentValidation = validateLichessTrainingDocument(trainingDocument);
if (!documentValidation.valid) {
  throw new Error(
    `Ungültiger Lichess-Trainingsdatensatz:\n${documentValidation.errors.join("\n")}`,
  );
}

function buildDatasetSummary(document) {
  const themes = Object.fromEntries(LICHESS_TRAINING_THEME_IDS.map((themeId) => {
    const entries = document.entries.filter((entry) => entry.theme === themeId);
    return [themeId, Object.freeze({
      id: themeId,
      label: THEME_BY_ID.get(themeId).label,
      count: entries.length,
      minRating: Math.min(...entries.map((entry) => entry.rating)),
      maxRating: Math.max(...entries.map((entry) => entry.rating)),
    })];
  }));
  return Object.freeze({
    schema: document.schema,
    license: document.license,
    count: document.entries.length,
    minRating: Math.min(...document.entries.map((entry) => entry.rating)),
    maxRating: Math.max(...document.entries.map((entry) => entry.rating)),
    themes: Object.freeze(themes),
  });
}

export const LICHESS_TRAINING_DATASET = buildDatasetSummary(trainingDocument);

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de-DE")
    .replace(/[._/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function knowledgeContextText(knowledgeContext) {
  const concepts = Array.isArray(knowledgeContext?.concepts)
    ? knowledgeContext.concepts
    : [];
  return concepts.flatMap((concept) => [
    concept?.id,
    concept?.name,
    ...(Array.isArray(concept?.matchedKeywords) ? concept.matchedKeywords : []),
    ...(Array.isArray(concept?.matchedSignals) ? concept.matchedSignals : []),
  ]).filter(Boolean).join(" ");
}

export function relevantLichessTrainingThemes({ message = "", knowledgeContext = null } = {}) {
  const text = normalizeSearchText(`${message} ${knowledgeContextText(knowledgeContext)}`);
  if (!text) return [];
  const selected = new Set();
  if (/\b(?:endspiel|endspiele|endgame|endgames)\b/.test(text)) {
    ["pawnEndgame", "rookEndgame", "bishopEndgame", "knightEndgame"]
      .forEach((theme) => selected.add(theme));
  }
  if (/\b(?:leichtfigurenendspiel|minor piece endgame)\b/.test(text)) {
    selected.add("bishopEndgame");
    selected.add("knightEndgame");
  }
  for (const theme of THEME_DEFINITIONS) {
    if (theme.patterns.some((pattern) => pattern.test(text))) selected.add(theme.id);
  }
  return LICHESS_TRAINING_THEME_IDS.filter((theme) => selected.has(theme));
}

function formatNumber(value) {
  return Number(value).toLocaleString("de-DE");
}

/** Returns aggregates only. No FEN, puzzle id, move or solution can leave here. */
export function lichessTrainingKnowledgeForCoach(input = {}) {
  const themeIds = relevantLichessTrainingThemes(input);
  if (themeIds.length === 0) {
    return Object.freeze({
      used: false,
      detail: `Für diese Antwort nicht genutzt (${formatNumber(LICHESS_TRAINING_DATASET.count)} Übungen verfügbar)`,
      themes: Object.freeze([]),
      count: 0,
      ratingRange: null,
    });
  }
  const themes = themeIds.map((themeId) => LICHESS_TRAINING_DATASET.themes[themeId]);
  const count = themes.reduce((sum, theme) => sum + theme.count, 0);
  const minRating = Math.min(...themes.map((theme) => theme.minRating));
  const maxRating = Math.max(...themes.map((theme) => theme.maxRating));
  const compactThemes = Object.freeze(themes.map((theme) => Object.freeze({
    id: theme.id,
    label: theme.label,
    count: theme.count,
  })));
  return Object.freeze({
    used: true,
    detail: `${formatNumber(count)} Übungen · ${themes.map((theme) => theme.label).join(", ")} · ${formatNumber(minRating)}–${formatNumber(maxRating)} Elo`,
    themes: compactThemes,
    count,
    ratingRange: Object.freeze({ min: minRating, max: maxRating }),
  });
}

export function lichessTrainingPromptData(selection) {
  if (!selection?.used) return null;
  return Object.freeze({
    themes: selection.themes,
    count: selection.count,
    ratingRange: selection.ratingRange,
  });
}

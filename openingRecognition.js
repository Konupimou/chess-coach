import { Chess } from "chess.js";

export const OPENING_SOURCE = "lichess-chess-openings";
export const OPENING_DATA_URL = "/data/openings/openings.runtime.json";

const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const EMPTY_RESULT = Object.freeze({
  matched: false,
  eco: null,
  sourceName: null,
  displayName: null,
  family: null,
  variation: null,
  subvariation: null,
  matchedPly: null,
  lastNamedOpeningPly: null,
  currentPly: 0,
  matchedUci: [],
  matchedEpd: null,
  inKnownSequence: false,
  sequenceExitPly: null,
  sequenceExitMove: null,
  confidence: "unknown",
  matchedBy: "unknown",
  source: OPENING_SOURCE,
});

const FAMILY_TRANSLATIONS = Object.freeze({
  "Alekhine's Defense": "Aljechin-Verteidigung",
  "Benoni Defense": "Benoni-Verteidigung",
  "Bird Opening": "Bird-Eröffnung",
  "Bishop's Opening": "Läufereröffnung",
  "Caro-Kann Defense": "Caro-Kann-Verteidigung",
  "Catalan Opening": "Katalanische Eröffnung",
  "Colle System": "Colle-System",
  "Dutch Defense": "Holländische Verteidigung",
  "English Opening": "Englische Eröffnung",
  "French Defense": "Französische Verteidigung",
  "Four Knights Game": "Vierspringerspiel",
  "Grünfeld Defense": "Grünfeld-Verteidigung",
  "Indian Game": "Indische Verteidigung",
  "Italian Game": "Italienische Partie",
  "King's Gambit": "Königsgambit",
  "King's Indian Attack": "Königsindischer Angriff",
  "King's Indian Defense": "Königsindische Verteidigung",
  "King's Pawn Game": "Königbauernspiel",
  "London System": "Londoner System",
  "Modern Defense": "Moderne Verteidigung",
  "Nimzo-Indian Defense": "Nimzo-Indische Verteidigung",
  "Petrov's Defense": "Russische Verteidigung",
  "Philidor Defense": "Philidor-Verteidigung",
  "Pirc Defense": "Pirc-Verteidigung",
  "Queen's Gambit": "Damengambit",
  "Queen's Gambit Accepted": "Angenommenes Damengambit",
  "Queen's Gambit Declined": "Abgelehntes Damengambit",
  "Queen's Indian Defense": "Damenindische Verteidigung",
  "Queen's Pawn Game": "Damenbauernspiel",
  "Réti Opening": "Réti-Eröffnung",
  "Ruy Lopez": "Spanische Partie",
  "Scandinavian Defense": "Skandinavische Verteidigung",
  "Scotch Game": "Schottische Partie",
  "Semi-Slav Defense": "Halbslawische Verteidigung",
  "Sicilian Defense": "Sizilianische Verteidigung",
  "Slav Defense": "Slawische Verteidigung",
  "Tarrasch Defense": "Tarrasch-Verteidigung",
  "Trompowsky Attack": "Trompowsky-Angriff",
  "Vienna Game": "Wiener Partie",
  "Zukertort Opening": "Zukertort-Eröffnung",
});

const COMPONENT_TRANSLATIONS = Object.freeze({
  "Accepted": "Angenommen",
  "Advance Variation": "Vorstoßvariante",
  "Classical Variation": "Klassische Variante",
  "English Attack": "Englischer Angriff",
  "Exchange Variation": "Abtauschvariante",
  "Four Knights Variation": "Vierspringervariante",
  "Najdorf Variation": "Najdorf-Variante",
  "Open Variation": "Offene Variante",
  "Three Knights Variation": "Dreispringervariante",
  "Two Knights Defense": "Zweispringerverteidigung",
  "Yugoslav Attack": "Jugoslawischer Angriff",
});

function cleanText(value, maximum = 240) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function normalizeFenToEpd(fen) {
  const source = cleanText(fen, 140);
  if (!source) throw new Error("FEN fehlt.");
  const game = new Chess();
  game.load(source);
  const [position, turn, castlingRaw, epRaw] = game.fen().split(/\s+/);
  const castling = castlingRaw === "-"
    ? "-"
    : ["K", "Q", "k", "q"].filter((flag) => castlingRaw.includes(flag)).join("") || "-";
  let enPassant = epRaw || "-";
  if (enPassant !== "-") {
    const hasLegalCapture = game.moves({ verbose: true }).some(
      (move) => move.to === enPassant && String(move.flags || "").includes("e"),
    );
    if (!hasLegalCapture) enPassant = "-";
  }
  return `${position} ${turn} ${castling} ${enPassant}`;
}

export function parseOpeningName(name) {
  const original = cleanText(name);
  const colon = original.indexOf(":");
  const family = cleanText(colon >= 0 ? original.slice(0, colon) : original);
  const detail = colon >= 0 ? cleanText(original.slice(colon + 1)) : "";
  const components = detail
    ? detail.split(",").map((part) => cleanText(part)).filter(Boolean)
    : [];
  return {
    original,
    family,
    variation: components[0] || null,
    subvariation: components.length > 1 ? components.slice(1).join(", ") : null,
  };
}

function translateComponent(value) {
  if (!value) return null;
  return COMPONENT_TRANSLATIONS[value] || value;
}

export function displayOpeningComponent(value) {
  return cleanText(value)
    .split(",")
    .map((component) => translateComponent(cleanText(component)))
    .filter(Boolean)
    .join(", ");
}

export function displayOpeningName(name) {
  const parsed = parseOpeningName(name);
  const family = FAMILY_TRANSLATIONS[parsed.family] || parsed.family;
  const variation = displayOpeningComponent(parsed.variation);
  const subvariation = displayOpeningComponent(parsed.subvariation);
  return [
    family,
    variation ? `: ${variation}` : "",
    subvariation ? `, ${subvariation}` : "",
  ].join("");
}

function specificity(entry) {
  const parsed = parseOpeningName(entry?.[1]);
  return [
    parsed.subvariation ? 3 : parsed.variation ? 2 : 1,
    String(entry?.[2] || "").split(" ").filter(Boolean).length,
    parsed.original.length,
  ];
}

function chooseMostSpecific(ids, entries) {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => ({ id, entry: entries[id] }))
    .filter(({ entry }) => Array.isArray(entry))
    .sort((left, right) => {
      const leftRank = specificity(left.entry);
      const rightRank = specificity(right.entry);
      for (let index = 0; index < leftRank.length; index += 1) {
        if (leftRank[index] !== rightRank[index]) return rightRank[index] - leftRank[index];
      }
      return String(left.entry[1]).localeCompare(String(right.entry[1]), "en");
    })[0] || null;
}

export function createOpeningBook(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.entries)) {
    throw new Error("Die lokalen Eröffnungsdaten haben ein unbekanntes Format.");
  }
  return Object.freeze({
    metadata: Object.freeze({ ...(data.source || {}) }),
    entries: data.entries,
    positions: data.positions || {},
    sequences: data.sequences || {},
    sequencePrefixes: new Set(Array.isArray(data.sequencePrefixes) ? data.sequencePrefixes : []),
  });
}

let openingBookPromise = null;

export function loadOpeningBook({
  fetchImpl = globalThis.fetch,
  url = OPENING_DATA_URL,
} = {}) {
  if (!openingBookPromise) {
    if (typeof fetchImpl !== "function") {
      return Promise.reject(new Error("Die lokalen Eröffnungsdaten können nicht geladen werden."));
    }
    openingBookPromise = fetchImpl(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Eröffnungsdaten konnten nicht geladen werden (${response.status}).`);
        return response.json();
      })
      .then(createOpeningBook)
      .catch((error) => {
        openingBookPromise = null;
        throw error;
      });
  }
  return openingBookPromise;
}

function pathMoveToUci(move) {
  const from = cleanText(move?.from, 2).toLowerCase();
  const to = cleanText(move?.to, 2).toLowerCase();
  const promotion = cleanText(move?.promotion, 1).toLowerCase();
  const uci = `${from}${to}${promotion}`;
  return UCI_PATTERN.test(uci) ? uci : "";
}

function sequenceStartsWith(sequence, prefix) {
  return prefix.every((move, index) => sequence[index] === move);
}

export function openingContinuationsForPath(path, book, { limit = 5 } = {}) {
  const nodes = Array.isArray(path) ? path : [];
  if (!book?.entries || nodes.length === 0) return [];
  const played = nodes.slice(1).map((node) => pathMoveToUci(node?.move));
  if (played.some((move) => !move)) return [];
  const prefixKey = played.join(" ");
  if (prefixKey && !book.sequencePrefixes?.has(prefixKey)) return [];

  let game;
  try {
    game = new Chess(nodes.at(-1)?.fen || undefined);
  } catch {
    return [];
  }
  const legalMoves = new Map(game.moves({ verbose: true }).map((move) => [
    `${move.from}${move.to}${move.promotion || ""}`,
    move.san,
  ]));
  const grouped = new Map();
  book.entries.forEach((entry) => {
    const sequence = cleanText(entry?.[2], 2_000).split(/\s+/).filter(Boolean);
    if (sequence.length <= played.length || !sequenceStartsWith(sequence, played)) return;
    const uci = sequence[played.length];
    const san = legalMoves.get(uci);
    if (!san) return;
    const current = grouped.get(uci) || {
      uci,
      san,
      variationCount: 0,
      openings: new Map(),
      source: OPENING_SOURCE,
    };
    current.variationCount += 1;
    const name = displayOpeningName(cleanText(entry?.[1]));
    if (name) {
      const remainingMoves = sequence.length - played.length - 1;
      const previousDistance = current.openings.get(name);
      if (!Number.isInteger(previousDistance) || remainingMoves < previousDistance) {
        current.openings.set(name, remainingMoves);
      }
    }
    grouped.set(uci, current);
  });

  return [...grouped.values()]
    .sort((left, right) => (
      right.variationCount - left.variationCount
      || left.san.localeCompare(right.san, "de")
    ))
    .slice(0, Math.max(1, Math.min(8, Number.parseInt(limit, 10) || 5)))
    .map((entry) => ({
      ...entry,
      openings: [...entry.openings.entries()]
        .sort((left, right) => (
          left[1] - right[1]
          || left[0].length - right[0].length
          || left[0].localeCompare(right[0], "de")
        ))
        .slice(0, 1)
        .map(([name]) => name),
    }));
}

export function openingReviewForPath(path, book, { limit = 3 } = {}) {
  const nodes = Array.isArray(path) ? path : [];
  if (!book?.entries || nodes.length < 2) return null;
  const recognition = detectOpeningFromPath(nodes, book);
  const currentPly = nodes.length - 1;
  if (
    recognition.inKnownSequence !== true
    && !(recognition.matched === true && recognition.matchedPly === currentPly)
  ) return null;

  const playedUci = pathMoveToUci(nodes.at(-1)?.move);
  if (!playedUci) return null;
  const maximum = Math.max(0, Math.min(5, Number.parseInt(limit, 10) || 0));
  const continuations = openingContinuationsForPath(
    nodes.slice(0, -1),
    book,
    { limit: 8 },
  );
  const bookEntry = continuations.find((entry) => entry.uci === playedUci);
  const playedSan = cleanText(nodes.at(-1)?.move?.san, 24)
    || bookEntry?.san
    || playedUci;

  return {
    source: OPENING_SOURCE,
    recognition,
    fenBefore: nodes.at(-2)?.fen || "",
    played: bookEntry
      ? { ...bookEntry, san: playedSan }
      : { uci: playedUci, san: playedSan, openings: [], source: OPENING_SOURCE },
    alternatives: continuations
      .filter((entry) => entry.uci !== playedUci)
      .slice(0, maximum),
  };
}

function unknownResult(currentPly, extra = {}) {
  return {
    ...EMPTY_RESULT,
    currentPly,
    ...extra,
    matchedUci: [],
  };
}

export function detectOpeningFromPath(path, book) {
  const nodes = Array.isArray(path) ? path : [];
  const currentPly = Math.max(0, nodes.length - 1);
  if (!book?.entries || nodes.length === 0) return unknownResult(currentPly);

  const rootFen = cleanText(nodes[0]?.fen, 140);
  const game = new Chess();
  try {
    game.load(rootFen || new Chess().fen());
  } catch {
    return unknownResult(currentPly, { invalidAtPly: 0 });
  }

  const playedUci = [];
  const prefixKnown = [];
  const namedHits = [];

  for (let ply = 1; ply < nodes.length; ply += 1) {
    const uci = pathMoveToUci(nodes[ply]?.move);
    if (!uci) return unknownResult(currentPly, { invalidAtPly: ply });
    try {
      const move = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] || undefined,
      });
      if (!move) return unknownResult(currentPly, { invalidAtPly: ply });
    } catch {
      return unknownResult(currentPly, { invalidAtPly: ply });
    }
    playedUci.push(uci);
    const sequenceKey = playedUci.join(" ");
    prefixKnown.push(book.sequencePrefixes.has(sequenceKey));
    const epd = normalizeFenToEpd(game.fen());
    const positionIds = book.positions[epd];
    if (!Array.isArray(positionIds) || positionIds.length === 0) continue;
    const exactIds = book.sequences[sequenceKey];
    const selected = chooseMostSpecific(
      Array.isArray(exactIds) && exactIds.length > 0 ? exactIds : positionIds,
      book.entries,
    );
    if (!selected) continue;
    const storedPly = String(selected.entry[2] || "").split(" ").filter(Boolean).length;
    const confidence = Array.isArray(exactIds) && exactIds.includes(selected.id)
      ? "exact-sequence"
      : storedPly === ply
        ? "transposition-position"
        : "exact-position";
    namedHits.push({
      id: selected.id,
      ply,
      epd,
      confidence,
      playedUci: [...playedUci],
    });
  }

  const lastHit = namedHits.at(-1);
  const firstExitIndex = prefixKnown.findIndex((known) => !known);
  const sequenceExitPly = firstExitIndex >= 0 ? firstExitIndex + 1 : null;
  if (!lastHit) {
    return unknownResult(currentPly, {
      inKnownSequence: currentPly > 0 && firstExitIndex < 0,
      sequenceExitPly,
      sequenceExitMove: sequenceExitPly ? playedUci[sequenceExitPly - 1] || null : null,
    });
  }

  const [eco, sourceName] = book.entries[lastHit.id];
  const parsed = parseOpeningName(sourceName);
  const isCurrentPosition = lastHit.ply === currentPly;
  const confidence = isCurrentPosition ? lastHit.confidence : "parent-opening";
  return {
    matched: true,
    eco,
    sourceName,
    displayName: displayOpeningName(sourceName),
    family: parsed.family,
    variation: parsed.variation,
    subvariation: parsed.subvariation,
    matchedPly: lastHit.ply,
    lastNamedOpeningPly: lastHit.ply,
    currentPly,
    matchedUci: lastHit.playedUci,
    matchedEpd: lastHit.epd,
    inKnownSequence: currentPly > 0 && firstExitIndex < 0,
    sequenceExitPly,
    sequenceExitMove: sequenceExitPly ? playedUci[sequenceExitPly - 1] || null : null,
    confidence,
    matchedBy: confidence,
    source: OPENING_SOURCE,
  };
}

export function detectOpeningAfterMove(path, uci, book) {
  const nodes = Array.isArray(path) ? path : [];
  if (
    nodes.length === 0
    || typeof uci !== "string"
    || !UCI_PATTERN.test(uci)
  ) return unknownResult(Math.max(0, nodes.length - 1));

  const currentFen = cleanText(nodes.at(-1)?.fen, 140);
  const game = new Chess();
  try {
    game.load(currentFen || new Chess().fen());
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || undefined,
    });
    if (!move) return unknownResult(nodes.length - 1);
    return detectOpeningFromPath([
      ...nodes,
      {
        fen: game.fen(),
        move: {
          from: move.from,
          to: move.to,
          promotion: move.promotion,
          san: move.san,
          color: move.color,
        },
      },
    ], book);
  } catch {
    return unknownResult(nodes.length - 1);
  }
}

export function openingCoachContext(result) {
  if (!result?.matched) {
    return {
      matched: false,
      currentPly: Number.isInteger(result?.currentPly) ? result.currentPly : 0,
      matchedBy: "unknown",
      inKnownSequence: Boolean(result?.inKnownSequence),
      source: OPENING_SOURCE,
    };
  }
  return {
    matched: true,
    eco: cleanText(result.eco, 3),
    sourceName: cleanText(result.sourceName),
    displayName: cleanText(result.displayName),
    family: cleanText(result.family) || null,
    variation: cleanText(result.variation) || null,
    subvariation: cleanText(result.subvariation) || null,
    matchedPly: Number.isInteger(result.matchedPly) ? result.matchedPly : null,
    currentPly: Number.isInteger(result.currentPly) ? result.currentPly : null,
    matchedBy: [
      "exact-position",
      "exact-sequence",
      "transposition-position",
      "parent-opening",
    ].includes(result.matchedBy)
      ? result.matchedBy
      : "unknown",
    inKnownSequence: Boolean(result.inKnownSequence),
    sequenceExitPly: Number.isInteger(result.sequenceExitPly) ? result.sequenceExitPly : null,
    source: OPENING_SOURCE,
  };
}

const QUALITY_KEYS = Object.freeze([
  "brilliant",
  "great",
  "book",
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
]);

const EMPTY_COUNTS = Object.freeze(Object.fromEntries(QUALITY_KEYS.map((key) => [key, 0])));

const TIME_FORMAT_LABELS = Object.freeze({
  bullet: "Bullet",
  blitz: "Blitz",
  rapid: "Rapid",
  classical: "Klassisch",
  correspondence: "Korrespondenz",
  training: "Training / ohne Uhr",
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedNumber(value, minimum, maximum) {
  const parsed = finiteNumber(value);
  return parsed === null ? null : clamp(parsed, minimum, maximum);
}

function rounded(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cleanText(value, maximum = 160) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maximum)
    : "";
}

function firstText(values, maximum = 160) {
  for (const value of values) {
    const text = cleanText(value, maximum);
    if (text) return text;
  }
  return "";
}

function normalizeColor(value) {
  const color = cleanText(value, 16).toLocaleLowerCase("de");
  if (["w", "white", "weiß", "weiss"].includes(color)) return "w";
  if (["b", "black", "schwarz"].includes(color)) return "b";
  return null;
}

function normalizeResult(value) {
  const result = cleanText(value, 24).toLocaleLowerCase("de");
  if (["1-0", "white", "weiß", "weiss"].includes(result)) return "1-0";
  if (["0-1", "black", "schwarz"].includes(result)) return "0-1";
  if (["1/2-1/2", "½-½", "draw", "remis"].includes(result)) return "1/2-1/2";
  return "*";
}

function normalizeTimeFormat(value) {
  const format = cleanText(value, 32).toLocaleLowerCase("de");
  const aliases = {
    bullet: "bullet",
    blitz: "blitz",
    rapid: "rapid",
    schnellschach: "rapid",
    classical: "classical",
    klassisch: "classical",
    correspondence: "correspondence",
    korrespondenz: "correspondence",
    training: "training",
    trainingpartie: "training",
  };
  return aliases[format] || format;
}

function perspectiveResult(result, playerColor) {
  if (result === "1/2-1/2") return "D";
  if (!playerColor || result === "*") return null;
  if (result === "1-0") return playerColor === "w" ? "W" : "L";
  if (result === "0-1") return playerColor === "b" ? "W" : "L";
  return null;
}

function parsePgnHeaders(pgn) {
  if (typeof pgn !== "string" || !pgn) return {};
  const headers = {};
  const headerPattern = /^\s*\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"])*)"\]\s*$/gm;
  let match;
  while ((match = headerPattern.exec(pgn))) {
    headers[match[1].toLocaleLowerCase("en")] = match[2]
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }
  return headers;
}

function stripPgnVariations(value) {
  let depth = 0;
  let result = "";
  for (const character of value) {
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      result += character;
    }
  }
  return result;
}

function plyCountFromPgn(pgn) {
  if (typeof pgn !== "string" || !pgn.trim()) return 0;
  const movetext = stripPgnVariations(
    pgn
      .replace(/^\s*\[[^\r\n]*\]\s*$/gm, " ")
      .replace(/\{[^}]*\}/g, " ")
      .replace(/;[^\r\n]*/g, " "),
  );
  let plies = 0;
  for (let token of movetext.split(/\s+/)) {
    token = token.replace(/^\d+\.(?:\.\.)?/, "");
    if (
      !token
      || /^\d+\.+$/.test(token)
      || /^\$\d+$/.test(token)
      || ["1-0", "0-1", "1/2-1/2", "½-½", "*", "e.p."].includes(token)
    ) {
      continue;
    }
    plies += 1;
  }
  return clamp(plies, 0, 1_000);
}

function parseTimestamp(value) {
  const text = cleanText(value, 64);
  if (!text || text.includes("?")) return null;
  const normalized = /^\d{4}\.\d{2}\.\d{2}$/.test(text)
    ? `${text.replaceAll(".", "-")}T00:00:00Z`
    : text;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function emptyCounts() {
  return { ...EMPTY_COUNTS };
}

function readCounts(value) {
  const counts = emptyCounts();
  if (!value || typeof value !== "object") return counts;
  for (const quality of QUALITY_KEYS) {
    const count = boundedNumber(value[quality], 0, 10_000);
    counts[quality] = count === null ? 0 : Math.round(count);
  }
  return counts;
}

function addCounts(target, source) {
  for (const quality of QUALITY_KEYS) target[quality] += source[quality] || 0;
}

function hasAnyCounts(counts) {
  return QUALITY_KEYS.some((quality) => counts[quality] > 0);
}

function countsFromMoves(moves, color = null) {
  const counts = emptyCounts();
  let matchingMoves = 0;
  for (const move of moves) {
    if (!move || typeof move !== "object") continue;
    const moveColor = normalizeColor(move.color);
    if (color && moveColor !== color) continue;
    if (!color || moveColor === color) matchingMoves += 1;
    const quality = cleanText(move.quality, 24).toLocaleLowerCase("en");
    if (QUALITY_KEYS.includes(quality)) counts[quality] += 1;
  }
  return { counts, matchingMoves };
}

function countAnalyzedMovesForColor(review, moves, color, analyzedMoves, totalMoves) {
  const explicitCandidates = color === "w"
    ? [
      review?.whiteAnalyzedMoves,
      review?.analyzedMovesByColor?.w,
      review?.analyzedMovesByColor?.white,
    ]
    : [
      review?.blackAnalyzedMoves,
      review?.analyzedMovesByColor?.b,
      review?.analyzedMovesByColor?.black,
    ];
  for (const candidate of explicitCandidates) {
    const parsed = boundedNumber(candidate, 0, 1_000);
    if (parsed !== null) return Math.round(parsed);
  }

  const fromMoves = moves.filter((move) => (
    normalizeColor(move?.color) === color
    && (
      boundedNumber(move?.accuracy, 0, 100) !== null
      || boundedNumber(move?.lossCp, 0, 100_000) !== null
      || QUALITY_KEYS.includes(cleanText(move?.quality, 24).toLocaleLowerCase("en"))
    )
  )).length;
  if (fromMoves > 0) return fromMoves;

  const sideMoves = color === "w" ? Math.ceil(totalMoves / 2) : Math.floor(totalMoves / 2);
  if (totalMoves > 0 && analyzedMoves > 0) {
    return Math.round(sideMoves * clamp(analyzedMoves / totalMoves, 0, 1));
  }
  if (analyzedMoves > 0) {
    return color === "w" ? Math.ceil(analyzedMoves / 2) : Math.floor(analyzedMoves / 2);
  }
  return 0;
}

function weightedMean(values) {
  let total = 0;
  let weight = 0;
  for (const entry of values) {
    if (!Number.isFinite(entry?.value) || !Number.isFinite(entry?.weight) || entry.weight <= 0) continue;
    total += entry.value * entry.weight;
    weight += entry.weight;
  }
  return weight > 0 ? total / weight : null;
}

function weightedValue(value, weight) {
  return Number.isFinite(value) ? { value, weight: Math.max(1, weight || 0) } : null;
}

function normalizeReview(reviewValue, plyCount) {
  const review = reviewValue && typeof reviewValue === "object" ? reviewValue : {};
  const moves = Array.isArray(review.moves) ? review.moves : [];
  const totalMoves = Math.round(
    boundedNumber(review.totalMoves, 0, 1_000) ?? plyCount,
  );

  let analyzedMoves = Math.round(
    boundedNumber(review.analyzedMoves, 0, 1_000) ?? 0,
  );
  if (analyzedMoves === 0 && moves.length > 0) {
    analyzedMoves = moves.filter((move) => move && typeof move === "object").length;
  }
  const suppliedCoverage = boundedNumber(review.coverage, 0, 100);
  if (analyzedMoves === 0 && suppliedCoverage !== null && totalMoves > 0) {
    analyzedMoves = Math.round(totalMoves * suppliedCoverage / 100);
  }

  const whiteAccuracy = boundedNumber(review.whiteAccuracy, 0, 100);
  const blackAccuracy = boundedNumber(review.blackAccuracy, 0, 100);

  const accuracyByMove = { w: [], b: [] };
  const lossByMove = { w: [], b: [] };
  for (const move of moves) {
    const color = normalizeColor(move?.color);
    if (!color) continue;
    const accuracy = boundedNumber(move.accuracy, 0, 100);
    const lossCp = boundedNumber(move.lossCp, 0, 100_000);
    if (accuracy !== null) accuracyByMove[color].push(accuracy);
    if (lossCp !== null) lossByMove[color].push(lossCp);
  }

  const normalizedWhiteAccuracy = whiteAccuracy
    ?? weightedMean(accuracyByMove.w.map((value) => ({ value, weight: 1 })));
  const normalizedBlackAccuracy = blackAccuracy
    ?? weightedMean(accuracyByMove.b.map((value) => ({ value, weight: 1 })));

  let overallAccuracy = boundedNumber(review.overallAccuracy, 0, 100);
  if (
    analyzedMoves === 0
    && (
      Number.isFinite(overallAccuracy)
      || Number.isFinite(normalizedWhiteAccuracy)
      || Number.isFinite(normalizedBlackAccuracy)
    )
  ) {
    analyzedMoves = totalMoves > 0 && review.final === true ? totalMoves : 1;
  }
  const whiteMoves = countAnalyzedMovesForColor(review, moves, "w", analyzedMoves, totalMoves);
  const blackMoves = countAnalyzedMovesForColor(review, moves, "b", analyzedMoves, totalMoves);
  if (overallAccuracy === null) {
    overallAccuracy = weightedMean([
      weightedValue(normalizedWhiteAccuracy, whiteMoves),
      weightedValue(normalizedBlackAccuracy, blackMoves),
    ].filter(Boolean));
  }

  const whiteLoss = boundedNumber(review.whiteAverageCentipawnLoss, 0, 100_000)
    ?? weightedMean(lossByMove.w.map((value) => ({ value, weight: 1 })));
  const blackLoss = boundedNumber(review.blackAverageCentipawnLoss, 0, 100_000)
    ?? weightedMean(lossByMove.b.map((value) => ({ value, weight: 1 })));
  let overallLoss = boundedNumber(review.averageCentipawnLoss, 0, 100_000);
  if (overallLoss === null) {
    overallLoss = weightedMean([
      weightedValue(whiteLoss, whiteMoves),
      weightedValue(blackLoss, blackMoves),
    ].filter(Boolean));
  }

  const countsFromAllMoves = countsFromMoves(moves);
  const hasSuppliedCounts = review.counts
    && typeof review.counts === "object"
    && QUALITY_KEYS.some((quality) => Object.hasOwn(review.counts, quality));
  const counts = hasSuppliedCounts
    ? readCounts(review.counts)
    : countsFromAllMoves.counts;

  const explicitWhiteCounts = review.countsByColor?.w
    || review.countsByColor?.white
    || review.whiteCounts;
  const explicitBlackCounts = review.countsByColor?.b
    || review.countsByColor?.black
    || review.blackCounts;
  const ownCountsByColor = {
    w: explicitWhiteCounts
      ? { counts: readCounts(explicitWhiteCounts), available: true }
      : {
        counts: countsFromMoves(moves, "w").counts,
        available: countsFromMoves(moves, "w").matchingMoves > 0,
      },
    b: explicitBlackCounts
      ? { counts: readCounts(explicitBlackCounts), available: true }
      : {
        counts: countsFromMoves(moves, "b").counts,
        available: countsFromMoves(moves, "b").matchingMoves > 0,
      },
  };

  const coverage = suppliedCoverage
    ?? (totalMoves > 0 ? clamp(analyzedMoves / totalMoves * 100, 0, 100) : null);
  const hasAnalysis = analyzedMoves > 0
    || Number.isFinite(overallAccuracy)
    || Number.isFinite(normalizedWhiteAccuracy)
    || Number.isFinite(normalizedBlackAccuracy)
    || Number.isFinite(overallLoss)
    || hasAnyCounts(counts);
  const complete = review.final === true
    && totalMoves > 0
    && Number.isFinite(coverage)
    && coverage >= 95
    && analyzedMoves >= Math.max(1, Math.ceil(totalMoves * 0.95));

  return {
    analyzedMoves,
    totalMoves,
    coverage,
    overallAccuracy,
    accuracy: { w: normalizedWhiteAccuracy, b: normalizedBlackAccuracy },
    analyzedByColor: { w: whiteMoves, b: blackMoves },
    averageLoss: overallLoss,
    loss: { w: whiteLoss, b: blackLoss },
    counts,
    ownCountsByColor,
    hasAnalysis,
    complete,
  };
}

function normalizeGame(record, index) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const metadata = record.metadata && typeof record.metadata === "object"
    ? record.metadata
    : {};
  const headers = parsePgnHeaders(record.pgn);
  const suppliedPlyCounts = [
    boundedNumber(record.plyCount, 0, 1_000),
    boundedNumber(record.review?.totalMoves, 0, 1_000),
    plyCountFromPgn(record.pgn),
  ];
  const parsedPlyCount = suppliedPlyCounts.find((value) => Number.isFinite(value) && value > 0) ?? 0;
  const plyCount = Math.round(parsedPlyCount);
  const color = normalizeColor(
    metadata.playerColor ?? record.playerColor,
  );
  const result = [
    record.result,
    metadata.result,
    headers.result,
  ].map(normalizeResult).find((value) => value !== "*") || "*";
  const playedAt = firstText([
    metadata.playedAt,
    record.playedAt,
    headers.date,
    record.createdAt,
    record.updatedAt,
  ], 64);
  const opening = firstText([
    metadata.opening,
    record.opening,
    headers.opening,
    headers.eco ? `ECO ${headers.eco}` : "",
  ], 120);
  const timeControl = firstText([
    metadata.timeControl,
    record.timeControl,
    headers.timecontrol,
  ], 80);
  const timeFormat = normalizeTimeFormat(
    firstText([metadata.timeFormat, record.timeFormat], 32),
  );

  return {
    index,
    id: cleanText(record.id, 120),
    title: cleanText(record.title, 160) || `Partie ${index + 1}`,
    color,
    result,
    perspective: perspectiveResult(result, color),
    playedAt,
    timestamp: parseTimestamp(playedAt),
    opening,
    timeFormat,
    timeControl,
    plyCount,
    review: normalizeReview(record.review, plyCount),
  };
}

function resultSummary(games) {
  const summary = { wins: 0, draws: 0, losses: 0, unknown: 0 };
  for (const game of games) {
    if (game.perspective === "W") summary.wins += 1;
    else if (game.perspective === "D") summary.draws += 1;
    else if (game.perspective === "L") summary.losses += 1;
    else summary.unknown += 1;
  }
  const classifiedGames = summary.wins + summary.draws + summary.losses;
  return {
    ...summary,
    classifiedGames,
    scoreRate: classifiedGames > 0
      ? rounded((summary.wins + summary.draws * 0.5) / classifiedGames * 100)
      : null,
  };
}

function accuracyForGame(game) {
  if (!game.color || !game.review.complete) return null;
  return game.review.accuracy[game.color];
}

function accuracyWeightForGame(game) {
  if (!game.color) return 0;
  return Math.max(1, game.review.analyzedByColor[game.color] || 0);
}

function addGroupedGame(map, label, game) {
  if (!label) return;
  const key = label.toLocaleLowerCase("de");
  if (!map.has(key)) {
    map.set(key, {
      name: label,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      unknown: 0,
      accuracyValues: [],
    });
  }
  const group = map.get(key);
  group.games += 1;
  if (game.perspective === "W") group.wins += 1;
  else if (game.perspective === "D") group.draws += 1;
  else if (game.perspective === "L") group.losses += 1;
  else group.unknown += 1;
  const accuracy = accuracyForGame(game);
  if (Number.isFinite(accuracy)) {
    group.accuracyValues.push({
      value: accuracy,
      weight: accuracyWeightForGame(game),
    });
  }
}

function finishOpeningGroup(group) {
  const classifiedGames = group.wins + group.draws + group.losses;
  return {
    name: group.name,
    games: group.games,
    wins: group.wins,
    draws: group.draws,
    losses: group.losses,
    unknown: group.unknown,
    scoreRate: classifiedGames > 0
      ? rounded((group.wins + group.draws * 0.5) / classifiedGames * 100)
      : null,
    ownAccuracy: rounded(weightedMean(group.accuracyValues)),
  };
}

function openingStatistics(games) {
  const groups = new Map();
  for (const game of games) addGroupedGame(groups, game.opening, game);
  const stats = [...groups.values()]
    .map(finishOpeningGroup)
    .sort((left, right) => (
      right.games - left.games
      || (right.scoreRate ?? -1) - (left.scoreRate ?? -1)
      || (right.ownAccuracy ?? -1) - (left.ownAccuracy ?? -1)
      || left.name.localeCompare(right.name, "de")
    ));
  const best = stats
    .filter((opening) => opening.games >= 2)
    .sort((left, right) => (
      (right.scoreRate ?? -1) - (left.scoreRate ?? -1)
      || (right.ownAccuracy ?? -1) - (left.ownAccuracy ?? -1)
      || right.games - left.games
      || left.name.localeCompare(right.name, "de")
    ))[0] || null;
  return {
    stats,
    favorite: stats[0] || null,
    best,
  };
}

function timeControlStatistics(games) {
  const groups = new Map();
  for (const game of games) {
    if (!game.timeControl) continue;
    const key = game.timeControl.toLocaleLowerCase("de");
    if (!groups.has(key)) groups.set(key, { name: game.timeControl, games: 0 });
    groups.get(key).games += 1;
  }
  const stats = [...groups.values()]
    .map((group) => ({
      ...group,
      share: rounded(group.games / games.length * 100),
    }))
    .sort((left, right) => (
      right.games - left.games || left.name.localeCompare(right.name, "de")
    ));
  return { stats, mostCommon: stats[0] || null };
}

function timeFormatStatistics(games) {
  const groups = new Map();
  for (const game of games) {
    if (!game.timeFormat) continue;
    if (!groups.has(game.timeFormat)) {
      groups.set(game.timeFormat, {
        key: game.timeFormat,
        name: TIME_FORMAT_LABELS[game.timeFormat] || game.timeFormat,
        games: 0,
      });
    }
    groups.get(game.timeFormat).games += 1;
  }
  const stats = [...groups.values()]
    .map((group) => ({
      ...group,
      share: rounded(group.games / games.length * 100),
    }))
    .sort((left, right) => (
      right.games - left.games || left.name.localeCompare(right.name, "de")
    ));
  return { stats, mostCommon: stats[0] || null };
}

function ownCountsForGame(game) {
  if (!game.color) return { counts: emptyCounts(), available: false };
  return game.review.ownCountsByColor[game.color];
}

function rankingBlundersForGame(game) {
  const own = ownCountsForGame(game);
  if (own.available) return own.counts.blunder;
  const analyzed = Math.max(1, game.review.analyzedMoves);
  const ownAnalyzed = game.color ? game.review.analyzedByColor[game.color] : 0;
  const share = ownAnalyzed > 0 ? clamp(ownAnalyzed / analyzed, 0, 1) : 1;
  return rounded(game.review.counts.blunder * share, 2) || 0;
}

function bestGameRanking(games, limit, minimumOwnMoves) {
  const ranked = games
    .filter((game) => (
      game.id
      && game.color
      && game.perspective
      && game.review.complete
      && game.review.analyzedByColor[game.color] >= minimumOwnMoves
    ))
    .map((game) => {
      const ownAccuracy = accuracyForGame(game);
      const accuracy = ownAccuracy ?? game.review.overallAccuracy;
      if (!Number.isFinite(accuracy)) return null;
      const coverage = game.review.coverage ?? 0;
      const resultBonus = game.perspective === "W"
        ? 15
        : game.perspective === "D"
          ? 8
          : 0;
      const blunders = rankingBlundersForGame(game);
      const blunderPenalty = Math.min(25, blunders * 6);
      const score = clamp(
        accuracy * 0.70 + coverage * 0.15 + resultBonus - blunderPenalty,
        0,
        100,
      );
      return {
        id: game.id,
        title: game.title,
        playedAt: game.playedAt,
        score: rounded(score),
        accuracy: rounded(accuracy),
        accuracySource: Number.isFinite(ownAccuracy) ? "own" : "overall",
        coverage: rounded(coverage),
        result: game.result,
        perspectiveResult: game.perspective,
        blunders,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      right.score - left.score
      || right.accuracy - left.accuracy
      || right.coverage - left.coverage
      || ((parseTimestamp(right.playedAt) ?? -Infinity) - (parseTimestamp(left.playedAt) ?? -Infinity))
      || left.id.localeCompare(right.id, "de")
    ));
  return {
    games: ranked,
    topGameIds: ranked.slice(0, limit).map((game) => game.id),
  };
}

function currentForm(games, size) {
  const recent = [...games]
    .sort((left, right) => (
      (right.timestamp ?? -Infinity) - (left.timestamp ?? -Infinity)
      || left.index - right.index
    ))
    .slice(0, size);
  const results = resultSummary(recent);
  return {
    games: recent.length,
    gameIds: recent.map((game) => game.id).filter(Boolean),
    sequence: recent.map((game) => game.perspective || "?"),
    wins: results.wins,
    draws: results.draws,
    losses: results.losses,
    unknown: results.unknown,
    scoreRate: results.scoreRate,
    ownAccuracy: rounded(weightedMean(
      recent
        .map((game) => weightedValue(accuracyForGame(game), accuracyWeightForGame(game)))
        .filter(Boolean),
    )),
  };
}

/**
 * Aggregates persisted game records into a player-centric profile.
 *
 * All calculations are deterministic and leave the supplied game records untouched.
 * Percentages and engine metrics are rounded to one decimal place.
 */
export function buildPlayerProfile(games, options = {}) {
  const records = Array.isArray(games) ? games : [];
  const normalizedGames = records
    .map(normalizeGame)
    .filter(Boolean);
  const requestedLimit = finiteNumber(options?.bestGamesLimit);
  const requestedFormSize = finiteNumber(options?.formSize);
  const requestedMinimumOwnMoves = finiteNumber(options?.bestGameMinimumOwnMoves);
  const bestGamesLimit = Math.round(clamp(requestedLimit ?? 3, 0, 20));
  const formSize = Math.round(clamp(requestedFormSize ?? 5, 1, 20));
  const bestGameMinimumOwnMoves = Math.round(clamp(requestedMinimumOwnMoves ?? 10, 1, 100));

  const results = resultSummary(normalizedGames);
  const completeGames = normalizedGames.filter((game) => game.review.complete);
  const analyzedGameIds = completeGames.map((game) => game.id).filter(Boolean);
  const analyzedGames = completeGames.length;
  const overallAccuracy = rounded(weightedMean(
    completeGames
      .map((game) => weightedValue(game.review.overallAccuracy, game.review.analyzedMoves))
      .filter(Boolean),
  ));
  const ownAccuracy = rounded(weightedMean(
    normalizedGames
      .map((game) => weightedValue(accuracyForGame(game), accuracyWeightForGame(game)))
      .filter(Boolean),
  ));
  const averageCentipawnLoss = rounded(weightedMean(
    completeGames
      .map((game) => weightedValue(game.review.averageLoss, game.review.analyzedMoves))
      .filter(Boolean),
  ));
  const ownAverageCentipawnLoss = rounded(weightedMean(
    completeGames
      .map((game) => {
        const value = game.color ? game.review.loss[game.color] : null;
        return weightedValue(value, accuracyWeightForGame(game));
      })
      .filter(Boolean),
  ));

  const colorGames = {
    w: normalizedGames.filter((game) => game.color === "w"),
    b: normalizedGames.filter((game) => game.color === "b"),
  };
  const colorKnownGames = colorGames.w.length + colorGames.b.length;
  const colorProfile = (color) => ({
    color,
    games: colorGames[color].length,
    analyzedGames: colorGames[color].filter((game) => (
      Number.isFinite(accuracyForGame(game))
    )).length,
    accuracy: rounded(weightedMean(
      colorGames[color]
        .map((game) => weightedValue(accuracyForGame(game), accuracyWeightForGame(game)))
        .filter(Boolean),
    )),
  });
  const whiteColorProfile = colorProfile("w");
  const blackColorProfile = colorProfile("b");
  const colorDistribution = {
    white: colorGames.w.length,
    black: colorGames.b.length,
    unknown: normalizedGames.length - colorKnownGames,
    whitePercent: colorKnownGames > 0
      ? rounded(colorGames.w.length / colorKnownGames * 100)
      : null,
    blackPercent: colorKnownGames > 0
      ? rounded(colorGames.b.length / colorKnownGames * 100)
      : null,
  };
  let favoriteColor = null;
  if (colorGames.w.length !== colorGames.b.length && colorKnownGames > 0) {
    const color = colorGames.w.length > colorGames.b.length ? "w" : "b";
    favoriteColor = {
      color,
      label: color === "w" ? "Weiß" : "Schwarz",
      games: colorGames[color].length,
      share: rounded(colorGames[color].length / colorKnownGames * 100),
    };
  }

  const qualityCounts = emptyCounts();
  const ownQualityCounts = emptyCounts();
  let ownQualityCountGames = 0;
  for (const game of completeGames) {
    addCounts(qualityCounts, game.review.counts);
    const own = ownCountsForGame(game);
    if (own.available) {
      addCounts(ownQualityCounts, own.counts);
      ownQualityCountGames += 1;
    }
  }

  const opening = openingStatistics(normalizedGames);
  const timeFormat = timeFormatStatistics(normalizedGames);
  const timeControl = timeControlStatistics(normalizedGames);
  const gamesWithLength = normalizedGames.filter((game) => game.plyCount > 0);
  const averagePlyCount = gamesWithLength.length > 0
    ? rounded(gamesWithLength.reduce((sum, game) => sum + game.plyCount, 0) / gamesWithLength.length)
    : null;
  const averageMoves = gamesWithLength.length > 0
    ? rounded(
      gamesWithLength.reduce((sum, game) => sum + Math.ceil(game.plyCount / 2), 0)
        / gamesWithLength.length,
    )
    : null;
  const longest = [...gamesWithLength].sort((left, right) => (
    right.plyCount - left.plyCount
    || (right.timestamp ?? -Infinity) - (left.timestamp ?? -Infinity)
    || left.index - right.index
  ))[0] || null;
  const ranking = bestGameRanking(normalizedGames, bestGamesLimit, bestGameMinimumOwnMoves);

  return {
    totalGames: normalizedGames.length,
    analyzedGames,
    analyzedGameIds,
    results,
    overallAccuracy,
    ownAccuracy,
    whiteAccuracy: whiteColorProfile.accuracy,
    blackAccuracy: blackColorProfile.accuracy,
    accuracyByColor: {
      white: whiteColorProfile,
      black: blackColorProfile,
    },
    averageCentipawnLoss,
    ownAverageCentipawnLoss,
    colorDistribution,
    favoriteColor,
    openingStats: opening.stats,
    favoriteOpening: opening.favorite,
    bestOpening: opening.best,
    timeFormatStats: timeFormat.stats,
    mostCommonTimeFormat: timeFormat.mostCommon,
    timeControlStats: timeControl.stats,
    mostCommonTimeControl: timeControl.mostCommon,
    averagePlyCount,
    averageMoves,
    longestGame: longest
      ? {
        id: longest.id,
        title: longest.title,
        plyCount: longest.plyCount,
        moves: Math.ceil(longest.plyCount / 2),
      }
      : null,
    currentForm: currentForm(normalizedGames, formSize),
    qualityCounts,
    ownQualityCounts: {
      ...ownQualityCounts,
      sourceGames: ownQualityCountGames,
    },
    mistakes: qualityCounts.mistake,
    blunders: qualityCounts.blunder,
    ownMistakes: ownQualityCounts.mistake,
    ownBlunders: ownQualityCounts.blunder,
    bestGames: ranking.games,
    topGameIds: ranking.topGameIds,
  };
}

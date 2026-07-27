export const DEFAULT_LEARNER_RATING = 1200;

export const LEARNER_LEVELS = Object.freeze({
  beginner: Object.freeze({
    key: "beginner",
    label: "Einsteiger",
    minimumRating: 100,
    maximumRating: 1199,
  }),
  intermediate: Object.freeze({
    key: "intermediate",
    label: "Fortgeschritten",
    minimumRating: 1200,
    maximumRating: 1799,
  }),
  advanced: Object.freeze({
    key: "advanced",
    label: "Stark",
    minimumRating: 1800,
    maximumRating: 2199,
  }),
  expert: Object.freeze({
    key: "expert",
    label: "Experte",
    minimumRating: 2200,
    maximumRating: 4000,
  }),
});

const LIMITS_BY_LEVEL = Object.freeze({
  beginner: Object.freeze({
    short: Object.freeze({
      minimumSentences: 4,
      maximumSentences: 6,
      maximumWordsPerSentence: 18,
    }),
    deep: Object.freeze({
      maximumSections: 4,
      maximumSentencesPerSection: 3,
    }),
    variations: Object.freeze({
      maximumLines: 1,
      maximumPliesPerLine: 4,
    }),
    terminology: Object.freeze({
      level: "plain",
      defineUncommonTerms: true,
      maximumNewTerms: 1,
    }),
  }),
  intermediate: Object.freeze({
    short: Object.freeze({
      minimumSentences: 4,
      maximumSentences: 6,
      maximumWordsPerSentence: 21,
    }),
    deep: Object.freeze({
      maximumSections: 5,
      maximumSentencesPerSection: 3,
    }),
    variations: Object.freeze({
      maximumLines: 2,
      maximumPliesPerLine: 6,
    }),
    terminology: Object.freeze({
      level: "guided",
      defineUncommonTerms: true,
      maximumNewTerms: 2,
    }),
  }),
  advanced: Object.freeze({
    short: Object.freeze({
      minimumSentences: 4,
      maximumSentences: 6,
      maximumWordsPerSentence: 24,
    }),
    deep: Object.freeze({
      maximumSections: 6,
      maximumSentencesPerSection: 4,
    }),
    variations: Object.freeze({
      maximumLines: 3,
      maximumPliesPerLine: 8,
    }),
    terminology: Object.freeze({
      level: "standard",
      defineUncommonTerms: false,
      maximumNewTerms: 3,
    }),
  }),
  expert: Object.freeze({
    short: Object.freeze({
      minimumSentences: 4,
      maximumSentences: 6,
      maximumWordsPerSentence: 28,
    }),
    deep: Object.freeze({
      maximumSections: 7,
      maximumSentencesPerSection: 4,
    }),
    variations: Object.freeze({
      maximumLines: 4,
      maximumPliesPerLine: 10,
    }),
    terminology: Object.freeze({
      level: "technical",
      defineUncommonTerms: false,
      maximumNewTerms: 4,
    }),
  }),
});

const PERF_WEIGHTS = Object.freeze({
  rapid: 1,
  classical: 1,
  blitz: 0.85,
  correspondence: 0.7,
  bullet: 0.55,
  ultraBullet: 0.35,
});

const LEVEL_ALIASES = Object.freeze({
  beginner: "beginner",
  novice: "beginner",
  starter: "beginner",
  einsteiger: "beginner",
  anfänger: "beginner",
  anfaenger: "beginner",
  intermediate: "intermediate",
  mittelstufe: "intermediate",
  fortgeschritten: "intermediate",
  advanced: "advanced",
  stark: "advanced",
  expert: "expert",
  experte: "expert",
  expertin: "expert",
});

function finiteRating(value) {
  if (
    typeof value !== "number"
    && (typeof value !== "string" || !value.trim())
  ) {
    return null;
  }
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 100 && rating <= 4000
    ? Math.round(rating)
    : null;
}

function finiteCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function cleanLevel(value) {
  if (typeof value !== "string") return null;
  const key = value.trim().toLocaleLowerCase("de");
  if (!key || ["auto", "automatic", "automatisch"].includes(key)) return null;
  return LEVEL_ALIASES[key] || null;
}

function cloneLimits(level) {
  const limits = LIMITS_BY_LEVEL[level] || LIMITS_BY_LEVEL.intermediate;
  return {
    short: { ...limits.short },
    deep: { ...limits.deep },
    variations: { ...limits.variations },
    terminology: { ...limits.terminology },
  };
}

export function ratingToLearnerLevel(value) {
  const rating = finiteRating(value) ?? DEFAULT_LEARNER_RATING;
  if (rating < LEARNER_LEVELS.intermediate.minimumRating) return "beginner";
  if (rating < LEARNER_LEVELS.advanced.minimumRating) return "intermediate";
  if (rating < LEARNER_LEVELS.expert.minimumRating) return "advanced";
  return "expert";
}

export function explanationLimitsForLevel(value) {
  const level = cleanLevel(
    typeof value === "object" && value !== null ? value.level : value,
  ) || "intermediate";
  return cloneLimits(level);
}

function preferenceObjects(input) {
  const candidates = [
    input?.manualPreference,
    input?.manual,
    input?.preferences?.coach,
    input?.preferences,
    input?.accountState?.profile?.coachPreferences,
    input?.accountState?.profile?.learningPreference,
    input?.account?.profile?.coachPreferences,
    input?.account?.profile?.learningPreference,
    input?.profile?.coachPreferences,
    input?.profile?.learningPreference,
  ];
  return candidates.filter((candidate) => (
    (candidate && typeof candidate === "object" && !Array.isArray(candidate))
    || typeof candidate === "string"
    || typeof candidate === "number"
  ));
}

function manualPreference(input) {
  let rating = null;
  let level = null;

  for (const preference of preferenceObjects(input)) {
    if (typeof preference === "number") {
      if (rating === null) rating = finiteRating(preference);
      continue;
    }
    if (typeof preference === "string") {
      if (level === null) level = cleanLevel(preference);
      if (rating === null) rating = finiteRating(preference);
      continue;
    }
    if (
      preference.auto === true
      || preference.automatic === true
      || ["auto", "automatic", "automatisch"].includes(
        String(preference.mode || "").toLocaleLowerCase("de"),
      )
    ) {
      return { rating: null, level: null };
    }
    if (rating === null) {
      rating = [
        preference.rating,
        preference.elo,
        preference.targetRating,
        preference.coachRating,
      ].map(finiteRating).find((candidate) => candidate !== null) ?? null;
    }
    if (level === null) {
      level = [
        preference.level,
        preference.skillLevel,
        preference.coachLevel,
        preference.explanationLevel,
      ].map(cleanLevel).find(Boolean) || null;
    }
  }

  return { rating, level };
}

function addObservation(observations, ratingValue, weight, source) {
  const rating = finiteRating(ratingValue);
  if (rating === null || !Number.isFinite(weight) || weight <= 0) return;
  observations.push({ rating, weight, source });
}

function accountObjects(input) {
  return [
    input?.lichessAccount,
    input?.lichess?.account,
    input?.accountState?.lichess,
    input?.account?.lichess,
    input?.accountState?.profile,
    input?.account?.profile,
    input?.profile,
    input?.account,
  ].filter((candidate) => candidate && typeof candidate === "object");
}

function addAccountRatings(observations, input) {
  const seen = new Set();
  for (const account of accountObjects(input)) {
    if (seen.has(account)) continue;
    seen.add(account);

    const perfs = account.perfs && typeof account.perfs === "object"
      ? account.perfs
      : null;
    if (perfs) {
      for (const [perf, importance] of Object.entries(PERF_WEIGHTS)) {
        const entry = perfs[perf];
        if (!entry || typeof entry !== "object") continue;
        const games = finiteCount(entry.games ?? entry.nb);
        const reliability = Math.max(1, Math.min(12, Math.sqrt(games || 1)));
        const provisionalPenalty = entry.prov === true || entry.provisional === true
          ? 0.5
          : 1;
        addObservation(
          observations,
          entry.rating,
          importance * reliability * provisionalPenalty,
          "lichess-perf",
        );
      }
    }

    const directRating = [
      account.rating,
      account.elo,
      account.chessRating,
      account.playerRating,
    ].map(finiteRating).find((candidate) => candidate !== null);
    if (directRating !== undefined && directRating !== null) {
      addObservation(observations, directRating, 5, "account-rating");
    }
  }
}

function identityKeys(input) {
  const values = [
    input?.lichessAccount?.id,
    input?.lichessAccount?.username,
    input?.lichessAccount?.name,
    input?.lichess?.account?.id,
    input?.lichess?.account?.username,
    input?.lichess?.account?.name,
    input?.lichess?.user?.id,
    input?.lichess?.user?.username,
    input?.lichess?.user?.name,
    input?.lichessUsername,
  ];
  return new Set(values
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim().toLocaleLowerCase("en")));
}

function playerIdentity(player) {
  const values = [
    player?.user?.id,
    player?.user?.name,
    player?.id,
    player?.username,
    player?.name,
  ];
  return values
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim().toLocaleLowerCase("en"));
}

function playerRatingFromRawGame(game, identities) {
  const players = game?.players;
  if (!players || typeof players !== "object") return null;

  const color = game.playerColor ?? game.metadata?.playerColor;
  if (color === "w" || color === "white") return finiteRating(players.white?.rating);
  if (color === "b" || color === "black") return finiteRating(players.black?.rating);

  if (identities.size === 0) return null;
  for (const side of ["white", "black"]) {
    if (playerIdentity(players[side]).some((identity) => identities.has(identity))) {
      return finiteRating(players[side]?.rating);
    }
  }
  return null;
}

function gameArrays(input) {
  return [
    input?.games,
    input?.accountState?.games,
    input?.account?.games,
    input?.lichessGames,
    input?.lichess?.games,
  ].filter(Array.isArray);
}

function addGameRatings(observations, input) {
  const identities = identityKeys(input);
  const seenObjects = new Set();
  const seenIds = new Set();

  for (const games of gameArrays(input)) {
    for (const game of games.slice(0, 200)) {
      if (!game || typeof game !== "object" || seenObjects.has(game)) continue;
      const id = typeof game.id === "string" && game.id.trim()
        ? game.id.trim()
        : "";
      if (id && seenIds.has(id)) continue;
      seenObjects.add(game);
      if (id) seenIds.add(id);

      const rating = finiteRating(
        game.metadata?.playerRating
        ?? game.playerRating
        ?? game.me?.rating,
      ) ?? playerRatingFromRawGame(game, identities);
      if (rating === null) continue;

      const rated = game.metadata?.rated ?? game.rated;
      addObservation(
        observations,
        rating,
        rated === false ? 0.45 : 0.8,
        "game-rating",
      );
    }
  }
}

function weightedMedian(observations) {
  const sorted = [...observations].sort((left, right) => left.rating - right.rating);
  const total = sorted.reduce((sum, observation) => sum + observation.weight, 0);
  let cumulative = 0;
  for (const observation of sorted) {
    cumulative += observation.weight;
    if (cumulative >= total / 2) return observation.rating;
  }
  return sorted.at(-1)?.rating ?? DEFAULT_LEARNER_RATING;
}

function automaticEstimate(input) {
  const observations = [];
  addAccountRatings(observations, input);
  addGameRatings(observations, input);
  if (observations.length === 0) {
    return {
      rating: DEFAULT_LEARNER_RATING,
      source: "default",
      confidence: "low",
      evidenceCount: 0,
      evidenceSources: [],
    };
  }

  const median = weightedMedian(observations);
  const floor = median - 350;
  const ceiling = median + 350;
  let weightedTotal = 0;
  let totalWeight = 0;
  for (const observation of observations) {
    const bounded = Math.max(floor, Math.min(ceiling, observation.rating));
    weightedTotal += bounded * observation.weight;
    totalWeight += observation.weight;
  }
  const sources = [...new Set(observations.map(({ source }) => source))].sort();
  const hasReliablePerf = observations.some((observation) => (
    observation.source === "lichess-perf" && observation.weight >= 3
  ));
  const confidence = hasReliablePerf && totalWeight >= 8
    ? "high"
    : totalWeight >= 3 || observations.length >= 3 ? "medium" : "low";

  return {
    rating: Math.round(weightedTotal / totalWeight),
    source: sources.length === 1 ? sources[0] : "combined",
    confidence,
    evidenceCount: observations.length,
    evidenceSources: sources,
  };
}

/**
 * Creates a privacy-minimal coaching profile from account, saved-game and Lichess
 * metadata. The returned object intentionally contains no name, e-mail address,
 * external account ID or game ID and is therefore safe to add to a coach prompt.
 */
export function buildLearnerProfile(input = {}) {
  const normalizedInput = Array.isArray(input) ? { games: input } : (input || {});
  const automatic = automaticEstimate(normalizedInput);
  const manual = manualPreference(normalizedInput);
  const rating = manual.rating ?? automatic.rating;
  const automaticLevel = ratingToLearnerLevel(automatic.rating);
  const level = manual.level || ratingToLearnerLevel(rating);
  const manualRating = manual.rating !== null;
  const manualLevel = manual.level !== null;

  return {
    rating,
    level,
    levelLabel: LEARNER_LEVELS[level].label,
    automaticRating: automatic.rating,
    automaticLevel,
    ratingSource: manualRating ? "manual" : automatic.source,
    levelSource: manualLevel ? "manual" : (manualRating ? "manual-rating" : "automatic"),
    confidence: manualRating ? "high" : automatic.confidence,
    usedDefault: automatic.source === "default" && !manualRating,
    manualOverride: {
      active: manualRating || manualLevel,
      rating: manualRating,
      level: manualLevel,
    },
    evidence: {
      count: automatic.evidenceCount,
      sources: [...automatic.evidenceSources],
    },
    explanationLimits: cloneLimits(level),
  };
}

/**
 * Narrows any learner profile to the fields the coach actually needs.
 */
export function learnerProfileForCoach(value) {
  const directRating = finiteRating(value?.rating);
  const directLevel = cleanLevel(value?.level);
  const profile = value?.explanationLimits
    ? value
    : directRating !== null || directLevel
      ? {
        rating: directRating ?? LEVEL_RATING[directLevel] ?? DEFAULT_LEARNER_RATING,
        level: directLevel || ratingToLearnerLevel(directRating),
      }
      : buildLearnerProfile(value);
  const rating = finiteRating(profile.rating) ?? DEFAULT_LEARNER_RATING;
  const level = cleanLevel(profile.level) || ratingToLearnerLevel(rating);
  return {
    rating,
    level,
    explanationLimits: cloneLimits(level),
  };
}

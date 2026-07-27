import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLearnerProfile,
  DEFAULT_LEARNER_RATING,
  explanationLimitsForLevel,
  learnerProfileForCoach,
  ratingToLearnerLevel,
} from "../learnerProfile.js";

test("Rating-Grenzen werden stabil den vier Lernstufen zugeordnet", () => {
  assert.equal(ratingToLearnerLevel(1199), "beginner");
  assert.equal(ratingToLearnerLevel(1200), "intermediate");
  assert.equal(ratingToLearnerLevel(1799), "intermediate");
  assert.equal(ratingToLearnerLevel(1800), "advanced");
  assert.equal(ratingToLearnerLevel(2199), "advanced");
  assert.equal(ratingToLearnerLevel(2200), "expert");
});

test("fehlende oder unbrauchbare Daten ergeben ein sinnvolles neutrales Profil", () => {
  const profile = buildLearnerProfile({
    accountState: {
      profile: {
        name: "Nicht in das Ergebnis übernehmen",
        email: "privat@example.test",
      },
      games: [{ metadata: { playerRating: "keine Wertung" } }],
    },
  });

  assert.equal(profile.rating, DEFAULT_LEARNER_RATING);
  assert.equal(profile.level, "intermediate");
  assert.equal(profile.ratingSource, "default");
  assert.equal(profile.confidence, "low");
  assert.equal(profile.usedDefault, true);
  assert.deepEqual(profile.evidence, { count: 0, sources: [] });
  assert.equal(JSON.stringify(profile).includes("privat@example.test"), false);
  assert.equal(JSON.stringify(profile).includes("Nicht in das Ergebnis"), false);
});

test("Lichess-Zeitformatwertungen werden nach Aktivität und Relevanz gewichtet", () => {
  const profile = buildLearnerProfile({
    lichessAccount: {
      id: "private-id",
      username: "PrivateName",
      perfs: {
        rapid: { rating: 1880, games: 100 },
        blitz: { rating: 1820, games: 64 },
        bullet: { rating: 1500, games: 1, prov: true },
      },
    },
  });

  assert.ok(profile.rating >= 1800 && profile.rating <= 1880);
  assert.equal(profile.level, "advanced");
  assert.equal(profile.ratingSource, "lichess-perf");
  assert.equal(profile.confidence, "high");
  assert.deepEqual(profile.evidence.sources, ["lichess-perf"]);
  assert.equal(JSON.stringify(profile).includes("PrivateName"), false);
});

test("gespeicherte Partie-Ratings funktionieren ohne verbundenes Lichess-Profil", () => {
  const profile = buildLearnerProfile({
    games: [
      { id: "one", metadata: { playerRating: 1540, rated: true } },
      { id: "two", metadata: { playerRating: 1580, rated: true } },
      { id: "three", metadata: { playerRating: 1560, rated: true } },
      { id: "four", metadata: { playerRating: 1550, rated: false } },
    ],
  });

  assert.ok(profile.rating >= 1540 && profile.rating <= 1580);
  assert.equal(profile.level, "intermediate");
  assert.equal(profile.ratingSource, "game-rating");
  assert.equal(profile.confidence, "medium");
  assert.equal(profile.evidence.count, 4);
});

test("rohe Lichess-Partien werden nur bei sicher zuordenbarem Spieler verwendet", () => {
  const game = {
    id: "lichess-one",
    rated: true,
    players: {
      white: { user: { id: "paul" }, rating: 2010 },
      black: { user: { id: "max" }, rating: 2400 },
    },
  };

  const matched = buildLearnerProfile({
    lichessAccount: { id: "paul" },
    lichessGames: [game],
  });
  assert.equal(matched.rating, 2010);
  assert.equal(matched.level, "advanced");

  const unknown = buildLearnerProfile({ lichessGames: [game] });
  assert.equal(unknown.rating, DEFAULT_LEARNER_RATING);
  assert.equal(unknown.usedDefault, true);
});

test("manuelles Rating hat Vorrang vor automatisch geschätzten Daten", () => {
  const profile = buildLearnerProfile({
    lichessAccount: {
      perfs: { rapid: { rating: 1900, games: 80 } },
    },
    manualPreference: { rating: 1050 },
  });

  assert.equal(profile.rating, 1050);
  assert.equal(profile.level, "beginner");
  assert.equal(profile.automaticRating, 1900);
  assert.equal(profile.automaticLevel, "advanced");
  assert.equal(profile.ratingSource, "manual");
  assert.equal(profile.levelSource, "manual-rating");
  assert.deepEqual(profile.manualOverride, {
    active: true,
    rating: true,
    level: false,
  });
});

test("manuelle Erklärstufe kann unabhängig vom Rating gesetzt werden", () => {
  const profile = buildLearnerProfile({
    games: [{ metadata: { playerRating: 900, rated: true } }],
    manualPreference: { level: "expert" },
  });

  assert.equal(profile.rating, 900);
  assert.equal(profile.level, "expert");
  assert.equal(profile.automaticLevel, "beginner");
  assert.equal(profile.levelSource, "manual");
  assert.equal(profile.explanationLimits.terminology.level, "technical");
  assert.equal(profile.explanationLimits.variations.maximumPliesPerLine, 10);
});

test("automatische Präferenz deaktiviert gespeicherte Overrides", () => {
  const profile = buildLearnerProfile({
    accountState: {
      profile: {
        coachPreferences: {
          mode: "auto",
          rating: 2500,
          level: "expert",
        },
      },
    },
    games: [{ metadata: { playerRating: 1350, rated: true } }],
  });

  assert.equal(profile.rating, 1350);
  assert.equal(profile.level, "intermediate");
  assert.equal(profile.manualOverride.active, false);
});

test("Erklärungslimits wachsen kontrolliert mit der Spielstärke", () => {
  const beginner = explanationLimitsForLevel("beginner");
  const expert = explanationLimitsForLevel("expert");

  assert.equal(beginner.short.minimumSentences, 4);
  assert.equal(expert.short.maximumSentences, 6);
  assert.ok(
    beginner.short.maximumWordsPerSentence
      < expert.short.maximumWordsPerSentence,
  );
  assert.ok(
    beginner.variations.maximumPliesPerLine
      < expert.variations.maximumPliesPerLine,
  );
  assert.equal(beginner.terminology.defineUncommonTerms, true);
  assert.equal(expert.terminology.defineUncommonTerms, false);
});

test("Coach-Kontext ist minimal und kann keine Accountdaten weiterreichen", () => {
  const context = learnerProfileForCoach({
    accountState: {
      profile: {
        name: "Paul",
        email: "paul@example.test",
      },
    },
    games: [{ metadata: { playerRating: 1725 } }],
  });

  assert.deepEqual(Object.keys(context), [
    "rating",
    "level",
    "explanationLimits",
  ]);
  assert.equal(context.rating, 1725);
  assert.equal(context.level, "intermediate");
  assert.equal(JSON.stringify(context).includes("paul@example.test"), false);
});

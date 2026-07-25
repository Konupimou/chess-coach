import test from "node:test";
import assert from "node:assert/strict";
import { buildPlayerProfile } from "../playerProfile.js";

function game({
  id,
  color,
  result,
  date,
  opening,
  timeControl = "10+0",
  timeFormat = "rapid",
  plyCount = 40,
  overallAccuracy,
  whiteAccuracy,
  blackAccuracy,
  overallLoss = 30,
  whiteLoss = 20,
  blackLoss = 40,
  analyzedMoves = plyCount,
  coverage = 100,
  counts = {},
  moves,
}) {
  return {
    id,
    title: `Partie ${id}`,
    result,
    plyCount,
    metadata: {
      playerColor: color,
      playedAt: date,
      opening,
      timeFormat,
      timeControl,
    },
    review: {
      final: true,
      totalMoves: plyCount,
      analyzedMoves,
      coverage,
      overallAccuracy,
      whiteAccuracy,
      blackAccuracy,
      averageCentipawnLoss: overallLoss,
      whiteAverageCentipawnLoss: whiteLoss,
      blackAverageCentipawnLoss: blackLoss,
      counts,
      ...(moves ? { moves } : {}),
    },
  };
}

test("Profil gewichtet Genauigkeit nach analysierten Zügen und wertet Ergebnisse aus Spielersicht", () => {
  const profile = buildPlayerProfile([
    game({
      id: "white-win",
      color: "w",
      result: "1-0",
      date: "2026-07-01",
      opening: "Italienisch",
      overallAccuracy: 90,
      whiteAccuracy: 92,
      blackAccuracy: 88,
      analyzedMoves: 20,
      plyCount: 20,
      whiteLoss: 18,
    }),
    game({
      id: "black-win",
      color: "b",
      result: "0-1",
      date: "2026-07-02",
      opening: "Sizilianisch",
      overallAccuracy: 60,
      whiteAccuracy: 55,
      blackAccuracy: 65,
      analyzedMoves: 60,
      plyCount: 60,
      blackLoss: 55,
    }),
    game({
      id: "black-loss",
      color: "b",
      result: "1-0",
      date: "2026-07-03",
      opening: "Sizilianisch",
      overallAccuracy: 80,
      whiteAccuracy: 85,
      blackAccuracy: 75,
      analyzedMoves: 20,
      plyCount: 20,
      blackLoss: 35,
    }),
    { id: "pending", result: "*", metadata: { playerColor: "w" }, plyCount: 10 },
  ]);

  assert.equal(profile.totalGames, 4);
  assert.equal(profile.analyzedGames, 3);
  assert.deepEqual(profile.results, {
    wins: 2,
    draws: 0,
    losses: 1,
    unknown: 1,
    classifiedGames: 3,
    scoreRate: 66.7,
  });
  assert.equal(profile.overallAccuracy, 70);
  assert.equal(profile.ownAccuracy, 72.4);
  assert.equal(profile.whiteAccuracy, 92);
  assert.equal(profile.blackAccuracy, 67.5);
  assert.equal(profile.ownAverageCentipawnLoss, 43.6);
  assert.deepEqual(profile.colorDistribution, {
    white: 2,
    black: 2,
    unknown: 0,
    whitePercent: 50,
    blackPercent: 50,
  });
  assert.equal(profile.favoriteColor, null);
});

test("Eröffnungen unterscheiden Favorit und beste Variante mit mindestens zwei Partien", () => {
  const profile = buildPlayerProfile([
    game({
      id: "a1",
      color: "w",
      result: "1-0",
      date: "2026-01-01",
      opening: "Italienisch",
      overallAccuracy: 80,
      whiteAccuracy: 82,
      blackAccuracy: 78,
    }),
    game({
      id: "a2",
      color: "b",
      result: "0-1",
      date: "2026-01-02",
      opening: " italienisch ",
      overallAccuracy: 84,
      whiteAccuracy: 80,
      blackAccuracy: 88,
    }),
    game({
      id: "a3",
      color: "w",
      result: "0-1",
      date: "2026-01-03",
      opening: "Italienisch",
      overallAccuracy: 70,
      whiteAccuracy: 68,
      blackAccuracy: 72,
    }),
    game({
      id: "b1",
      color: "w",
      result: "1-0",
      date: "2026-01-04",
      opening: "Damengambit",
      overallAccuracy: 90,
      whiteAccuracy: 92,
      blackAccuracy: 88,
      timeControl: "3+2",
    }),
    game({
      id: "b2",
      color: "b",
      result: "0-1",
      date: "2026-01-05",
      opening: "Damengambit",
      overallAccuracy: 90,
      whiteAccuracy: 88,
      blackAccuracy: 92,
      timeControl: "3+2",
    }),
    game({
      id: "one-hit",
      color: "w",
      result: "1-0",
      date: "2026-01-06",
      opening: "Bird",
      overallAccuracy: 99,
      whiteAccuracy: 99,
      blackAccuracy: 99,
    }),
  ]);

  assert.equal(profile.favoriteOpening.name, "Italienisch");
  assert.equal(profile.favoriteOpening.games, 3);
  assert.equal(profile.bestOpening.name, "Damengambit");
  assert.equal(profile.bestOpening.games, 2);
  assert.equal(profile.bestOpening.scoreRate, 100);
  assert.notEqual(profile.bestOpening.name, "Bird");
  assert.equal(profile.mostCommonTimeControl.name, "10+0");
  assert.equal(profile.mostCommonTimeControl.games, 4);
  assert.equal(profile.mostCommonTimeFormat.key, "rapid");
  assert.equal(profile.mostCommonTimeFormat.name, "Rapid");
  assert.equal(profile.mostCommonTimeFormat.games, 6);
});

test("Eigene Fehler und CP-Verluste werden aus farbigen Analysezügen abgeleitet", () => {
  const profile = buildPlayerProfile([
    game({
      id: "moves",
      color: "b",
      result: "0-1",
      date: "2026-02-01",
      opening: "Caro-Kann",
      overallAccuracy: 70,
      whiteAccuracy: null,
      blackAccuracy: null,
      overallLoss: null,
      whiteLoss: null,
      blackLoss: null,
      analyzedMoves: 4,
      plyCount: 4,
      counts: null,
      moves: [
        { color: "w", accuracy: 90, lossCp: 10, quality: "excellent" },
        { color: "b", accuracy: 80, lossCp: 30, quality: "mistake" },
        { color: "w", accuracy: 70, lossCp: 50, quality: "blunder" },
        { color: "b", accuracy: 60, lossCp: 70, quality: "blunder" },
      ],
    }),
  ]);

  assert.equal(profile.ownAccuracy, 70);
  assert.equal(profile.ownAverageCentipawnLoss, 50);
  assert.equal(profile.qualityCounts.mistake, 1);
  assert.equal(profile.qualityCounts.blunder, 2);
  assert.equal(profile.ownQualityCounts.mistake, 1);
  assert.equal(profile.ownQualityCounts.blunder, 1);
  assert.equal(profile.ownQualityCounts.sourceGames, 1);
});

test("Form nutzt die fünf neuesten Datumswerte unabhängig von der Eingabereihenfolge", () => {
  const records = [
    ["g1", "2026-03-01", "1-0", "w"],
    ["g6", "2026-03-06", "0-1", "w"],
    ["g3", "2026-03-03", "1/2-1/2", "b"],
    ["g2", "2026-03-02", "1-0", "b"],
    ["g5", "2026-03-05", "0-1", "b"],
    ["g4", "2026-03-04", "1-0", "w"],
  ].map(([id, date, result, color]) => game({
    id,
    date,
    result,
    color,
    opening: "Test",
    overallAccuracy: 80,
    whiteAccuracy: 80,
    blackAccuracy: 80,
  }));
  const profile = buildPlayerProfile(records);

  assert.deepEqual(profile.currentForm.gameIds, ["g6", "g5", "g4", "g3", "g2"]);
  assert.deepEqual(profile.currentForm.sequence, ["L", "W", "W", "D", "L"]);
  assert.equal(profile.currentForm.scoreRate, 50);
});

test("Bestpartien-Ranking belohnt Ergebnis und Abdeckung und bestraft Patzer", () => {
  const profile = buildPlayerProfile([
    game({
      id: "clean-win",
      color: "w",
      result: "1-0",
      date: "2026-04-01",
      opening: "A",
      overallAccuracy: 90,
      whiteAccuracy: 90,
      blackAccuracy: 90,
      coverage: 100,
      counts: { blunder: 0 },
    }),
    game({
      id: "blunder-win",
      color: "w",
      result: "1-0",
      date: "2026-04-02",
      opening: "B",
      overallAccuracy: 95,
      whiteAccuracy: 95,
      blackAccuracy: 95,
      coverage: 100,
      counts: { blunder: 2 },
    }),
    game({
      id: "partial-loss",
      color: "w",
      result: "0-1",
      date: "2026-04-03",
      opening: "C",
      overallAccuracy: 99,
      whiteAccuracy: 99,
      blackAccuracy: 99,
      analyzedMoves: 10,
      plyCount: 40,
      coverage: 25,
    }),
  ], { bestGamesLimit: 2 });

  assert.deepEqual(profile.topGameIds, ["clean-win", "blunder-win"]);
  assert.equal(profile.bestGames.length, 2);
  assert.ok(profile.bestGames[0].score > profile.bestGames[1].score);
});

test("vorläufige und sehr kurze Analysen zählen nicht als Profilanalyse oder Bestpartie", () => {
  const provisional = game({
    id: "provisional",
    color: "w",
    result: "1-0",
    date: "2026-04-04",
    opening: "Italienisch",
    overallAccuracy: 5,
    whiteAccuracy: 5,
    blackAccuracy: 5,
    plyCount: 30,
    analyzedMoves: 30,
  });
  provisional.review.final = false;
  const short = game({
    id: "short",
    color: "w",
    result: "1-0",
    date: "2026-04-05",
    opening: "Italienisch",
    overallAccuracy: 82,
    whiteAccuracy: 82,
    blackAccuracy: 82,
    plyCount: 6,
    analyzedMoves: 6,
  });

  const profile = buildPlayerProfile([provisional, short]);
  assert.equal(profile.analyzedGames, 1);
  assert.deepEqual(profile.analyzedGameIds, ["short"]);
  assert.equal(profile.ownAccuracy, 82);
  assert.equal(profile.whiteAccuracy, 82);
  assert.equal(profile.openingStats[0].ownAccuracy, 82);
  assert.deepEqual(profile.topGameIds, []);
});

test("Längenstatistik nutzt Halbzüge und erkennt die längste Partie", () => {
  const profile = buildPlayerProfile([
    { id: "short", title: "Kurz", plyCount: 31 },
    { id: "long", title: "Lang", plyCount: 80 },
    { id: "unknown", plyCount: "kaputt" },
  ]);
  assert.equal(profile.averagePlyCount, 55.5);
  assert.equal(profile.averageMoves, 28);
  assert.deepEqual(profile.longestGame, {
    id: "long",
    title: "Lang",
    plyCount: 80,
    moves: 40,
  });
});

test("PGN-Header dienen als defensiver Fallback und ungültige Eingaben bleiben neutral", () => {
  const pgn = `[Event "Vereinsabend"]
[Date "2026.05.07"]
[Result "1-0"]
[Opening "Spanisch"]
[TimeControl "600+5"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 1-0`;
  const profile = buildPlayerProfile([
    null,
    "kein Record",
    {
      id: "pgn",
      metadata: { playerColor: "weiß" },
      pgn,
      review: {
        final: true,
        overallAccuracy: "88.5",
        whiteAccuracy: "90",
        blackAccuracy: "87",
      },
    },
    {
      id: "broken",
      metadata: { playerColor: "grün", playedAt: "kein Datum" },
      result: "irgendwas",
      review: { overallAccuracy: Infinity, analyzedMoves: -5, counts: { blunder: -2 } },
    },
  ]);

  assert.equal(profile.totalGames, 2);
  assert.equal(profile.analyzedGames, 1);
  assert.equal(profile.favoriteOpening.name, "Spanisch");
  assert.equal(profile.mostCommonTimeControl.name, "600+5");
  assert.equal(profile.longestGame.plyCount, 5);
  assert.equal(profile.results.wins, 1);
  assert.equal(profile.results.unknown, 1);
  assert.equal(profile.overallAccuracy, 88.5);
  assert.equal(profile.qualityCounts.blunder, 0);

  const empty = buildPlayerProfile(undefined);
  assert.equal(empty.totalGames, 0);
  assert.equal(empty.overallAccuracy, null);
  assert.equal(empty.currentForm.games, 0);
  assert.deepEqual(empty.topGameIds, []);
});

import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { analyzeCoachLanguage } from "../coachLanguageQuality.js";
import {
  buildCoachPhaseSummary,
  buildFallbackFeedback,
  buildLearningSummary,
  describeMoveAssessment,
  explainMoveQuality,
  summarizeGameReview,
  verifiedMoveReview,
} from "../gameReview.js";
import { PRACTICALLY_EQUIVALENT_LOSS_CP } from "../coachThresholds.js";

const RATINGS = [800, 1000, 1400, 1800];
const GAME_COUNT = Math.max(
  1,
  Math.min(100, Number.parseInt(process.env.COACH_GAME_REVIEW_STRESS_GAMES, 10) || 8),
);
const PLIES_PER_GAME = Math.max(
  12,
  Math.min(80, Number.parseInt(process.env.COACH_GAME_REVIEW_STRESS_PLIES, 10) || 24),
);
const LOSS_SEQUENCE = [0, 6, 18, 45, 90, 155, 315, 28, 68, 220];

function deterministicRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function uci(move) {
  return `${move.from}${move.to}${move.promotion || ""}`;
}

function legalMoves(game) {
  return game.moves({ verbose: true })
    .sort((left, right) => uci(left).localeCompare(uci(right)));
}

function boundedCp(value) {
  return Math.max(-1_500, Math.min(1_500, Math.round(value)));
}

function buildSyntheticGame(seed) {
  const random = deterministicRandom(seed);
  const game = new Chess();
  const nodes = [{ fen: game.fen(), move: null }];
  const evaluations = [];
  let whiteCp = Math.round((random() - 0.5) * 500);

  for (let ply = 0; ply <= PLIES_PER_GAME; ply += 1) {
    const available = legalMoves(game);
    const best = available.length > 0
      ? available[Math.floor(random() * available.length)]
      : null;
    evaluations.push({
      whiteCp,
      evaluation: { unit: "cp", value: whiteCp, perspective: "white" },
      depth: 12,
      pv: best ? [uci(best)] : [],
    });
    if (ply === PLIES_PER_GAME || available.length === 0) break;

    const played = available[Math.floor(random() * available.length)];
    const mover = played.color;
    const loss = LOSS_SEQUENCE[(seed + ply) % LOSS_SEQUENCE.length];
    const legalMove = game.move({
      from: played.from,
      to: played.to,
      promotion: played.promotion,
    });
    whiteCp = boundedCp(whiteCp + (mover === "w" ? -loss : loss));
    nodes.push({ fen: game.fen(), move: legalMove });
  }

  return { nodes, evaluations };
}

function visibleReviewTexts(report, rating) {
  const texts = [];
  report.moves.forEach((move) => {
    texts.push({ kind: "move", move, text: explainMoveQuality(move, { rating }) });
    const assessment = describeMoveAssessment(move, { rating });
    if (assessment) {
      [assessment.lead, assessment.reason, assessment.alternative]
        .filter(Boolean)
        .forEach((text) => texts.push({ kind: "assessment", move, text }));
    }
  });
  buildCoachPhaseSummary(report).forEach((phase) => {
    texts.push({ kind: "phase", text: phase.positive });
    texts.push({ kind: "phase", text: phase.focus });
  });
  const learning = buildLearningSummary(report, { rating });
  [
    learning.strongestPhaseDetail,
    learning.biggestLesson,
    learning.recurringPattern,
    learning.learningGoal,
    learning.exercise,
  ].filter(Boolean).forEach((text) => texts.push({ kind: "learning", text }));
  buildFallbackFeedback(report, { rating })
    .split(/\n{2,}/u)
    .filter(Boolean)
    .forEach((text) => texts.push({ kind: "fallback", text }));
  return texts;
}

test(`${GAME_COUNT * RATINGS.length} vollständige Offline-Partieberichte bleiben einfach, widerspruchsfrei und belegt`, (context) => {
  let checkedReports = 0;
  let checkedMoves = 0;
  let checkedTexts = 0;

  for (let gameIndex = 0; gameIndex < GAME_COUNT; gameIndex += 1) {
    const { nodes, evaluations } = buildSyntheticGame(0x5eed + gameIndex);
    assert.ok(nodes.length >= 10, `synthetische Partie ${gameIndex} ist zu kurz`);

    for (const rating of RATINGS) {
      const report = summarizeGameReview(nodes, evaluations, {
        depth: 12,
        final: true,
        playerColor: gameIndex % 2 === 0 ? "w" : "b",
        coachRating: rating,
      });
      checkedReports += 1;
      checkedMoves += report.moves.length;

      assert.equal(report.coachRating, rating);
      assert.ok(report.moves.length > 0);
      report.moves.forEach((move) => {
        const verified = verifiedMoveReview(move);
        assert.ok(verified, `${gameIndex}/${rating}: ungültiger Zugrückblick`);
        assert.equal(verified.playedUci, move.playedUci);
        if (move.bestUci) assert.equal(verified.bestUci, move.bestUci);
      });

      visibleReviewTexts(report, rating).forEach(({ kind, move, text }) => {
        checkedTexts += 1;
        assert.doesNotMatch(text, /\bSauber\b|genau das war (?:hier )?gefragt/iu);
        assert.doesNotMatch(text, /aktuelle Analysetiefe|geprüfte Antwortfolge|Stockfish|Centipawn|\bPV\b/iu);
        assert.doesNotMatch(text, /\bGenauer (?:war|wäre|ist)\b/iu);

        const language = analyzeCoachLanguage(text, {
          rating,
          practicallyEquivalent: Boolean(
            move
            && move.playedUci !== move.bestUci
            && Number.isFinite(move.lossCp)
            && move.lossCp <= PRACTICALLY_EQUIVALENT_LOSS_CP,
          ),
          evidence: move ? {
            significantLoss: move.lossCp >= 140,
            severeLoss: move.lossCp >= 300,
          } : {},
        });
        assert.equal(
          language.issues.length,
          0,
          `${gameIndex}/${rating}/${kind}: ${text}\n${JSON.stringify(language.issues)}`,
        );

        if (!move) return;
        const playerBeforeCp = move.color === "b" ? -move.beforeCp : move.beforeCp;
        if (playerBeforeCp <= 0) {
          assert.doesNotMatch(text, /dein(?:em|en)? Vorteil|Vorteil ab/iu);
        }
        if (
          move.playedUci !== move.bestUci
          && move.lossCp <= PRACTICALLY_EQUIVALENT_LOSS_CP
        ) {
          assert.doesNotMatch(text, /\b(?:besser|genauer|stärker)\b/iu);
        }
        if (/Genauso gut/iu.test(text)) {
          assert.ok(move.lossCp <= PRACTICALLY_EQUIVALENT_LOSS_CP);
        }
        if (/\bBesser war\b/iu.test(text)) {
          assert.ok(move.bestSan);
          assert.ok(move.lossCp > PRACTICALLY_EQUIVALENT_LOSS_CP);
        }
        if (/grober Fehler|viel schlechter/iu.test(text)) {
          assert.ok(move.lossCp >= 300, `${text} bei ${move.lossCp} cp`);
        }
        if (/klarer Fehler|deutlich schlechter/iu.test(text)) {
          assert.ok(move.lossCp >= 140, `${text} bei ${move.lossCp} cp`);
        }
      });
    }
  }

  assert.equal(checkedReports, GAME_COUNT * RATINGS.length);
  assert.ok(
    checkedMoves >= GAME_COUNT * RATINGS.length * Math.min(10, PLIES_PER_GAME),
    `${checkedMoves} geprüfte Züge`,
  );
  assert.ok(
    checkedTexts >= checkedMoves * 2,
    `${checkedTexts} geprüfte Texte`,
  );
  context.diagnostic(
    `${checkedReports} Berichte · ${checkedMoves} Zugbewertungen · ${checkedTexts} sichtbare Texte`,
  );
});

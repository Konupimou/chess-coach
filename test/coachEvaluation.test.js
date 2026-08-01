import test from "node:test";
import assert from "node:assert/strict";
import {
  COACH_EVALUATION_CASES,
  REQUIRED_COACH_EVALUATION_GROUPS,
} from "./fixtures/coachEvaluationCases.js";
import { FULL_GAME_COACH_CASES } from "./fixtures/fullGameCoachCases.js";
import { Chess } from "chess.js";
import { buildPositionEvidence } from "../positionEvidence.js";
import {
  buildLocalMoveExplanation,
  buildTrustedExplanationEvidence,
  moveExplanationToMarkdown,
  verifyMoveExplanation,
} from "../coachExplanation.js";
import { findUnsupportedMoveTokens } from "../coachEngineContext.js";
import { verifiedMoveReview } from "../gameReview.js";

function runCoachCase(coachCase) {
  const bestValue = coachCase.candidateLines[0]?.evaluation?.value;
  const playedValue = coachCase.playedLine?.evaluation?.value;
  const lossCp = Number.isFinite(bestValue) && Number.isFinite(playedValue)
    ? Math.max(0, bestValue - playedValue)
    : 0;
  const positionEvidence = buildPositionEvidence({
    fenBefore: coachCase.fen,
    playedUci: coachCase.playedMove,
    candidateLines: coachCase.candidateLines,
    playedLine: coachCase.playedLine,
    lossCp,
    quality: coachCase.expectedQuality,
    engineDepth: 18,
    onlyMoveEvidence: coachCase.legalMoveCount === 1
      ? { type: "only_legal_move", legalMoveCount: 1 }
      : null,
    pvLimit: 20,
  });
  const lines = positionEvidence.candidateLines?.map((line) => ({
    rank: line.rank,
    depth: 18,
    evaluation: line.evaluation,
    bestMove: { uci: line.pvUci[0], san: line.pvSan[0] },
    pv: { uci: line.pvUci, san: line.pvSan },
  })) || [];
  const best = lines[0] || null;
  const engineContext = {
    source: "stockfish",
    kind: "move_review",
    fen: coachCase.fen,
    depth: 18,
    lines,
    bestMove: best?.bestMove || null,
    primaryVariation: best?.pv || { uci: [], san: [] },
    playedLine: {
      evaluation: coachCase.playedLine.evaluation,
      uci: coachCase.playedLine.pvUci,
      san: coachCase.playedLine.pvSan,
    },
    moveReview: {
      playedMove: {
        uci: coachCase.playedMove,
        san: coachCase.playedSan,
      },
      bestMove: best?.bestMove || null,
      quality: coachCase.expectedQuality,
      lossCp,
      pv: best?.pv || { uci: [], san: [] },
      onlyMove: positionEvidence.moveComparison?.onlyMove === true,
      onlyMoveEvidence: positionEvidence.moveComparison?.onlyMoveEvidence || null,
    },
  };
  const explanation = buildLocalMoveExplanation({
    positionEvidence,
    engineContext,
  });
  return {
    positionEvidence,
    engineContext,
    explanation,
    text: moveExplanationToMarkdown(explanation, { deep: true }),
  };
}

test("die feste Coach-Evaluation deckt mindestens 50 Fälle und alle Pflichtgruppen ab", () => {
  assert.ok(COACH_EVALUATION_CASES.length >= 50);
  const ids = new Set(COACH_EVALUATION_CASES.map((coachCase) => coachCase.id));
  assert.equal(ids.size, COACH_EVALUATION_CASES.length);
  const covered = new Set(COACH_EVALUATION_CASES.flatMap((coachCase) => coachCase.groups));
  REQUIRED_COACH_EVALUATION_GROUPS.forEach((group) => {
    assert.ok(covered.has(group), `Pflichtgruppe fehlt: ${group}`);
  });
});

test("59 kuratierte Zugfälle liefern legale, konkrete und fachlich erwartete Erklärungen", async (t) => {
  let concreteCases = 0;
  for (const coachCase of COACH_EVALUATION_CASES) {
    await t.test(coachCase.id, () => {
      const result = runCoachCase(coachCase);
      const { positionEvidence, explanation, text } = result;
      assert.equal(positionEvidence.valid, true);
      assert.ok(
        positionEvidence.verifiedLines.every(
          (line) => line.legal === true && line.complete === true,
        ),
        "Alle gelieferten Varianten müssen vollständig legal sein.",
      );
      assert.ok(explanation, "Der lokale Fallback darf bei gültigen Daten nicht null sein.");
      assert.equal(
        positionEvidence.coachAnalysis.verdict.quality,
        coachCase.expectedQuality,
      );
      assert.equal(
        positionEvidence.coachAnalysis.verdict.explanationType,
        coachCase.expectedExplanationType,
      );

      const serialized = JSON.stringify(positionEvidence);
      coachCase.requiredFacts.forEach((fact) => {
        assert.ok(serialized.includes(fact), `Erwarteter Fakt fehlt: ${fact}`);
      });
      coachCase.forbiddenClaims.forEach((claim) => {
        assert.doesNotMatch(text.toLocaleLowerCase("de-DE"), new RegExp(
          claim.toLocaleLowerCase("de-DE").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "u",
        ));
      });

      const motifs = [
        ...positionEvidence.coachAnalysis.playedMoveConsequences.tacticalConsequences
          .map((entry) => entry?.motif?.type || entry?.type),
        ...positionEvidence.coachAnalysis.playedMoveConsequences.strategicConsequences
          .map((entry) => entry.type),
      ];
      coachCase.expectedMotifs.forEach((motif) => {
        assert.ok(motifs.includes(motif), `Erwartetes Motiv fehlt: ${motif}`);
      });
      const dangers = [
        ...positionEvidence.dangers.dangerCreatedByMove,
        ...positionEvidence.dangers.dangerIgnoredByMove,
      ].map((danger) => danger.type);
      coachCase.expectedDanger.forEach((danger) => {
        assert.ok(dangers.includes(danger), `Erwartete Gefahr fehlt: ${danger}`);
      });

      assert.equal(
        positionEvidence.moveComparison?.alternative?.move?.uci || "",
        coachCase.expectedAlternative || "",
      );
      if (positionEvidence.moveComparison?.materialComparison) {
        assert.equal(
          positionEvidence.moveComparison.materialComparison.equalLength,
          true,
          "Material darf nur auf gleichem Variantenhorizont verglichen werden.",
        );
      }
      if (positionEvidence.moveComparison?.onlyMove) {
        assert.ok([
          "only_legal_move",
          "only_move_to_avoid_loss",
          "only_move_to_keep_advantage",
        ].includes(positionEvidence.moveComparison.moveNecessity.type));
      }

      if (
        /[a-h][1-8]|Bauer|Springer|Läufer|Turm|Dame|König|Schach|Matt|Rochade|Zentrum|Linie|Figur/iu
          .test(text)
      ) {
        concreteCases += 1;
      }
    });
  }
  assert.ok(
    concreteCases / COACH_EVALUATION_CASES.length >= 0.9,
    `Nur ${concreteCases}/${COACH_EVALUATION_CASES.length} Fälle sind konkret.`,
  );
});

test("eine allgemeine Vergleichs-ID legitimiert keine erfundene Linienöffnung", () => {
  const result = runCoachCase(COACH_EVALUATION_CASES[0]);
  const fabricated = structuredClone(result.explanation);
  fabricated.moveIdea = {
    text: "Der Zug öffnet die h-Linie.",
    evidenceIds: ["engine.move_comparison"],
    moveRefs: [],
  };
  const checked = verifyMoveExplanation(fabricated, {
    positionEvidence: buildTrustedExplanationEvidence({
      positionEvidence: result.positionEvidence,
      engineContext: result.engineContext,
    }),
    engineContext: result.engineContext,
  });
  assert.equal(checked.valid, false);
});

test("ein nacktes Feldkürzel gilt als Zug, ein ausdrücklich bezeichnetes Feld nicht", () => {
  const result = runCoachCase(COACH_EVALUATION_CASES[0]);
  assert.deepEqual(
    findUnsupportedMoveTokens("d4 war hier besser.", result.engineContext),
    ["d4"],
  );
  assert.deepEqual(
    findUnsupportedMoveTokens("Das Feld d4 wird kontrolliert.", result.engineContext),
    [],
  );
});

test("alte und unvollständige Reviewdaten bleiben defensiv lesbar", () => {
  const coachCase = COACH_EVALUATION_CASES[0];
  const oldReview = verifiedMoveReview({
    fenBefore: coachCase.fen,
    playedUci: coachCase.playedMove,
    bestUci: coachCase.candidateLines[0].pvUci[0],
    bestPvUci: coachCase.candidateLines[0].pvUci,
    quality: coachCase.expectedQuality,
  });
  assert.ok(oldReview);
  assert.equal(oldReview.playedUci, coachCase.playedMove);
});

test("zwei vollständige Beispielpartien bleiben Zug für Zug legal und konkret erklärbar", async (t) => {
  for (const example of FULL_GAME_COACH_CASES) {
    await t.test(example.name, () => {
      const game = new Chess();
      example.moves.forEach((moveCase, ply) => {
        const fen = game.fen();
        const legalMoves = game.moves({ verbose: true }).map(
          (move) => `${move.from}${move.to}${move.promotion || ""}`,
        );
        assert.ok(legalMoves.includes(moveCase.playedMove));
        assert.ok(legalMoves.includes(moveCase.bestMove));
        const fallbackAlternative = legalMoves.find(
          (move) => move !== moveCase.playedMove,
        ) || "";
        const rankOne = [
          moveCase.bestMove,
          moveCase.bestReply,
        ].filter(Boolean);
        const rankTwoMove = moveCase.bestMove === moveCase.playedMove
          ? fallbackAlternative
          : moveCase.playedMove;
        const rankTwo = [
          rankTwoMove,
          moveCase.bestMove === moveCase.playedMove ? "" : moveCase.playedReply,
        ].filter(Boolean);
        const candidateLines = [
          {
            rank: 1,
            evaluation: {
              unit: "cp",
              value: moveCase.bestCp,
              perspective: "player",
            },
            pvUci: rankOne,
          },
          ...(rankTwo.length > 0 ? [{
            rank: 2,
            evaluation: {
              unit: "cp",
              value: moveCase.bestMove === moveCase.playedMove
                ? moveCase.secondCp
                : moveCase.playedCp,
              perspective: "player",
            },
            pvUci: rankTwo,
          }] : []),
        ];
        const playedLine = candidateLines.find(
          (line) => line.pvUci[0] === moveCase.playedMove,
        );
        const positionEvidence = buildPositionEvidence({
          fenBefore: fen,
          playedUci: moveCase.playedMove,
          candidateLines,
          playedLine,
          quality: moveCase.quality,
          engineDepth: 18,
          lossCp: Math.max(0, moveCase.bestCp - (moveCase.playedCp ?? moveCase.bestCp)),
        });
        assert.equal(positionEvidence.valid, true);
        assert.ok(JSON.stringify(positionEvidence).includes(moveCase.expectedFact));

        const verifiedLines = positionEvidence.candidateLines.map((line) => ({
          rank: line.rank,
          depth: 18,
          evaluation: line.evaluation,
          bestMove: { uci: line.pvUci[0], san: line.pvSan[0] },
          pv: { uci: line.pvUci, san: line.pvSan },
        }));
        const explanation = buildLocalMoveExplanation({
          positionEvidence,
          engineContext: {
            source: "stockfish",
            kind: "move_review",
            fen,
            depth: 18,
            lines: verifiedLines,
            bestMove: verifiedLines[0].bestMove,
            primaryVariation: verifiedLines[0].pv,
            playedLine: {
              evaluation: playedLine.evaluation,
              uci: playedLine.pvUci,
              san: positionEvidence.verifiedLines.find(
                (line) => line.moves[0]?.uci === moveCase.playedMove,
              )?.moves.map((move) => move.san) || [],
            },
            moveReview: {
              playedMove: {
                uci: moveCase.playedMove,
                san: positionEvidence.playedMove.san,
              },
              bestMove: verifiedLines[0].bestMove,
              quality: moveCase.quality,
              lossCp: positionEvidence.moveComparison.lossCp,
              pv: verifiedLines[0].pv,
              onlyMove: positionEvidence.moveComparison.onlyMove,
              onlyMoveEvidence: positionEvidence.moveComparison.onlyMoveEvidence,
            },
          },
        });
        assert.ok(explanation, `Kein lokaler Text in Halbzug ${ply + 1}.`);
        assert.ok(moveExplanationToMarkdown(explanation).length > 20);
        game.move({
          from: moveCase.playedMove.slice(0, 2),
          to: moveCase.playedMove.slice(2, 4),
          promotion: moveCase.playedMove[4],
        });
      });
      assert.equal(game.isGameOver(), true);
      assert.equal(game.isCheckmate(), true);
    });
  }
});

export { runCoachCase };

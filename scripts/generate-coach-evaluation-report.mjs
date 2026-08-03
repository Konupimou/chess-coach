import { mkdir, writeFile } from "node:fs/promises";
import { Chess } from "chess.js";
import { buildPositionEvidence } from "../positionEvidence.js";
import {
  buildLocalMoveExplanation,
  moveExplanationToMarkdown,
} from "../coachExplanation.js";
import {
  COACH_EVALUATION_CASES,
  REQUIRED_COACH_EVALUATION_GROUPS,
} from "../test/fixtures/coachEvaluationCases.js";
import { FULL_GAME_COACH_CASES } from "../test/fixtures/fullGameCoachCases.js";

const REPORT_PATH = new URL("../reports/coach-evaluation.md", import.meta.url);
const REPRESENTATIVE_IDS = Object.freeze([
  "italian-01",
  "opening-early-queen",
  "strategy-missed-castle",
  "tactic-mate-threat",
  "tactic-hanging-queen",
  "tactic-knight-fork",
  "strategy-prophylaxis",
  "strategy-pawn-break",
  "endgame-passed-pawn",
  "forced-only-legal",
]);

function uci(move) {
  return `${move.from}${move.to}${move.promotion || ""}`.toLowerCase();
}

function alternateMove(fen, excluded) {
  return new Chess(fen)
    .moves({ verbose: true })
    .map(uci)
    .find((move) => move !== excluded) || "";
}

function caseResult(coachCase) {
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
      playedMove: { uci: coachCase.playedMove, san: coachCase.playedSan },
      bestMove: best?.bestMove || null,
      quality: coachCase.expectedQuality,
      lossCp,
      pv: best?.pv || { uci: [], san: [] },
      onlyMove: positionEvidence.moveComparison?.onlyMove === true,
      onlyMoveEvidence: positionEvidence.moveComparison?.onlyMoveEvidence || null,
    },
  };
  const explanation = buildLocalMoveExplanation({ positionEvidence, engineContext });
  return {
    positionEvidence,
    explanation,
    text: moveExplanationToMarkdown(explanation, { deep: true }),
  };
}

function fullGameResults(gameCase) {
  const game = new Chess();
  return gameCase.moves.map((moveCase, index) => {
    const fen = game.fen();
    const fallback = alternateMove(fen, moveCase.playedMove);
    const rankTwoMove = moveCase.bestMove === moveCase.playedMove
      ? fallback
      : moveCase.playedMove;
    const candidateLines = [
      {
        rank: 1,
        evaluation: {
          unit: "cp",
          value: moveCase.bestCp,
          perspective: "player",
        },
        pvUci: [moveCase.bestMove, moveCase.bestReply].filter(Boolean),
      },
      {
        rank: 2,
        evaluation: {
          unit: "cp",
          value: moveCase.bestMove === moveCase.playedMove
            ? moveCase.secondCp
            : moveCase.playedCp,
          perspective: "player",
        },
        pvUci: [
          rankTwoMove,
          moveCase.bestMove === moveCase.playedMove ? "" : moveCase.playedReply,
        ].filter(Boolean),
      },
    ];
    const lineSan = (line) => {
      const lineGame = new Chess(fen);
      return line.pvUci.map((moveUci) => lineGame.move({
        from: moveUci.slice(0, 2),
        to: moveUci.slice(2, 4),
        promotion: moveUci[4],
      }).san);
    };
    candidateLines.forEach((line) => {
      line.pvSan = lineSan(line);
    });
    const playedLineCandidate = candidateLines.find(
      (line) => line.pvUci[0] === moveCase.playedMove,
    );
    const playedLine = {
      evaluation: {
        unit: "cp",
        value: moveCase.playedCp ?? moveCase.bestCp,
        perspective: "player",
      },
      pvUci: playedLineCandidate.pvUci,
      pvSan: playedLineCandidate.pvSan,
    };
    const played = game.move({
      from: moveCase.playedMove.slice(0, 2),
      to: moveCase.playedMove.slice(2, 4),
      promotion: moveCase.playedMove[4],
    });
    const result = caseResult({
      id: `${gameCase.id}-${index + 1}`,
      fen,
      playedMove: moveCase.playedMove,
      playedSan: played.san,
      candidateLines,
      playedLine,
      expectedQuality: moveCase.quality,
      legalMoveCount: null,
    });
    return {
      ply: index + 1,
      san: played.san,
      expectedFact: moveCase.expectedFact,
      ...result,
    };
  });
}

function blockquote(text) {
  return text.split("\n").filter(Boolean).map((line) => `> ${line}`).join("\n");
}

const results = COACH_EVALUATION_CASES.map((coachCase) => ({
  coachCase,
  ...caseResult(coachCase),
}));
const concrete = results.filter(({ text }) => (
  /[a-h][1-8]|Bauer|Springer|Läufer|Turm|Dame|König|Schach|Matt|Rochade|Zentrum|Linie|Figur/iu
    .test(text)
));
const categories = new Map();
for (const { coachCase } of results) {
  categories.set(coachCase.category, (categories.get(coachCase.category) || 0) + 1);
}

const sections = [
  "# Evaluationsbericht: Zug-für-Zug-Coach",
  "",
  `Erzeugt am ${new Date().toISOString().slice(0, 10)} aus der lokalen, verifizierten Fallback-Pipeline.`,
  "",
  "## Zusammenfassung",
  "",
  `- Kuratierte Einzelstellungen: ${results.length}`,
  `- Abgedeckte Pflichtgruppen: ${REQUIRED_COACH_EVALUATION_GROUPS.length}`,
  `- Konkret formulierte lokale Erklärungen: ${concrete.length}/${results.length} (${Math.round((concrete.length / results.length) * 100)} %)`,
  `- Vollständige Beispielpartien: ${FULL_GAME_COACH_CASES.length}`,
  "- Jede dokumentierte Variante stammt aus den gelieferten legal geprüften Kandidatenlinien.",
  "- Materialvergleiche verwenden in beiden Linien denselben Halbzughorizont.",
  "",
  "## Verteilung",
  "",
  "| Kategorie | Fälle |",
  "| --- | ---: |",
  ...[...categories.entries()].sort().map(([category, count]) => `| ${category} | ${count} |`),
  "",
  "## Zehn repräsentative Vorher-/Nachher-Beispiele",
  "",
  "„Vorher“ bezeichnet die im Altcode beobachtete Schablonenklasse, nicht eine erneut ausgeführte Engine-Analyse. „Nachher“ ist die tatsächliche Ausgabe des aktuellen lokalen Coachs.",
  "",
];

for (const id of REPRESENTATIVE_IDS) {
  const result = results.find((entry) => entry.coachCase.id === id);
  sections.push(
    `### ${result.coachCase.id}: ${result.coachCase.playedSan}`,
    "",
    "**Vorher (Schablonenklasse)**",
    "",
    "> Die Figur wechselt auf ihr Zielfeld. Die Alternative hielt die Stellung besser zusammen.",
    "",
    "**Nachher (aktuelle lokale Ausgabe)**",
    "",
    blockquote(result.text),
    "",
  );
}

sections.push(
  "## Zwei vollständige Beispielpartien",
  "",
  "Alle Halbzüge werden aus der jeweiligen echten Vorher-Stellung erzeugt und legal auf dem Brett ausgeführt.",
  "",
);

for (const gameCase of FULL_GAME_COACH_CASES) {
  sections.push(`### ${gameCase.name}`, "");
  for (const result of fullGameResults(gameCase)) {
    sections.push(
      `#### Halbzug ${result.ply}: ${result.san}`,
      "",
      `Erwarteter belegter Kernfakt: \`${result.expectedFact}\``,
      "",
      blockquote(result.text),
      "",
    );
  }
}

sections.push(
  "## Fachliche und technische Grenzen",
  "",
  "- Der lokale Coach formuliert nur aus explizit extrahierten Brett- und Variantenfakten. Bei sehr kurzen Varianten kann er deshalb vorsichtiger und knapper bleiben.",
  "- Langfristige strategische Urteile ohne messbares Stellungsmerkmal werden nicht aus einer Bewertungszahl erfunden.",
  "- Seltene Motive wie Ablenkung, Überlastung oder ein langfristig günstiger Abtausch benötigen eine passende Variante; ohne belegte Ereignisfolge werden sie nicht behauptet.",
  "- Die KI-Fassung kann sprachlich variabler sein, muss aber dieselben Evidenz-IDs und legalen Zugreferenzen bestehen.",
  "",
  "## Prüfstatus",
  "",
  "- Dieser Bericht wird automatisch aus den festen Testdaten erzeugt.",
  "- Aktuelle Gesamtzahlen für Tests und Build werden bewusst nicht fest in diesen Bericht geschrieben; sie müssen beim jeweiligen Freigabelauf neu gemessen werden.",
  "- Die repräsentativen Ausgaben benötigen vor einer Freigabe zusätzlich eine aktuelle Prüfung auf Schachlogik, Reihenfolge und Sprache.",
  "",
);

await mkdir(new URL("../reports/", import.meta.url), { recursive: true });
await writeFile(REPORT_PATH, `${sections.join("\n")}\n`, "utf8");
console.log(`Bericht geschrieben: ${REPORT_PATH.pathname}`);

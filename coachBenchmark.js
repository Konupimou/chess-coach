import { createHash } from "node:crypto";
import { Chess } from "chess.js";
import { buildMoveExplanationContext, requestCoachResponse } from "./api/chat.js";
import {
  findUnsupportedBoardClaims,
  findUnsupportedEvaluationTokens,
  findUnsupportedMoveTokens,
} from "./coachEngineContext.js";
import { moveExplanationToMarkdown } from "./coachExplanation.js";
import { validateCoachLanguage } from "./coachLanguageQuality.js";
import { evaluationToPlayerCp } from "./moveNecessity.js";

export const COACH_BENCHMARK_SCHEMA_VERSION = 1;
export const COACH_BENCHMARK_RESULT_VERSION = 1;

export const BENCHMARK_CATEGORIES = Object.freeze([
  "TACTICAL",
  "POSITIONAL",
  "MATERIAL",
  "KING_SAFETY",
  "PAWN_STRUCTURE",
  "DEVELOPMENT",
  "PIECE_ACTIVITY",
  "ENDGAME",
  "MATING_ATTACK",
  "QUIET_MOVE",
  "BLUNDER",
  "MISSED_OPPORTUNITY",
  "MULTI_FACTOR",
  "UNCERTAIN",
  "COMPENSATION",
  "INITIATIVE",
  "PROPHYLAXIS",
  "COMPLEX_ENDGAME",
]);

export const BENCHMARK_QUESTIONS = Object.freeze([
  { id: "why_bad", text: "Warum war mein Zug schlecht?" },
  { id: "why_evaluation", text: "Warum ist diese Stellung so bewertet?" },
  { id: "why_best", text: "Warum bevorzugt Stockfish diesen Zug?" },
  { id: "overlooked", text: "Was habe ich übersehen?" },
  { id: "position_problem", text: "Was ist das wichtigste Problem in meiner Stellung?" },
  { id: "compare", text: "Warum ist dieser Zug besser als meiner?" },
  { id: "lesson", text: "Was sollte ich aus diesem Fehler lernen?" },
  { id: "was_bad", text: "War das wirklich ein schlechter Zug?" },
  { id: "most_important", text: "Was ist hier am wichtigsten?" },
]);

export const BENCHMARK_SCORE_WEIGHTS = Object.freeze({
  moveLegality: 18,
  evidenceIntegrity: 17,
  noHallucination: 20,
  engineConsistency: 15,
  mainReason: 20,
  questionRelevance: 5,
  specificity: 5,
});

const CATEGORY_SET = new Set(BENCHMARK_CATEGORIES);
const QUESTION_MAP = new Map(BENCHMARK_QUESTIONS.map((question) => [question.id, question]));
const DIFFICULTIES = new Set(["beginner", "intermediate", "advanced"]);

const CONCEPT_PATTERNS = Object.freeze({
  hanging_piece: /(?:hängt|hängend|ungedeckt|nicht gedeckt|stellst?.{0,35}(?:dame|turm|läufer|springer|figur).{0,20}ein|eingestellt|verliert? (?:die |eine )?figur|figurenverlust)/iu,
  loose_piece: /(?:ungedeckt|nicht gedeckt|lose figur)/iu,
  material_loss: /(?:material|figur|dame|turm|läufer|springer).{0,35}(?:verlier|weg|geschlagen)|(?:verlier|gewinn).{0,25}(?:material|figur|dame|turm|läufer|springer)/iu,
  material_change: /(?:schlägt|abtausch|material|bauer|figur).{0,35}(?:gewinn|verlier|zurück)/iu,
  fork: /(?:gabel|doppelangriff|zwei.{0,25}(?:figuren|ziele))/iu,
  double_attack: /(?:doppelangriff|zwei.{0,25}(?:figuren|ziele))/iu,
  pin: /(?:fessel|gefesselt|gebunden)/iu,
  skewer: /(?:spieß|spiess)/iu,
  discovered_attack: /(?:abzugsangriff|abzugsschach|linie frei|freigeleg)/iu,
  zwischenzug: /(?:zwischenzug|zuerst.{0,30}(?:schach|schlägt))/iu,
  mating_attack: /(?:matt|mattangriff|mattdrohung)/iu,
  unsafe_king: /(?:könig.{0,25}(?:unsicher|offen|schach|gefahr)|königssicherheit)/iu,
  forcing_check: /(?:schach|könig)/iu,
  development_advantage: /(?:entwickl|ausgangsfeld|figur ins spiel)/iu,
  isolated_pawn: /(?:isoliert|schwacher bauer|bauernschwäche)/iu,
  backward_pawn: /(?:rückständig|schwacher bauer|bauernschwäche)/iu,
  passed_pawn: /(?:freibauer|freien bauer|umwand)/iu,
  space_advantage: /(?:raum|mehr platz)/iu,
  outpost: /(?:vorposten|stützpunkt)/iu,
  rook_on_open_file: /(?:offene.{0,15}linie|turm.{0,25}linie)/iu,
  open_file: /(?:offene.{0,15}linie)/iu,
  weak_square: /(?:schwaches feld|feldschwäche)/iu,
  bad_bishop: /(?:schlechter läufer|läufer.{0,25}(?:eingesperrt|passiv))/iu,
  passive_piece: /(?:passiv|schlechte figur)/iu,
  piece_activity: /(?:aktiv|aktivität|wirksam)/iu,
  prophylaxis: /(?:verhindert|vorbeug|prophyl)/iu,
  pawn_break: /(?:bauernhebel|bauernbruch|öffnet.{0,20}(?:zentrum|linie))/iu,
  center_control: /(?:zentrum|zentrums)/iu,
  king_safety: /(?:königssicherheit|rochade|könig.{0,25}(?:sicher|schutz))/iu,
  king_activity_endgame: /(?:königsaktivität|aktiver könig|könig.{0,30}(?:aktiv|zentrum).{0,20}endspiel|endspiel.{0,30}könig.{0,20}(?:aktiv|zentrum))/iu,
  initiative: /(?:initiative|mit tempo|tempi|druck aufrechterhalten|am zug bleiben)/iu,
  compensation: /(?:kompensation|entschädigung|material.{0,35}(?:aktivität|initiative|angriff)|(?:aktivität|initiative|angriff).{0,35}material)/iu,
  restriction: /(?:einschränk|beschränk|eineng|kein gegenspiel|gegenfigur.{0,20}passiv|hindert)/iu,
  counterplay: /(?:gegenspiel|gegenchancen|konterspiel)/iu,
  opposition: /(?:opposition|schlüsselfeld|körpercheck|bodycheck)/iu,
  zugzwang: /(?:zugzwang|wartezug|keinen nützlichen zug)/iu,
  pawn_race: /(?:bauernrennen|quadratregel|beide freibauern|umwandlungsrennen)/iu,
  rook_activity: /(?:turmaktivität|aktiver turm|turm.{0,25}(?:aktiv|hinter den freibauern))/iu,
  coordination: /(?:koordination|zusammenspiel|figuren.{0,25}zusammen)/iu,
});

const clamp = (value, minimum = 0, maximum = 100) => (
  Math.max(minimum, Math.min(maximum, value))
);

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function moveObject(uci, san = "") {
  return { uci: String(uci || "").toLowerCase(), san: String(san || "") };
}

function playUci(game, uci) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/u.test(String(uci || ""))) return null;
  try {
    return game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
  } catch {
    return null;
  }
}

export function legalLineFromFen(fen, moves) {
  let game;
  try {
    game = new Chess(fen);
  } catch {
    return { legal: false, complete: false, san: [], fenAfter: "" };
  }
  const san = [];
  for (const uci of moves || []) {
    const move = playUci(game, uci);
    if (!move) return { legal: false, complete: false, san, fenAfter: game.fen() };
    san.push(move.san);
  }
  return { legal: true, complete: san.length === (moves || []).length, san, fenAfter: game.fen() };
}

function evaluation(value) {
  if (!value || !["cp", "mate"].includes(value.unit) || !Number.isFinite(value.value)) return null;
  return {
    unit: value.unit,
    value: Math.round(value.value),
    perspective: value.perspective === "white" ? "white" : "player",
  };
}

function lineForEngine(fen, line, fallbackDepth) {
  const pvUci = (line?.pvUci || line?.pv?.uci || []).map((move) => String(move).toLowerCase());
  const checked = legalLineFromFen(fen, pvUci);
  if (!checked.legal || pvUci.length === 0 || !evaluation(line?.evaluation)) return null;
  return {
    rank: Math.max(1, Number.parseInt(line.rank, 10) || 1),
    depth: Math.max(1, Number.parseInt(line.depth, 10) || fallbackDepth),
    evaluation: evaluation(line.evaluation),
    bestMove: moveObject(pvUci[0], checked.san[0]),
    pv: { uci: pvUci, san: checked.san },
  };
}

export function engineContextFromBenchmarkCase(benchmarkCase) {
  const depth = Math.max(1, Number.parseInt(benchmarkCase?.engine?.depth, 10) || 1);
  const lines = (benchmarkCase?.engine?.lines || [])
    .map((line) => lineForEngine(benchmarkCase.fenBefore, line, depth))
    .filter(Boolean)
    .sort((left, right) => left.rank - right.rank);
  const best = lines[0] || null;
  const playedUci = benchmarkCase?.playedMove?.uci || "";
  let played = lines.find((line) => line.bestMove.uci === playedUci) || null;
  if (!played && benchmarkCase?.engine?.playedLine) {
    played = lineForEngine(benchmarkCase.fenBefore, {
      ...benchmarkCase.engine.playedLine,
      rank: lines.length + 1,
    }, depth);
  }
  if (!best || !played) return null;
  const bestCp = evaluationToPlayerCp(best.evaluation);
  const playedCp = evaluationToPlayerCp(played.evaluation);
  const lossCp = Number.isFinite(bestCp) && Number.isFinite(playedCp)
    ? Math.max(0, Math.round(bestCp - playedCp))
    : Math.max(0, Number.parseInt(benchmarkCase?.engine?.lossCp, 10) || 0);
  const quality = benchmarkCase?.engine?.quality
    || (best.bestMove.uci === playedUci ? "best" : lossCp >= 300 ? "blunder" : lossCp >= 140 ? "mistake" : "inaccuracy");
  const allLines = [...lines];
  if (!allLines.some((line) => line.bestMove.uci === played.bestMove.uci)) allLines.push(played);
  return {
    source: "stockfish",
    kind: "move_review",
    fen: benchmarkCase.fenBefore,
    depth,
    evaluation: best.evaluation,
    bestMove: best.bestMove,
    primaryVariation: best.pv,
    lines: allLines,
    playedLine: {
      evaluation: played.evaluation,
      uci: played.pv.uci,
      san: played.pv.san,
    },
    moveReview: {
      playedMove: moveObject(playedUci, benchmarkCase?.playedMove?.san || played.bestMove.san),
      bestMove: best.bestMove,
      quality,
      lossCp,
      evaluationBefore: best.evaluation,
      evaluationAfter: played.evaluation,
      evaluationDeltaCp: -lossCp,
      pv: best.pv,
      onlyMove: benchmarkCase?.engine?.onlyMove === true,
      onlyMoveEvidence: benchmarkCase?.engine?.onlyMoveEvidence || null,
    },
  };
}

function validQuestionIds(dataset, benchmarkCase) {
  const available = new Set((dataset.questions || BENCHMARK_QUESTIONS).map((question) => question.id));
  return (benchmarkCase.questionIds || []).filter((id) => available.has(id));
}

export function validateBenchmarkDataset(dataset) {
  const errors = [];
  if (dataset?.schemaVersion !== COACH_BENCHMARK_SCHEMA_VERSION) {
    errors.push(`schemaVersion muss ${COACH_BENCHMARK_SCHEMA_VERSION} sein.`);
  }
  if (!dataset?.datasetId || typeof dataset.datasetId !== "string") errors.push("datasetId fehlt.");
  if (!Array.isArray(dataset?.cases) || dataset.cases.length === 0) errors.push("cases fehlt oder ist leer.");
  const ids = new Set();
  for (const [index, benchmarkCase] of (dataset?.cases || []).entries()) {
    const prefix = `cases[${index}]`;
    if (!benchmarkCase?.id) errors.push(`${prefix}.id fehlt.`);
    if (ids.has(benchmarkCase?.id)) errors.push(`${prefix}.id ist doppelt: ${benchmarkCase.id}.`);
    ids.add(benchmarkCase?.id);
    let game = null;
    try {
      game = new Chess(benchmarkCase?.fenBefore);
    } catch {
      errors.push(`${prefix}.fenBefore ist ungültig.`);
    }
    const played = game ? playUci(game, benchmarkCase?.playedMove?.uci) : null;
    if (!played) errors.push(`${prefix}.playedMove ist illegal.`);
    if (played && benchmarkCase.fenAfter && game.fen() !== benchmarkCase.fenAfter) {
      errors.push(`${prefix}.fenAfter passt nicht zum gespielten Zug.`);
    }
    if (!engineContextFromBenchmarkCase(benchmarkCase)) errors.push(`${prefix}.engine ist nicht nutzbar.`);
    const categories = benchmarkCase?.expected?.categories || [];
    if (categories.length === 0 || categories.some((category) => !CATEGORY_SET.has(category))) {
      errors.push(`${prefix}.expected.categories enthält ungültige Werte.`);
    }
    if (!DIFFICULTIES.has(benchmarkCase?.difficulty)) errors.push(`${prefix}.difficulty ist ungültig.`);
    if (validQuestionIds(dataset, benchmarkCase).length === 0) errors.push(`${prefix}.questionIds enthält keine gültige Frage.`);
    if ("answer" in (benchmarkCase?.expected || {}) || "explanation" in (benchmarkCase?.expected || {})) {
      errors.push(`${prefix}.expected darf keine Musterantwort enthalten.`);
    }
    const reasonMode = benchmarkCase?.expected?.reasonMode || "single";
    if (!["single", "multi_factor", "ambiguous"].includes(reasonMode)) {
      errors.push(`${prefix}.expected.reasonMode ist ungültig.`);
    }
    const groups = benchmarkCase?.expected?.requiredConceptGroups || [];
    if (!Array.isArray(groups)) {
      errors.push(`${prefix}.expected.requiredConceptGroups muss ein Array sein.`);
    } else {
      const groupIds = new Set();
      groups.forEach((group, groupIndex) => {
        if (!group?.id || groupIds.has(group.id)) {
          errors.push(`${prefix}.expected.requiredConceptGroups[${groupIndex}].id fehlt oder ist doppelt.`);
        }
        groupIds.add(group?.id);
        if (!Array.isArray(group?.concepts) || group.concepts.length === 0) {
          errors.push(`${prefix}.expected.requiredConceptGroups[${groupIndex}].concepts fehlt.`);
        }
      });
      if (reasonMode === "multi_factor" && groups.length < 2) {
        errors.push(`${prefix}: multi_factor benötigt mindestens zwei Konzeptgruppen.`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function benchmarkContextForCase(benchmarkCase, { rating = 1400 } = {}) {
  const engineContext = engineContextFromBenchmarkCase(benchmarkCase);
  if (!engineContext) return null;
  return buildMoveExplanationContext({
    engineContext,
    learnerProfile: { rating },
  });
}

function conceptMentioned(text, concepts) {
  return (concepts || []).some((concept) => CONCEPT_PATTERNS[concept]?.test(text));
}

function requiredConceptCoverage(benchmarkCase, diagnosis, answer) {
  const groups = benchmarkCase?.expected?.requiredConceptGroups || [];
  if (groups.length === 0) return null;
  const diagnosisConcepts = new Set([
    diagnosis?.primaryReason?.concept,
    ...(diagnosis?.secondaryReasons || []).map((reason) => reason?.concept),
  ].filter(Boolean));
  const rows = groups.map((group) => ({
    id: group.id,
    diagnosis: group.concepts.some((concept) => diagnosisConcepts.has(concept)),
    answer: conceptMentioned(answer, group.concepts),
  }));
  const percentage = (key) => Number((
    rows.filter((row) => row[key]).length / rows.length * 100
  ).toFixed(2));
  return {
    rows,
    diagnosisPercent: percentage("diagnosis"),
    answerPercent: percentage("answer"),
  };
}

function concreteTextScore(text) {
  const hasPiece = /(?:bauer|springer|läufer|turm|dame|könig|figur)/iu.test(text);
  const hasSquare = /(?:feld\s+)?[a-h][1-8]/iu.test(text);
  const hasAction = /(?:greif|schlägt|deckt|droht|öffnet|entwick|verhindert|kontrolliert|verlier|gewinnt|roch)/iu.test(text);
  return clamp((hasPiece ? 35 : 0) + (hasSquare ? 30 : 0) + (hasAction ? 35 : 0));
}

function questionRelevanceScore(questionId, text, benchmarkCase, context, mainConceptFound) {
  if (!text.trim()) return 0;
  const quality = context?.positionEvidence?.coachAnalysis?.verdict?.quality || "";
  const bestSan = context?.positionEvidence?.moveComparison?.best?.move?.san || "";
  const problemLanguage = /(?:problem|fehler|schlecht|verlier|erlaubt|übersieh|gefahr|droh)/iu.test(text);
  const lessonLanguage = /(?:merke|merksatz|lernen|achte|prüfe|bevor|regel)/iu.test(text);
  if (["why_bad", "overlooked", "position_problem"].includes(questionId)) {
    return clamp(35 + (problemLanguage ? 35 : 0) + (mainConceptFound ? 30 : 0));
  }
  if (["why_evaluation", "most_important"].includes(questionId)) {
    return clamp(40 + (mainConceptFound ? 60 : 0));
  }
  if (["why_best", "compare"].includes(questionId)) {
    const mentionsBest = bestSan && text.toLocaleLowerCase("de-DE").includes(bestSan.toLocaleLowerCase("de-DE"));
    return clamp(35 + (mentionsBest ? 35 : 0) + (mainConceptFound ? 30 : 0));
  }
  if (questionId === "lesson") return clamp(35 + (lessonLanguage ? 40 : 0) + (mainConceptFound ? 25 : 0));
  if (questionId === "was_bad") {
    const assessed = quality === "best"
      ? /(?:gut|kein fehler|spielbar|gleichwertig)/iu.test(text)
      : problemLanguage;
    return assessed ? 100 : 40;
  }
  return 50;
}

function weightedScore(metrics) {
  let total = 0;
  let weights = 0;
  for (const [key, weight] of Object.entries(BENCHMARK_SCORE_WEIGHTS)) {
    if (!Number.isFinite(metrics[key])) continue;
    total += metrics[key] * weight;
    weights += weight;
  }
  return weights > 0 ? total / weights : 0;
}

export function evaluateBenchmarkAnswer({ benchmarkCase, question, answer, context }) {
  const engineContext = context?.engineContext || engineContextFromBenchmarkCase(benchmarkCase);
  const positionEvidence = context?.positionEvidence;
  const diagnosis = context?.diagnosis;
  const expectedConcepts = benchmarkCase.expected?.possibleConcepts || [];
  const expectsNoPrimaryReason = benchmarkCase.expected?.expectNoPrimaryReason === true;
  const reviewedReason = benchmarkCase.expected?.needsReview !== true
    && (expectedConcepts.length > 0 || expectsNoPrimaryReason);
  const unsupportedMoves = findUnsupportedMoveTokens(answer, engineContext);
  const unsupportedBoardClaims = findUnsupportedBoardClaims(answer, engineContext);
  const unsupportedEvaluations = findUnsupportedEvaluationTokens(answer, engineContext);
  const hallucinationIssues = unique([
    ...unsupportedMoves.map((item) => `unsupported_move:${item}`),
    ...unsupportedBoardClaims.map((item) => `unsupported_board:${item}`),
    ...unsupportedEvaluations.map((item) => `unsupported_evaluation:${item}`),
  ]);
  const diagnosisConcept = diagnosis?.primaryReason?.concept || null;
  const factorCoverage = requiredConceptCoverage(benchmarkCase, diagnosis, answer);
  const diagnosisCorrect = reviewedReason
    ? expectsNoPrimaryReason ? diagnosisConcept === null : expectedConcepts.includes(diagnosisConcept)
    : null;
  const uncertaintyExplained = /(?:nicht sicher|nicht eindeutig|keine sichere|unklar|nicht zuverlässig)/iu.test(answer);
  const answerMentionsConcept = reviewedReason
    ? expectsNoPrimaryReason ? uncertaintyExplained : conceptMentioned(answer, expectedConcepts)
    : null;
  const mainReasonScore = reviewedReason
    ? factorCoverage
      ? (diagnosisCorrect ? 45 : 0)
        + factorCoverage.diagnosisPercent * 0.3
        + factorCoverage.answerPercent * 0.25
      : (diagnosisCorrect ? 65 : 0) + (answerMentionsConcept ? 35 : 0)
    : null;
  const requiredFacts = benchmarkCase.expected?.requiredFacts || [];
  const serializedEvidence = JSON.stringify({ positionEvidence, diagnosis });
  const missingFacts = requiredFacts.filter((fact) => !serializedEvidence.includes(fact));
  const lineIntegrity = Boolean(
    positionEvidence?.valid
    && positionEvidence.verifiedLines?.length > 0
    && positionEvidence.verifiedLines.every((line) => line.legal && line.complete),
  );
  const engineConsistency = Boolean(
    engineContext?.bestMove?.uci === benchmarkCase.engine.bestMove
    && engineContext?.moveReview?.playedMove?.uci === benchmarkCase.playedMove.uci
    && missingFacts.length === 0,
  );
  const language = validateCoachLanguage(answer, {
    rating: benchmarkCase.metadata?.rating || 1400,
    strict: false,
    allowTechnicalTerms: true,
  });
  const specificity = concreteTextScore(answer);
  const mainConceptFound = reviewedReason
    ? diagnosisCorrect === true && answerMentionsConcept === true
    : Boolean(diagnosisConcept) && specificity >= 65;
  const metrics = {
    moveLegality: engineContext ? 100 : 0,
    evidenceIntegrity: lineIntegrity ? 100 : 0,
    noHallucination: hallucinationIssues.length === 0 ? 100 : 0,
    engineConsistency: engineConsistency ? 100 : 0,
    mainReason: mainReasonScore,
    questionRelevance: questionRelevanceScore(question.id, answer, benchmarkCase, context, mainConceptFound),
    specificity,
    diagnosisFactorCoverage: factorCoverage?.diagnosisPercent ?? null,
    answerFactorCoverage: factorCoverage?.answerPercent ?? null,
  };
  let score = weightedScore(metrics);
  const diagnosisConfidence = Number(diagnosis?.confidence?.value) || 0;
  const confidentlyWrong = reviewedReason && diagnosisCorrect === false && diagnosisConfidence >= 0.8;
  const majorChessError = !engineContext || !lineIntegrity || !engineConsistency || hallucinationIssues.length > 0;
  if (confidentlyWrong) score -= 20;
  if (majorChessError) score = Math.min(score, 35);
  return {
    score: Number(clamp(score).toFixed(2)),
    metrics,
    flags: {
      hallucination: hallucinationIssues.length > 0,
      majorChessError,
      mainConceptFound,
      contradictsEngine: unsupportedMoves.length > 0 || unsupportedEvaluations.length > 0,
      confidentlyWrong,
    },
    issues: unique([
      ...hallucinationIssues,
      ...missingFacts.map((fact) => `missing_required_fact:${fact}`),
      ...(!lineIntegrity ? ["invalid_or_incomplete_evidence"] : []),
      ...(reviewedReason && !diagnosisCorrect ? [`wrong_primary_reason:${diagnosisConcept || "none"}`] : []),
      ...(reviewedReason && diagnosisCorrect && !answerMentionsConcept ? ["main_reason_not_explained"] : []),
      ...(factorCoverage?.rows || []).flatMap((row) => [
        ...(!row.diagnosis ? [`missing_diagnosis_factor:${row.id}`] : []),
        ...(!row.answer ? [`missing_explanation_factor:${row.id}`] : []),
      ]),
      ...language.errors.map((entry) => `language:${entry.id}`),
    ]),
    diagnosis: {
      concept: diagnosisConcept,
      confidence: diagnosisConfidence,
      level: diagnosis?.confidence?.level || "limited",
      correct: diagnosisCorrect,
      calibrationClass: diagnosisCorrect === null
        ? "unreviewed"
        : diagnosisConfidence >= 0.58
          ? diagnosisCorrect ? "confident_correct" : "confident_wrong"
          : diagnosisCorrect ? "uncertain_correct" : "uncertain_wrong",
    },
  };
}

export async function runBenchmarkCase(benchmarkCase, question, {
  coachMode = "local",
  rating = benchmarkCase?.metadata?.rating || 1400,
  prebuiltContext = null,
  apiKey,
  model,
  fetchImpl = globalThis.fetch,
  judge = null,
} = {}) {
  const context = prebuiltContext || benchmarkContextForCase(benchmarkCase, { rating });
  let answer = "";
  let coachSource = "unavailable";
  if (context?.localExplanation && coachMode === "local") {
    answer = moveExplanationToMarkdown(context.localExplanation, { deep: true });
    coachSource = "local";
  } else if (context && coachMode === "ai") {
    answer = await requestCoachResponse({
      message: question.text,
      engineContext: context.engineContext,
      learnerProfile: { rating },
      history: [],
      conversation: [],
    }, {
      apiKey,
      model,
      fetchImpl,
      safetyIdentifier: `benchmark-${sha256(`${benchmarkCase.id}:${question.id}`).slice(0, 24)}`,
    });
    coachSource = "ai";
  }
  const objective = evaluateBenchmarkAnswer({ benchmarkCase, question, answer, context });
  const subjective = typeof judge === "function"
    ? await judge({ benchmarkCase, question, answer, context, objective })
    : null;
  const subjectiveScore = subjective
    ? [
      subjective.scores?.mainReason,
      subjective.scores?.specificity,
      subjective.scores?.clarity,
      subjective.scores?.teachingQuality,
      subjective.scores?.relevance,
    ].filter(Number.isFinite).reduce((sum, value, _, values) => sum + value / values.length, 0) * 10
    : null;
  let score = subjectiveScore === null
    ? objective.score
    : objective.score * 0.8 + subjectiveScore * 0.2;
  if (objective.flags.majorChessError || subjective?.majorChessError || subjective?.hallucination) {
    score = Math.min(score, 35);
  }
  const diagnosis = context?.diagnosis;
  return {
    caseId: benchmarkCase.id,
    questionId: question.id,
    question: question.text,
    source: benchmarkCase.source,
    categories: benchmarkCase.expected.categories,
    expectedConcepts: benchmarkCase.expected.possibleConcepts || [],
    difficulty: benchmarkCase.difficulty,
    needsReview: benchmarkCase.expected.needsReview === true,
    coachSource,
    answer,
    score: Number(clamp(score).toFixed(2)),
    objective,
    subjective,
    diagnosis: diagnosis ? {
      version: diagnosis.version,
      phase: diagnosis.phase,
      evaluation: diagnosis.evaluation,
      primaryReason: diagnosis.primaryReason,
      secondaryReasons: diagnosis.secondaryReasons,
      confidence: diagnosis.confidence,
      uncertainties: diagnosis.uncertainties,
    } : null,
  };
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function summarizeGroup(results) {
  const reviewed = results.filter((result) => result.objective.diagnosis.correct !== null);
  const hallucinations = results.filter((result) => result.objective.flags.hallucination).length;
  const majorErrors = results.filter((result) => result.objective.flags.majorChessError).length;
  return {
    cases: results.length,
    overallScore: Number(average(results.map((result) => result.score)).toFixed(2)),
    objectiveScore: Number(average(results.map((result) => result.objective.score)).toFixed(2)),
    chessAccuracy: Number(average(results.map((result) => average([
      result.objective.metrics.moveLegality,
      result.objective.metrics.evidenceIntegrity,
      result.objective.metrics.engineConsistency,
      result.objective.metrics.noHallucination,
    ]))).toFixed(2)),
    mainReasonPercent: reviewed.length > 0
      ? Number((reviewed.filter((result) => result.objective.flags.mainConceptFound).length / reviewed.length * 100).toFixed(2))
      : null,
    hallucinationRate: Number((results.length > 0 ? hallucinations / results.length * 100 : 0).toFixed(2)),
    majorErrorRate: Number((results.length > 0 ? majorErrors / results.length * 100 : 0).toFixed(2)),
    diagnosisFactorCoverage: (() => {
      const values = results.map((result) => result.objective.metrics.diagnosisFactorCoverage)
        .filter(Number.isFinite);
      return values.length > 0 ? Number(average(values).toFixed(2)) : null;
    })(),
    answerFactorCoverage: (() => {
      const values = results.map((result) => result.objective.metrics.answerFactorCoverage)
        .filter(Number.isFinite);
      return values.length > 0 ? Number(average(values).toFixed(2)) : null;
    })(),
  };
}

function groupedSummary(results, valuesForResult) {
  const groups = new Map();
  for (const result of results) {
    for (const value of valuesForResult(result)) {
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(result);
    }
  }
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, values]) => [key, summarizeGroup(values)]));
}

export function calibrationMetrics(results) {
  const byCase = new Map();
  results.forEach((result, index) => {
    const key = result.caseId || `result-${index}`;
    if (!byCase.has(key)) byCase.set(key, result);
  });
  const reviewed = [...byCase.values()].filter(
    (result) => result.objective.diagnosis.correct !== null,
  );
  if (reviewed.length === 0) return {
    evaluated: 0,
    brierScore: null,
    expectedCalibrationError: null,
    confidentlyWrong: 0,
    classes: {},
  };
  const brier = average(reviewed.map((result) => {
    const target = result.objective.diagnosis.correct ? 1 : 0;
    return (result.objective.diagnosis.confidence - target) ** 2;
  }));
  const buckets = [[0, 0.4], [0.4, 0.7], [0.7, 1.00001]];
  const ece = buckets.reduce((sum, [minimum, maximum]) => {
    const bucket = reviewed.filter((result) => {
      const confidence = result.objective.diagnosis.confidence;
      return confidence >= minimum && confidence < maximum;
    });
    if (bucket.length === 0) return sum;
    const confidence = average(bucket.map((result) => result.objective.diagnosis.confidence));
    const accuracy = average(bucket.map((result) => result.objective.diagnosis.correct ? 1 : 0));
    return sum + Math.abs(confidence - accuracy) * bucket.length / reviewed.length;
  }, 0);
  const classes = {};
  reviewed.forEach((result) => {
    const key = result.objective.diagnosis.calibrationClass;
    classes[key] = (classes[key] || 0) + 1;
  });
  return {
    evaluated: reviewed.length,
    brierScore: Number(brier.toFixed(4)),
    expectedCalibrationError: Number(ece.toFixed(4)),
    confidentlyWrong: classes.confident_wrong || 0,
    classes,
  };
}

export function summarizeBenchmarkResults(results) {
  const failures = results.filter((result) => (
    result.objective.issues.length > 0
    || result.objective.flags.majorChessError
    || result.score < 80
  ));
  return {
    overall: summarizeGroup(results),
    byCategory: groupedSummary(results, (result) => result.categories),
    byDifficulty: groupedSummary(results, (result) => [result.difficulty]),
    byQuestion: groupedSummary(results, (result) => [result.questionId]),
    bySource: groupedSummary(results, (result) => [result.source?.type || "unknown"]),
    calibration: calibrationMetrics(results),
    failedCases: new Set(failures.map((result) => result.caseId)).size,
    failureCaseIds: unique(failures.map((result) => result.caseId)),
    topFailures: [...failures]
      .sort((left, right) => left.score - right.score || left.caseId.localeCompare(right.caseId, "en"))
      .slice(0, 10)
      .map((result) => ({
        caseId: result.caseId,
        questionId: result.questionId,
        score: result.score,
        expected: result.needsReview ? ["needsReview"] : result.expectedConcepts,
        diagnosis: result.objective.diagnosis.concept,
        issues: result.objective.issues,
        answer: result.answer.slice(0, 500),
      })),
  };
}

export function compareBenchmarkRuns(current, baseline) {
  if (!baseline?.results) return null;
  if (current?.datasetId && baseline?.datasetId && current.datasetId !== baseline.datasetId) return null;
  const previous = new Map(baseline.results.map((result) => [`${result.caseId}:${result.questionId}`, result]));
  const pairs = current.results.flatMap((result) => {
    const before = previous.get(`${result.caseId}:${result.questionId}`);
    return before ? [{ beforeResult: before, afterResult: result }] : [];
  });
  const matched = pairs.map(({ beforeResult, afterResult }) => ({
      caseId: afterResult.caseId,
      questionId: afterResult.questionId,
      before: beforeResult.score,
      after: afterResult.score,
      delta: Number((afterResult.score - beforeResult.score).toFixed(2)),
    }));
  const resultChessAccuracy = (result) => average([
    result.objective?.metrics?.moveLegality,
    result.objective?.metrics?.evidenceIntegrity,
    result.objective?.metrics?.engineConsistency,
    result.objective?.metrics?.noHallucination,
  ]);
  const reasonPercent = (results) => {
    const reviewed = results.filter((result) => result.objective?.diagnosis?.correct !== null);
    return reviewed.length > 0
      ? reviewed.filter((result) => result.objective?.flags?.mainConceptFound).length / reviewed.length * 100
      : 0;
  };
  const rate = (results, predicate) => results.length > 0
    ? results.filter(predicate).length / results.length * 100
    : 0;
  const beforeResults = pairs.map((pair) => pair.beforeResult);
  const afterResults = pairs.map((pair) => pair.afterResult);
  const categoryDeltas = {};
  for (const category of new Set(afterResults.flatMap((result) => result.categories || []))) {
    const categoryPairs = pairs.filter((pair) => pair.afterResult.categories?.includes(category));
    categoryDeltas[category] = Number(average(categoryPairs.map(
      (pair) => pair.afterResult.score - pair.beforeResult.score,
    )).toFixed(2));
  }
  return {
    baselineRunId: baseline.runId || null,
    matchedResults: matched.length,
    overallDelta: Number(average(matched.map((entry) => entry.delta)).toFixed(2)),
    metricDeltas: {
      chessAccuracy: Number((
        average(afterResults.map(resultChessAccuracy)) - average(beforeResults.map(resultChessAccuracy))
      ).toFixed(2)),
      mainReasonPercent: Number((reasonPercent(afterResults) - reasonPercent(beforeResults)).toFixed(2)),
      hallucinationRate: Number((
        rate(afterResults, (result) => result.objective?.flags?.hallucination)
        - rate(beforeResults, (result) => result.objective?.flags?.hallucination)
      ).toFixed(2)),
    },
    categoryDeltas,
    regressions: matched.filter((entry) => entry.delta <= -5).sort((a, b) => a.delta - b.delta).slice(0, 20),
    improvements: matched.filter((entry) => entry.delta >= 5).sort((a, b) => b.delta - a.delta).slice(0, 20),
  };
}

export function benchmarkFingerprint(dataset) {
  return sha256(JSON.stringify(dataset));
}

export function benchmarkQuestion(dataset, id) {
  return (dataset?.questions || BENCHMARK_QUESTIONS).find((question) => question.id === id)
    || QUESTION_MAP.get(id)
    || null;
}

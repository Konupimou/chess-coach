import { Chess } from "chess.js";
import { PRACTICALLY_EQUIVALENT_LOSS_CP } from "./coachThresholds.js";

const FILES = "abcdefgh";
const PIECE_VALUES = Object.freeze({
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
});
const PIECE_NAMES = Object.freeze({
  p: "Bauer",
  n: "Springer",
  b: "Läufer",
  r: "Turm",
  q: "Dame",
  k: "König",
});
const PIECE_SUBJECTS = Object.freeze({
  p: "Der Bauer",
  n: "Der Springer",
  b: "Der Läufer",
  r: "Der Turm",
  q: "Die Dame",
  k: "Der König",
});
const PIECE_OBJECTS = Object.freeze({
  p: "den Bauern",
  n: "den Springer",
  b: "den Läufer",
  r: "den Turm",
  q: "die Dame",
  k: "den König",
});
const HOME_MINOR_SQUARES = new Set(["b1", "c1", "f1", "g1", "b8", "c8", "f8", "g8"]);
const CENTER = new Set(["d4", "e4", "d5", "e5"]);
const ALL_SQUARES = [...FILES].flatMap((file) => (
  Array.from({ length: 8 }, (_, index) => `${file}${index + 1}`)
));
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/i;
const MOTIF_PHRASES = Object.freeze({
  Matt: "ein Matt",
  Umwandlung: "eine Umwandlung",
  Doppelschach: "ein Doppelschach",
  Abzugsschach: "ein Abzugsschach",
  Gabel: "eine Gabel",
  Doppelangriff: "einen Doppelangriff",
  Fesselung: "eine Fesselung",
  Spieß: "einen Spieß",
  "Schlag mit Schach": "einen Schlag mit Schach",
  Schach: "ein Schach",
});
const CONCRETE_FOLLOW_UP_MOTIFS = new Set([
  "Matt",
  "Umwandlung",
  "Doppelschach",
  "Abzugsschach",
  "Gabel",
  "Doppelangriff",
  "Fesselung",
  "Spieß",
  "Schlag mit Schach",
]);

const opposite = (color) => (color === "w" ? "b" : "w");
const squareFile = (square) => FILES.indexOf(square?.[0]);
const squareRank = (square) => Number.parseInt(square?.[1], 10) - 1;
const squareAt = (file, rank) => (
  file >= 0 && file < 8 && rank >= 0 && rank < 8
    ? `${FILES[file]}${rank + 1}`
    : ""
);
const squaresAround = (square) => {
  const file = squareFile(square);
  const rank = squareRank(square);
  return [-1, 0, 1].flatMap((fileStep) => (
    [-1, 0, 1].map((rankStep) => (
      fileStep || rankStep
        ? squareAt(file + fileStep, rank + rankStep)
        : ""
    ))
  )).filter(Boolean);
};

function passedPawnData(game, square, color) {
  if (!game || !square) return { passed: false, path: [] };
  const file = squareFile(square);
  const rank = squareRank(square);
  const direction = color === "w" ? 1 : -1;
  const enemy = opposite(color);
  const enemyPawnAhead = ALL_SQUARES.some((candidate) => {
    const piece = game.get(candidate);
    if (piece?.color !== enemy || piece.type !== "p") return false;
    return (
      Math.abs(squareFile(candidate) - file) <= 1
      && (squareRank(candidate) - rank) * direction > 0
    );
  });
  if (enemyPawnAhead) return { passed: false, path: [] };
  const path = [];
  for (
    let nextRank = rank + direction;
    nextRank >= 0 && nextRank < 8;
    nextRank += direction
  ) {
    const nextSquare = squareAt(file, nextRank);
    if (game.get(nextSquare)) break;
    path.push(nextSquare);
  }
  return { passed: true, path };
}

function loadGame(fen) {
  if (typeof fen !== "string" || !fen.trim()) return null;
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

function playUci(game, rawUci) {
  const uci = String(rawUci || "").toLowerCase();
  if (!game || !UCI_PATTERN.test(uci)) return null;
  try {
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
    return move ? { move, uci } : null;
  } catch {
    return null;
  }
}

function legalCaptureSquaresForMover(game, event) {
  if (!game || !event?.to || !event?.color) return new Set();
  try {
    const parts = game.fen().split(" ");
    // Nach einem Zug ist der Gegner am Zug. Für diese Prüfung wird nur die
    // Zugfarbe zurückgesetzt. So zählt zum Beispiel ein festgebundener
    // Springer nicht als Angreifer einer angeblichen Gabel.
    parts[1] = event.color;
    parts[3] = "-";
    const moverGame = new Chess(parts.join(" "));
    return new Set(
      moverGame.moves({ square: event.to, verbose: true })
        .filter((move) => Boolean(move.captured))
        .map((move) => move.to),
    );
  } catch {
    return new Set();
  }
}

function legalLineEvents(fen, pv, maximum = 16) {
  const game = loadGame(fen);
  if (!game || !Array.isArray(pv)) return [];
  const events = [];
  for (const rawUci of pv.slice(0, maximum)) {
    const fenBefore = game.fen();
    const result = playUci(game, rawUci);
    if (!result) return [];
    const { move, uci } = result;
    const checkedColor = game.turn();
    const checkedKing = game.findPiece({ color: checkedColor, type: "k" })[0] || "";
    const checkAttackers = checkedKing
      ? game.attackers(checkedKing, move.color)
      : [];
    const attackedTargets = ALL_SQUARES
      .flatMap((square) => {
        const piece = game.get(square);
        if (
          piece?.color !== checkedColor
          || !game.attackers(square, move.color).includes(move.to)
        ) return [];
        return [{
          square,
          piece: piece.type,
          value: PIECE_VALUES[piece.type] || 0,
        }];
      })
      .sort((left, right) => right.value - left.value);
    const legalCaptureSquares = legalCaptureSquaresForMover(game, move);
    const legallyAttackedTargets = attackedTargets.filter((target) => (
      target.piece !== "k" && legalCaptureSquares.has(target.square)
    ));
    const defendedTargets = ALL_SQUARES
      .flatMap((square) => {
        const piece = game.get(square);
        if (
          square === move.to
          || piece?.color !== move.color
          || piece.type === "k"
          || !game.attackers(square, move.color).includes(move.to)
        ) return [];
        return [{
          square,
          piece: piece.type,
          value: PIECE_VALUES[piece.type] || 0,
        }];
      })
      .sort((left, right) => right.value - left.value);
    const controlledSquares = ALL_SQUARES.filter((square) => (
      game.attackers(square, move.color).includes(move.to)
    ));
    const controlledCenter = [...CENTER].filter((square) => (
      controlledSquares.includes(square)
    ));
    const enemyKing = game.findPiece({
      color: opposite(move.color),
      type: "k",
    })[0] || "";
    const ownKing = game.findPiece({ color: move.color, type: "k" })[0] || "";
    const enemyKingZone = enemyKing
      ? [enemyKing, ...squaresAround(enemyKing)]
      : [];
    const controlledKingZone = enemyKingZone.filter((square) => (
      controlledSquares.includes(square)
    ));
    const fileSquares = Array.from(
      { length: 8 },
      (_, index) => `${move.to[0]}${index + 1}`,
    );
    const filePawns = fileSquares
      .map((square) => game.get(square))
      .filter((piece) => piece?.type === "p");
    const fileState = filePawns.length === 0
      ? "open"
      : filePawns.every((piece) => piece.color !== move.color)
        ? "semi-open"
        : "closed";
    const passedPawn = move.piece === "p"
      ? passedPawnData(game, move.to, move.color)
      : { passed: false, path: [] };
    events.push({
      index: events.length,
      uci,
      san: move.san,
      from: move.from,
      to: move.to,
      color: move.color,
      piece: move.piece,
      captured: move.captured || "",
      promotion: move.promotion || "",
      givesCheck: game.inCheck(),
      givesMate: game.isCheckmate(),
      fenBefore,
      fenAfter: game.fen(),
      checkedKing,
      checkAttackers,
      attackedTargets,
      legallyAttackedTargets,
      defendedTargets,
      controlledSquares,
      controlledCenter,
      enemyKing,
      ownKing,
      controlledKingZone,
      fileState,
      fileSquares,
      isPassedPawn: passedPawn.passed,
      passedPath: passedPawn.path,
    });
  }
  return events;
}

function rayMotif(game, event) {
  if (!game || !event || !["b", "r", "q"].includes(event.piece)) return null;
  const diagonal = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const straight = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const directions = event.piece === "b"
    ? diagonal
    : event.piece === "r"
      ? straight
      : [...diagonal, ...straight];
  const opponent = opposite(event.color);
  const startFile = squareFile(event.to);
  const startRank = squareRank(event.to);

  for (const [fileStep, rankStep] of directions) {
    const pieces = [];
    for (let distance = 1; distance < 8; distance += 1) {
      const square = squareAt(
        startFile + fileStep * distance,
        startRank + rankStep * distance,
      );
      if (!square) break;
      const piece = game.get(square);
      if (piece) pieces.push({ ...piece, square });
      if (pieces.length >= 2) break;
    }
    const [first, second] = pieces;
    if (
      first?.color === opponent
      && second?.color === opponent
      && first.type !== "k"
      && second.type === "k"
    ) {
      return {
        name: "Fesselung",
        detail: `${PIECE_SUBJECTS[first.type]} auf ${first.square} darf die Linie zum eigenen König nicht freigeben.`,
        targets: [first.square, second.square],
        visualArrows: [
          { from: event.to, to: first.square, role: "threat" },
          { from: first.square, to: second.square, role: "danger" },
        ],
      };
    }
    if (
      first?.color === opponent
      && first.type === "k"
      && second?.color === opponent
      && second.type !== "k"
    ) {
      return {
        name: "Spieß",
        detail: `Der König muss reagieren. Dahinter steht ${second.type === "q" ? "die" : "der"} ${PIECE_NAMES[second.type]} auf ${second.square}.`,
        targets: [first.square, second.square],
        visualArrows: [
          { from: event.to, to: first.square, role: "danger" },
          { from: first.square, to: second.square, role: "threat" },
        ],
      };
    }
  }
  return null;
}

function firstMoveMotif(fen, events) {
  const event = events[0];
  if (!event) return null;
  const after = loadGame(event.fenAfter);
  if (!after) return null;

  if (event.givesMate) {
    return {
      name: "Matt",
      detail: "Der gegnerische König hat keine legale Rettung mehr.",
      targets: [event.checkedKing].filter(Boolean),
      visualArrows: event.checkAttackers.map((from) => ({
        from,
        to: event.checkedKing,
        role: "danger",
      })),
    };
  }
  if (event.promotion) {
    return {
      name: "Umwandlung",
      detail: "Der Freibauer erreicht die letzte Reihe und wird zu einer neuen Figur.",
      targets: [event.to],
      visualArrows: [],
    };
  }
  if (event.givesCheck && event.checkAttackers.length >= 2) {
    return {
      name: "Doppelschach",
      detail: "Zwei Figuren greifen den König gleichzeitig an; nur ein Königszug kann beide Angriffe beantworten.",
      targets: [event.checkedKing].filter(Boolean),
      visualArrows: event.checkAttackers.map((from) => ({
        from,
        to: event.checkedKing,
        role: "danger",
      })),
    };
  }
  if (
    event.givesCheck
    && event.checkAttackers.some((square) => square !== event.to)
  ) {
    return {
      name: "Abzugsschach",
      detail: "Der gezogene Stein öffnet eine Linie, auf der eine andere Figur sofort Schach gibt.",
      targets: [event.checkedKing].filter(Boolean),
      visualArrows: event.checkAttackers.map((from) => ({
        from,
        to: event.checkedKing,
        role: "danger",
      })),
    };
  }

  // Zwei geometrisch angegriffene Bauern sind noch kein lehrreicher
  // Doppelangriff. Es zählen nur legale Angriffe auf Figuren von
  // Springerwert oder höher. Bei einem Schach darf der König das zweite Ziel
  // sein, sofern der gezogene Stein selbst das Schach gibt.
  const valuableTargets = event.legallyAttackedTargets.filter(
    (target) => target.value >= 3,
  );
  const checkedKingTarget = event.givesCheck
    && event.checkedKing
    && event.checkAttackers.includes(event.to)
    ? [{ square: event.checkedKing, piece: "k", value: 0 }]
    : [];
  const attackerValue = PIECE_VALUES[event.piece] || 0;
  const hasClearTwoPieceFork = (
    valuableTargets.length >= 2
    && (
      ["n", "p"].includes(event.piece)
      || valuableTargets.slice(0, 2).every((target) => target.value > attackerValue)
    )
  );
  const forkTargets = checkedKingTarget.length > 0 && valuableTargets.length > 0
    ? [checkedKingTarget[0], valuableTargets[0]]
    : hasClearTwoPieceFork
      ? valuableTargets.slice(0, 2)
      : [];
  if (forkTargets.length >= 2) {
    const name = ["n", "p"].includes(event.piece) ? "Gabel" : "Doppelangriff";
    return {
      name,
      detail: `${PIECE_SUBJECTS[event.piece]} auf ${event.to} greift gleichzeitig ${forkTargets
        .map((target) => `${PIECE_OBJECTS[target.piece]} auf ${target.square}`)
        .join(" und ")} an.`,
      targets: forkTargets.map((target) => target.square),
      visualArrows: forkTargets.map((target) => ({
        from: event.to,
        to: target.square,
        role: "threat",
      })),
    };
  }

  const ray = rayMotif(after, event);
  if (ray) return ray;

  if (event.givesCheck && event.captured) {
    return {
      name: "Schlag mit Schach",
      detail: "Der Zug schlägt einen Stein und gibt zugleich Schach. Der Gegner muss zuerst seinen König schützen.",
      targets: [event.checkedKing].filter(Boolean),
      visualArrows: event.checkAttackers.map((from) => ({
        from,
        to: event.checkedKing,
        role: "danger",
      })),
    };
  }
  if (event.givesCheck) {
    return {
      name: "Schach",
      detail: "Der Zug gibt Schach. Der Gegner muss jetzt seinen König schützen.",
      targets: [event.checkedKing].filter(Boolean),
      visualArrows: event.checkAttackers.map((from) => ({
        from,
        to: event.checkedKing,
        role: "danger",
      })),
    };
  }
  return null;
}

function lineMotif(events) {
  const immediate = firstMoveMotif(events[0]?.fenBefore, events);
  if (immediate) return { ...immediate, eventIndex: 0 };

  const firstMoveIsForcing = Boolean(
    events[0]?.givesCheck
    || events[0]?.givesMate
    || events[0]?.captured
    || events[0]?.promotion,
  );
  if (!firstMoveIsForcing) return null;

  const maximum = Math.min(8, events.length);
  for (let index = 1; index < maximum; index += 1) {
    const previous = events[index - 1];
    const forcingChainContinues = Boolean(
      previous?.givesCheck
      || previous?.givesMate
      || previous?.captured
      || previous?.promotion,
    );
    if (!forcingChainContinues) break;
    const motif = firstMoveMotif(
      events[index]?.fenBefore,
      events.slice(index),
    );
    if (motif && CONCRETE_FOLLOW_UP_MOTIFS.has(motif.name)) {
      return { ...motif, eventIndex: index };
    }
  }
  return null;
}

function chosenPlyCount(events, motif) {
  const maximum = Math.min(16, events.length);
  if (!motif) return Math.min(1, maximum);
  return Math.min(maximum, Math.max(1, (motif.eventIndex || 0) + 1));
}

function strategicIdea(event) {
  if (!event) return {
    kind: "activity",
    headline: "Den Zug am Brett verstehen",
    explanation: "Der Zug konnte am Brett nicht genauer erklärt werden.",
  };
  if (/^O-O(?:-O)?/.test(event.san)) {
    return {
      kind: "castle",
      headline: "Rochieren",
      explanation: `${event.san} zieht den König und den Turm in einem Zug.`,
    };
  }
  if (event.captured) {
    return {
      kind: "capture",
      headline: "Einen Stein schlagen",
      explanation: `${event.san} schlägt ${PIECE_OBJECTS[event.captured]} auf ${event.to}.`,
    };
  }
  if (event.piece === "p" && event.isPassedPawn) {
    return {
      kind: "passed-pawn",
      headline: "Den freien Bauern vorziehen",
      explanation: `${event.san} zieht einen freien Bauern vor. Vor ihm steht auf seiner oder einer benachbarten Linie kein gegnerischer Bauer.`,
    };
  }
  if (CENTER.has(event.to) && event.piece === "p") {
    return {
      kind: "center",
      headline: "Einen Bauern ins Zentrum stellen",
      explanation: `${event.san} stellt den Bauern auf das Zentrumsfeld ${event.to}.`,
    };
  }
  if (HOME_MINOR_SQUARES.has(event.from) && ["n", "b"].includes(event.piece)) {
    return {
      kind: "development",
      headline: "Eine Figur entwickeln",
      explanation: `${event.san} entwickelt den ${PIECE_NAMES[event.piece]} vom Startfeld ${event.from}.`,
    };
  }
  if (
    ["r", "q"].includes(event.piece)
    && ["open", "semi-open"].includes(event.fileState)
  ) {
    return {
      kind: "open-file",
      headline: "Eine Linie ohne eigenen Bauern nutzen",
      explanation: `${event.san} stellt die Figur auf die ${event.to[0]}-Linie. Auf dieser Linie steht kein eigener Bauer.`,
    };
  }
  if (event.controlledKingZone.length >= 2) {
    return {
      kind: "king-pressure",
      headline: "Felder am gegnerischen König kontrollieren",
      explanation: `${event.san} kontrolliert mehrere Felder neben dem gegnerischen König.`,
    };
  }
  if (event.legallyAttackedTargets.length > 0) {
    const target = event.legallyAttackedTargets[0];
    return {
      kind: "pressure",
      headline: "Einen gegnerischen Stein angreifen",
      explanation: `${event.san} greift ${PIECE_OBJECTS[target.piece]} auf ${target.square} direkt an.`,
    };
  }
  if (event.defendedTargets.some((target) => target.value >= 3)) {
    const target = event.defendedTargets.find((entry) => entry.value >= 3);
    return {
      kind: "defense",
      headline: "Eine eigene Figur absichern",
      explanation: `${event.san} deckt ${PIECE_OBJECTS[target.piece]} auf ${target.square}.`,
    };
  }
  if (event.piece === "p") {
    const destinationRank = squareRank(event.to);
    const gainsSpace = event.color === "w"
      ? destinationRank >= 4
      : destinationRank <= 3;
    return {
      kind: gainsSpace ? "space" : "pawn",
      headline: gainsSpace
        ? "Den Bauern weit vorschieben"
        : "Einen Bauern ziehen",
      explanation: `${event.san} stellt den Bauern auf ${event.to}. Die markierten Felder greift er jetzt an.`,
    };
  }
  if (event.piece === "k") {
    return {
      kind: "king",
      headline: "Den König neu positionieren",
      explanation: `${event.san} stellt den König von ${event.from} nach ${event.to}.`,
    };
  }
  return {
    kind: "activity",
    headline: "Die Figur neu aufstellen",
    explanation: `${event.san} stellt den ${PIECE_NAMES[event.piece] || "Stein"} von ${event.from} nach ${event.to}.`,
  };
}

function strategicAnnotations(event, strategic) {
  const base = initialAnnotations(event, null);
  if (!event) return base;
  const kind = strategic?.kind || "activity";
  // Bei einer normalen Entwicklung ist nur der tatsächlich gespielte Zug
  // gemeint. Kontrollierte Felder wie d4 oder e5 sehen sonst wie weitere
  // Zugempfehlungen aus.
  if (kind === "development" || kind === "activity" || kind === "king") {
    return base;
  }
  const annotations = {
    arrows: [...base.arrows],
    highlights: [...base.highlights],
  };
  const addArrow = (from, to, role = "concept", impact = 0.72) => {
    if (!from || !to || from === to) return;
    annotations.arrows.push({
      move: `${from}${to}`,
      rank: 2,
      impact,
      role,
    });
  };
  const addHighlights = (squares, role = "concept", limit = 8) => {
    squares.filter(Boolean).slice(0, limit).forEach((square) => {
      annotations.highlights.push({ square, role });
    });
  };

  if (kind === "center") {
    addHighlights([event.to, ...event.controlledCenter], "concept", 3);
  }

  if (kind === "pawn" || kind === "space") {
    const pawnInfluence = event.controlledSquares.slice(0, 2);
    pawnInfluence.forEach((square) => addArrow(event.to, square, "concept"));
    addHighlights(pawnInfluence, "concept", 2);
  }

  if (kind === "passed-pawn") {
    addHighlights(event.passedPath, "concept", 7);
  }

  if (kind === "pressure") {
    event.legallyAttackedTargets.slice(0, 2).forEach((target) => {
      addArrow(event.to, target.square, "threat", 0.84);
      addHighlights([target.square], "target");
    });
  }

  if (kind === "defense") {
    event.defendedTargets
      .filter((target) => target.value >= 3)
      .slice(0, 2)
      .forEach((target) => {
        addArrow(event.to, target.square, "defense", 0.8);
        addHighlights([target.square], "concept");
      });
  }

  if (kind === "king-pressure") {
    event.controlledKingZone.slice(0, 4).forEach((square) => {
      addArrow(event.to, square, "threat", 0.76);
    });
    addHighlights(event.controlledKingZone, "danger", 5);
    addHighlights([event.enemyKing], "danger", 1);
  }

  if (kind === "open-file") {
    addHighlights(event.fileSquares, "concept", 8);
  }

  if (kind === "castle") {
    const homeRank = event.color === "w" ? "1" : "8";
    const kingSide = event.to[0] === "g";
    const rookMove = kingSide
      ? `h${homeRank}f${homeRank}`
      : `a${homeRank}d${homeRank}`;
    addArrow(rookMove.slice(0, 2), rookMove.slice(2, 4), "defense", 0.78);
    addHighlights([rookMove.slice(2, 4)], "concept", 1);
  }

  if (kind === "capture") {
    addHighlights([event.to], "target", 1);
  }

  return {
    arrows: annotations.arrows.filter((arrow, index, entries) => (
      entries.findIndex((candidate) => (
        candidate.move === arrow.move && candidate.role === arrow.role
      )) === index
    )),
    highlights: annotations.highlights.filter((highlight, index, entries) => (
      entries.findIndex((candidate) => (
        candidate.square === highlight.square
        && candidate.role === highlight.role
      )) === index
    )),
  };
}

function initialAnnotations(event, motif) {
  if (!event) return { arrows: [], highlights: [] };
  const arrows = [{
    move: event.uci,
    rank: 1,
    impact: 1,
    role: "primary",
  }];
  const motifArrows = Array.isArray(motif?.visualArrows)
    ? motif.visualArrows
    : (motif?.targets || []).map((square) => ({
      from: event.to,
      to: square,
      role: "threat",
    }));
  motifArrows
    .filter(({ from, to }) => from && to && from !== to)
    .slice(0, 4)
    .forEach(({ from, to, role = "threat" }) => {
      arrows.push({
        move: `${from}${to}`,
        rank: 2,
        impact: 0.82,
        role,
      });
    });
  const highlights = [
    { square: event.from, role: "origin" },
    { square: event.to, role: "destination" },
    ...(motif?.targets || []).map((square) => ({
      square,
      role: square === event.checkedKing ? "danger" : "target",
    })),
  ];
  return { arrows, highlights };
}

export function buildCoachVisualPlan({
  fen,
  pv,
  rank = 1,
} = {}) {
  const events = legalLineEvents(fen, pv, 16);
  if (events.length === 0) return null;
  const motif = lineMotif(events);
  const plyCount = chosenPlyCount(events, motif);
  const selected = events.slice(0, plyCount);
  const strategic = strategicIdea(events[0]);
  const motifPhrase = MOTIF_PHRASES[motif?.name] || `das Motiv ${motif?.name || ""}`;
  const motifForMover = Boolean(
    motif
    && events[motif.eventIndex]?.color === events[0]?.color,
  );
  const headline = motif
    ? `${motifForMover ? "Motiv im Zug" : "Gefahr"}: ${motif.name}`
    : strategic.headline;
  const explanation = motif
    ? !motifForMover
      ? `In dieser Folge spielt der Gegner ${events[motif.eventIndex].san}. ${motif.detail}`
      : motif.eventIndex === 0
      ? `${events[0].san} zeigt ${motifPhrase}. ${motif.detail}`
      : `In der gezeigten Folge entsteht ${motifPhrase}. ${motif.detail}`
    : strategic.explanation;
  const frameAnnotations = selected.map((event, index) => (
    !motif && index === 0
      ? strategicAnnotations(event, strategic)
      : initialAnnotations(
        event,
        motif?.eventIndex === index ? motif : null,
      )
  ));
  const persistentAnnotations = motif
    ? frameAnnotations[motif.eventIndex] || frameAnnotations.at(-1)
    : strategicAnnotations(events[0], strategic);

  return {
    rank: Math.max(1, Number.parseInt(rank, 10) || 1),
    fen,
    headline,
    explanation,
    motif: motif?.name || "",
    motifForMover,
    tactical: Boolean(motif),
    ideaKind: strategic.kind,
    piece: events[0].piece,
    plyCount,
    uci: selected.map((event) => event.uci),
    san: selected.map((event) => event.san),
    frames: selected.map((event) => ({
      fen: event.fenAfter,
      san: event.san,
      uci: event.uci,
      from: event.from,
      to: event.to,
    })),
    annotations: frameAnnotations[0],
    frameAnnotations,
    persistentAnnotations,
  };
}

export function buildTerminalVisualPlan(fen) {
  const game = loadGame(fen);
  if (!game || !game.isGameOver()) return null;
  const side = game.turn();
  const king = game.findPiece({ color: side, type: "k" })[0] || "";
  const attackers = king
    ? game.attackers(king, opposite(side))
    : [];
  const adjacent = king ? squaresAround(king) : [];
  const highlights = [
    ...(king ? [{ square: king, role: game.isCheckmate() ? "danger" : "target" }] : []),
    ...attackers.map((square) => ({ square, role: "target" })),
    ...adjacent
      .filter((square) => square !== king)
      .filter((square) => game.attackers(square, opposite(side)).length > 0)
      .slice(0, 8)
      .map((square) => ({ square, role: "danger" })),
  ];
  const arrows = attackers.map((from) => ({
    from,
    to: king,
    role: "threat",
    rank: 1,
  }));
  const status = game.isCheckmate()
    ? "checkmate"
    : game.isStalemate()
      ? "stalemate"
      : "draw";
  const sideName = side === "w" ? "Weiß" : "Schwarz";
  const headline = status === "checkmate"
    ? `Schachmatt: ${sideName} hat keinen legalen Ausweg`
    : status === "stalemate"
      ? `Patt: ${sideName} hat keinen legalen Zug`
      : "Remisstellung";
  const explanation = status === "checkmate"
    ? `${sideName} steht im Schach. Die markierten Angreifer kontrollieren den König, und es bleibt kein legaler Flucht-, Schlag- oder Blockierzug.`
    : status === "stalemate"
      ? `${sideName} steht nicht im Schach, hat aber keinen legalen Zug mehr. Deshalb endet die Partie sofort remis.`
      : "Die Stellung erfüllt eine Remisregel; es gibt keinen normalen Folgezug mehr.";
  return {
    rank: 1,
    terminal: status,
    headline,
    explanation,
    tactical: status === "checkmate",
    ideaKind: status,
    plyCount: 0,
    uci: [],
    san: [],
    frames: [],
    annotations: { arrows, highlights },
    persistentAnnotations: { arrows, highlights },
  };
}

export function moveQualityPresentation({
  quality,
  playedUci = "",
  bestUci = "",
  lossCp = null,
} = {}) {
  const presentations = {
    brilliant: { symbol: "!!", label: "Brillant", tone: "brilliant" },
    great: { symbol: "!", label: "Großartig", tone: "great" },
    book: { symbol: "📖", label: "Buchzug", tone: "book" },
    best: { symbol: "★", label: "Bester Zug", tone: "best" },
    excellent: { symbol: "👍", label: "Sehr gut", tone: "excellent" },
    good: { symbol: "✓", label: "Gut", tone: "good" },
    inaccuracy: { symbol: "?!", label: "Ungenauigkeit", tone: "inaccuracy" },
    mistake: { symbol: "?", label: "Fehler", tone: "mistake" },
    miss: { symbol: "✕", label: "Verpasste Chance", tone: "miss" },
    blunder: { symbol: "??", label: "Grober Fehler", tone: "blunder" },
  };
  if (["brilliant", "great", "book"].includes(quality)) return presentations[quality];
  const exactBest = Boolean(playedUci && bestUci && playedUci === bestUci);
  const equivalent = !exactBest
    && Number.isFinite(lossCp)
    && lossCp <= PRACTICALLY_EQUIVALENT_LOSS_CP;
  if (exactBest) return { symbol: "★", label: "Bester Zug", tone: "best" };
  if (equivalent) {
    return {
      symbol: "!",
      label: "Genauso gut",
      tone: "excellent",
    };
  }
  return presentations[quality] || presentations.good;
}

import { Chess } from "chess.js";

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
  "Schach mit Tempo": "ein Schach mit Tempo",
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

function passedPawnPath(game, square, color) {
  if (!game || !square) return [];
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
  if (enemyPawnAhead) return [];
  const path = [];
  for (
    let nextRank = rank + direction;
    nextRank >= 0 && nextRank < 8;
    nextRank += direction
  ) {
    path.push(squareAt(file, nextRank));
  }
  return path;
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
    const passedPath = move.piece === "p"
      ? passedPawnPath(game, move.to, move.color)
      : [];
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
      defendedTargets,
      controlledSquares,
      controlledCenter,
      enemyKing,
      ownKing,
      controlledKingZone,
      fileState,
      fileSquares,
      passedPath,
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
        detail: `${PIECE_NAMES[first.type]} auf ${first.square} steht vor dem eigenen König und kann sich kaum lösen.`,
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
        detail: `Der König muss reagieren; dahinter steht ${PIECE_NAMES[second.type]} auf ${second.square}.`,
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

  const valuableTargets = event.attackedTargets.filter((target) => target.value >= 1);
  if (valuableTargets.length >= 2) {
    const name = ["n", "p"].includes(event.piece) ? "Gabel" : "Doppelangriff";
    return {
      name,
      detail: `${PIECE_NAMES[event.piece]} greift gleichzeitig ${valuableTargets
        .slice(0, 2)
        .map((target) => `${PIECE_NAMES[target.piece]} auf ${target.square}`)
        .join(" und ")} an.`,
      targets: valuableTargets.slice(0, 2).map((target) => target.square),
      visualArrows: valuableTargets.slice(0, 2).map((target) => ({
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
      detail: "Der Zug gewinnt ein Tempo, weil nach dem Schlag zuerst das Schach beantwortet werden muss.",
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
      name: "Schach mit Tempo",
      detail: "Der König muss reagieren, bevor der Gegner seinen eigenen Plan fortsetzen kann.",
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
    explanation: "Der vorgeschlagene Zug zeigt, welche Aufgabe in dieser Stellung besonders wichtig ist.",
  };
  if (/^O-O(?:-O)?/.test(event.san)) {
    return {
      kind: "castle",
      headline: "Den König sichern",
      explanation: "Die Rochade bringt den König aus dem Zentrum und verbindet gleichzeitig die Türme.",
    };
  }
  if (event.captured) {
    return {
      kind: "capture",
      headline: "Die Spannung konkret auflösen",
      explanation: `${event.san} verändert Material und Bauern- oder Figurenstruktur sofort.`,
    };
  }
  if (event.piece === "p" && event.passedPath.length > 0) {
    return {
      kind: "passed-pawn",
      headline: "Den Freibauern voranbringen",
      explanation: `${event.san} schiebt einen Bauern vor, dem auf seiner und den benachbarten Linien kein gegnerischer Bauer mehr entgegensteht.`,
    };
  }
  if (CENTER.has(event.to) && event.piece === "p") {
    return {
      kind: "center",
      headline: "Im Zentrum Raum gewinnen",
      explanation: `${event.san} besetzt ein wichtiges Zentrumsfeld und öffnet Wege für die eigenen Figuren.`,
    };
  }
  if (HOME_MINOR_SQUARES.has(event.from) && ["n", "b"].includes(event.piece)) {
    return {
      kind: "development",
      headline: "Eine Figur sinnvoll entwickeln",
      explanation: `${event.san} bringt den ${PIECE_NAMES[event.piece]} ins Spiel und verbessert seine Wirkung auf die Stellung.`,
    };
  }
  if (
    ["r", "q"].includes(event.piece)
    && ["open", "semi-open"].includes(event.fileState)
  ) {
    return {
      kind: "open-file",
      headline: event.fileState === "open"
        ? "Eine offene Linie besetzen"
        : "Eine halboffene Linie nutzen",
      explanation: `${event.san} stellt die Figur auf eine Linie, auf der kein eigener Bauer den Weg versperrt.`,
    };
  }
  if (event.controlledKingZone.length >= 2) {
    return {
      kind: "king-pressure",
      headline: "Den gegnerischen König einengen",
      explanation: `${event.san} richtet die Figur auf mehrere Felder in der Nähe des gegnerischen Königs. Die Markierungen zeigen den tatsächlich kontrollierten Bereich.`,
    };
  }
  if (event.attackedTargets.length > 0) {
    const target = event.attackedTargets[0];
    return {
      kind: "pressure",
      headline: "Druck auf eine Figur erzeugen",
      explanation: `${event.san} greift ${PIECE_NAMES[target.piece]} auf ${target.square} direkt an und erzeugt konkreten Druck.`,
    };
  }
  if (event.defendedTargets.some((target) => target.value >= 3)) {
    const target = event.defendedTargets.find((entry) => entry.value >= 3);
    return {
      kind: "defense",
      headline: "Eine eigene Figur absichern",
      explanation: `${event.san} unterstützt ${PIECE_NAMES[target.piece]} auf ${target.square} direkt und verbessert damit den Zusammenhalt der Stellung.`,
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
        ? "Mehr Raum beanspruchen"
        : "Die Bauernstruktur verändern",
      explanation: `${event.san} verändert dauerhaft die Bauernstruktur und kontrolliert neue Felder. Diese Felder sind am Brett markiert.`,
    };
  }
  if (event.piece === "k") {
    return {
      kind: "king",
      headline: "Den König neu positionieren",
      explanation: `${event.san} verändert die Königssicherheit und die Felder, die der König selbst kontrolliert.`,
    };
  }
  return {
    kind: "activity",
    headline: "Die Figur aktiver stellen",
    explanation: `${event.san} verbessert die Aufgabe des ${PIECE_NAMES[event.piece] || "Steins"} und bereitet den weiteren Plan vor.`,
  };
}

function strategicAnnotations(event, strategic) {
  const base = initialAnnotations(event, null);
  if (!event) return base;
  const kind = strategic?.kind || "activity";
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
    addHighlights([...CENTER], "concept");
  }

  if (kind === "development" || kind === "activity") {
    const relevant = event.controlledCenter.length > 0
      ? event.controlledCenter
      : event.controlledSquares.filter((square) => !event.defendedTargets.some(
        (target) => target.square === square,
      )).slice(0, 3);
    relevant.slice(0, 3).forEach((square) => {
      addArrow(event.to, square, "concept");
    });
    addHighlights(relevant, "concept", 3);
  }

  if (kind === "pawn" || kind === "space") {
    const pawnInfluence = event.controlledSquares.slice(0, 2);
    pawnInfluence.forEach((square) => addArrow(event.to, square, "concept"));
    addHighlights(pawnInfluence, "concept", 2);
  }

  if (kind === "passed-pawn") {
    addHighlights(event.passedPath, "concept", 7);
    addArrow(
      event.to,
      event.passedPath.at(-1),
      "concept",
      0.86,
    );
  }

  if (kind === "pressure") {
    event.attackedTargets.slice(0, 2).forEach((target) => {
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
    const targetRank = event.color === "w" ? "8" : "1";
    addArrow(event.to, `${event.to[0]}${targetRank}`, "concept", 0.8);
  }

  if (kind === "castle") {
    const homeRank = event.color === "w" ? "1" : "8";
    const kingSide = event.to[0] === "g";
    const rookMove = kingSide
      ? `h${homeRank}f${homeRank}`
      : `a${homeRank}d${homeRank}`;
    addArrow(rookMove.slice(0, 2), rookMove.slice(2, 4), "defense", 0.78);
    addHighlights([
      rookMove.slice(2, 4),
      event.ownKing,
      ...squaresAround(event.ownKing),
    ], "concept", 6);
  }

  if (kind === "king") {
    addHighlights([event.ownKing, ...squaresAround(event.ownKing)], "concept", 6);
  }

  if (kind === "capture") {
    addHighlights([event.to], "target", 1);
  }

  if (kind !== "center" && event.controlledCenter.length > 0) {
    event.controlledCenter.slice(0, 2).forEach((square) => {
      addArrow(event.to, square, "concept", 0.68);
    });
    addHighlights(event.controlledCenter, "concept", 4);
  }

  if (kind !== "pressure" && event.attackedTargets.length > 0) {
    event.attackedTargets.slice(0, 2).forEach((target) => {
      addArrow(event.to, target.square, "threat", 0.8);
      addHighlights([target.square], "target");
    });
  }

  if (kind !== "defense") {
    event.defendedTargets
      .filter((target) => target.value >= 3)
      .slice(0, 2)
      .forEach((target) => {
        addArrow(event.to, target.square, "defense", 0.72);
        addHighlights([target.square], "concept");
      });
  }

  if (kind !== "king-pressure" && event.controlledKingZone.length >= 2) {
    addHighlights(event.controlledKingZone, "danger", 4);
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
    ? `${motifForMover ? "Taktische Idee" : "Taktische Gefahr"}: ${motif.name}`
    : strategic.headline;
  const explanation = motif
    ? !motifForMover
      ? `Die gezeigte Folge macht ${motifPhrase} für den Gegner sichtbar. ${motif.detail}`
      : motif.eventIndex === 0
      ? `${events[0].san} setzt ${motifPhrase} in Gang. ${motif.detail}`
      : `Die gezeigte Folge mündet in ${motifPhrase}. ${motif.detail}`
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
  const exactBest = Boolean(playedUci && bestUci && playedUci === bestUci);
  const equivalent = !exactBest
    && Number.isFinite(lossCp)
    && lossCp <= 15;
  if (exactBest) return { symbol: "★", label: "Bester Zug", tone: "best" };
  if (equivalent) {
    return {
      symbol: "!",
      label: "Ebenfalls bester Zug",
      tone: "excellent",
    };
  }
  const presentations = {
    best: { symbol: "★", label: "Bester Zug", tone: "best" },
    excellent: { symbol: "!", label: "Sehr gut", tone: "excellent" },
    good: { symbol: "✓", label: "Gut", tone: "good" },
    inaccuracy: { symbol: "?!", label: "Ungenauigkeit", tone: "inaccuracy" },
    mistake: { symbol: "?", label: "Fehler", tone: "mistake" },
    blunder: { symbol: "??", label: "Grober Fehler", tone: "blunder" },
  };
  return presentations[quality] || presentations.good;
}

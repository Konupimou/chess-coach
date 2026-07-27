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
  Abtauschfolge: "eine Abtauschfolge",
});

const opposite = (color) => (color === "w" ? "b" : "w");
const squareFile = (square) => FILES.indexOf(square?.[0]);
const squareRank = (square) => Number.parseInt(square?.[1], 10) - 1;
const squareAt = (file, rank) => (
  file >= 0 && file < 8 && rank >= 0 && rank < 8
    ? `${FILES[file]}${rank + 1}`
    : ""
);

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
    const attackedTargets = [...FILES].flatMap((file) => (
      Array.from({ length: 8 }, (_, index) => `${file}${index + 1}`)
    ))
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
    };
  }
  if (event.promotion) {
    return {
      name: "Umwandlung",
      detail: "Der Freibauer erreicht die letzte Reihe und wird zu einer neuen Figur.",
      targets: [event.to],
    };
  }
  if (event.givesCheck && event.checkAttackers.length >= 2) {
    return {
      name: "Doppelschach",
      detail: "Zwei Figuren greifen den König gleichzeitig an; nur ein Königszug kann beide Angriffe beantworten.",
      targets: [event.checkedKing].filter(Boolean),
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
    };
  }

  const ray = rayMotif(after, event);
  if (ray) return ray;

  if (event.givesCheck && event.captured) {
    return {
      name: "Schlag mit Schach",
      detail: "Der Zug gewinnt ein Tempo, weil nach dem Schlag zuerst das Schach beantwortet werden muss.",
      targets: [event.checkedKing].filter(Boolean),
    };
  }
  if (event.givesCheck) {
    return {
      name: "Schach mit Tempo",
      detail: "Der König muss reagieren, bevor der Gegner seinen eigenen Plan fortsetzen kann.",
      targets: [event.checkedKing].filter(Boolean),
    };
  }
  if (event.captured && events[1]?.captured) {
    return {
      name: "Abtauschfolge",
      detail: "Die Pointe wird erst nach dem erwarteten Rückschlag vollständig sichtbar.",
      targets: [event.to, events[1].to],
    };
  }
  return null;
}

function lineMotif(events) {
  const maximum = Math.min(8, events.length);
  for (let index = 0; index < maximum; index += 1) {
    const motif = firstMoveMotif(
      events[index]?.fenBefore,
      events.slice(index),
    );
    if (motif) return { ...motif, eventIndex: index };
  }
  return null;
}

function chosenPlyCount(events, motif) {
  if (events.length <= 2) return events.length;
  const maximum = Math.min(16, events.length);
  const firstTacticalIndex = events
    .slice(0, Math.min(5, maximum))
    .findIndex((event) => (
      event.givesCheck || event.givesMate || event.captured || event.promotion
    ));
  if (!motif && firstTacticalIndex < 0) return Math.min(2, maximum);

  let lastForcing = Math.max(0, firstTacticalIndex);
  let quietAfter = 0;
  const minimumForMotif = motif
    ? Math.min(maximum, (motif.eventIndex || 0) + 2)
    : 0;
  for (let index = 0; index < maximum; index += 1) {
    const event = events[index];
    const forcing = Boolean(
      event.givesCheck || event.givesMate || event.captured || event.promotion,
    );
    if (forcing) {
      lastForcing = index;
      quietAfter = 0;
    } else if (index > lastForcing) {
      quietAfter += 1;
    }
    if (event.givesMate && index + 1 >= minimumForMotif) return index + 1;
    if (
      index >= 3
      && quietAfter >= 2
      && index + 1 >= minimumForMotif
    ) return index + 1;
  }
  return maximum;
}

function strategicIdea(event) {
  if (!event) return {
    headline: "Den Zug am Brett verstehen",
    explanation: "Die kurze Antwortfolge zeigt, welche Aufgabe der Zug in dieser Stellung übernimmt.",
  };
  if (/^O-O(?:-O)?/.test(event.san)) {
    return {
      headline: "Den König sichern",
      explanation: "Die Rochade bringt den König aus dem Zentrum und verbindet gleichzeitig die Türme.",
    };
  }
  if (HOME_MINOR_SQUARES.has(event.from) && ["n", "b"].includes(event.piece)) {
    return {
      headline: "Eine Figur sinnvoll entwickeln",
      explanation: `${event.san} bringt den ${PIECE_NAMES[event.piece]} ins Spiel und verbessert seine Wirkung auf die Stellung.`,
    };
  }
  if (CENTER.has(event.to) && event.piece === "p") {
    return {
      headline: "Im Zentrum Raum gewinnen",
      explanation: `${event.san} besetzt ein wichtiges Zentrumsfeld und öffnet Wege für die eigenen Figuren.`,
    };
  }
  if (event.captured) {
    return {
      headline: "Die Stellung konkret klären",
      explanation: `${event.san} löst die Spannung sofort auf; die kurze Folge zeigt, was nach dem Gegenschlag übrig bleibt.`,
    };
  }
  if (event.piece === "p") {
    return {
      headline: "Die Bauernstruktur verbessern",
      explanation: `${event.san} verändert Raum und Felder dauerhaft. Entscheidend ist, welche Figuren davon profitieren.`,
    };
  }
  return {
    headline: "Die Figur aktiver stellen",
    explanation: `${event.san} verbessert die Aufgabe des ${PIECE_NAMES[event.piece] || "Steins"}; die Antwort zeigt, worauf der Zug vorbereitet.`,
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
  (motif?.targets || [])
    .filter((square) => square && square !== event.to)
    .slice(0, 2)
    .forEach((square) => {
      arrows.push({
        move: `${event.to}${square}`,
        rank: 2,
        impact: 0.82,
        role: "threat",
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
    initialAnnotations(
      event,
      motif?.eventIndex === index ? motif : null,
    )
  ));

  return {
    rank: Math.max(1, Number.parseInt(rank, 10) || 1),
    headline,
    explanation,
    motif: motif?.name || "",
    motifForMover,
    tactical: Boolean(motif),
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

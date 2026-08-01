import test from "node:test";
import assert from "node:assert/strict";
import {
  annotationRecords,
  parseAnnotatedPgn,
  tokenizePgnMovetext,
} from "../pgnPipeline.js";

test("Kommentare vor und nach Zügen, NAGs und verschachtelte Varianten bleiben zugeordnet", () => {
  const parsed = parseAnnotatedPgn(`
[Event "Parser Test"]
[White "Alice"]
[Black "Bob"]
[WhiteElo "1234"]
[BlackElo "1300"]
[Annotator "Coach"]
[Result "*"]

{Vor dem ersten Zug} 1. e4! {Kontrolliert das Zentrum.} (1. d4 $5 d5 (1... Nf6 {Indisch.})) 1... e5 2. Nf3 $1 *
`, { source: "fixture.pgn" });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.metadata.whiteElo, 1234);
  assert.equal(parsed.metadata.annotator, "Coach");
  const e4 = parsed.moves.find((move) => move.path === "main.1");
  assert.deepEqual(e4.commentsBefore, ["Vor dem ersten Zug"]);
  assert.deepEqual(e4.commentsAfter, ["Kontrolliert das Zentrum."]);
  assert.deepEqual(e4.nags, [1]);
  assert.equal(e4.annotation.originalComment.includes("Vor dem ersten Zug"), true);
  assert.deepEqual(e4.annotation.alternatives[0].lineSan, ["d4", "d5"]);
  assert.equal(parsed.moves.some((move) => move.variationDepth === 2 && move.san === "Nf6"), true);
  assert.equal(annotationRecords(parsed).some((record) => record.variationDepth === 2), true);
});

test("alternative Start-FEN, Rochade, Umwandlung und en passant werden legal nachgespielt", () => {
  const castle = parseAnnotatedPgn(`
[Event "Castle"]
[SetUp "1"]
[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]
[Result "*"]

1. O-O {Sicher.} O-O-O *`);
  assert.equal(castle.valid, true);
  assert.deepEqual(castle.moves.map((move) => move.uci), ["e1g1", "e8c8"]);

  const promotion = parseAnnotatedPgn(`
[Event "Promotion"]
[SetUp "1"]
[FEN "8/P7/8/8/8/8/7p/4K2k w - - 0 1"]
[Result "*"]

1. a8=Q {Neue Dame.} *`);
  assert.equal(promotion.valid, true);
  assert.equal(promotion.moves[0].uci, "a7a8q");

  const enPassant = parseAnnotatedPgn(`
[Event "En passant"]
[SetUp "1"]
[FEN "8/8/8/3pP3/8/8/8/4K2k w - d6 0 1"]
[Result "*"]

1. exd6 {En passant.} *`);
  assert.equal(enPassant.valid, true);
  assert.equal(enPassant.moves[0].uci, "e5d6");
});

test("fehlerhafte Notation wird protokolliert statt den Parser zu werfen", () => {
  const parsed = parseAnnotatedPgn(`
[Event "Broken"]
[Result "*"]

1. e4 {legal} e5 2. Qz9 {kaputt} *`);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.moves.length, 2);
  assert.equal(parsed.errors.some((error) => error.code === "illegal_move" && error.san === "Qz9"), true);
});

test("kompakte Zugnummern und Semikolon-Kommentare werden tokenisiert", () => {
  const tokens = tokenizePgnMovetext("1.e4 e5 2.Nf3; Entwicklung\n2...Nc6 *");
  assert.equal(tokens.some((token) => token.type === "word" && token.value === "e4"), true);
  assert.equal(tokens.some((token) => token.type === "moveNumber" && token.value === "2..."), true);
  assert.equal(tokens.some((token) => token.type === "comment" && /Entwicklung/.test(token.value)), true);
});

test("strukturierte Annotationen behalten Originaltext und markieren Ableitungen als ungeprüft", () => {
  const parsed = parseAnnotatedPgn(`
[Event "Structure"]
[Result "*"]

1. e4 {The idea is to develop quickly. It threatens mate and follows the principle: always finish development.} (1. d4 d5) *`);
  const annotation = parsed.moves[0].annotation;
  assert.match(annotation.originalComment, /The idea/);
  assert.equal(annotation.claims.some((claim) => claim.field === "moveIdea"), true);
  assert.equal(annotation.claims.some((claim) => claim.field === "immediateThreat"), true);
  assert.equal(annotation.claims.every((claim) => claim.source === "human_annotation"), true);
  assert.equal(annotation.claims.some((claim) => claim.verificationStatus === "unverified"), true);
});

import { Chess } from "chess.js";

export function coachTrainingPositionAfterMove(fen, moveUci) {
  const normalizedFen = typeof fen === "string" ? fen.trim() : "";
  const normalizedUci = typeof moveUci === "string"
    ? moveUci.trim().toLowerCase()
    : "";
  if (!normalizedFen || !/^[a-h][1-8][a-h][1-8][qrbn]?$/u.test(normalizedUci)) {
    return normalizedFen;
  }
  try {
    const game = new Chess(normalizedFen);
    const move = game.move({
      from: normalizedUci.slice(0, 2),
      to: normalizedUci.slice(2, 4),
      promotion: normalizedUci.slice(4, 5) || undefined,
    });
    return move ? game.fen() : normalizedFen;
  } catch {
    return normalizedFen;
  }
}

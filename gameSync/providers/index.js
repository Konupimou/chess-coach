import { createProviderRegistry } from "../provider.js";
import { ChessComProvider } from "./chessCom.js";
import { LichessProvider } from "./lichess.js";

export const gameProviders = createProviderRegistry([
  ChessComProvider,
  LichessProvider,
]);

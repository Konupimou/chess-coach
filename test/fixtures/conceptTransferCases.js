import { TRANSFER_CONCEPT_CATALOGUE } from "../../positionConcepts.js";

const tactical = new Set([
  "pin", "fork", "deflection", "overloaded_defender", "remove_defender",
  "back_rank_weakness", "mate_motif", "exchange_sacrifice",
]);

export const CONCEPT_TRANSFER_CASES = Object.freeze(
  TRANSFER_CONCEPT_CATALOGUE.map((id) => ({
    id,
    type: tactical.has(id) ? "tactical" : "strategic",
    prerequisites: [`condition:${id}`],
    plan: [`plan:${id}`],
    failureCondition: `failure:${id}`,
  })),
);

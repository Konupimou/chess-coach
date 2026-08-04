import { getConceptById } from "./chessKnowledge/index.js";

const DEFINITIONS = [
  {
    type: "fork", knowledgeId: "tactics.fork", ontologyId: "tactics.fork",
    detector: "forkOpportunity", prerequisites: ["legal_move", "multiple_targets"],
    validators: ["best_defence", "exchange_sequence", "countercheck", "target_escape"],
    failureConditions: ["attacker_lost_without_compensation", "all_targets_escape"],
  },
  {
    type: "pin", knowledgeId: "tactics.pin", ontologyId: "tactics.pin",
    detector: "positionConcept", prerequisites: ["aligned_attacker_blocker_target"],
    validators: ["legal_mobility", "break_pin", "countertactic"],
    failureConditions: ["pinned_piece_can_move_legally", "attacker_lost"],
  },
  {
    type: "skewer", knowledgeId: "tactics.skewer", ontologyId: "tactics.skewer",
    detector: "skewerPatterns", prerequisites: ["aligned_high_value_targets"],
    validators: ["front_target_forced_to_move", "exchange_sequence", "line_can_close"],
    failureConditions: ["counterattack_with_tempo", "line_closed", "attacker_lost"],
  },
  {
    type: "discovered_attack", knowledgeId: "tactics.discovered-attack", ontologyId: "tactics.discovered_attack",
    detector: "discoveredAttackOpportunity", prerequisites: ["battery", "legal_uncovering_move"],
    validators: ["revealed_attacker_safety", "target_response", "exchange_sequence"],
    failureConditions: ["revealed_attacker_lost", "target_safe", "uncovering_piece_lost"],
  },
  {
    type: "deflection", knowledgeId: "tactics.deflection", ontologyId: "tactics.deflection",
    detector: "deflectionOpportunity", prerequisites: ["sole_defender", "forcing_displacement"],
    validators: ["alternative_reply", "replacement_defender", "follow_up_gain"],
    failureConditions: ["defender_can_decline", "second_defender", "countertempo"],
  },
  {
    type: "remove_defender", knowledgeId: "tactics.removing-the-defender", ontologyId: "tactics.remove_defender",
    detector: "removalOfDefenderOpportunity", prerequisites: ["key_defender", "legal_removal"],
    validators: ["exchange_sequence", "replacement_defender", "follow_up_gain"],
    failureConditions: ["unfavorable_exchange", "no_follow_up", "replacement_defender"],
  },
  {
    type: "overloaded_defender", knowledgeId: "tactics.deflection", ontologyId: "tactics.overloading",
    detector: "positionConcept", prerequisites: ["defender_has_multiple_duties"],
    validators: ["duty_can_be_abandoned", "second_defender", "countertactic"],
    failureConditions: ["duties_not_forcing", "second_defender", "countertempo"],
  },
  {
    type: "zwischenzug", knowledgeId: "tactics.zwischenzug", ontologyId: "tactics.zwischenzug",
    detector: "intermediateMoveOpportunity", prerequisites: ["expected_recapture", "stronger_forcing_move"],
    validators: ["checks_captures_threats", "original_threat_survives", "best_defence"],
    failureConditions: ["original_threat_lost", "forcing_move_refuted"],
  },
  {
    type: "back_rank_mate", knowledgeId: "tactics.back-rank-tactic", ontologyId: "tactics.back_rank_mate",
    detector: "matingOpportunities", prerequisites: ["king_without_luft", "back_rank_access"],
    validators: ["legal_mate", "all_escapes_covered", "interposition", "capture_attacker"],
    failureConditions: ["escape_square", "legal_interposition", "attacker_captured"],
  },
  {
    type: "mate_motif", knowledgeId: "checkmate.mating-net", ontologyId: "tactics.mate_motif",
    detector: "matingOpportunities", prerequisites: ["restricted_king", "legal_mating_move"],
    validators: ["legal_mate", "all_escapes_covered", "best_defence"],
    failureConditions: ["escape_square", "defensive_resource", "countercheck"],
  },
];

function compactKnowledge(knowledgeId) {
  const concept = getConceptById(knowledgeId);
  if (!concept) return null;
  return Object.freeze({
    id: concept.id,
    name: concept.name.de,
    definition: concept.definition.de,
    explanation: concept.explanation.de,
    exceptions: Object.freeze([...(concept.exceptions?.de || [])]),
    mistakes: Object.freeze([...(concept.commonMistakes?.de || [])]),
    questions: Object.freeze([...(concept.practicalQuestions?.de || [])]),
    signals: Object.freeze([...(concept.retrieval?.signals || [])]),
  });
}

export const EXECUTABLE_MOTIF_RULES = Object.freeze(DEFINITIONS.map((definition) => Object.freeze({
  ...definition,
  prerequisites: Object.freeze([...definition.prerequisites]),
  validators: Object.freeze([...definition.validators]),
  failureConditions: Object.freeze([...definition.failureConditions]),
  enginePolicy: Object.freeze({
    usePrimaryLine: true,
    minimumDepth: definition.type.includes("mate") ? 12 : 16,
    absenceDoesNotRefute: true,
  }),
  knowledge: compactKnowledge(definition.knowledgeId),
})));

const RULES_BY_TYPE = new Map(EXECUTABLE_MOTIF_RULES.map((rule) => [rule.type, rule]));

export function motifRuleFor(type) {
  return RULES_BY_TYPE.get(type) || null;
}

export function executableMotifRuleSummary() {
  return EXECUTABLE_MOTIF_RULES.map((rule) => ({
    type: rule.type,
    knowledgeId: rule.knowledgeId,
    hasKnowledge: Boolean(rule.knowledge),
    validatorCount: rule.validators.length,
  }));
}


import { Chess } from "chess.js";
import {
  detectOpeningFromPath,
  displayOpeningComponent,
  displayOpeningName,
} from "./openingRecognition.js";

const MAX_OPENING_LIFECYCLE_PLIES = 40;
const MAX_VARIATION_ANNOUNCEMENTS = 2;

const SUPPRESSED_FAMILIES = new Set([
  "King's Pawn Game",
  "King's Pawn Opening",
  "King's Knight Opening",
  "Queen's Pawn Game",
  "Zukertort Opening",
  "Indian Defense",
  "Indian Game",
  "Three Knights Opening",
]);

const SUPPRESSED_VARIATIONS = new Set([
  "Normal Variation",
  "Normal",
  "Modern Variation",
  "Modern Variations",
  "Main Line",
  "Rare Defenses",
  "Standard Defense",
  "Traditional Variation",
]);

const PROMOTED_VARIATIONS = new Map([
  ["London System", "London System"],
  ["Colle System", "Colle System"],
  ["Trompowsky Attack", "Trompowsky Attack"],
  ["King's Indian Attack", "King's Indian Attack"],
]);

const COACHWORTHY_SUBVARIATIONS = new Set([
  "Berlin Endgame",
  "English Attack",
  "Fried Liver Attack",
  "Marshall Attack",
  "Poisoned Pawn Variation",
  "Yugoslav Attack",
]);

function cleanText(value, maximum = 240) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function pathMoveToUci(node) {
  const from = cleanText(node?.move?.from, 2).toLowerCase();
  const to = cleanText(node?.move?.to, 2).toLowerCase();
  const promotion = cleanText(node?.move?.promotion, 1).toLowerCase();
  const uci = `${from}${to}${promotion}`;
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) ? uci : "";
}

function exactCurrentMatch(result) {
  return Boolean(
    result?.matched
    && Number.isInteger(result.currentPly)
    && result.currentPly === result.matchedPly
    && result.matchedBy !== "parent-opening"
  );
}

function presentableDetail(value) {
  const detail = cleanText(value, 160);
  if (!detail || SUPPRESSED_VARIATIONS.has(detail)) return "";
  if (
    /\b(?:normal(?: line| variation)?|main line|rare defenses?|modern variations?|traditional variation|standard defense)\b/i
      .test(detail)
    || /\bwith\b/i.test(detail)
  ) return "";
  return detail;
}

function firstPresentableSubvariation(value) {
  return cleanText(value, 240)
    .split(",")
    .map((component) => presentableDetail(component))
    .find(Boolean) || "";
}

function presentableFamily(value) {
  return cleanText(value, 160)
    .replace(
      /,\s*(?:with\b.*|normal(?: line| variation)?|main line|rare defenses?|modern variations?|traditional variation|standard defense)\s*$/i,
      "",
    )
    .trim();
}

function presentationIdentity(result) {
  if (!exactCurrentMatch(result)) return null;
  const family = presentableFamily(result.family);
  const variation = cleanText(result.variation, 120);
  const subvariation = cleanText(result.subvariation, 160);
  const promotedFamily = PROMOTED_VARIATIONS.get(variation) || "";
  const familyKey = promotedFamily || (
    family && !SUPPRESSED_FAMILIES.has(family) ? family : ""
  );
  if (!familyKey) return null;

  const familyDisplay = displayOpeningName(familyKey);
  const presentableVariation = !promotedFamily
    ? presentableDetail(variation)
    : "";
  const presentableSubvariation = firstPresentableSubvariation(subvariation);
  const variationIsPresentable = Boolean(presentableVariation);
  const subvariationIsPresentable = Boolean(presentableSubvariation);
  const variationKey = [
    variationIsPresentable ? presentableVariation : "",
    subvariationIsPresentable ? presentableSubvariation : "",
  ].filter(Boolean).join(", ");
  const fullDisplay = promotedFamily
    ? [
      familyDisplay,
      subvariationIsPresentable
        ? `: ${displayOpeningName(presentableSubvariation)}`
        : "",
    ].join("")
    : [
      familyDisplay,
      variationIsPresentable
        ? `: ${displayOpeningComponent(presentableVariation)}`
        : "",
      subvariationIsPresentable
        ? `, ${displayOpeningComponent(presentableSubvariation)}`
        : "",
    ].join("");

  return {
    familyKey,
    familyDisplay,
    variationKey,
    coachworthySubvariation: COACHWORTHY_SUBVARIATIONS.has(
      presentableSubvariation,
    ),
    fullDisplay,
    sourceName: cleanText(result.sourceName),
    eco: cleanText(result.eco, 3),
    family,
    variation: variation || null,
    subvariation: subvariation || null,
    transposition: result.matchedBy === "transposition-position",
  };
}

function sequenceStartsWith(sequence, prefix) {
  return prefix.every((move, index) => sequence[index] === move);
}

function legalStoredContinuation(path, book, exitPly, maximum = 4) {
  if (!book?.entries || !Number.isInteger(exitPly) || exitPly < 2) return null;
  const playedPrefix = path
    .slice(1, exitPly)
    .map(pathMoveToUci);
  if (
    playedPrefix.length !== exitPly - 1
    || playedPrefix.some((move) => !move)
  ) return null;

  const candidates = book.entries
    .map((entry) => {
      const sequence = cleanText(entry?.[2], 2_000).split(/\s+/).filter(Boolean);
      return { entry, sequence };
    })
    .filter(({ sequence }) => (
      sequence.length > playedPrefix.length
      && sequenceStartsWith(sequence, playedPrefix)
    ))
    .sort((left, right) => {
      const leftRemaining = left.sequence.length - playedPrefix.length;
      const rightRemaining = right.sequence.length - playedPrefix.length;
      if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
      return cleanText(left.entry?.[1]).localeCompare(cleanText(right.entry?.[1]), "en");
    });
  const selected = candidates[0];
  if (!selected) return null;

  let game;
  try {
    game = new Chess(path[0]?.fen || undefined);
  } catch {
    return null;
  }
  for (const uci of playedPrefix) {
    try {
      if (!game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] || undefined,
      })) return null;
    } catch {
      return null;
    }
  }
  const fenBefore = game.fen();
  const uci = [];
  const san = [];
  for (const moveUci of selected.sequence.slice(playedPrefix.length, playedPrefix.length + maximum)) {
    try {
      const move = game.move({
        from: moveUci.slice(0, 2),
        to: moveUci.slice(2, 4),
        promotion: moveUci[4] || undefined,
      });
      if (!move) break;
      uci.push(moveUci);
      san.push(move.san);
    } catch {
      break;
    }
  }
  if (uci.length === 0) return null;
  return {
    label: "Eine lokal gespeicherte Fortsetzung",
    sourceName: cleanText(selected.entry?.[1]),
    displayName: displayOpeningName(cleanText(selected.entry?.[1])),
    fenBefore,
    uci,
    san,
  };
}

export function deriveOpeningLifecycle(path, book) {
  const nodes = Array.isArray(path) ? path : [];
  const currentPly = Math.max(0, nodes.length - 1);
  if (!book?.entries || nodes.length === 0) {
    return {
      currentPly,
      current: detectOpeningFromPath(nodes, book),
      presentation: null,
      events: [],
      currentEvent: null,
    };
  }

  const events = [];
  let meaningfulFamilySeen = false;
  let announcedFamilyKey = "";
  const announcedVariationKeys = new Set();
  let presentation = null;
  let exitEmitted = false;
  const maximumPly = Math.min(currentPly, MAX_OPENING_LIFECYCLE_PLIES);

  for (let ply = 1; ply <= maximumPly; ply += 1) {
    const prefix = nodes.slice(0, ply + 1);
    const result = detectOpeningFromPath(prefix, book);
    const identity = presentationIdentity(result);
    if (!exitEmitted && identity) {
      presentation = {
        ...identity,
        triggerPly: ply,
        matchedBy: result.matchedBy,
      };
      if (!meaningfulFamilySeen) {
        const event = {
          id: `family:${identity.familyKey}:${ply}`,
          kind: "family",
          triggerPly: ply,
          ...identity,
        };
        events.push(event);
        meaningfulFamilySeen = true;
        announcedFamilyKey = identity.familyKey;
        if (identity.variationKey) {
          announcedVariationKeys.add(identity.variationKey);
        }
      } else if (
        identity.familyKey === announcedFamilyKey
        && identity.variationKey
        && !announcedVariationKeys.has(identity.variationKey)
        && announcedVariationKeys.size < MAX_VARIATION_ANNOUNCEMENTS
        && (
          announcedVariationKeys.size === 0
          || identity.coachworthySubvariation
        )
      ) {
        const variationIdentity = `${identity.familyKey}:${identity.variationKey}`;
        events.push({
          id: `variation:${variationIdentity}:${ply}`,
          kind: "variation",
          triggerPly: ply,
          ...identity,
        });
        announcedVariationKeys.add(identity.variationKey);
      }
    }

    if (
      !exitEmitted
      && meaningfulFamilySeen
      && result.sequenceExitPly === ply
    ) {
      const continuation = legalStoredContinuation(prefix, book, ply);
      events.push({
        id: `database-exit:${ply}:${result.sequenceExitMove || "unknown"}`,
        kind: "database_exit",
        triggerPly: ply,
        sequenceExitMove: result.sequenceExitMove || null,
        continuation,
      });
      exitEmitted = true;
    }
  }

  const current = detectOpeningFromPath(nodes, book);
  return {
    currentPly,
    current,
    presentation,
    events,
    currentEvent: events.findLast((event) => event.triggerPly === currentPly) || null,
  };
}

export function openingAnnouncementContext(event) {
  if (!event || !["family", "variation", "database_exit"].includes(event.kind)) {
    return null;
  }
  return {
    id: cleanText(event.id, 300),
    kind: event.kind,
    triggerPly: Number.isInteger(event.triggerPly) ? event.triggerPly : null,
    familyKey: cleanText(event.familyKey, 120) || null,
    familyDisplay: cleanText(event.familyDisplay, 160) || null,
    variationKey: cleanText(event.variationKey, 180) || null,
    displayName: cleanText(event.fullDisplay, 240) || null,
    transposition: event.transposition === true,
    sequenceExitMove: cleanText(event.sequenceExitMove, 5) || null,
    continuation: event.continuation
      ? {
        label: cleanText(event.continuation.label, 120),
        displayName: cleanText(event.continuation.displayName, 240),
        fenBefore: cleanText(event.continuation.fenBefore, 140),
        uci: Array.isArray(event.continuation.uci)
          ? event.continuation.uci.slice(0, 6)
          : [],
        san: Array.isArray(event.continuation.san)
          ? event.continuation.san.slice(0, 6)
          : [],
      }
      : null,
  };
}

export function openingMetadataName(lifecycle) {
  const currentName = lifecycle?.current?.matched
    ? cleanText(lifecycle.current.displayName, 240)
    : "";
  return currentName || cleanText(lifecycle?.presentation?.fullDisplay, 240);
}

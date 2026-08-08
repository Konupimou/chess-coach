export const TIME_CONTROL_CATEGORIES = Object.freeze([
  "bullet",
  "blitz",
  "rapid",
  "classical",
  "correspondence",
  "unknown",
]);

const PROVIDER_CATEGORY_MAP = Object.freeze({
  ultrabullet: "bullet",
  bullet: "bullet",
  blitz: "blitz",
  rapid: "rapid",
  classical: "classical",
  correspondence: "correspondence",
  daily: "correspondence",
});

function nonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

export function parseTimeControl(rawValue) {
  const raw = String(rawValue || "").trim();
  const clock = raw.match(/^(\d+)(?:\+(\d+))?$/u);
  if (clock) {
    return {
      initialSeconds: nonNegativeInteger(clock[1]),
      incrementSeconds: nonNegativeInteger(clock[2] || 0),
      correspondenceDaysPerTurn: null,
    };
  }
  const correspondence = raw.match(/^(\d+)\/(\d+)$/u);
  if (correspondence) {
    return {
      initialSeconds: null,
      incrementSeconds: null,
      correspondenceDaysPerTurn: Number(correspondence[2]) / 86_400,
    };
  }
  return {
    initialSeconds: null,
    incrementSeconds: null,
    correspondenceDaysPerTurn: null,
  };
}

/**
 * Uses the common estimated-duration rule (initial + 40 increments) whenever
 * a provider did not already supply a recognized speed. Provider values are
 * retained alongside the canonical result so a classification is auditable.
 */
export function classifyTimeControl({
  initialSeconds,
  incrementSeconds,
  providerCategory = "",
  raw = "",
  correspondenceDaysPerTurn = null,
} = {}) {
  const parsed = parseTimeControl(raw);
  const initial = nonNegativeInteger(initialSeconds) ?? parsed.initialSeconds;
  const increment = nonNegativeInteger(incrementSeconds) ?? parsed.incrementSeconds;
  const providerValue = String(providerCategory || "").trim();
  const mappedProviderCategory = PROVIDER_CATEGORY_MAP[providerValue.toLowerCase()] || null;
  const daysPerTurn = correspondenceDaysPerTurn !== null
    && correspondenceDaysPerTurn !== undefined
    && Number.isFinite(Number(correspondenceDaysPerTurn))
    ? Number(correspondenceDaysPerTurn)
    : parsed.correspondenceDaysPerTurn;

  let category = mappedProviderCategory;
  if (!category && daysPerTurn !== null) category = "correspondence";
  if (!category && initial !== null) {
    const estimatedSeconds = initial + (increment || 0) * 40;
    if (estimatedSeconds < 180) category = "bullet";
    else if (estimatedSeconds < 480) category = "blitz";
    else if (estimatedSeconds < 1_500) category = "rapid";
    else category = "classical";
  }

  return Object.freeze({
    category: category || "unknown",
    initialSeconds: initial,
    incrementSeconds: increment,
    raw: String(raw || "").trim(),
    providerCategory: providerValue,
    correspondenceDaysPerTurn: daysPerTurn,
  });
}

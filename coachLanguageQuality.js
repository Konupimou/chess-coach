export const COACH_LANGUAGE_RATINGS = Object.freeze([800, 1000, 1400, 1800]);

const RULES_BY_RATING = Object.freeze({
  800: Object.freeze({
    maximumWordsPerSentence: 16,
    maximumSentences: 6,
    maximumSections: 3,
  }),
  1000: Object.freeze({
    maximumWordsPerSentence: 18,
    maximumSentences: 6,
    maximumSections: 4,
  }),
  1400: Object.freeze({
    maximumWordsPerSentence: 21,
    maximumSentences: 8,
    maximumSections: 5,
  }),
  1800: Object.freeze({
    maximumWordsPerSentence: 24,
    maximumSentences: 10,
    maximumSections: 6,
  }),
});

const FORBIDDEN_PATTERNS = Object.freeze([
  {
    id: "praise-template",
    pattern: /\b(?:sauber|genau das war (?:hier )?gefragt)\b/iu,
    message: "Verwende keine pauschale Lob-Floskel.",
  },
  {
    id: "evidence-jargon",
    pattern: /\b(?:geprüfte[nr]? Antwortfolge|legal geprüfte[nr]? Folge|aktuelle[nr]? Analysetiefe|konkret erklärbare[rn]? Zweck|gelieferte[nr]? Fakten|sichere[rn]? Bezugspunkt)\b/iu,
    message: "Interne Belegsprache gehört nicht in eine einfache Coach-Antwort.",
  },
  {
    id: "engine-jargon",
    pattern: /\b(?:Stockfish|Engine(?:bewertung)?|PV|Centipawn|Bauerneinheiten?|Evaluation|Kandidatenz(?:ug|üge))\b/iu,
    message: "Technische Analysebegriffe sollen in einer normalen Coach-Antwort nicht sichtbar sein.",
    technical: true,
  },
  {
    id: "formal-wording",
    pattern: /\b(?:Anforderungen der Stellung|zu Ungunsten|die ziehende Seite|Fortsetzung fällt klar ab|verschlechtert sich konkret|gleichwertige Alternative|erste Wahl|andere geprüfte Möglichkeit)\b/iu,
    message: "Die Formulierung klingt wie ein Bericht statt wie ein Freund am Brett.",
  },
  {
    id: "condescending-wording",
    pattern: /\b(?:das ist (?:doch|wirklich) (?:ganz )?einfach|das (?:müsstest|solltest) du (?:doch |eigentlich )?(?:sehen|wissen|kennen)|selbst (?:ein )?Anfänger(?:in)?(?:innen)? (?:sieht|sehen|weiß|wissen|kennt|können)|das kann doch jeder|offensichtlich|trivial|Anfängerfehler|wie konntest du .{0,30}(?:übersehen|nicht sehen)|das darf dir nicht passieren|du hättest .{0,24} wissen müssen)\b/iu,
    message: "Die Formulierung wirkt herablassend statt hilfreich.",
  },
]);

const VAGUE_PATTERNS = Object.freeze([
  /\b(?:die Stellung bleibt (?:gut )?spielbar|der Zug passt(?: hier)?)\b/iu,
  /\bda war (?:noch )?(?:etwas )?mehr drin\b/iu,
]);

// Diese Wendungen bleiben auch dann leer, wenn im selben Satz zufällig eine
// Figur oder ein Feld genannt wird. Gerade bei 800/1000 Elo soll der Coach die
// konkrete Wirkung nennen und den Berichtssatz ganz weglassen.
const INTRINSICALLY_VAGUE_PATTERNS = Object.freeze([
  /\b(?:gibt nichts her|trifft den Kern der Stellung)\b/iu,
  /\b(?:packt die wichtigste Aufgabe|verändert dadurch die Stellung konkret)\b/iu,
  /\b(?:hält die Stellung(?: präzise)? zusammen|lässt mehr Gegenspiel zu)\b/iu,
  /\b(?:verbessert (?:seine Wirkung|die Aufgabe|den Zusammenhalt)(?: auf die Stellung| der Stellung)?|bereitet den weiteren Plan vor)\b/iu,
  /\b(?:verändert Material und Bauern- oder Figurenstruktur|verändert die Königssicherheit)\b/iu,
]);

const JARGON_800 = Object.freeze([
  "Bauernhebel",
  "Außenposten",
  "Schwerfigur",
  "Prophylaxe",
  "Initiative",
  "Gegenspiel",
  "Fianchetto",
  "Qualitätsopfer",
  "Zwischenzug",
  "Überlastung",
  "Ablenkung",
  "Pattressource",
  "Hauptvariante",
  "Konsolidierung",
  "Konzession",
  "Figurenkoordination",
]);

const JARGON_1000 = Object.freeze([
  "Prophylaxe",
  "Fianchetto",
  "Qualitätsopfer",
  "Überlastung",
  "Ablenkung",
  "Pattressource",
  "Konsolidierung",
  "Konzession",
  "Figurenkoordination",
]);

const JARGON_STEMS = Object.freeze({
  Bauernhebel: "Bauernhebel",
  Außenposten: "Außenposten",
  Schwerfigur: "Schwerfigur",
  Prophylaxe: Object.freeze(["Prophylax", "prophylak"]),
  Initiative: "Initiativ",
  Gegenspiel: "Gegenspiel",
  Fianchetto: "Fianchett",
  Qualitätsopfer: "Qualitätsopfer",
  Zwischenzug: "Zwischenz",
  Überlastung: "Überlast",
  Ablenkung: "Ablenk",
  Pattressource: "Pattressour",
  Hauptvariante: "Hauptvariant",
  Konsolidierung: "Konsolid",
  Konzession: "Konzession",
  Figurenkoordination: "Figurenkoordination",
});

const GERMAN_LANGUAGE_MARKERS = new Set([
  "aber", "also", "auch", "auf", "aus", "bauer", "beim", "dame", "damit",
  "dann", "das", "dein", "deine", "deinem", "deinen", "dem", "den", "der",
  "dich", "die", "dieser", "dieses", "dir", "doch", "du", "ein", "eine",
  "einen", "er", "erst", "es", "figur", "für", "geht", "genauso", "gut",
  "hier", "im", "ins", "ist", "jetzt", "kann", "könig", "können", "läufer",
  "mehr", "mit", "muss", "musst", "nach", "nicht", "noch", "nur", "oder",
  "ohne", "rochade", "schach", "schon", "seine", "sie", "sind", "soll",
  "sollte", "sonst", "springer", "steht", "stellung", "turm", "und", "von",
  "vor", "vorbereiten", "war", "wäre", "weil", "wenn", "weniger", "wird",
  "zu", "zug", "zum", "zur",
]);

const ENGLISH_LANGUAGE_MARKERS = new Set([
  "a", "activity", "advantage", "advancing", "after", "again", "against",
  "aiming", "allow", "allowed", "allowing", "allows", "also", "and", "annoying",
  "anything", "are", "around", "attack", "attacked", "attacking", "attacks",
  "away", "avoid", "avoided", "avoiding", "baiting", "because", "before",
  "beginning", "best", "better", "between", "bishop", "black", "block",
  "blocked", "blocking", "both", "but", "can", "capture", "captured",
  "captures", "capturing", "centralization", "centralize", "centralizing",
  "chances", "change", "changing", "checkmate", "checks", "completed",
  "cannot", "coming", "considerable", "consideration", "considered", "convincing",
  "coordination", "counterplay",
  "could", "coupled", "covering", "creates",
  "creating", "danger", "dangerous", "decoy", "defend", "defended", "defender",
  "defending", "defends", "deflection", "development", "develop", "developed",
  "developing", "develops", "diagonal", "direction", "discovered", "dissuading",
  "does", "doesn't", "double", "doubling", "else", "equal", "eventually",
  "difference", "even", "exchange", "exchanged", "exchanges", "exchanging", "far",
  "first", "followed", "forced", "forces", "forcing", "fork", "for", "forward",
  "from", "gain",
  "gained", "gaining", "gains", "getting", "going", "grabbing", "guarding",
  "good", "has", "have", "help", "here", "holding", "how", "if", "immediate",
  "immediately", "improve", "improved", "improves", "improving", "inaccuracy",
  "instead", "into", "is",
  "it", "it's", "keeping", "king", "knight", "lead", "leads", "leaping",
  "less", "lethal", "let's", "like", "lose", "loses", "losing", "lost",
  "maintaining", "mate", "mates", "methodical", "might", "more", "move",
  "moved", "moves", "moving",
  "must", "need", "no", "not", "now", "of", "off", "on", "only", "onto", "opting",
  "or", "otherwise", "our", "out", "over", "overloading", "pattern", "pawn", "piece",
  "pieces", "pin", "pinned", "play", "played", "playing", "plays", "position",
  "possible", "prepare", "prepared", "prepares", "preparing", "preserving",
  "pressure", "prevent", "prevented", "preventing", "prevents", "protect",
  "protected", "protecting", "protects", "puzzle", "push", "pushed", "pushing",
  "queen", "queens", "queenside", "reaches", "ready", "recaptured", "recapturing",
  "reinforcing", "remove",
  "removing", "repeat", "repeating", "retreat", "retreating", "rook", "runs",
  "sacrifice", "sacrificed", "sacrifices", "sacrificing", "safe", "safety",
  "same", "saw", "securing", "should", "similar", "simple", "simplifying", "skewer", "snatching",
  "some", "space", "square", "squares", "still", "stopping", "strong",
  "stronger", "structure", "tenacious", "than", "that", "the", "their", "then",
  "there", "these", "this", "those", "threat", "threatening", "threatens",
  "through", "time", "to", "towards", "trade", "trading", "transpose",
  "transposed", "transposes", "transposing", "two", "under", "undermining",
  "unpinning", "useful", "very", "victory", "wasn't", "we", "weak", "weaker",
  "weakening", "what", "when", "where", "which", "while", "white", "who",
  "accomplished", "accurately", "achieved", "activating", "aggressive", "all",
  "another", "appealing", "assault", "attention", "automatically", "backward",
  "beautiful", "begins", "blacks", "blow", "by", "captured", "carnage",
  "check", "classic", "clearance", "collapses", "completely", "concession",
  "consistency", "continuation", "continued", "continues", "decides", "decisive",
  "deserved", "desperation", "destruction", "disruptive", "drum", "dutch",
  "easier", "either", "emerge", "energetically", "error", "escape", "escapes",
  "everybody", "everything", "excellent", "executing", "failed", "fails",
  "fatal", "fighting", "finally", "follow-up", "follows", "game", "goes",
  "great", "had", "hardly", "he", "her", "hinting", "his", "hitting",
  "hopeless", "ideas", "indeed", "incredible", "life", "lifting", "lines",
  "logical", "makes", "mating", "meet", "mission", "mistake", "mops", "much",
  "obligatory", "obviously", "open", "option", "options", "optimistic", "place",
  "player's", "please", "point", "precise", "pretty", "provoking", "quickly",
  "rare", "recapture", "refutation", "renewing", "resignation", "responds",
  "response", "right", "roll", "safer", "saved", "sense", "sequence", "serious",
  "smoothly", "stalemate", "standard", "step", "stop", "supported", "surrendered",
  "sweet", "tactical", "taking", "thematic", "they", "though", "threats", "too",
  "trick", "try", "turns", "unfortunately", "up", "variation", "version",
  "warming", "well", "whites", "why", "win", "winning", "wins", "with",
  "without", "won", "wonderful", "works", "worth", "worse", "would", "you",
  "your", "yet", "zero",
]);

const SPANISH_LANGUAGE_MARKERS = new Set([
  "aceptando", "actualmente", "ahora", "alfil", "alfiles", "amenaza", "amenazando",
  "aparece", "apuntada", "atacando", "atacado", "ataque", "atención", "avance",
  "bien", "blancas", "blanco", "bloqueador", "borda", "buena", "bueno", "caballo",
  "caso", "cómo", "complicado", "comete", "con", "considera", "considerar",
  "continuar", "contra", "correcta", "correcto", "cuál", "cumple", "de",
  "debó", "demasiado", "defender", "defensa", "demostrara", "después", "desde",
  "dinámicamente", "dominación", "efectivo", "ejemplo", "elige", "eligieron",
  "elija", "empate", "equilibrada", "era", "estado", "está", "esto", "evaluación",
  "evitar", "exacto", "forzado", "forzando", "fue", "fuerte", "grave", "gambito",
  "habría", "hay", "hemos", "hoy", "idea", "informático", "importantes", "juegan",
  "juego", "jugar", "jugada", "jugable", "la", "las", "lenguaje", "lima", "línea",
  "lo", "los", "malo", "mate", "materiales", "mejor", "motivos", "movimiento",
  "mucha", "negras", "negro", "obispo", "origina", "para", "parece", "partida",
  "paso", "peón", "peones", "pérdidas", "pero", "pieza", "piezas", "por", "posición",
  "posible", "preferible", "preferirse", "prefiere", "presión", "prestamos", "pues",
  "puro", "que", "quería", "quizás", "recomienda", "relativamente", "respuesta",
  "romántico", "se", "segundo", "seguido", "seguimiento", "sencillo", "sería",
  "si", "simplemente", "sin", "tabú", "también", "tentador", "teoría",
  "teóricamente", "termina", "tirando", "todo", "torre", "tranquilas", "transpuesto",
  "total", "tras", "tres", "una", "unica", "variantes", "ventaja", "ver", "viable",
]);

const HIGH_CONFIDENCE_FOREIGN_WORDS = new Set([
  "accomplished", "achieved", "activating", "automatically", "captured", "carnage",
  "collapses", "confusing", "considerable", "continuation", "deflection", "destruction",
  "disruptive", "energetically",
  "escapes", "executing", "failed", "fails", "hinting", "hopeless", "hitting",
  "incredible", "lifting", "mating", "obviously", "on", "or", "otherwise", "provoking",
  "recaptured", "recapture",
  "refutation", "renewing", "resignation", "responds", "simplify", "stalemate",
  "surrendered", "thematic", "unfortunately", "wonderful",
  "actualmente", "atacando", "bloqueador", "dominación", "forzando", "gambito",
  "jugable", "negras",
  "peón", "peones", "posición", "teoría", "teóricamente", "variantes",
]);

const OTHER_FOREIGN_LANGUAGE_MARKERS = new Set([
  "avec", "blancs", "giocano", "jouent", "menace", "menaces", "minaccia",
  "minacce", "noirs", "pedone", "pezzo", "suivi",
]);

// Ein einzelnes dieser Wörter ist bereits ein verlässlicher Hinweis auf ein
// unbearbeitetes englisches Aktionsfragment. Das fängt auch Ein-Wort-Kommentare
// wie «Unpinning.» ab, ohne kurze deutsche Sätze allein wegen eines
// Eröffnungsnamens zu verwerfen.
const HIGH_CONFIDENCE_FOREIGN_PATTERN = /(?:[¿¡]|\b(?:advancing|aiming|allowing|attacking|avoiding|baiting|beginning|blocking|capturing|centralizing|changing|completing|covering|creating|defending|developing|dissuading|doubling|exchanges|exchanging|forced|forcing|gaining|getting|grabbing|guarding|holding|improving|keeping|leaping|losing|maintaining|moving|opting|overloading|playing|preparing|preserving|preventing|protecting|pushing|recapturing|reinforcing|removing|repeating|retreating|sacrificing|securing|simplifying|snatching|stopping|taking|threatening|trading|transposing|undermining|unpinning|warming|weakening|winning|blancas|caballo|elige|elija|forzado|juegan|jugada|negras|peón|peones|posición|seguimiento|minaccia|minacce)\b)/iu;

function normalizedText(value) {
  return typeof value === "string"
    ? value.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim()
    : "";
}

function plainLines(value) {
  return normalizedText(value)
    .split("\n")
    .map((line) => line
      .replace(/^\s*(?:(?:[-*]|\d+[.)]|>)\s+)+/u, "")
      .trim())
    .filter(Boolean);
}

function withoutPresentationLabel(value) {
  return value
    .replace(
      /^(?:Alternative|Stärkste Antwort|Typische Antwort|Konkrete Folge|Der Unterschied|Merksatz|Lernpunkt|Trainingsaufgabe):\s*/iu,
      "",
    )
    // Das Moment-Label ist eine Überschrift innerhalb der Bullet. Sein
    // Doppelpunkt gehört nicht zum Satzbau der eigentlichen Erklärung.
    .replace(/^\d+\s*(?:\.{3}|…|\.)\s*[^:\n]{1,24}:\s*/u, "");
}

function sentences(value) {
  return plainLines(value)
    .flatMap((line) => line
      .replace(/\*\*/g, "")
      // Eine Zugnummer ist kein Satzende. Ohne den Platzhalter würden zum
      // Beispiel «2. Nf3» und «2... Nc6» jeweils als zwei Sätze zählen.
      .replace(/(\d+)\s*\.{3}\s*(?=[KQRBNDTLSO0a-h])/gu, "$1\uE001")
      .replace(/(\d+)\s*\.\s*(?=[KQRBNDTLSO0a-h])/gu, "$1\uE000")
      .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])/u))
    .map((sentence) => withoutPresentationLabel(sentence
      .replace(/\uE001/gu, "... ")
      .replace(/\uE000/gu, ". ")
      .trim()))
    .filter(Boolean);
}

function words(value) {
  return value.match(/[\p{L}\p{N}]+(?:[.'’-][\p{L}\p{N}]+)*/gu) || [];
}

function languageMarkerCounts(value) {
  return words(value).reduce((counts, word) => {
    const normalized = word.toLocaleLowerCase("de-DE");
    if (GERMAN_LANGUAGE_MARKERS.has(normalized)) counts.german += 1;
    if (ENGLISH_LANGUAGE_MARKERS.has(normalized)) counts.english += 1;
    if (SPANISH_LANGUAGE_MARKERS.has(normalized)) counts.spanish += 1;
    if (OTHER_FOREIGN_LANGUAGE_MARKERS.has(normalized)) counts.otherForeign += 1;
    counts.words += 1;
    return counts;
  }, {
    german: 0,
    english: 0,
    spanish: 0,
    otherForeign: 0,
    words: 0,
  });
}

function issue(id, severity, message, sample = "", recommendation = "") {
  return {
    id,
    severity,
    message,
    ...(sample ? { sample } : {}),
    ...(recommendation ? { recommendation } : {}),
  };
}

function termPattern(term) {
  const stems = Array.isArray(JARGON_STEMS[term])
    ? JARGON_STEMS[term]
    : [JARGON_STEMS[term] || term];
  const alternatives = stems.map((stem) => (
    stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ));
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})[\\p{L}-]*(?![\\p{L}\\p{N}])`,
    "iu",
  );
}

function termIsExplained(text, term) {
  const pattern = termPattern(term);
  const match = pattern.exec(text);
  if (!match) return true;
  const nearby = text.slice(match.index, match.index + match[0].length + 110);
  const before = text.slice(Math.max(0, match.index - 100), match.index);
  return (
    /(?:das heißt|das bedeutet|bedeutet|also|damit ist gemeint|\([^)]{3,80}\)|[\u2013—:]\s*(?:du|der|die|das|ein))/iu
      .test(nearby)
    || /(?:das|dies)\s+(?:nennt man|heißt)\s*$/iu.test(before)
  );
}

function hasConcreteBoardReference(value) {
  return (
    /(?<![KQRBNDTLS])\b[a-h][1-8]\b/u.test(value)
    || /\b(?:Bauer|Bauern|Springer|Läufer|Turm|Türme|Dame|König|Schach|Matt|Rochade|Zentrum|schlägt|nimmt|deckt|ungedeckt|angegriffen|entwickelt)\b/iu
      .test(value)
  );
}

function hasExplicitFalse(evidence, key) {
  return Object.hasOwn(evidence, key) && evidence[key] !== true;
}

function normalizeRating(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return 800;
  if (rating <= 800) return 800;
  if (rating <= 1000) return 1000;
  if (rating <= 1400) return 1400;
  return 1800;
}

export function coachLanguageRulesForRating(value) {
  const rating = normalizeRating(value);
  return { rating, ...RULES_BY_RATING[rating] };
}

/**
 * Analysiert einen sichtbaren Coach-Text ohne ihn zu verändern.
 *
 * `practicallyEquivalent` schützt gleichwertige Züge vor einer falschen
 * Rangfolge. `phase: "opening"` und `multipleGoodOpeningMoves` schützen
 * Datenbankoptionen vor Bestzug-Sprache. `recognizedOpening` verbietet auch
 * eine Rangfolge der gegnerischen Eröffnungsantwort. Eine `Typische Antwort`
 * ist nur mit `typicalOpeningReplySupported` erlaubt. In `evidence` werden nur ausdrücklich
 * gesetzte `false`-Werte beanstandet; fehlende Werte werden nie als Widerlegung
 * behandelt. `allowTechnicalTerms` ist nur für ausdrückliche Technikfragen.
 * `expectedLanguage` ist standardmäßig Deutsch und kann für anderssprachige
 * Nutzer bewusst geändert werden.
 *
 * Der Check beweist keine Schachrichtigkeit. Er kann aber starke Aussagen gegen
 * bereits verifizierte Brettfakten abgleichen und liefert zu jedem Fund eine
 * sichere Bearbeitungsempfehlung.
 */
export function analyzeCoachLanguage(
  value,
  {
    rating = 800,
    practicallyEquivalent = false,
    phase = "",
    multipleGoodOpeningMoves = false,
    recognizedOpening = false,
    typicalOpeningReplySupported = false,
    allowTechnicalTerms = false,
    expectedLanguage = "de",
    evidence = {},
  } = {},
) {
  const text = normalizedText(value);
  const rules = coachLanguageRulesForRating(rating);
  const target = rules.rating;
  const resultSentences = sentences(text);
  const issues = [];

  if (!text) {
    issues.push(issue(
      "empty",
      "error",
      "Die Coach-Antwort ist leer.",
      "",
      "Nutze mindestens einen kurzen Satz mit einer konkreten Brettwirkung.",
    ));
  }

  const language = languageMarkerCounts(text);
  const strongestForeignMarkerCount = Math.max(
    language.english,
    language.spanish,
    language.otherForeign,
  );
  const highConfidenceForeignWord = expectedLanguage === "de"
    ? words(text).find((word) => (
      HIGH_CONFIDENCE_FOREIGN_WORDS.has(word.toLocaleLowerCase("de-DE"))
    ))
    : "";
  const highConfidenceForeignMatch = expectedLanguage === "de"
    ? text.match(HIGH_CONFIDENCE_FOREIGN_PATTERN)
    : null;
  if (
    expectedLanguage === "de"
    && (
      highConfidenceForeignMatch
      || highConfidenceForeignWord
      || (
        strongestForeignMarkerCount >= 2
        && strongestForeignMarkerCount >= language.german + 1
      )
      || (
        language.words >= 4
        && strongestForeignMarkerCount >= 1
        && language.german === 0
      )
    )
  ) {
    issues.push(issue(
      "wrong-language",
      "error",
      "Die Coach-Antwort enthält unbearbeiteten fremdsprachigen Text statt einer deutschen Erklärung.",
      highConfidenceForeignMatch?.[0] || highConfidenceForeignWord || "",
      "Formuliere die Erklärung vollständig auf Deutsch.",
    ));
  }

  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.technical && allowTechnicalTerms) continue;
    const match = text.match(rule.pattern);
    if (match) issues.push(issue(
      rule.id,
      "error",
      rule.message,
      match[0],
      rule.id === "praise-template"
        ? "Beginne direkt mit der Wirkung des Zuges."
        : rule.id === "engine-jargon"
          ? "Erkläre das Schach selbst und lasse den Namen des Werkzeugs weg."
          : "Nenne stattdessen eine konkrete Figur, ein Feld oder eine direkte Folge.",
    ));
  }

  resultSentences.forEach((sentence, index) => {
    const count = words(sentence).length;
    if (count > rules.maximumWordsPerSentence) {
      issues.push(issue(
        "long-sentence",
        "error",
        `Satz ${index + 1} hat ${count} Wörter; erlaubt sind höchstens ${rules.maximumWordsPerSentence}.`,
        sentence,
        "Teile den Satz in kurze Hauptsätze mit jeweils nur einem Gedanken.",
      ));
    }
    const clauseText = sentence.replace(
      /,\s*(?=\b(?:aber|obwohl|während|sodass|damit|weil|denn|wodurch)\b)/giu,
      " ",
    );
    const clauseLinks = clauseText.match(/(?:[,;:]|\b(?:aber|obwohl|während|sodass|damit|weil|denn|wodurch)\b)/giu) || [];
    if (count >= 10 && clauseLinks.length >= 2) {
      issues.push(issue(
        "many-clauses",
        "warning",
        `Satz ${index + 1} verbindet zu viele Gedanken.`,
        sentence,
        "Teile Ursache, Folge und Merksatz in getrennte Sätze.",
      ));
    }
  });

  if (resultSentences.length > rules.maximumSentences) {
    issues.push(issue(
      "too-many-sentences",
      "error",
      `Die Antwort hat ${resultSentences.length} Sätze; erlaubt sind höchstens ${rules.maximumSentences}.`,
      "",
      "Behalte nur Wirkung, wichtigste Folge und einen nächsten Schritt.",
    ));
  }

  const sectionCount = plainLines(text)
    .filter((line) => /^\*\*[^*]+:\*\*/u.test(line)).length;
  if (sectionCount > rules.maximumSections) {
    issues.push(issue(
      "too-many-sections",
      "error",
      `Die Antwort hat ${sectionCount} Zusatzabschnitte; für ${target} Elo sind höchstens ${rules.maximumSections} sinnvoll.`,
      "",
      "Zeige nur die wichtigsten Abschnitte für dieses Coach-Niveau.",
    ));
  }

  const jargon = target === 800
    ? JARGON_800
    : target === 1000
      ? JARGON_1000
      : [];
  jargon.forEach((term) => {
    if (!termIsExplained(text, term)) {
      issues.push(issue(
        "unexplained-jargon",
        "error",
        `Der Begriff «${term}» wird nicht einfach erklärt.`,
        term,
        "Ersetze den Begriff durch Alltagswörter oder erkläre ihn direkt im selben Satz.",
      ));
    }
  });

  VAGUE_PATTERNS.forEach((pattern) => {
    const match = text.match(pattern);
    const containingSentence = match
      ? resultSentences.find((sentence) => pattern.test(sentence)) || ""
      : "";
    if (match && !hasConcreteBoardReference(containingSentence)) {
      issues.push(issue(
        "vague-wording",
        "warning",
        "Die Aussage nennt keine konkrete Figur, kein Feld und keine direkte Folge.",
        match[0],
        "Nenne die betroffene Figur, ihr Feld und was der Gegner danach konkret tun kann.",
      ));
    }
  });

  INTRINSICALLY_VAGUE_PATTERNS.forEach((pattern) => {
    const match = text.match(pattern);
    if (!match) return;
    issues.push(issue(
      "vague-wording",
      "warning",
      "Die Aussage beschreibt keine konkrete Wirkung auf dem Brett.",
      match[0],
      "Lass die Floskel weg und nenne direkt Figur, Feld oder unmittelbare Folge.",
    ));
  });

  const falseRankingPattern = /(?:\b(?:etwas\s+)?(?:genauer|besser|präziser|stärker)\s+(?:wäre|war|ist|geht)\b|\b(?:genaueste|beste)\s+Wahl\b|\bbeste[rn]?\s+Zug\b|\b(?:stärkere|bessere|genauere)\s+(?:Idee|Alternative|Möglichkeit)\b|\b(?:Alternative|Möglichkeit)\b.{0,45}\b(?:besser|genauer|präziser|stärker)\b)/iu;
  if (
    practicallyEquivalent
    && falseRankingPattern.test(text)
  ) {
    issues.push(issue(
      "false-ranking",
      "error",
      "Bei praktisch gleichwertigen Zügen darf kein Zug als besser oder genauer bezeichnet werden.",
      "",
      "Formuliere zum Beispiel: «Genauso gut geht Nf3.»",
    ));
  }

  if (
    /\*{0,2}Stärkste Antwort:\*{0,2}\s*(?:Am stärksten|Die stärkste Antwort|Am besten|Die beste Antwort)/iu
      .test(text)
  ) {
    issues.push(issue(
      "duplicated-opponent-ranking",
      "error",
      "Die Überschrift und der Satz wiederholen dieselbe Rangfolge.",
      "",
      "Schreibe nach der Überschrift nur den Zug oder seine konkrete Wirkung.",
    ));
  }

  if (
    phase === "opening"
    && recognizedOpening
    && /(?:\*{0,2}(?:Stärkste|Beste) Antwort:\*{0,2}|\b(?:Am stärksten|Am besten)\b|\b(?:stärkste|beste)\s+(?:gegnerische\s+)?Antwort\b)/iu
      .test(text)
  ) {
    issues.push(issue(
      "opening-opponent-ranking",
      "error",
      "In einer erkannten Eröffnung wird die gegnerische Fortsetzung fälschlich als beste Antwort gerankt.",
      "",
      "Nutze nur bei einem Datenbankbeleg «Typische Antwort» oder lasse den Block weg.",
    ));
  }

  if (
    phase === "opening"
    && !typicalOpeningReplySupported
    && /\*{0,2}Typische Antwort:\*{0,2}/iu.test(text)
  ) {
    issues.push(issue(
      "unsupported-typical-opening-reply",
      "error",
      "Die typische Eröffnungsantwort ist nicht durch die Eröffnungsdaten belegt.",
      "",
      "Entferne den Block oder liefere die Fortsetzung als Datenbankzug.",
    ));
  }

  if (
    phase === "opening"
    && multipleGoodOpeningMoves
    && /(?:\b(?:genauest|best|stärkst)e(?:n|r|m|s)?(?:\s+\p{L}+){0,2}\s+(?:Zug|Wahl|Idee(?:n)?|Möglichkeit(?:en)?|Fortsetzung(?:en)?)\b|\b(?:führt|steht)\b[^.!?]{0,35}\b(?:Liste|Rangfolge)\b[^.!?]{0,12}\ban\b|\b(?:anderen?\s+(?:Zügen|Möglichkeiten)\s+)?(?:klar\s+)?vorzuziehen\b|\b(?:Nummer\s+eins|Top-?Wahl)\b|\b(?:klar\s+)?(?:besser|genauer|präziser|stärker)\s+als\b|\b(?:die\s+)?(?:bessere|genauere|präzisere|stärkere)\s+(?:Fortsetzung|Wahl|Idee|Möglichkeit)\b|\bsteht\s+(?:klar\s+)?vor\b|\bklare\s+Empfehlung\b|\b(?:nur\s+)?die\s+(?:zweite|dritte)\s+Wahl\b)/iu.test(text)
  ) {
    issues.push(issue(
      "opening-ranking",
      "error",
      "Mehrere Datenbankzüge werden in der Eröffnung fälschlich geordnet.",
      "",
      "Nenne die Züge als gleichberechtigte Eröffnungswege.",
    ));
  }

  if (
    hasExplicitFalse(evidence, "onlyMove")
    && /\b(?:einzige(?:r|n)? Zug|nur (?:dieser|der|die) .*? Zug|erzwungen)\b/iu.test(text)
  ) {
    issues.push(issue(
      "unsupported-only-move",
      "error",
      "Die Nur-Zug-Aussage ist nicht belegt.",
      "",
      "Sprich nur dann vom einzigen Zug, wenn die Zugnotwendigkeit ausdrücklich belegt ist.",
    ));
  }
  if (hasExplicitFalse(evidence, "mate") && /\bmatt\b/iu.test(text)) {
    issues.push(issue(
      "unsupported-mate",
      "error",
      "Die Matt-Aussage ist nicht belegt.",
      "",
      "Entferne die Matt-Aussage oder liefere eine legal geprüfte Mattfolge.",
    ));
  }
  if (
    hasExplicitFalse(evidence, "materialLoss")
    && /\b(?:stellst .{0,35} ein|verlierst (?:du )?(?:Material|eine[n]? (?:Dame|Turm|Läufer|Springer|Bauern?)))\b/iu.test(text)
  ) {
    issues.push(issue(
      "unsupported-material-loss",
      "error",
      "Der behauptete Materialverlust ist nicht belegt.",
      "",
      "Benenne einen Einsteller nur bei einem verifizierten Schlag ohne direkte Rücknahme.",
    ));
  }
  if (
    hasExplicitFalse(evidence, "significantLoss")
    && /\b(?:klarer Fehler|deutlich schlechter)\b/iu.test(text)
  ) {
    issues.push(issue(
      "unsupported-significant-loss",
      "error",
      "Die deutliche Verschlechterung ist nicht belegt.",
      "",
      "Nutze eine neutrale Bewertung, bis ein deutlicher Bewertungsverlust belegt ist.",
    ));
  }
  if (
    hasExplicitFalse(evidence, "severeLoss")
    && /\b(?:grober Fehler|viel schlechter)\b/iu.test(text)
  ) {
    issues.push(issue(
      "unsupported-severe-loss",
      "error",
      "Die sehr starke Verschlechterung ist nicht belegt.",
      "",
      "Nutze «grober Fehler» nur bei einem entsprechend starken belegten Verlust.",
    ));
  }

  const errorCount = issues.filter((entry) => entry.severity === "error").length;
  return {
    ok: errorCount === 0,
    valid: errorCount === 0,
    rating: target,
    rules,
    metrics: {
      sentences: resultSentences.length,
      maximumWordsPerSentence: resultSentences.reduce(
        (maximum, sentence) => Math.max(maximum, words(sentence).length),
        0,
      ),
      sections: sectionCount,
      languageMarkers: language,
    },
    issues,
  };
}

/**
 * Liefert die für Runtime und Tests praktische Trennung in Fehler/Warnungen.
 * Normalerweise blockieren nur Fehler. Mit `strict: true` blockiert auch eine
 * vage oder unnötig komplizierte Formulierung.
 */
export function validateCoachLanguage(value, options = {}) {
  const analysis = analyzeCoachLanguage(value, options);
  const errors = analysis.issues.filter((entry) => entry.severity === "error");
  const warnings = analysis.issues.filter((entry) => entry.severity === "warning");
  const strict = options?.strict === true;
  return {
    valid: errors.length === 0 && (!strict || warnings.length === 0),
    errors,
    warnings,
    analysis,
  };
}

// Rückwärtskompatibler Name für vorhandene Auswertungen.
export const auditCoachLanguage = analyzeCoachLanguage;

import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCoachLanguage,
  auditCoachLanguage,
  coachLanguageRulesForRating,
  COACH_LANGUAGE_RATINGS,
  validateCoachLanguage,
} from "../coachLanguageQuality.js";

test("alle vier Coach-Stufen besitzen eigene, wachsende Sprachgrenzen", () => {
  assert.deepEqual(COACH_LANGUAGE_RATINGS, [800, 1000, 1400, 1800]);
  const rules = COACH_LANGUAGE_RATINGS.map(coachLanguageRulesForRating);

  assert.deepEqual(
    rules.map((entry) => entry.maximumWordsPerSentence),
    [16, 18, 21, 24],
  );
  assert.deepEqual(
    rules.map((entry) => entry.maximumSections),
    [3, 4, 5, 6],
  );
});

test("eine kurze konkrete 800-Elo-Erklärung besteht den Sprachcheck", () => {
  const result = auditCoachLanguage(
    "Damit entwickelst du den Springer! Er greift jetzt das Feld e5 an.",
    { rating: 800 },
  );

  assert.equal(result.ok, true);
  assert.equal(result.issues.length, 0);
});

test("interne Belegsprache und pauschales Lob werden gefunden", () => {
  const result = auditCoachLanguage(
    "Sauber. Über das Zielfeld d4 hinaus ist bei der aktuellen Analysetiefe noch kein konkret erklärbarer Zweck zuverlässig belegt.",
    { rating: 800 },
  );

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.id === "praise-template"));
  assert.ok(result.issues.some((entry) => entry.id === "evidence-jargon"));
});

test("alle bekannten internen Floskeln werden abgefangen", () => {
  const phrases = [
    "Die geprüfte Antwortfolge zeigt den Unterschied.",
    "Das sind die Anforderungen der Stellung.",
    "Der konkrete Zweck ist durch die gelieferten Fakten unklar.",
    "Dafür fehlt ein sicherer Bezugspunkt.",
    "Die Fortsetzung fällt klar ab.",
  ];

  phrases.forEach((text) => {
    assert.equal(
      analyzeCoachLanguage(text, { rating: 800 }).ok,
      false,
      text,
    );
  });
});

test("lange Sätze und nicht erklärte Fachwörter fallen bei 800 Elo auf", () => {
  const result = auditCoachLanguage(
    "Der Bauernhebel schafft dynamisches Gegenspiel, während du zugleich die Initiative behältst, damit deine Schwerfiguren später in die Stellung eindringen können.",
    { rating: 800 },
  );

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.id === "long-sentence"));
  assert.ok(result.issues.some((entry) => entry.id === "many-clauses"));
  assert.ok(result.issues.some((entry) => entry.id === "unexplained-jargon"));
});

test("bei gleichwertigen Zügen ist besser oder genauer verboten", () => {
  const wrongPhrases = [
    "Genauer war Nf3.",
    "Etwas genauer ist Nf3.",
    "Besser geht’s mit Nf3.",
    "Stärkere Idee: Nf3.",
    "Das ist hier die genaueste Wahl.",
  ];
  const right = auditCoachLanguage(
    "Genauso gut geht Nf3. Damit entwickelst du den Springer.",
    { rating: 800, practicallyEquivalent: true },
  );

  wrongPhrases.forEach((text) => {
    assert.ok(
      auditCoachLanguage(text, {
        rating: 800,
        practicallyEquivalent: true,
      }).issues.some((entry) => entry.id === "false-ranking"),
      text,
    );
  });
  assert.equal(right.ok, true);
});

test("eine stärkste gegnerische Antwort ist keine falsche Alternativen-Rangfolge", () => {
  const result = auditCoachLanguage(
    "Stärkste Antwort: Am stärksten ist Kd7.",
    { rating: 800, practicallyEquivalent: true },
  );

  assert.equal(
    result.issues.some((entry) => entry.id === "false-ranking"),
    false,
  );
  assert.ok(result.issues.some(
    (entry) => entry.id === "duplicated-opponent-ranking",
  ));
});

test("in erkannten Eröffnungen wird auch die gegnerische Antwort nicht gerankt", () => {
  [
    "Stärkste Antwort: Nc6.",
    "Beste Antwort: Nc6.",
    "Am stärksten ist Nc6.",
    "Nc6 ist die beste gegnerische Antwort.",
  ].forEach((text) => {
    const result = auditCoachLanguage(text, {
      rating: 1000,
      phase: "opening",
      recognizedOpening: true,
      typicalOpeningReplySupported: true,
    });
    assert.ok(
      result.issues.some((entry) => entry.id === "opening-opponent-ranking"),
      text,
    );
  });
});

test("eine typische Eröffnungsantwort braucht einen Datenbankbeleg", () => {
  const text = "Typische Antwort: Danach folgt oft Nc6.";
  const unsupported = auditCoachLanguage(text, {
    rating: 1000,
    phase: "opening",
    recognizedOpening: true,
    typicalOpeningReplySupported: false,
  });
  const supported = auditCoachLanguage(text, {
    rating: 1000,
    phase: "opening",
    recognizedOpening: true,
    typicalOpeningReplySupported: true,
  });

  assert.ok(unsupported.issues.some(
    (entry) => entry.id === "unsupported-typical-opening-reply",
  ));
  assert.equal(supported.ok, true);
});

test("mehrere Eröffnungswege dürfen nicht als bester Zug geordnet werden", () => {
  [
    "Nf3 ist hier der beste Zug.",
    "Beste Idee: Nf3.",
    "Nf3 ist hier die beste Möglichkeit.",
    "Nf3 ist hier die stärkste praktische Wahl.",
    "Nf3 gehört zu den stärksten Möglichkeiten.",
    "Nf3 ist hier der stärkste Zug.",
    "Nf3 führt hier klar die Liste an.",
    "Nf3 ist den anderen Möglichkeiten klar vorzuziehen.",
    "e4 ist hier klar besser als d4.",
    "e5 ist genauer als c5.",
    "Von den Buchzügen ist e4 die stärkere Fortsetzung.",
    "e4 steht vor d4.",
    "e4 ist meine klare Empfehlung; d4 ist nur die zweite Wahl.",
  ].forEach((text) => {
    const result = auditCoachLanguage(text, {
      rating: 1000,
      phase: "opening",
      multipleGoodOpeningMoves: true,
    });

    assert.ok(result.issues.some((entry) => entry.id === "opening-ranking"));
  });
});

test("starke Aussagen lassen sich gegen ausdrückliche Brettbelege prüfen", () => {
  const text = "Das ist ein grober Fehler. Du stellst deine Dame auf d3 ein. Danach ist die Stellung viel schlechter.";
  const unsupported = auditCoachLanguage(text, {
    rating: 800,
    evidence: { materialLoss: false, severeLoss: false },
  });
  const supported = auditCoachLanguage(text, {
    rating: 800,
    evidence: { materialLoss: true, severeLoss: true },
  });

  assert.ok(unsupported.issues.some(
    (entry) => entry.id === "unsupported-material-loss",
  ));
  assert.ok(unsupported.issues.some(
    (entry) => entry.id === "unsupported-severe-loss",
  ));
  assert.equal(supported.ok, true);
});

test("abstrakte Brettwirkungen werden als Warnung sichtbar", () => {
  [
    "Nf3 verbessert seine Wirkung auf die Stellung und bereitet den weiteren Plan vor.",
    "Be3 bringt den Läufer ins Spiel und verbessert seine Wirkung auf die Stellung.",
  ].forEach((text) => {
    const result = validateCoachLanguage(text, { rating: 800, strict: true });
    assert.equal(result.valid, false, text);
    assert.ok(result.warnings.some((entry) => entry.id === "vague-wording"), text);
  });
});

test("der Coach spricht mit Anfängern freundlich und ohne unnötige Fachsprache", () => {
  [
    "Das ist doch ganz einfach.",
    "Das solltest du eigentlich sehen.",
    "Keine Sorge, selbst Anfänger sehen das.",
    "Das ist ein Anfängerfehler.",
    "Wie konntest du diese Gabel übersehen?",
    "Das darf dir nicht passieren.",
  ].forEach((text) => {
    const result = validateCoachLanguage(text, { rating: 800, strict: true });
    assert.equal(result.valid, false, text);
    assert.ok(result.errors.some(
      (entry) => entry.id === "condescending-wording",
    ), text);
  });

  [
    "Konsolidiere die Stellung.",
    "Das ist eine positionelle Konzession.",
    "Der Zug optimiert deine Figurenkoordination.",
  ].forEach((text) => {
    const result = validateCoachLanguage(text, { rating: 1000, strict: true });
    assert.equal(result.valid, false, text);
    assert.ok(result.errors.some(
      (entry) => entry.id === "unexplained-jargon",
    ), text);
  });
});

test("eine lockere Einleitung mit sofortigem Brettbezug gilt nicht als vage", () => {
  const result = auditCoachLanguage(
    "Der Zug passt, weil der Springer auf f3 den Bauern auf e5 angreift.",
    { rating: 800 },
  );

  assert.equal(result.issues.some((entry) => entry.id === "vague-wording"), false);
});

test("Fachbegriffe werden nach Coach-Stufe konservativ bewertet", () => {
  const text = "Prophylaxe stoppt den Plan des Gegners.";
  const foundations = auditCoachLanguage(text, { rating: 800 });
  const building = auditCoachLanguage(text, { rating: 1000 });
  const club = auditCoachLanguage(text, { rating: 1400 });
  const explained = auditCoachLanguage(
    "Prophylaxe bedeutet: Du stoppst den Plan des Gegners schon vorher.",
    { rating: 800 },
  );

  assert.ok(foundations.issues.some((entry) => entry.id === "unexplained-jargon"));
  assert.ok(building.issues.some((entry) => entry.id === "unexplained-jargon"));
  assert.equal(club.issues.some((entry) => entry.id === "unexplained-jargon"), false);
  assert.equal(explained.issues.some((entry) => entry.id === "unexplained-jargon"), false);
});

test("eine Definition darf auch direkt vor dem Fachbegriff stehen", () => {
  const result = auditCoachLanguage(
    "Du stoppst seinen Plan schon vorher. Das nennt man Prophylaxe.",
    { rating: 800 },
  );

  assert.equal(result.issues.some((entry) => entry.id === "unexplained-jargon"), false);
});

test("auch gebeugte Fachbegriffe werden erkannt", () => {
  const result = auditCoachLanguage(
    "Der prophylaktische Zug fianchettiert den Läufer und startet ein Ablenkungsmanöver gegen den überlasteten Verteidiger.",
    { rating: 800 },
  );

  const samples = result.issues
    .filter((entry) => entry.id === "unexplained-jargon")
    .map((entry) => entry.sample);
  assert.ok(samples.includes("Prophylaxe"));
  assert.ok(samples.includes("Fianchetto"));
  assert.ok(samples.includes("Überlastung"));
  assert.ok(samples.includes("Ablenkung"));
});

test("technische Begriffe sind nur bei ausdrücklich technischem Modus erlaubt", () => {
  const normal = auditCoachLanguage(
    "Stockfish bewertet den Zug mit 40 Centipawn.",
    { rating: 1800 },
  );
  const technical = auditCoachLanguage(
    "Stockfish bewertet den Zug mit 40 Centipawn.",
    { rating: 1800, allowTechnicalTerms: true },
  );

  assert.ok(normal.issues.some((entry) => entry.id === "engine-jargon"));
  assert.equal(technical.ok, true);
});

test("eine englische Coach-Antwort wird konservativ erkannt", () => {
  const result = auditCoachLanguage(
    "The knight is attacked and your queen can only move after the king leaves this position.",
    { rating: 800 },
  );
  const allowed = auditCoachLanguage(
    "The knight is attacked and your queen can only move after the king leaves this position.",
    { rating: 800, expectedLanguage: "en" },
  );

  assert.ok(result.issues.some((entry) => entry.id === "wrong-language"));
  assert.equal(allowed.issues.some((entry) => entry.id === "wrong-language"), false);
});

test("das deutsche Schachwort Variation wird nicht als Fremdsprache blockiert", () => {
  const result = auditCoachLanguage(
    "Diese Variation zeigt einen klaren Plan für den Springer.",
    { rating: 1800 },
  );

  assert.equal(result.issues.some((entry) => entry.id === "wrong-language"), false);
});

test("auch kurze englische Rohfragmente werden erkannt", () => {
  [
    "Defending the knight and avoiding structure problems.",
    "Moving away from the danger diagonal.",
    "Grabbing yet more space.",
    "Unpinning, preparing to play ...Ng6.",
    "Play for mate.",
    "This attack was also winning.",
    "Development creates activity.",
    "Centralization improves coordination.",
    "Pressure on weak squares.",
    "A thematic sequence.",
    "The right recapture!",
    "Obviously fails to.",
    "Wonderful!",
    "Or 4...Nf6 5.Rxg7+ Kh8.",
  ].forEach((text) => {
    const result = auditCoachLanguage(text, { rating: 800 });
    assert.ok(result.issues.some((entry) => entry.id === "wrong-language"));
  });
});

test("spanische PGN-Rohtexte werden nicht als deutsche Coach-Texte akzeptiert", () => {
  [
    "Hay que defender el caballo de d5.",
    "Tras esto hay mate en tres.",
    "La teoría actualmente recomienda Cf3.",
    "También es posible.",
    "Se amenaza 20.Da3 mate.",
    "Dominación total.",
  ].forEach((text) => {
    const result = validateCoachLanguage(text, {
      rating: 1000,
      strict: true,
    });
    assert.equal(result.valid, false, text);
    assert.ok(result.errors.some((entry) => entry.id === "wrong-language"));
  });
});

test("kurze normale deutsche Coach-Sätze bleiben trotz strenger Prüfung erlaubt", () => {
  [
    "Also erst den Springer nach f3.",
    "Mit Nf3 hältst du mehr Felder.",
    "Eine flexible Alternative ist Nf3.",
    "Der King’s-Indian-Aufbau ist hier spielbar.",
    "Das ist eine Standard-Idee.",
  ].forEach((text) => {
    const result = validateCoachLanguage(text, {
      rating: 800,
      strict: true,
    });
    assert.equal(result.valid, true, `${text}: ${JSON.stringify(result.errors)}`);
  });
});

test("Satz- und Abschnittsgrenzen werden je Rating durchgesetzt", () => {
  const seventeenWords = "Dieser Zug entwickelt deinen Springer und greift zugleich den Bauern auf e5 an, der gerade noch ungedeckt steht.";
  const foundations = auditCoachLanguage(seventeenWords, { rating: 800 });
  const building = auditCoachLanguage(seventeenWords, { rating: 1000 });
  const tooMany = auditCoachLanguage(
    "Eins. Zwei. Drei. Vier. Fünf. Sechs. Sieben.",
    { rating: 1000 },
  );

  assert.ok(foundations.issues.some((entry) => entry.id === "long-sentence"));
  assert.equal(building.issues.some((entry) => entry.id === "long-sentence"), false);
  assert.ok(tooMany.issues.some((entry) => entry.id === "too-many-sentences"));
});

test("Zugnummern zählen im Ganzpartie-Review nicht als eigene Sätze", () => {
  const result = analyzeCoachLanguage(
    "**2. Nf3:** Das ist gut.\n**3... Nc6:** Das ist ein klarer Fehler.\n**4. Ba4:** Das ist ein grober Fehler.",
    { rating: 800 },
  );

  assert.equal(result.metrics.sentences, 3);
  assert.equal(
    result.issues.some((entry) => entry.id === "too-many-sentences"),
    false,
  );
});

test("Moment-Label und Komma vor aber zählen nicht als zusätzliche Teilsätze", () => {
  const result = analyzeCoachLanguage(
    "- **1. e4:** Gute Idee, aber d4 geht genauso gut.",
    { rating: 800 },
  );

  assert.equal(
    result.issues.some((entry) => entry.id === "many-clauses"),
    false,
  );
});

test("Validierung trennt Fehler und Warnungen und kann streng laufen", () => {
  const text = "Nf3 verbessert seine Wirkung auf die Stellung.";
  const normal = validateCoachLanguage(text, { rating: 800 });
  const strict = validateCoachLanguage(text, { rating: 800, strict: true });

  assert.equal(normal.valid, true);
  assert.equal(normal.errors.length, 0);
  assert.ok(normal.warnings.length > 0);
  assert.equal(strict.valid, false);
});

const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6-luna";
const MAX_FACTS = 10;
const MAX_KNOWLEDGE = 6;

function cleanText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function sanitizeFacts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_FACTS).flatMap((fact) => {
    const label = cleanText(fact?.label, 60);
    const detail = cleanText(fact?.value, 240);
    return label && detail ? [{ label, value: detail }] : [];
  });
}

function sanitizeKnowledge(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_KNOWLEDGE).flatMap((entry) => {
    const id = cleanText(entry?.id, 100);
    const kind = cleanText(entry?.kind, 60);
    const title = cleanText(entry?.title, 240);
    const text = cleanText(entry?.text, 700);
    const source = cleanText(entry?.source, 240);
    return id && kind && title && text
      ? [{ id, kind, title, text, source: source || "Wissensdatenbank" }]
      : [];
  });
}

function responseText(data) {
  if (typeof data?.output_text === "string") return data.output_text.trim();
  return (Array.isArray(data?.output) ? data.output : [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n");
}

function notationTokens(text) {
  return String(text || "").match(/\b(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)\b/gu) || [];
}

function numberTokens(text) {
  return String(text || "").match(/[+-]?\d+(?:[.,]\d+)?/gu) || [];
}

function safeRephrase(candidate, source) {
  const text = cleanText(candidate, 700);
  if (!text || text.split(/\s+/u).length > 70 || /[*_`#]{2,}/u.test(text)) return false;
  const sourceText = JSON.stringify(source);
  if (notationTokens(text).some((token) => !sourceText.includes(token))) return false;
  if (numberTokens(text).some((token) => !sourceText.includes(token))) return false;
  const forbiddenMotifs = ["Gabel", "Fesselung", "Spieß", "Doppelangriff", "Abzugsangriff"];
  if (forbiddenMotifs.some((motif) => text.includes(motif) && !sourceText.includes(motif))) return false;
  const sourceHasMate = /(?:#|matt)/iu.test(sourceText);
  if (sourceHasMate && !/matt/iu.test(text)) return false;
  if (!sourceHasMate && /(?:schachmatt|\bmatt\b)/iu.test(text)) return false;
  return true;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Ungültiges JSON." }, { status: 400 });
  }
  const localExplanation = cleanText(body?.localExplanation, 1_000);
  const facts = sanitizeFacts(body?.facts);
  const knowledge = sanitizeKnowledge(body?.knowledge);
  const mode = body?.mode === "opening_knowledge" ? "opening_knowledge" : "engine_facts";
  if (!localExplanation || facts.length === 0) {
    return Response.json({ error: "Fakten fehlen." }, { status: 400 });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ text: localExplanation, source: "local", reason: "OPENAI_API_KEY fehlt", usedKnowledgeIds: [] });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        instructions: [
          "Formuliere die gelieferte lokale Schacherklärung auf Deutsch neu.",
          "Schreibe locker und so einfach, dass ein Grundschulkind sie versteht.",
          "Nutze höchstens drei kurze Sätze und sprich den Spieler mit du an.",
          "Verwende ausschließlich die gelieferten Fakten, die lokale Erklärung und passende Einträge aus knowledge.",
          "Wissen darf einen belegten Zug verständlich erklären, aber niemals einen neuen konkreten Zug, eine neue Stellungsbehauptung oder eine neue Bewertung liefern.",
          "Eröffnungstheorie ist allgemeiner Kontext und kein Beweis dafür, dass ein konkreter Zug gut oder schlecht ist.",
          "Fakten und konkrete Engine-Varianten haben immer Vorrang vor allgemeinem Wissen.",
          mode === "opening_knowledge"
            ? "Eröffnungsmodus: Erkläre den bekannten Buchzug aus Eröffnungswissen und Wissensdatenbank. Sprich nicht von Engine, Bewertung oder Variante."
            : "Analysemodus: Erkläre zuerst die konkrete taktische oder materielle Folge aus den Fakten.",
          "Erfinde keine Züge, Figuren, Felder, Zahlen, Motive, Ursachen oder Folgen.",
          "Bei Matt sage sofort und direkt, dass die Partie vorbei ist.",
          "Gib JSON mit text und usedKnowledgeIds aus. usedKnowledgeIds enthält nur IDs von Wissenseinträgen, die im Text wirklich verwendet wurden.",
        ].join(" "),
        input: JSON.stringify({ mode, facts, localExplanation, knowledge }),
        reasoning: { effort: "low" },
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "stage_four_grounded_reply",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["text", "usedKnowledgeIds"],
              properties: {
                text: { type: "string", minLength: 1, maxLength: 700 },
                usedKnowledgeIds: {
                  type: "array",
                  maxItems: MAX_KNOWLEDGE,
                  items: { type: "string", maxLength: 100 },
                },
              },
            },
          },
        },
        max_output_tokens: 260,
        store: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return Response.json({ text: localExplanation, source: "local", reason: `KI-Fehler ${response.status}`, usedKnowledgeIds: [] });
    }
    let output;
    try {
      output = JSON.parse(responseText(await response.json()));
    } catch {
      output = null;
    }
    const candidate = cleanText(output?.text, 700);
    const knownIds = new Set(knowledge.map((entry) => entry.id));
    const usedKnowledgeIds = Array.isArray(output?.usedKnowledgeIds)
      ? [...new Set(output.usedKnowledgeIds.filter((id) => knownIds.has(id)))].slice(0, MAX_KNOWLEDGE)
      : [];
    if (!safeRephrase(candidate, { facts, localExplanation, knowledge })) {
      return Response.json({ text: localExplanation, source: "local", reason: "KI-Text enthielt unbelegte Angaben", usedKnowledgeIds: [] });
    }
    return Response.json({ text: candidate, source: "ai", reason: "", usedKnowledgeIds });
  } catch (error) {
    return Response.json({
      text: localExplanation,
      source: "local",
      reason: error?.name === "AbortError" ? "KI-Zeitlimit" : "KI nicht erreichbar",
      usedKnowledgeIds: [],
    });
  } finally {
    clearTimeout(timeout);
  }
}

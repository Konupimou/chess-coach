import { promises as fs } from "node:fs";
import path from "node:path";
import { siteIdentityFromHeaders } from "../../../api/siteIdentity.js";

export const runtime = "nodejs";

const filePath = path.join(process.cwd(), "data", "feedback-submissions.json");

async function readFeedback() {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); } catch { return []; }
}

export async function POST(request) {
  const identity = siteIdentityFromHeaders(request.headers);
  const body = await request.json().catch(() => null);
  if (!body?.fenBefore || !body?.rating) {
    return Response.json({ error: "fenBefore und rating sind erforderlich." }, { status: 400 });
  }
  const entry = {
    id: `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user: identity.user?.email || "local-user",
    gameId: String(body.gameId || "").slice(0, 120),
    fenBefore: String(body.fenBefore).slice(0, 120),
    fenAfter: String(body.fenAfter || "").slice(0, 120),
    moveUci: String(body.moveUci || "").slice(0, 10),
    moveSan: String(body.moveSan || "").slice(0, 30),
    rating: body.rating === "helpful" ? "helpful" : "not_helpful",
    text: String(body.text || "").trim().slice(0, 2_000),
    coachText: String(body.coachText || "").slice(0, 2_000),
    patternIds: Array.isArray(body.patternIds) ? body.patternIds.slice(0, 12).map(String) : [],
    createdAt: new Date().toISOString(),
  };
  const entries = (await readFeedback()).filter((item) => !(item.user === entry.user && item.gameId === entry.gameId && item.fenBefore === entry.fenBefore && item.moveUci === entry.moveUci));
  entries.unshift(entry);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(entries.slice(0, 10_000), null, 2));
  return Response.json({ ok: true, feedback: entry });
}

export async function GET(request) {
  const identity = siteIdentityFromHeaders(request.headers);
  const user = identity.user?.email || "local-user";
  const entries = (await readFeedback()).filter((item) => item.user === user);
  return Response.json({ feedback: entries });
}

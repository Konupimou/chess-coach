import { chatConfig } from "../../../api/chat.js";

export const runtime = "nodejs";

export function GET() {
  return Response.json({
    ok: true,
    coachConfigured: chatConfig.configured,
    model: chatConfig.model,
  });
}

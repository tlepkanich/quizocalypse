import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import { runAskAIChat, type AskAIMessage } from "../lib/claude";
import { parseBrandGuidelinesSafe } from "../lib/brandGuidelines";
import { rateLimit } from "../lib/rateLimiters";
import type { IndexedProduct } from "../lib/recommendationEngine";

// AskAI chat endpoint. The runtime POSTs the current AskAI node id, the
// path so far, and the new user message; we respond with the assistant's
// reply. No streaming for the MVP — the reply is short enough to wait on.

interface ChatRequestBody {
  nodeId: string;
  // Visited path so the server can build the same context the runtime sees.
  path: Array<{ questionNodeId: string; answerIds: string[] }>;
  history: AskAIMessage[];
  userMessage: string;
}

// Hard cap on user message length so a stuck client can't spam massive
// prompts. Mirrors typical chat input affordances.
const MAX_USER_MESSAGE_CHARS = 1200;

export async function action({ params, request }: ActionFunctionArgs) {
  const { id } = params;
  if (!id) return json({ error: "Missing quiz id" }, { status: 400 });
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  // 10/min/IP — the only public endpoint where abuse costs real money (one
  // Claude call per request). Same-origin POSTs from the runtime, no CORS.
  const rl = rateLimit(request, "ai-chat", 10);
  if (!rl.ok) {
    return json(
      { error: "Too many messages — give it a moment." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterS) } },
    );
  }

  const body = (await request.json()) as ChatRequestBody;
  if (!body.userMessage || typeof body.userMessage !== "string") {
    return json({ error: "Missing userMessage" }, { status: 400 });
  }
  if (body.userMessage.length > MAX_USER_MESSAGE_CHARS) {
    return json({ error: "Message too long" }, { status: 413 });
  }

  const quiz = await prisma.quiz.findFirst({
    where: { id },
    // Include the parent shop's brand guidelines so we can apply the
    // brand voice to the assistant's reply.
    select: {
      publishedJson: true,
      shop: { select: { brandGuidelines: true } },
    },
  });
  if (!quiz?.publishedJson) {
    return json({ error: "Quiz not published" }, { status: 404 });
  }
  const brandGuidelines = parseBrandGuidelinesSafe(
    quiz.shop?.brandGuidelines,
  );

  const parsed = Quiz.safeParse(quiz.publishedJson);
  if (!parsed.success) {
    return json({ error: "Quiz JSON invalid" }, { status: 500 });
  }
  const doc = parsed.data;

  const node = doc.nodes.find((n) => n.id === body.nodeId);
  if (!node || node.type !== "ask_ai") {
    return json({ error: "Node is not an ask_ai node" }, { status: 400 });
  }

  // Server-side max_turns enforcement — count assistant replies in history
  // and refuse if we'd exceed. This mirrors the client check but prevents
  // bypassing via a hand-rolled POST.
  const assistantTurns = body.history.filter((m) => m.role === "assistant").length;
  if (assistantTurns >= node.data.max_turns) {
    return json({ error: "Max turns reached" }, { status: 429 });
  }

  // Build quiz-context summary from the visited path.
  const lines: string[] = [];
  for (const step of body.path) {
    const q = doc.nodes.find((n) => n.id === step.questionNodeId);
    if (!q || q.type !== "question") continue;
    const picked = q.data.answers
      .filter((a) => step.answerIds.includes(a.id))
      .map((a) => a.text);
    if (picked.length === 0) continue;
    lines.push(`- "${q.data.text}" → ${picked.join(", ")}`);
  }
  const quizContext = lines.length > 0 ? lines.join("\n") : "";

  // Catalog summary from the baked product_index. Trim each product to a
  // single line — title, handle, top tags, price — to keep tokens bounded.
  const publishedRaw = quiz.publishedJson as { product_index?: IndexedProduct[] };
  const products = publishedRaw.product_index ?? [];
  const catalogSummary = products
    .slice(0, 40) // cap so the prompt stays manageable
    .map((p) => {
      const tagPart = p.tags.slice(0, 6).join(", ");
      const pricePart = p.price ? `$${p.price}` : "n/a";
      return `- ${p.title} (handle: ${p.handle}) — tags: [${tagPart}] — price: ${pricePart}`;
    })
    .join("\n");

  try {
    const result = await runAskAIChat({
      systemPrompt: node.data.system_prompt,
      personaName: node.data.persona_name,
      quizContext,
      catalogSummary,
      history: body.history,
      userMessage: body.userMessage,
      ...(brandGuidelines ? { brandGuidelines } : {}),
    });
    return json({ reply: result.reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: `AI chat failed: ${message}` }, { status: 502 });
  }
}

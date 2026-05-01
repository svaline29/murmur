import Anthropic from "@anthropic-ai/sdk";

import { buildPrompt, parseResponse } from "@/lib/claude";
import type { ChatMessage, ClaudeResponse, SimSnapshot } from "@/lib/types";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";

const FALLBACK: ClaudeResponse = {
  message: "I missed that — try rephrasing.",
  rule_update: null,
  highlight_cluster: null,
};

function jsonResponse(body: ClaudeResponse, status = 200) {
  return Response.json(body, { status });
}

function isChatHistory(x: unknown): x is ChatMessage[] {
  if (!Array.isArray(x)) return false;
  return x.slice(-10).every(
    (m) =>
      m !== null &&
      typeof m === "object" &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      typeof m.timestamp === "number"
  );
}

function isSimSnapshot(x: unknown): x is SimSnapshot {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;

  const delta = s.delta;
  if (
    !delta ||
    typeof delta !== "object" ||
    typeof (delta as Record<string, unknown>).clusterCountDelta !==
      "number" ||
    typeof (delta as Record<string, unknown>).avgVelocityDelta !==
      "number" ||
    typeof (delta as Record<string, unknown>).timeSinceLastChange !==
      "number"
  ) {
    return false;
  }

  if (
    typeof s.timestamp !== "number" ||
    typeof s.agentCount !== "number" ||
    typeof s.clusterCount !== "number" ||
    typeof s.outlierCount !== "number" ||
    typeof s.velocityVariance !== "number" ||
    typeof s.dominantDirection !== "number"
  ) {
    return false;
  }

  if (!Array.isArray(s.clusters)) return false;
  for (const c of s.clusters) {
    if (!c || typeof c !== "object") return false;
    const cl = c as Record<string, unknown>;
    if (
      typeof cl.id !== "number" ||
      typeof cl.size !== "number" ||
      typeof cl.avgVelocity !== "number"
    )
      return false;
    const centroid = cl.centroid;
    if (
      !centroid ||
      typeof centroid !== "object" ||
      typeof (centroid as Record<string, unknown>).x !== "number" ||
      typeof (centroid as Record<string, unknown>).y !== "number"
    )
      return false;
    if (!Array.isArray(cl.agentIds)) return false;
    if (
      !(cl.agentIds as unknown[]).every(
        (id) => typeof id === "number" && Number.isInteger(id)
      )
    )
      return false;
  }

  const rules = s.currentRules;
  if (
    !rules ||
    typeof rules !== "object" ||
    typeof (rules as Record<string, unknown>).separation !== "number" ||
    typeof (rules as Record<string, unknown>).alignment !== "number" ||
    typeof (rules as Record<string, unknown>).cohesion !== "number" ||
    typeof (rules as Record<string, unknown>).speed !== "number" ||
    typeof (rules as Record<string, unknown>).perception !== "number"
  )
    return false;

  return true;
}

async function callClaude(
  client: Anthropic,
  snapshot: SimSnapshot,
  history: ChatMessage[],
  userMessage: string
): Promise<string | null> {
  try {
    const { system, messages } = buildPrompt(snapshot, history, userMessage);
    const result = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
    });

    const textBlock = result.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return textBlock.text;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(FALLBACK);
  }

  if (!body || typeof body !== "object") {
    return jsonResponse(FALLBACK);
  }

  const { snapshot, history, userMessage } = body as Record<
    string,
    unknown
  >;

  if (typeof userMessage !== "string") {
    return jsonResponse(FALLBACK);
  }

  if (!isSimSnapshot(snapshot)) {
    return jsonResponse(FALLBACK);
  }

  const hist: ChatMessage[] = isChatHistory(history)
    ? history.slice(-10)
    : [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return jsonResponse(FALLBACK);
  }

  const client = new Anthropic({ apiKey });

  let raw = await callClaude(client, snapshot, hist, userMessage);
  let parsed = raw ? parseResponse(raw) : null;

  if (!parsed) {
    raw = await callClaude(client, snapshot, hist, userMessage);
    parsed = raw ? parseResponse(raw) : null;
  }

  if (!parsed) {
    return jsonResponse(FALLBACK);
  }

  return jsonResponse(parsed);
}

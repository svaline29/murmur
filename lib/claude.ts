import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

import type {
  ChatMessage,
  ClaudeResponse,
  RuleWeights,
  SimSnapshot,
} from "@/lib/types";

/**
 * Verbatim from spec §4.4 (`lib/claude.ts` — System prompt).
 */
export const MURMUR_SYSTEM_PROMPT = `You are Murmur, the AI observer of a swarm of 200 autonomous agents
following boids rules (separation, alignment, cohesion). You see live
metrics about the simulation, not raw positions.

You have three jobs:
1. Explain what is happening or why, when asked
2. Modify agent behavior when the user requests it (return rule_update)
3. Reference specific clusters when relevant (return highlight_cluster
   with the cluster id from the snapshot)

Style:
- Conversational, not robotic. Like a thoughtful colleague.
- Concise. 1-3 sentences typically. Never lecture.
- Reference specific numbers when they support the point.
- Don't narrate every metric. Pick what matters.

When referencing specific clusters in your message, wrap them in square brackets with the format [cluster N] where N is the integer cluster ID from the snapshot. Example: 'The agents in [cluster 0] are dispersing while [cluster 2] is gaining cohesion.' Use this whenever you reference a specific cluster by id, but not for general statements about 'the swarm' or 'all clusters'.

You MUST always return valid JSON in this exact shape:
{
  "message": "<your conversational response, always present>",
  "rule_update": null OR { "separation": <num>, "alignment": <num>,
                           "cohesion": <num>, "speed": <num>,
                           "perception": <num> } (any subset),
  "highlight_cluster": null OR <integer cluster id from the snapshot>
}

Rule weight ranges (stay inside these bounds):
- separation: 0 to 5
- alignment: 0 to 5
- cohesion: 0 to 5
- speed: 0.2 to 8
- perception: 10 to 250

Behavior tweaks must stay **playable**: motion should keep flowing; agents
should not freeze into a motionless blob or a single overlapping point.

Use the snapshot's "Current rules" as a baseline. Change only what you need,
by **moderate steps** (roughly 0.5–1.5 on separation/alignment/cohesion,
smaller on speed). Visible change is good; slamming multiple knobs to 0 or 5
is wrong — that breaks the sim.

**More chaotic / dispersed:** raise separation a bit; lower alignment and
cohesion **slightly**. Never drive alignment or cohesion to zero — keep them
at least ~0.8 so neighbors still interact and velocities stay lively. Avoid
max perception (large radii + extreme weights makes everyone pull the same way).

**Tighter flock / more cohesive:** raise cohesion and alignment moderately.
Keep separation at least ~1.0–1.5 so agents maintain spacing and keep moving as
a group instead of collapsing into one static clump. Do not combine near-max
cohesion with near-min separation.


Only set rule_update when the user is requesting a behavioral change.
Only set highlight_cluster when referencing a specific cluster.
Otherwise leave them null.

Return ONLY the JSON object. No preamble. No code fences. No commentary.`;

const RULE_KEYS = [
  "separation",
  "alignment",
  "cohesion",
  "speed",
  "perception",
] as const satisfies readonly (keyof RuleWeights)[];

type RuleKey = (typeof RULE_KEYS)[number];

function compassDirection(radians: number): string {
  const twoPi = 2 * Math.PI;
  const a = ((radians % twoPi) + twoPi) % twoPi;
  const labels = [
    "east",
    "northeast",
    "north",
    "northwest",
    "west",
    "southwest",
    "south",
    "southeast",
  ] as const;
  const sector = Math.floor((a + Math.PI / 8) / (Math.PI / 4)) % 8;
  return labels[sector];
}

function varianceDescriptor(variance: number): string {
  if (variance < 0.25) return "low — ordered movement";
  if (variance < 0.75) return "moderate — mixed motion";
  return "high — chaotic motion";
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/**
 * Verbatim serialization pattern from spec §4.4 (Snapshot serialization).
 */
export function serializeSnapshotContext(snapshot: SimSnapshot): string {
  const clustersById = [...snapshot.clusters].sort((a, b) => a.id - b.id);
  const clustersBySizeDesc = [...snapshot.clusters].sort(
    (a, b) => b.size - a.size
  );

  const clusterSummaries =
    clustersBySizeDesc.length === 0
      ? "(none)"
      : clustersBySizeDesc.map((c) => `one of size ${c.size}`).join(", ");

  const outliersLine = `- Outliers: ${snapshot.outlierCount} agents not in any cluster`;
  const varianceLine = `- Average velocity: ${round1(snapshot.averageVelocity)} (variance: ${round1(snapshot.velocityVariance)}, ${varianceDescriptor(snapshot.velocityVariance)})`;
  const headingLine = `- Heading: mostly ${compassDirection(snapshot.dominantDirection)}`;
  const timeSeconds = snapshot.delta.timeSinceLastChange / 1000;
  const timeLine = `- Time since cluster count last changed: ${round1(timeSeconds)} seconds`;
  const r = snapshot.currentRules;
  const rulesLine = `- Current rules: separation ${r.separation}, alignment ${r.alignment}, cohesion ${r.cohesion}, speed ${r.speed},\n  perception ${r.perception}`;

  const clusterBlocks = clustersById
    .map(
      (c) =>
        `- id ${c.id}: centroid (${Math.round(c.centroid.x)}, ${Math.round(c.centroid.y)}), size ${c.size}, avg velocity ${round1(c.avgVelocity)}`
    )
    .join("\n");

  return `[Current simulation state]
- Clusters: ${snapshot.clusterCount}${clusterSummaries ? ` (${clusterSummaries})` : ""}
${outliersLine}
${varianceLine}
${headingLine}
${timeLine}
${rulesLine}

Cluster details:
${clusterBlocks || "- (no clusters)"}`;
}

export function buildPrompt(
  snapshot: SimSnapshot,
  history: ChatMessage[],
  userMessage: string
): { system: string; messages: MessageParam[] } {
  const context = serializeSnapshotContext(snapshot);
  const wrapped = `${context}

[User]: ${userMessage}`;

  const messages: MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  messages.push({ role: "user", content: wrapped });

  return { system: MURMUR_SYSTEM_PROMPT, messages };
}

function stripCodeFences(text: string): string {
  let s = text.trim();
  const wrapped = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/im.exec(s);
  if (wrapped) return wrapped[1].trim();
  if (s.startsWith("```")) {
    s = s
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();
  }
  return s;
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inRange(key: RuleKey, n: number): boolean {
  switch (key) {
    case "separation":
    case "alignment":
    case "cohesion":
      return n >= 0 && n <= 5;
    case "speed":
      return n >= 0.2 && n <= 8;
    case "perception":
      return n >= 10 && n <= 250;
    default:
      return false;
  }
}

function validateRuleUpdate(
  value: unknown
): Partial<RuleWeights> | null | false {
  if (value === null) return null;
  if (!isPlainObject(value)) return false;
  const out: Partial<RuleWeights> = {};
  for (const key of Object.keys(value)) {
    if (!RULE_KEYS.includes(key as RuleKey)) return false;
    const k = key as RuleKey;
    const n = value[k];
    if (typeof n !== "number" || Number.isNaN(n) || !inRange(k, n)) {
      return false;
    }
    out[k] = n;
  }
  return Object.keys(out).length === 0 ? null : out;
}

export function parseResponse(rawText: string): ClaudeResponse | null {
  let s = stripCodeFences(String(rawText).trim());
  const extracted = extractJsonObject(s);
  if (extracted !== null) s = extracted;

  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) return null;

  const message = parsed.message;
  const ruleRaw = parsed.rule_update;
  const highlightRaw = parsed.highlight_cluster;

  if (typeof message !== "string") return null;

  const ruleUpdate = validateRuleUpdate(ruleRaw);
  if (ruleUpdate === false) return null;

  if (
    highlightRaw !== null &&
    highlightRaw !== undefined &&
    typeof highlightRaw !== "number"
  ) {
    return null;
  }
  if (
    typeof highlightRaw === "number" &&
    (!Number.isFinite(highlightRaw) ||
      Math.floor(highlightRaw) !== highlightRaw)
  ) {
    return null;
  }

  return {
    message,
    rule_update: ruleUpdate,
    highlight_cluster: highlightRaw === undefined ? null : highlightRaw,
  };
}

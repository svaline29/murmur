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
                           "perception": <num>, "entropy": <num> } (any subset),
  "highlight_cluster": null OR <integer cluster id from the snapshot>
}

---

PHYSICS KNOWLEDGE

Each rule does the following in the actual simulation:

SEPARATION: Distance-weighted repulsion within 45% of perception
radius. Stronger at close range. REQUIRES high speed to actually
scatter agents — without speed, agents just space out slightly and
re-equilibrate at wider spacing. High separation alone does nothing
dramatic.

ALIGNMENT: Velocity matching with neighbors, scaled 0.4. Drives
directional coordination. Primary force for making groups move
coherently together.

COHESION: Pull toward local center of mass, scaled by actual distance
× 0.04. Weak at short range, strong at long range. REQUIRES high
perception to work globally — agents only pull toward neighbors they
can see. At low perception, cohesion only keeps local groups together,
never merges distant groups.

PERCEPTION: Determines who counts as a neighbor. The most important
lever for global vs local behavior. Low perception (10-40) → agents
only see immediate neighbors → local clusters form, never merge. High
perception (150-250) → agents see across the canvas → global
coordination, flock consolidation.

ENTROPY: Random force per tick scaled 0.3. Prevents dead equilibrium.
At 0, the simulation can freeze in a stable state. At 3-5, agents
behave erratically regardless of other rules.

SPEED: Caps maximum velocity AND scales the force budget. Low speed
means all forces are weaker. Critical: chaos requires high speed —
without it, separation just spreads agents out and they
re-equilibrate.

SIMSPEED: Time multiplier. Does NOT change physics. Only compresses
or expands wall-clock time. Use for observing long-term emergence
without changing behavior.

---

PARAMETER RANGES

separation: 0 to 5
alignment: 0 to 5
cohesion: 0 to 5
speed: 0.2 to 8
perception: 10 to 250
entropy: 0 to 5
simSpeed: 0.25 to 10

---

SCENARIO PRESETS — use these as targets for common requests

TIGHT SINGLE FLOCK — "form tight flocks", "form one flock", "consolidate", "come together":
  separation: 1.2, alignment: 3.0, cohesion: 4.5,
  speed: 2.5, perception: 220, entropy: 0.1
  Key: high perception is mandatory — agents must see across canvas.
  Keep separation around ~1.0–1.5 so the flock stays one mass without collapsing to a single overlapping blob.

CHAOS / SCATTER — "chaos", "scatter", "break apart", "go wild":
  separation: 4.0, alignment: 0.2, cohesion: 0.1,
  speed: 7.0, perception: 20, entropy: 3.0
  Key: high speed is mandatory — without it agents just space out.

MANY SMALL GROUPS — "fragment", "split up", "small clusters":
  separation: 2.0, alignment: 0.8, cohesion: 0.6,
  speed: 2.0, perception: 35, entropy: 1.0
  Key: low perception keeps agents locally coordinated only.

SLOW / CONTEMPLATIVE — "slow down", "gentle", "peaceful":
  separation: 1.2, alignment: 1.5, cohesion: 1.5,
  speed: 0.5, perception: 80, entropy: 0.1
  Key: low entropy is mandatory at low speed — otherwise random
  forces dominate and movement looks jittery not peaceful.

ORGANIZED / CLEAN — "more organized", "tidy", "coordinated":
  separation: 1.2, alignment: 3.5, cohesion: 1.5,
  speed: 2.0, perception: 80, entropy: 0.1

INSECT SWARM — "like bees", "like insects", "swarm":
  separation: 1.0, alignment: 0.5, cohesion: 3.0,
  speed: 3.0, perception: 60, entropy: 1.5

SPEED UP TIME — "speed up", "fast forward", "observe long-term":
  simSpeed: 5.0
  DO NOT change any other rules. Only simSpeed.

RESET — "reset", "back to default", "start over":
  separation: 1.5, alignment: 1.0, cohesion: 1.0,
  speed: 2.0, perception: 50, entropy: 0.5, simSpeed: 1.0

---

CRITICAL COUPLING RULES — always follow these

1. Chaos requires BOTH high separation AND high speed. Never set
   separation > 3 without also setting speed > 4.

2. One tight flock requires BOTH high cohesion AND high perception.
   Never set cohesion > 3 without also setting perception > 150.

3. Slow movement requires low entropy. Never set speed < 1.0 without
   also setting entropy < 0.3.

4. When only simSpeed is requested, return ONLY simSpeed in
   rule_update. Do not modify any other parameters.

5. Partial updates are fine. If the user asks to "make them faster",
   return only { "speed": 5.0 } — do not reset other rules to defaults.

6. Be bold. The ranges exist for a reason. "A little more chaotic"
   still means separation: 3.0+ and speed: 5.0+. Subtle nudges
   produce no visible change and disappoint the user.

---


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
  "entropy",
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
  const rulesLine = `- Current rules: separation ${r.separation}, alignment ${r.alignment}, cohesion ${r.cohesion}, speed ${r.speed},\n  perception ${r.perception}, entropy ${r.entropy}`;

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
    case "entropy":
      return n >= 0 && n <= 5;
    default:
      return false;
  }
}

/** Coerce model output into rule_update; drop invalid keys instead of failing the whole response. */
function parseRuleUpdate(value: unknown): Partial<RuleWeights> | null {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return null;
  const out: Partial<RuleWeights> = {};
  for (const key of Object.keys(value)) {
    if (!RULE_KEYS.includes(key as RuleKey)) continue;
    const k = key as RuleKey;
    const raw = value[k];
    let n: number | undefined;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      n = raw;
    } else if (typeof raw === "string") {
      const parsed = Number(raw.trim());
      if (Number.isFinite(parsed)) n = parsed;
    }
    if (n === undefined || !inRange(k, n)) continue;
    out[k] = n;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** Accept numeric cluster id from JSON number or string; invalid values become null (do not reject message). */
function normalizeHighlightCluster(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.floor(value) !== value) return null;
    return value;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!/^-?\d+$/.test(t)) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || Math.floor(n) !== n) return null;
    return n;
  }
  return null;
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

  if (typeof message !== "string") return null;

  const ruleUpdate = parseRuleUpdate(ruleRaw);
  const highlightCluster = normalizeHighlightCluster(parsed.highlight_cluster);

  return {
    message,
    rule_update: ruleUpdate,
    highlight_cluster: highlightCluster,
  };
}

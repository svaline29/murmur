# Murmur. — Specification

> A real-time swarm simulation with a conversational AI observer. Agents
> follow boids rules. An LLM maintains live situational awareness of the
> simulation and responds to natural language queries — explaining
> emergent behavior or modifying agent rules in plain English.

---

## 1. Product Definition

### 1.1 What it is
A web app where ~200 autonomous agents flock on a black canvas. A chat
panel on the right lets the user talk to an AI that has live awareness
of the simulation. The AI can:
- Explain what is currently happening (cluster formation, chaos, isolation)
- Reason about why it happened (referencing prior state)
- Modify agent rules in response to natural language ("make them chaotic")
- Highlight specific clusters in the canvas while discussing them

### 1.2 What makes it technically real
- **Stateful conversation about a dynamic system.** The AI's observations
  evolve as the simulation evolves. It can contradict its earlier
  assessments when state changes.
- **Perception layer.** A separate module computes interpreted metrics
  from raw agent state. The AI never sees raw positions — it sees
  cluster counts, velocity variance, deltas. This is the right abstraction.
- **Structured output.** Every AI response returns JSON with three
  optional fields: natural-language `message`, parameter `rule_update`,
  and `highlight_cluster` ID. Frontend handles each independently.
- **Decoupled rendering.** The simulation runs at 60fps via
  `requestAnimationFrame`. API calls are fully async. The render loop
  never blocks.
- **Frozen-snapshot highlight sync.** When the user sends a message,
  the current cluster snapshot is frozen and sent with the prompt.
  The AI's `highlight_cluster` ID maps to that frozen snapshot — not
  to live state — preventing ID drift.

### 1.3 What it is NOT
- Not a generic boids visualizer
- Not a chatbot with a sim attached
- Not a control dashboard with sliders (sliders exist only as hidden
  dev tooling)
- Not an agent-level LLM system (the LLM does NOT control individual
  agents; it observes the swarm and modifies global rule weights)

---

## 2. Architecture

### 2.1 Module overview

```
┌─────────────────────────────────────────────────────────────┐
│                       Next.js App                           │
│                                                             │
│  ┌──────────────────────┐   ┌────────────────────────────┐ │
│  │  SimCanvas (70%)     │   │  ChatPanel (30%)           │ │
│  │                      │   │                            │ │
│  │  Render loop         │   │  Chat history              │ │
│  │  Triangle agents     │   │  Input field (pulses on    │ │
│  │  Trails              │   │    pending)                │ │
│  │  Cluster highlight   │   │  "Thinking..." indicator   │ │
│  │  Soft boundary       │   │  4 preset buttons          │ │
│  │                      │   │  MetricsPanel (toggleable) │ │
│  └──────────────────────┘   └────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
        │                                │
        ▼                                ▼
   [simulation.ts]                  [/api/chat]
   pure TS, no React                proxies to Anthropic
        │                                │
        ▼                                ▼
   [extractor.ts]                   [claude.ts]
   computes SimSnapshot             builds prompt, parses
   every 500ms                      ClaudeResponse
```

### 2.2 Data flow on user message

```
User sends message
       │
       ▼
Extractor freezes current snapshot
       │
       ▼
Frontend POSTs { snapshot, history (last 10), userMessage } to /api/chat
       │
       ▼
/api/chat builds prompt + calls Anthropic API (Haiku 4.5)
       │
       ▼
Claude returns structured JSON
       │
       ▼
Response parsed → ClaudeResponse
       │
       ├──► message → appended to chat history (chat UI re-renders)
       │
       ├──► rule_update (if non-null) → applied to simulation rule weights
       │
       └──► highlight_cluster (if non-null) → triggers convex-hull pulse
                                              on canvas, mapped to frozen
                                              snapshot's cluster centroid
```

### 2.3 What lives where

| State                       | Lives in              | Why                          |
|-----------------------------|-----------------------|------------------------------|
| Agent positions / velocities| `useRef` in hook      | 60fps update — no re-render  |
| Rule weights                | `useRef` in hook      | Same reason                  |
| Latest SimSnapshot          | React `useState`      | Drives metrics panel UI      |
| Conversation history        | React `useState`      | Drives chat UI               |
| Active highlight (cluster)  | React `useState`      | Drives canvas overlay        |
| Pending API state           | React `useState`      | Drives input pulse / indicator|
| Frozen snapshot             | Local at send-time    | Doesn't need to persist      |

**Critical:** Anything that updates 60x/second lives in `useRef`. Anything
that needs to trigger React re-render lives in `useState`. Do not violate
this rule — it is the difference between a smooth demo and a frozen one.

---

## 3. Type Definitions

These are the canonical types. Every module references these. Do not
redefine them locally.

```typescript
// lib/types.ts

export interface Agent {
  id: number;
  x: number;        // position
  y: number;
  vx: number;       // velocity
  vy: number;
}

export interface RuleWeights {
  separation: number;   // 0..2,  default 1.5
  alignment: number;    // 0..2,  default 1.0
  cohesion: number;     // 0..2,  default 1.0
  speed: number;        // 0.5..4, default 2.0 (max velocity)
  perception: number;   // 20..100, default 50 (neighbor radius in px)
}

export interface Cluster {
  id: number;           // stable within a single snapshot
  centroid: { x: number; y: number };
  size: number;         // agent count
  avgVelocity: number;  // magnitude
  agentIds: number[];   // which agents belong to this cluster
}

export interface SimSnapshot {
  timestamp: number;    // ms
  agentCount: number;
  clusterCount: number;
  clusters: Cluster[];
  outlierCount: number; // agents not in any cluster
  velocityVariance: number;
  dominantDirection: number; // radians, avg heading
  delta: {
    clusterCountDelta: number;     // vs previous snapshot
    avgVelocityDelta: number;
    timeSinceLastChange: number;   // ms since clusterCount changed
  };
  currentRules: RuleWeights;
}

export interface ClaudeResponse {
  message: string;                       // always present, conversational
  rule_update: Partial<RuleWeights> | null;
  highlight_cluster: number | null;      // cluster id from frozen snapshot
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}
```

---

## 4. Module Specifications

### 4.1 `lib/simulation.ts`

**Purpose:** Pure boids physics. Zero React. Zero DOM. Zero API knowledge.

**Exports:**
```typescript
export function initAgents(count: number, width: number, height: number): Agent[]
export function tick(agents: Agent[], rules: RuleWeights, width: number, height: number): void
export const DEFAULT_RULES: RuleWeights
```

**Behavior:**
- `initAgents` creates N agents at random positions with random velocities
- `tick` mutates the agents array in place — applies one physics step
- Boids forces: separation (avoid neighbors within perception/3),
  alignment (match neighbor velocity), cohesion (steer toward neighbor
  center). Each weighted by rules.
- Soft boundary: if agent within 50px of edge, apply steering force
  pushing back toward center. NOT a wall bounce. NOT wraparound.
- Speed cap: clamp velocity magnitude to `rules.speed`.
- Constants:
  - Agent count: 200 (configurable via init)
  - Canvas: 1200×800 logical pixels
  - Boundary margin: 50px

**Notes:**
- Use spatial partitioning (simple grid, 100px cells) if performance
  becomes an issue. Premature optimization not required for 200 agents.
- Mutation in place is intentional — avoid allocations in the hot loop.

### 4.2 `lib/extractor.ts`

**Purpose:** Compute interpreted metrics from raw agent state. This is
the perception layer the AI sees.

**Exports:**
```typescript
export function extractSnapshot(
  agents: Agent[],
  rules: RuleWeights,
  previousSnapshot: SimSnapshot | null
): SimSnapshot

export function detectClusters(agents: Agent[], radius: number): Cluster[]
```

**Cluster detection algorithm:**
- Use simple distance-threshold grouping (Union-Find or BFS)
- An agent belongs to a cluster if it has at least 2 neighbors within
  `radius` (default 60px) that also belong to that cluster
- Minimum cluster size: 5 agents
- Agents not in any cluster are outliers
- Cluster `id` is assigned 0..N-1 in order of size descending (largest
  cluster always has lowest id within a single snapshot)

**Critical: Cluster IDs are NOT stable across snapshots.** They are stable
within a single frozen snapshot. The frontend handles ID stability by
freezing the snapshot at message-send time and using it throughout that
exchange.

**Metrics:**
- `velocityVariance`: variance of velocity magnitudes across all agents
- `dominantDirection`: circular mean of all velocity headings
- `delta.clusterCountDelta`: this snapshot's clusterCount minus previous
- `delta.timeSinceLastChange`: ms since clusterCount last changed
- All other deltas computed against `previousSnapshot`

### 4.3 `app/api/chat/route.ts`

**Purpose:** Server-side proxy to Anthropic API. Keeps API key secret.

**Method:** POST

**Request body:**
```typescript
{
  snapshot: SimSnapshot,
  history: ChatMessage[],   // last 10 exchanges max
  userMessage: string
}
```

**Response body:** `ClaudeResponse`

**Behavior:**
- Reads `ANTHROPIC_API_KEY` from environment
- Builds prompt via `lib/claude.ts`
- Calls Claude Haiku 4.5 (model id: `claude-haiku-4-5-20251001`)
- Parses response. If JSON parse fails, retries once. If retry fails,
  returns:
  ```json
  {
    "message": "I missed that — try rephrasing.",
    "rule_update": null,
    "highlight_cluster": null
  }
  ```
- Returns parsed `ClaudeResponse`

**Errors:**
- Always returns valid `ClaudeResponse` shape, never throws
- Never returns 5xx — converts errors into the message field

### 4.4 `lib/claude.ts`

**Purpose:** Build prompts and parse responses. Pure functions.

**Exports:**
```typescript
export function buildPrompt(
  snapshot: SimSnapshot,
  history: ChatMessage[],
  userMessage: string
): { system: string; messages: AnthropicMessage[] }

export function parseResponse(rawText: string): ClaudeResponse | null
```

**System prompt:**
```
You are Murmur, the AI observer of a swarm of 200 autonomous agents
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

You MUST always return valid JSON in this exact shape:
{
  "message": "<your conversational response, always present>",
  "rule_update": null OR { "separation": <num>, "alignment": <num>,
                           "cohesion": <num>, "speed": <num>,
                           "perception": <num> } (any subset),
  "highlight_cluster": null OR <integer cluster id from the snapshot>
}

Rule weight ranges:
- separation: 0 to 2
- alignment: 0 to 2
- cohesion: 0 to 2
- speed: 0.5 to 4
- perception: 20 to 100

Only set rule_update when the user is requesting a behavioral change.
Only set highlight_cluster when referencing a specific cluster.
Otherwise leave them null.

Return ONLY the JSON object. No preamble. No code fences. No commentary.
```

**Snapshot serialization to user message:**
The user's message is wrapped with the current snapshot as context:
```
[Current simulation state]
- Clusters: 3 (one of size 87, one of size 54, one of size 31)
- Outliers: 28 agents not in any cluster
- Average velocity: 1.8 (variance: 0.4, low — ordered movement)
- Heading: mostly northeast
- Time since cluster count last changed: 4.2 seconds
- Current rules: separation 1.5, alignment 1.0, cohesion 1.0, speed 2.0,
  perception 50

Cluster details:
- id 0: centroid (340, 290), size 87, avg velocity 2.1
- id 1: centroid (820, 410), size 54, avg velocity 1.6
- id 2: centroid (560, 680), size 31, avg velocity 1.4

[User]: <userMessage>
```

**Response parsing:**
- Strip whitespace, code fences, and any preamble
- Attempt `JSON.parse`
- Validate shape against `ClaudeResponse`
- On failure, return `null` (caller handles retry)

### 4.5 `hooks/useSimulation.ts`

**Purpose:** Bridge between pure simulation logic and React rendering.

**Exports:**
```typescript
export function useSimulation(): {
  agentsRef: React.MutableRefObject<Agent[]>;
  rulesRef: React.MutableRefObject<RuleWeights>;
  snapshot: SimSnapshot | null;          // useState — re-renders metrics
  isPaused: boolean;
  togglePause: () => void;
  reset: () => void;
  applyRuleUpdate: (update: Partial<RuleWeights>) => void;
}
```

**Behavior:**
- Initializes agents on mount
- Runs `tick` in `requestAnimationFrame` loop, mutating `agentsRef`
- Every 500ms, computes new snapshot via `extractSnapshot`, sets
  `snapshot` state (triggers re-render of metrics panel)
- `togglePause` halts the rAF loop without resetting state
- `reset` re-initializes agents with default rules
- `applyRuleUpdate` mutates `rulesRef` — sim picks up changes on next
  tick

### 4.6 `components/SimCanvas.tsx`

**Purpose:** Renders the simulation onto a `<canvas>` element.

**Props:**
```typescript
{
  agentsRef: React.MutableRefObject<Agent[]>;
  highlightClusterId: number | null;
  frozenClusters: Cluster[] | null;       // for highlight rendering
}
```

**Render loop:**
- Reads `agentsRef.current` directly each frame (no React state)
- Draws each agent as a small filled triangle pointing in velocity
  direction, length ~6px
- Trails: maintain a circular buffer of last 8 positions per agent;
  draw as fading polyline (alpha decreases with age)
- Background: deep black (#050505)
- Subtle grid overlay at 5% white opacity, 50px spacing
- Vignette: radial gradient, slight darkening at edges

**Highlight rendering:**
- When `highlightClusterId !== null`, look up the cluster in
  `frozenClusters`
- Compute convex hull of that cluster's agent positions (use current
  positions, not frozen — the highlight follows the cluster as it moves)
- Draw the hull with a pulsing glow:
  - Stroke: cyan (#7CF8FF), 2px, soft outer glow via shadowBlur
  - Pulse: opacity 0.4 → 1.0 over 1.2s, sine wave, looping
- Highlight auto-clears after 8 seconds OR on next user message

**Visual tokens (CSS variables):**
```
--bg-canvas: #050505
--agent-color: #E8F4FF
--agent-glow: rgba(124, 248, 255, 0.4)
--trail-color: rgba(232, 244, 255, 0.6)
--highlight-stroke: #7CF8FF
--highlight-glow: rgba(124, 248, 255, 0.8)
--grid-color: rgba(255, 255, 255, 0.04)
```

### 4.7 `components/ChatPanel.tsx`

**Purpose:** Chat interface and preset buttons.

**Props:**
```typescript
{
  history: ChatMessage[];
  onSendMessage: (message: string) => void;
  isPending: boolean;
}
```

**Layout (top to bottom):**
1. Brand header: "Murmur." in display font, small caption
   "swarm observer" in monospace
2. Chat scroll area:
   - User messages: right-aligned, subtle background, body font
   - Assistant messages: left-aligned, no background, slightly larger
     leading
   - "Thinking..." indicator when `isPending`: animated three dots
3. Preset buttons (4 buttons, horizontal row, small):
   - "What's happening right now?"
   - "Why did that just happen?"
   - "Make them more chaotic"
   - "Form one tight flock"
4. Input field:
   - Pulses subtly when `isPending` (border color animates)
   - Enter submits
   - Disabled while `isPending`

### 4.8 `components/MetricsPanel.tsx`

**Purpose:** Live telemetry readout. Toggleable.

**Props:**
```typescript
{
  snapshot: SimSnapshot | null;
  isVisible: boolean;
  onToggle: () => void;
}
```

**Layout:**
- Bottom-right of canvas, fixed position
- Monospace font, very small (10-11px)
- Subtle background (rgba(255,255,255,0.03)), border on top + left
- Toggle button (top-right corner of panel) shows/hides the body
- When visible, shows:
  ```
  CLUSTERS    3
  OUTLIERS    28
  VELOCITY    1.84 ± 0.41
  HEADING     042°
  STABLE FOR  4.2s
  ```
- Numbers tick smoothly (animate transitions over 200ms)

---

## 5. Visual Design

### 5.1 Aesthetic direction
**Dark mission-control / sci-fi telemetry.** Looks like something from
a defense lab. Black background, monochrome agents with subtle cyan
glow, telemetry-style readouts in monospace. Restrained — minimal color
palette, no decorative elements.

### 5.2 Typography
- **Display (brand, headers):** Inter Display, Tight, or Söhne if
  available. Avoid generic Inter. Avoid Space Grotesk.
- **Body (chat messages):** A neutral humanist sans, ~15px, generous
  line-height (1.5)
- **Monospace (metrics, telemetry, code-coded UI):** JetBrains Mono
  or IBM Plex Mono, ~11-13px depending on context

### 5.3 Color palette
```
--bg-page:          #0A0A0A    (page background, slightly lighter than canvas)
--bg-canvas:        #050505    (canvas itself)
--bg-panel:         rgba(255,255,255,0.02)
--border-subtle:    rgba(255,255,255,0.08)
--text-primary:     #E8F4FF    (chat, headers)
--text-secondary:   rgba(232,244,255,0.55)
--text-mono:        #B8C5D6    (monospace telemetry)
--accent:           #7CF8FF    (cyan — highlight, pulse, brand)
--accent-glow:      rgba(124,248,255,0.4)
--accent-soft:      rgba(124,248,255,0.15)
```

No purple gradients. No "AI" aesthetic clichés.

### 5.4 Layout
- Two-panel desktop layout: canvas 70%, chat 30%
- Mobile: canvas top, chat below (out of scope for hackathon — desktop only)
- Generous padding around canvas (no edge-to-edge)
- Brand "Murmur." anchored top-left of chat panel

### 5.5 Motion
- Pulse on input field while pending: border color 0.5s ease cycle
- "Thinking..." dots: standard 3-dot bounce
- Cluster highlight: opacity sine wave, 1.2s period
- Metric number ticks: 200ms ease transition
- No page-load fanfare. The sim should already be running when the page
  appears.

---

## 6. Demo Flow

The product is built around a 3-minute demo arc.

**Act 1 (0:00–0:30) — Establish the system**
The sim is already running on page load. Agents flock visibly. No
explanation needed. Tagline: "200 autonomous agents. Each follows
simple rules. Watch what happens."

**Act 2 (0:30–1:15) — AI awareness**
Click preset: "What's happening right now?" Claude responds with
specific observations. As it mentions a cluster, that cluster lights up
on the canvas. *This is the first wow moment.*

**Act 3 (1:15–2:00) — Bidirectional control**
Type free-form: "Make the isolated agents join the flock." Claude
explains its approach and updates rule weights. The simulation visibly
adapts. Audience understands this is genuine conversational control.

**Act 4 (2:00–2:30) — Emergent surprise**
Click preset: "Make them more chaotic." Flocking breaks down. Ask:
"Why did the structure collapse?" Claude explains using actual delta
metrics — variance spiked, cohesion was overwhelmed. The explanation
matches what the audience just watched.

**Act 5 (2:30–3:00) — The pitch**
"This is what human-AI collaboration looks like for autonomous systems.
Not a dashboard. A conversational interface that understands what the
system is doing and can reason about it in real time. The same
architecture applies to drone swarms, robot fleets, network routing."

---

## 7. Build Order and Parallelism

The build splits into three independent modules in Phase 1, suitable
for three parallel Cursor agents in isolated git worktrees.

### Phase 1 — Parallel (3 agents simultaneously)

**Agent A — Simulation core**
- Build `lib/types.ts`
- Build `lib/simulation.ts` (boids physics, soft boundary)
- Write a small test page that verifies agents move correctly

**Agent B — Perception layer**
- Build `lib/extractor.ts` (cluster detection, metrics)
- Depends only on `lib/types.ts` (Agent A must commit types first)
- Write a small test that verifies clusters detect correctly on a
  hand-crafted agent array

**Agent C — Server proxy**
- Build `app/api/chat/route.ts`
- Build `lib/claude.ts` (prompt builder, response parser)
- Depends only on `lib/types.ts`
- Test with a synthetic snapshot and curl

### Phase 2 — Sequential (single agent)

After Phase 1 modules merge to main:
- Build `hooks/useSimulation.ts` (depends on simulation + extractor)
- Build `components/SimCanvas.tsx` (depends on hook)
- Build `components/ChatPanel.tsx` and `components/MetricsPanel.tsx`
- Build `app/page.tsx` (composes everything)
- Wire highlight sync (pass frozen clusters from snapshot through to
  canvas)

### Phase 3 — Parallel polish (2 agents)

**Agent D — Canvas polish**
- Trails, triangle rendering, glow, grid, vignette
- Cluster highlight pulsing animation
- Number tick animations on metrics

**Agent E — Chat polish**
- Preset buttons styled
- Thinking indicator
- Input pulse animation
- Brand header treatment

---

## 8. Critical Constraints (do not violate)

1. `simulation.ts` and `extractor.ts` have ZERO React dependencies.
2. Agent state and rule weights live in `useRef`, never `useState`.
3. The render loop never awaits an API call. Ever.
4. The Anthropic API key never reaches the client. All calls go through
   `/api/chat`.
5. Every Claude response must parse as `ClaudeResponse` — fall back to
   the error response shape if parsing fails twice.
6. Cluster IDs are stable only within a single snapshot. Highlight uses
   the frozen snapshot taken at message-send time.
7. Frozen snapshot stays in scope until the next user message OR until
   the highlight times out (8s).
8. No purple gradients. No generic AI aesthetic. Black, monospace,
   cyan accent.

---

## 9. Out of Scope for Hackathon

These are explicitly NOT in the build:
- Mobile responsive layout
- User accounts / persistence
- Multiple simulation views
- Recording / replay
- Ambient AI commentary (only responds to user input)
- Speed control (only play/pause/reset)
- Visible rule weight sliders (hidden dev panel only, hotkey `D`)
- 3D rendering / Three.js
- Multiple swarms or interacting groups
# Murmur. — Architectural Decisions

> Every non-obvious decision and why. New agents and future you should
> read this before changing anything fundamental.

---

## D1. `useRef` not `useState` for sim state

**Decision:** Agent positions, velocities, and rule weights live in
`useRef`. They are mutated in place by the simulation loop.

**Why:** The simulation runs at 60fps. `useState` triggers React
reconciliation on every update. 60 reconciliations per second over an
array of 200 objects kills the framerate and freezes the page. `useRef`
holds mutable state without involving the React render cycle.

**Consequence:** The canvas reads `agentsRef.current` directly each
frame. Components that want to display sim state (like the metrics
panel) read from `snapshot` (a `useState`-backed snapshot computed
every 500ms by the extractor), not from the ref directly.

---

## D2. Frozen snapshot at message send-time

**Decision:** When the user sends a message, the current cluster
snapshot is frozen and passed to the API. The frontend keeps that
frozen snapshot in scope for highlight rendering.

**Why:** Cluster IDs are unstable across snapshots. Clusters merge,
split, and disappear between frames. If Claude returns
`highlight_cluster: 2` but the sim has moved on and there is no longer
a cluster with id 2, the highlight either fails or maps to the wrong
group. Freezing the snapshot at send-time means Claude's response is
interpreted against a known state.

**Consequence:** The highlighted convex hull tracks the *current
positions* of the agents that were in that cluster at freeze-time. The
cluster shape moves with the swarm — but its membership is locked.
This is intentional: the AI is referring to *those agents specifically*,
not "whichever cluster happens to be in that location now."

---

## D3. Extractor as separate module from simulation

**Decision:** Cluster detection and metrics computation live in
`extractor.ts`, completely separate from the boids physics in
`simulation.ts`.

**Why:** The simulation is concerned with how agents move. The
extractor is concerned with how the swarm looks at the macro level.
These are different problems. Mixing them makes both harder to test
and tune. Separating them lets the perception layer evolve
independently — for example, swapping in DBSCAN later for cluster
detection without touching physics.

**Consequence:** The extractor does its own pass over the agent array
every 500ms. This is wasted work in the sense that the simulation
already has the data — but the cost is negligible (200 agents) and
the modularity is worth it.

---

## D4. Structured JSON output, not free-form text

**Decision:** Every Claude response returns JSON with three optional
fields: `message`, `rule_update`, `highlight_cluster`.

**Why:** The frontend needs to handle three independent outputs:
display text in the chat, apply rule changes to the sim, render a
highlight on the canvas. Parsing natural language to extract these
is fragile. Structured output is reliable.

**Consequence:** The system prompt is strict about JSON formatting.
The parser strips code fences and whitespace. If parsing fails, the
API route retries once. If retry fails, a fallback error response is
returned. The conversation can never break the UI shape.

---

## D5. AI as observer + global controller, not per-agent driver

**Decision:** The LLM does NOT control individual agents. It observes
the whole swarm via interpreted metrics and modifies global rule
weights.

**Why:** Per-agent LLM control is computationally absurd in real time
(200 API calls per frame × 60fps). The interesting research question
isn't whether LLMs can drive agents — it's whether LLMs can reason
about and modulate emergent collective behavior. That's the genuinely
novel framing.

**Consequence:** The "intelligence" of the AI is at the swarm level,
not the agent level. This is closer to how human operators actually
interact with autonomous systems — at the policy level, not the unit
level.

---

## D6. Haiku 4.5 over Sonnet/Opus

**Decision:** Use Claude Haiku 4.5 for all observer responses.

**Why:** The observer's task is "look at metrics, explain in plain
language, sometimes suggest rule changes." This does not require
flagship reasoning. Latency and conversational responsiveness matter
more than depth. Haiku is ~5x cheaper than Sonnet and significantly
faster, which makes the demo feel snappy.

**Escalation path:** If response quality feels weak in tuning, swap
to Sonnet 4.6. The model id is the only change required.

---

## D7. Decoupled API and render loops

**Decision:** API calls fire async. The render loop never awaits them.
Response handling updates a separate state object that the render loop
reads on its next tick.

**Why:** API latency is 1-3 seconds. Render loop is 16ms per frame. If
the render loop ever waits on the API, the demo dies.

**Consequence:** When a Claude response arrives, applying its
`rule_update` mutates `rulesRef`. The next render tick picks up the
new weights naturally. No blocking. No coordination required.

---

## D8. Server-side API proxy

**Decision:** All Anthropic API calls go through `/api/chat`. The API
key is read from `ANTHROPIC_API_KEY` server-side env variable and
never reaches the client.

**Why:** Calling Anthropic directly from the browser would expose the
API key to anyone who opens dev tools. Standard security hygiene. The
proxy adds ~20 lines of code.

**Consequence:** Vercel deploy needs the env variable configured. No
other implication for development.

---

## D9. Conversational tone in `message`, strict JSON wrapper

**Decision:** Claude responses use natural conversational language in
the `message` field, but the wrapping JSON structure is strict.

**Why:** Strict JSON-only feels robotic. The demo loses its warmth.
But the structural fields need to be reliable for the frontend. Both
goals are met by enforcing JSON shape while leaving content stylistic.

**Consequence:** The system prompt explicitly says "Conversational,
not robotic. Like a thoughtful colleague."

---

## D10. No ambient AI narration

**Decision:** The AI only speaks when the user sends a message. No
periodic background commentary.

**Why:** Ambient narration is a trap. It either fires during boring
moments (annoying) or talks over user input (worse). It also burns
tokens on uninteresting outputs. The demo is stronger when the AI
"comes alive" only on prompt — it makes each response feel intentional.

---

## D11. Visible metrics panel makes AI awareness verifiable

**Decision:** The metrics panel is shown by default (toggleable off).

**Why:** When Claude says "two clusters formed," and the metrics panel
shows "CLUSTERS 2," judges can see the AI is observing real state, not
generating plausible-sounding text. The metrics panel is *evidence*
that the perception layer is real. Without it, the AI's claims are
unverifiable.

**Aesthetic note:** Style it as small monospace telemetry, not a
dashboard. It should look like instrumentation, not a UI feature.

---

## D12. Hidden rule sliders behind dev hotkey

**Decision:** Direct slider control of rule weights exists but is
hidden behind the `D` hotkey, only visible in dev mode.

**Why:** Visible sliders contradict the pitch — if users can drag
sliders, why is the AI useful? But sliders are essential during build
(for tuning) and as emergency demo recovery (if Claude breaks
something). Hidden by default, accessible when needed.

---

## D13. Convex hull highlight, not pulsing region

**Decision:** Cluster highlights render as a stroked convex hull
around the cluster's agents, with a soft pulsing glow.

**Why:** Convex hulls are unambiguous — judges immediately understand
"this group of agents." Region-based highlights (like a circle around
the centroid) are vague about membership. Color changes to agents
themselves are too subtle in a busy sim.

**Note:** The hull tracks current agent positions, even though the
membership is frozen at message-send time. This means the hull
deforms naturally as the cluster moves.

---

## D14. Soft boundary, not wrap or bounce

**Decision:** Agents within 50px of the canvas edge experience a
steering force pushing them back toward center.

**Why:**
- Wrap-around (toroidal) confuses cluster detection — a single cluster
  can appear split across edges
- Hard wall bounces look mechanical and disrupt natural flocking
- Soft steering looks organic and keeps clusters spatially coherent,
  which is essential for the highlight sync to look right

---

## D15. 200 agents, not more

**Decision:** Default agent count is 200.

**Why:**
- Enough density for emergent flocking to be visually obvious
- Light enough that Canvas 2D never struggles, even on a laptop GPU
- Snapshot serialization stays under 500 tokens
- More agents looks cooler in screenshots but is a worse interactive
  experience

---

## D16. Dark theme, cyan accent, no purple

**Decision:** Black background (#050505), monochrome agents with
cyan (#7CF8FF) accent for highlights and brand.

**Why:** This is autonomy / mission-control software. It should look
like instrumentation, not a consumer app. Glowing agents on black is
the iconic swarm visualization look. Cyan reads as "telemetry" and
"sensor data" in cultural shorthand. Purple gradients are the visual
fingerprint of generic AI-generated UI — actively avoided.
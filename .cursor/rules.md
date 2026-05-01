# Murmur. — Cursor Rules

You are working on Murmur, a real-time swarm simulation with a
conversational AI observer. Read `spec.md` and `decisions.md` before
making any non-trivial change.

---

## Stack

- Next.js 14 (App Router)
- React 18, TypeScript strict mode
- Tailwind CSS
- Canvas API (2D context, no Three.js)
- Anthropic SDK via server-side `/api/chat` route
- Deploy: Vercel

---

## Critical constraints (do not violate)

1. `lib/simulation.ts` and `lib/extractor.ts` have ZERO React
   dependencies. They are pure TypeScript.
2. Agent positions, velocities, and rule weights live in `useRef`,
   NEVER `useState`. The simulation runs at 60fps and re-renders will
   freeze the page.
3. The `requestAnimationFrame` render loop NEVER awaits an API call.
   API calls are fully async and decoupled.
4. The Anthropic API key NEVER reaches the client. All calls route
   through `app/api/chat/route.ts`.
5. Every Claude response must parse as `ClaudeResponse`. On parse
   failure, retry once. On second failure, return the fallback shape.
6. Cluster IDs are stable only within a single snapshot. Highlight
   rendering uses the frozen snapshot taken at message-send time.

---

## File structure

```
app/
  api/chat/route.ts        ← Anthropic proxy
  page.tsx                 ← composes everything
components/
  SimCanvas.tsx            ← canvas + render loop
  ChatPanel.tsx            ← chat UI + presets
  MetricsPanel.tsx         ← telemetry readout
hooks/
  useSimulation.ts         ← bridges sim to React
lib/
  types.ts                 ← shared type definitions
  simulation.ts            ← pure boids physics
  extractor.ts             ← perception layer (clusters, metrics)
  claude.ts                ← prompt builder + response parser
```

---

## Canonical types

Defined in `lib/types.ts`. Do not redefine these locally:

- `Agent` — `{ id, x, y, vx, vy }`
- `RuleWeights` — `{ separation, alignment, cohesion, speed, perception }`
- `Cluster` — `{ id, centroid, size, avgVelocity, agentIds }`
- `SimSnapshot` — full perception snapshot, see spec section 3
- `ClaudeResponse` — `{ message, rule_update, highlight_cluster }`
- `ChatMessage` — `{ role, content, timestamp }`

---

## Code style

- ES modules with named exports (no default exports except components)
- Destructure imports: `import { foo } from 'bar'`
- TypeScript strict mode — no `any`, no `as` casts unless justified
- Functions over classes
- Pure functions wherever possible
- Mutate in place inside the simulation hot loop (`tick`) to avoid
  allocations
- Tailwind for styling — no inline styles unless dynamic

---

## When asked to build a module

1. Read `spec.md` first (especially section 4 for module specs)
2. Read `decisions.md` for any architectural rationale that applies
3. Build only what the spec says to build. Do not invent features.
4. Export only what the spec says to export.
5. Use only the dependencies the spec says to use.
6. Verify TypeScript compiles before declaring done.

## When asked to wire modules together

1. Read `spec.md` section 2 (architecture and data flow)
2. Do not modify the internal logic of either module
3. Add only the connection layer described
4. Verify data shapes match the canonical types

---

## Visual design tokens

Use these CSS variables (define in `globals.css`):

```css
--bg-page: #0A0A0A;
--bg-canvas: #050505;
--bg-panel: rgba(255,255,255,0.02);
--border-subtle: rgba(255,255,255,0.08);
--text-primary: #E8F4FF;
--text-secondary: rgba(232,244,255,0.55);
--text-mono: #B8C5D6;
--accent: #7CF8FF;
--accent-glow: rgba(124,248,255,0.4);
--accent-soft: rgba(124,248,255,0.15);
```

No purple gradients. No generic AI aesthetic. Black background,
monochrome agents, cyan accent only for highlights and brand.

---

## Reference

- `spec.md` — full system specification (source of truth)
- `decisions.md` — architectural rationale (read before changing
  fundamentals)
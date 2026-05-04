# Murmur

Murmur is a real-time swarm simulation with a conversational AI observer. The app renders autonomous agents on a canvas using boids-style rules, then lets the user ask an AI what the swarm is doing or request changes to the swarm's global behavior.

The goal is not to make an LLM drive every agent. The simulation runs locally and continuously; the AI receives interpreted telemetry about the swarm, explains the current state, and can return structured rule updates that change how the agents move.

## What It Does

- Simulates a flock of autonomous agents with separation, alignment, cohesion, speed, perception, and entropy controls.
- Extracts live swarm metrics such as cluster count, outliers, average velocity, velocity variance, and dominant direction.
- Sends frozen simulation snapshots to an Anthropic-backed chat API so responses refer to a consistent moment in the simulation.
- Accepts structured AI responses that can include a chat message, rule updates, and a cluster highlight.
- Renders cluster highlights on the canvas when the assistant references specific groups.
- Includes a small telemetry panel and a hidden development panel for tuning rule weights.

## Architecture

Murmur is built with Next.js, React, TypeScript, and Canvas 2D.

- `lib/simulation.ts` contains the pure boids simulation. It has no React, DOM, or API dependencies.
- `lib/extractor.ts` turns raw agent state into higher-level swarm metrics for the UI and AI context.
- `hooks/useSimulation.ts` owns the animation loop and keeps hot simulation state in refs so React does not re-render at 60fps.
- `components/SimCanvas.tsx` draws agents, trails, the grid, and cluster highlights.
- `components/ChatPanel.tsx` handles the conversation UI and cluster reference interactions.
- `app/api/chat/route.ts` proxies requests to Anthropic and keeps the API key server-side.
- `lib/claude.ts` builds prompts and parses the assistant's structured JSON response.

Cluster IDs are only stable within a single extracted snapshot. When the user sends a message, the app freezes that snapshot and uses it to interpret any `highlight_cluster` value returned by the assistant.

## Requirements

- Node.js 20 or newer
- npm
- An Anthropic API key for chat responses

## Setup

Install dependencies:

```bash
npm install
```

Create `.env.local` and add your Anthropic key:

```bash
ANTHROPIC_API_KEY=your_api_key_here
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Notes

- The render loop is intentionally decoupled from API calls. The canvas keeps animating while the assistant is thinking.
- Agent positions and rule weights live in refs; React state is used only for UI-facing snapshots and interaction state.
- The API route always returns the expected response shape so malformed model output does not break the client.
- Press `D` in development to toggle the hidden rule tuning panel.

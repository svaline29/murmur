import type { Agent, RuleWeights } from "./types";

/** Soft boundary: steering within this distance (px) of each canvas edge (spec §4.1, D14). */
const BOUNDARY_MARGIN = 50;

/** Steer inward near edges; tuned with boundary margin so forces stay moderate at default speed. */
const BOUNDARY_STRENGTH = 0.08;

let bufN = 0;
let sepX: Float64Array = new Float64Array(0);
let sepY: Float64Array = new Float64Array(0);
let aliX: Float64Array = new Float64Array(0);
let aliY: Float64Array = new Float64Array(0);
let cohX: Float64Array = new Float64Array(0);
let cohY: Float64Array = new Float64Array(0);
let neigh: Uint16Array = new Uint16Array(0);

function ensureBuffers(n: number): void {
  if (n <= bufN) return;
  bufN = n;
  sepX = new Float64Array(n);
  sepY = new Float64Array(n);
  aliX = new Float64Array(n);
  aliY = new Float64Array(n);
  cohX = new Float64Array(n);
  cohY = new Float64Array(n);
  neigh = new Uint16Array(n);
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

function len(x: number, y: number): number {
  return Math.hypot(x, y);
}

function clampMag(x: number, y: number, max: number): [number, number] {
  const m = len(x, y);
  if (m <= max || m === 0) return [x, y];
  const s = max / m;
  return [x * s, y * s];
}

/**
 * Random positions and velocities on the canvas. Each agent gets a stable `id` (0 .. count-1).
 */
export function initAgents(count: number, width: number, height: number): Agent[] {
  const agents: Agent[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 1.5;
    agents.push({
      id: i,
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    });
  }
  return agents;
}

/** Defaults match `lib/types.ts` and system prompt examples in spec §4.4. */
export const DEFAULT_RULES: RuleWeights = {
  separation: 1.5,
  alignment: 1.0,
  cohesion: 1.0,
  speed: 2.0,
  perception: 50,
};

const FRAME_DT = 1;

/**
 * One physics step: boids (separation within perception/3, alignment + cohesion within perception),
 * soft boundary, speed cap. Mutates `agents` in place; reuses internal buffers (no per-tick allocation).
 */
export function tick(
  agents: Agent[],
  rules: RuleWeights,
  width: number,
  height: number,
): void {
  const n = agents.length;
  if (n === 0) return;

  ensureBuffers(n);

  const perception = rules.perception;
  const r2 = perception * perception;
  const rSep = perception / 3;
  const rSep2 = rSep * rSep;
  const margin = BOUNDARY_MARGIN;

  sepX.fill(0, 0, n);
  sepY.fill(0, 0, n);
  aliX.fill(0, 0, n);
  aliY.fill(0, 0, n);
  cohX.fill(0, 0, n);
  cohY.fill(0, 0, n);
  neigh.fill(0, 0, n);

  for (let i = 0; i < n; i++) {
    const ai = agents[i];
    let sx = 0;
    let sy = 0;
    let ax = 0;
    let ay = 0;
    let cx = 0;
    let cy = 0;
    let count = 0;

    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const aj = agents[j];
      const d2 = distSq(ai.x, ai.y, aj.x, aj.y);
      if (d2 >= r2 || d2 === 0) continue;

      count++;
      const d = Math.sqrt(d2);

      if (d2 < rSep2) {
        const invD = 1 / d;
        const ox = (ai.x - aj.x) * invD;
        const oy = (ai.y - aj.y) * invD;
        sx += ox / d;
        sy += oy / d;
      }

      ax += aj.vx;
      ay += aj.vy;
      cx += aj.x;
      cy += aj.y;
    }

    neigh[i] = count;
    if (count > 0) {
      sepX[i] = sx;
      sepY[i] = sy;
      aliX[i] = ax / count - ai.vx;
      aliY[i] = ay / count - ai.vy;
      cohX[i] = cx / count - ai.x;
      cohY[i] = cy / count - ai.y;
    }
  }

  for (let i = 0; i < n; i++) {
    const a = agents[i];
    let fx = 0;
    let fy = 0;

    if (neigh[i] > 0) {
      let sx = sepX[i];
      let sy = sepY[i];
      const sm = len(sx, sy);
      if (sm > 0) {
        sx /= sm;
        sy /= sm;
      }
      let ax = aliX[i];
      let ay = aliY[i];
      const am = len(ax, ay);
      if (am > 0) {
        ax /= am;
        ay /= am;
      }
      let cx = cohX[i];
      let cy = cohY[i];
      const cm = len(cx, cy);
      if (cm > 0) {
        cx /= cm;
        cy /= cm;
      }

      fx += sx * rules.separation;
      fy += sy * rules.separation;
      fx += ax * rules.alignment;
      fy += ay * rules.alignment;
      fx += cx * rules.cohesion;
      fy += cy * rules.cohesion;
    }

    if (a.x < margin) fx += (margin - a.x) * BOUNDARY_STRENGTH;
    else if (a.x > width - margin) fx -= (a.x - (width - margin)) * BOUNDARY_STRENGTH;

    if (a.y < margin) fy += (margin - a.y) * BOUNDARY_STRENGTH;
    else if (a.y > height - margin) fy -= (a.y - (height - margin)) * BOUNDARY_STRENGTH;

    a.vx += fx * FRAME_DT;
    a.vy += fy * FRAME_DT;

    const capped = clampMag(a.vx, a.vy, rules.speed);
    a.vx = capped[0];
    a.vy = capped[1];

    a.x += a.vx * FRAME_DT;
    a.y += a.vy * FRAME_DT;
  }
}

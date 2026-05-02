import type { Agent, RuleWeights } from "./types";

/** Soft boundary: steering within this distance (px) of each canvas edge (spec §4.1, D14). */
const BOUNDARY_MARGIN = 50;

/** Steer inward near edges; tuned with boundary margin so forces stay moderate at default speed. */
const BOUNDARY_STRENGTH = 0.04;

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
  entropy: 0.5,
};

const FRAME_DT = 1;

/**
 * One physics step: boids (separation within ~0.45× perception, alignment + cohesion within perception),
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
  const rSep = perception * 0.45;
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
      // Separation: clamp raw magnitude to prevent explosion, then weight
      const MAX_SEP = rules.perception * 0.5;
      const [csx, csy] = clampMag(sepX[i], sepY[i], MAX_SEP);
      fx += csx * rules.separation;
      fy += csy * rules.separation;

      // Alignment: clamp to max speed range, then weight
      const [cax, cay] = clampMag(aliX[i], aliY[i], rules.speed * 2);
      fx += cax * rules.alignment * 0.4;
      fy += cay * rules.alignment * 0.4;

      // Cohesion: scale by actual distance to center of mass
      // (already a position delta — don't normalize, just scale down)
      fx += cohX[i] * rules.cohesion * 0.04;
      fy += cohY[i] * rules.cohesion * 0.04;
    }

    if (a.x < margin) fx += (margin - a.x) * BOUNDARY_STRENGTH;
    else if (a.x > width - margin) fx -= (a.x - (width - margin)) * BOUNDARY_STRENGTH;

    if (a.y < margin) fy += (margin - a.y) * BOUNDARY_STRENGTH;
    else if (a.y > height - margin) fy -= (a.y - (height - margin)) * BOUNDARY_STRENGTH;

    if (rules.entropy > 0) {
      const angle = Math.random() * Math.PI * 2;
      fx += Math.cos(angle) * rules.entropy * 0.3;
      fy += Math.sin(angle) * rules.entropy * 0.3;
    }

    const forceMax = rules.speed * 0.8 + 1.0;
    const [cfx, cfy] = clampMag(fx, fy, forceMax);
    fx = cfx;
    fy = cfy;

    a.vx += fx * FRAME_DT;
    a.vy += fy * FRAME_DT;

    const drag = neigh[i] > 0 ? 0.992 : 0.975;
    a.vx *= drag;
    a.vy *= drag;

    const capped = clampMag(a.vx, a.vy, rules.speed);
    a.vx = capped[0];
    a.vy = capped[1];

    const minSpeed = rules.speed * 0.15;
    const currentSpeed = len(a.vx, a.vy);
    if (currentSpeed > 0 && currentSpeed < minSpeed) {
      const boost = minSpeed / currentSpeed;
      a.vx *= boost;
      a.vy *= boost;
    }

    a.x += a.vx * FRAME_DT;
    a.y += a.vy * FRAME_DT;
  }
}

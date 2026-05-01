import type { Agent, RuleWeights } from "./types";

/** Soft boundary: steering within this distance (px) of each canvas edge. */
const BOUNDARY_MARGIN = 50;

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
 * Spreads agents uniformly over the canvas with small random velocities.
 */
export function initAgents(count: number, width: number, height: number): Agent[] {
  const agents: Agent[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 1.5;
    agents.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    });
  }
  return agents;
}

export const DEFAULT_RULES: RuleWeights = {
  separation: 1.25,
  alignment: 0.85,
  cohesion: 0.65,
  speed: 4,
  perception: 55,
};

const FRAME_DT = 1;

/**
 * One simulation step: boids (separation, alignment, cohesion), soft boundary, speed cap.
 * Mutates agents in place. Neighbor search uses `rules.perception` as radius.
 */
export function tick(
  agents: Agent[],
  rules: RuleWeights,
  width: number,
  height: number,
): void {
  const n = agents.length;
  if (n === 0) return;

  const r = rules.perception;
  const r2 = r * r;
  const margin = BOUNDARY_MARGIN;

  const sepX = new Float64Array(n);
  const sepY = new Float64Array(n);
  const aliX = new Float64Array(n);
  const aliY = new Float64Array(n);
  const cohX = new Float64Array(n);
  const cohY = new Float64Array(n);
  const neigh = new Uint16Array(n);

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
      const invD = 1 / d;
      const ox = (ai.x - aj.x) * invD;
      const oy = (ai.y - aj.y) * invD;
      sx += ox / d;
      sy += oy / d;
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

  const boundaryK = 0.08;

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

    if (a.x < margin) fx += (margin - a.x) * boundaryK;
    else if (a.x > width - margin) fx -= (a.x - (width - margin)) * boundaryK;

    if (a.y < margin) fy += (margin - a.y) * boundaryK;
    else if (a.y > height - margin) fy -= (a.y - (height - margin)) * boundaryK;

    a.vx += fx * FRAME_DT;
    a.vy += fy * FRAME_DT;

    const capped = clampMag(a.vx, a.vy, rules.speed);
    a.vx = capped[0];
    a.vy = capped[1];

    a.x += a.vx * FRAME_DT;
    a.y += a.vy * FRAME_DT;
  }
}

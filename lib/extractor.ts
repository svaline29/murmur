import type { Agent, Cluster, RuleWeights, SimSnapshot } from "./types";

const MIN_CLUSTER_SIZE = 5;

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function meanSpeed(agents: Agent[]): number {
  if (agents.length === 0) return 0;
  let s = 0;
  for (const a of agents) {
    s += Math.hypot(a.vx, a.vy);
  }
  return s / agents.length;
}

/** Population variance of velocity magnitudes. */
function velocityVarianceMag(agents: Agent[]): number {
  if (agents.length === 0) return 0;
  const speeds = agents.map((a) => Math.hypot(a.vx, a.vy));
  const mean = speeds.reduce((acc, v) => acc + v, 0) / speeds.length;
  return speeds.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / speeds.length;
}

/** Circular mean of velocity headings `atan2(vy, vx)`. */
function dominantDirectionFromVelocity(agents: Agent[]): number {
  if (agents.length === 0) return 0;
  let sx = 0;
  let sy = 0;
  for (const a of agents) {
    const h = Math.atan2(a.vy, a.vx);
    sx += Math.cos(h);
    sy += Math.sin(h);
  }
  return Math.atan2(sy, sx);
}

class UnionFind {
  private readonly parent: number[];
  private readonly rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(i: number): number {
    let p = this.parent[i];
    if (p !== i) {
      p = this.find(p);
      this.parent[i] = p;
    }
    return p;
  }

  union(i: number, j: number): void {
    let ri = this.find(i);
    let rj = this.find(j);
    if (ri === rj) return;
    if (this.rank[ri] < this.rank[rj]) {
      [ri, rj] = [rj, ri];
    }
    this.parent[rj] = ri;
    if (this.rank[ri] === this.rank[rj]) this.rank[ri] += 1;
  }
}

function buildClusterFromIndices(
  agents: Agent[],
  indices: number[],
  clusterId: number,
): Cluster {
  indices.sort((a, b) => agents[a]!.id - agents[b]!.id);
  const agentIds = indices.map((i) => agents[i]!.id);
  let cx = 0;
  let cy = 0;
  let speedSum = 0;
  for (const i of indices) {
    const a = agents[i]!;
    cx += a.x;
    cy += a.y;
    speedSum += Math.hypot(a.vx, a.vy);
  }
  const n = indices.length;
  return {
    id: clusterId,
    centroid: { x: cx / n, y: cy / n },
    size: n,
    avgVelocity: speedSum / n,
    agentIds,
  };
}

/**
 * Distance-threshold grouping (Union-Find). Agents need ≥2 neighbors within
 * a detection radius scaled from `rules.perception`. Components with size ≥ 5
 * become clusters; ids 0..N−1 by descending size.
 */
export function detectClusters(agents: Agent[], rules: RuleWeights): Cluster[] {
  const detectionRadius = Math.max(rules.perception * 0.9, 30);
  const r = detectionRadius;
  const n = agents.length;
  const r2 = r * r;

  const neighborCount: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const ai = agents[i]!;
    for (let j = i + 1; j < n; j++) {
      const aj = agents[j]!;
      if (distSq(ai.x, ai.y, aj.x, aj.y) <= r2) {
        neighborCount[i] += 1;
        neighborCount[j] += 1;
      }
    }
  }

  const eligible: number[] = [];
  for (let i = 0; i < n; i++) {
    if (neighborCount[i]! >= 2) eligible.push(i);
  }

  if (eligible.length === 0) return [];

  const uf = new UnionFind(eligible.length);
  for (let a = 0; a < eligible.length; a++) {
    const gi = eligible[a]!;
    const ag = agents[gi]!;
    for (let b = a + 1; b < eligible.length; b++) {
      const gj = eligible[b]!;
      const bg = agents[gj]!;
      if (distSq(ag.x, ag.y, bg.x, bg.y) <= r2) {
        uf.union(a, b);
      }
    }
  }

  const rootToIndices = new Map<number, number[]>();
  for (let a = 0; a < eligible.length; a++) {
    const root = uf.find(a);
    const gi = eligible[a]!;
    let arr = rootToIndices.get(root);
    if (!arr) {
      arr = [];
      rootToIndices.set(root, arr);
    }
    arr.push(gi);
  }

  const components: number[][] = [];
  for (const indices of rootToIndices.values()) {
    if (indices.length >= MIN_CLUSTER_SIZE) {
      components.push(indices);
    }
  }

  components.sort((ia, ib) => {
    const d = ib.length - ia.length;
    if (d !== 0) return d;
    const amin = Math.min(...ia.map((i) => agents[i]!.id));
    const bmin = Math.min(...ib.map((i) => agents[i]!.id));
    return amin - bmin;
  });

  return components.map((indices, idx) =>
    buildClusterFromIndices(agents, indices, idx),
  );
}

export function extractSnapshot(
  agents: Agent[],
  rules: RuleWeights,
  previousSnapshot: SimSnapshot | null,
): SimSnapshot {
  const timestamp = Date.now();
  const clusters = detectClusters(agents, rules);
  const clusterCount = clusters.length;
  const agentCount = agents.length;

  const clustered = new Set<number>();
  for (const c of clusters) {
    for (const id of c.agentIds) clustered.add(id);
  }
  const outlierCount = agents.reduce(
    (acc, a) => acc + (clustered.has(a.id) ? 0 : 1),
    0,
  );

  const averageVelocity = meanSpeed(agents);
  const velVar = velocityVarianceMag(agents);
  const domDir = dominantDirectionFromVelocity(agents);

  const prevClusterCount = previousSnapshot?.clusterCount ?? 0;
  const clusterCountDelta = clusterCount - prevClusterCount;

  let timeSinceLastChange: number;
  if (!previousSnapshot) {
    timeSinceLastChange = 0;
  } else if (clusterCount !== previousSnapshot.clusterCount) {
    timeSinceLastChange = 0;
  } else {
    timeSinceLastChange =
      previousSnapshot.delta.timeSinceLastChange +
      (timestamp - previousSnapshot.timestamp);
  }

  const avgVelocityDelta = previousSnapshot
    ? averageVelocity - previousSnapshot.averageVelocity
    : 0;

  return {
    timestamp,
    agentCount,
    clusterCount,
    clusters,
    outlierCount,
    averageVelocity,
    velocityVariance: velVar,
    dominantDirection: domDir,
    delta: {
      clusterCountDelta,
      avgVelocityDelta,
      timeSinceLastChange,
    },
    currentRules: { ...rules },
  };
}

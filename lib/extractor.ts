import type {
  Agent,
  Cluster,
  PerceptionRules,
  SimSnapshot,
} from "./types";

const DEFAULT_RADIUS_PX = 60;
const DEFAULT_MIN_CLUSTER_SIZE = 5;

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Smallest signed difference between two headings (wraps at ±π). */
function circularDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function meanSpeedVariance(agents: Agent[]): number {
  if (agents.length === 0) return 0;
  const speeds = agents.map((a) => Math.hypot(a.vx, a.vy));
  const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length;
  const m2 =
    speeds.reduce((s, v) => s + (v - mean) * (v - mean), 0) / speeds.length;
  return m2;
}

/** Circular mean direction; returns angle in (−π, π]. Empty set → 0. */
function circularMeanHeading(agents: Agent[]): number {
  if (agents.length === 0) return 0;
  let sx = 0;
  let sy = 0;
  for (const a of agents) {
    sx += Math.cos(a.heading);
    sy += Math.sin(a.heading);
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

/**
 * Distance-threshold grouping: edge if dist ≤ radius. Only agents with ≥2
 * neighbors participate. Keeps connected components with size ≥ minClusterSize.
 * Cluster ids are 0…N−1 in order of size descending.
 */
export function detectClusters(
  agents: Agent[],
  radius: number = DEFAULT_RADIUS_PX,
): Cluster[] {
  const n = agents.length;
  const r2 = radius * radius;

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
  const localIndex = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (neighborCount[i]! >= 2) {
      localIndex.set(i, eligible.length);
      eligible.push(i);
    }
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

  const buckets = new Map<number, string[]>();
  for (let a = 0; a < eligible.length; a++) {
    const root = uf.find(a);
    const gid = eligible[a]!;
    const id = agents[gid]!.id;
    let list = buckets.get(root);
    if (!list) {
      list = [];
      buckets.set(root, list);
    }
    list.push(id);
  }

  const minSize = DEFAULT_MIN_CLUSTER_SIZE;
  const raw: Cluster[] = [];
  for (const ids of buckets.values()) {
    if (ids.length >= minSize) {
      ids.sort((x, y) => x.localeCompare(y));
      raw.push({ id: -1, memberIds: ids });
    }
  }

  raw.sort((c1, c2) => {
    const d = c2.memberIds.length - c1.memberIds.length;
    if (d !== 0) return d;
    const m1 = c1.memberIds[0] ?? "";
    const m2 = c2.memberIds[0] ?? "";
    return m1.localeCompare(m2);
  });

  return raw.map((c, idx) => ({ ...c, id: idx }));
}

export function extractSnapshot(
  agents: Agent[],
  rules: PerceptionRules | null | undefined,
  previousSnapshot: SimSnapshot | null | undefined,
): SimSnapshot {
  const timestampMs = Date.now();
  const radius = rules?.clusterRadiusPx ?? DEFAULT_RADIUS_PX;
  const minCluster =
    rules?.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;

  let clusters = detectClusters(agents, radius).filter(
    (c) => c.memberIds.length >= minCluster,
  );
  clusters = clusters.map((c, idx) => ({ ...c, id: idx }));

  const velocityVariance = meanSpeedVariance(agents);
  const dominantDirection = circularMeanHeading(agents);

  const prevCount = previousSnapshot?.clusters.length ?? 0;
  const currCount = clusters.length;
  const clusterCountDelta = currCount - prevCount;

  let clusterCountLastChangedAtMs: number;
  if (!previousSnapshot) {
    clusterCountLastChangedAtMs = timestampMs;
  } else if (currCount !== prevCount) {
    clusterCountLastChangedAtMs = timestampMs;
  } else {
    clusterCountLastChangedAtMs =
      previousSnapshot.clusterCountLastChangedAtMs;
  }

  const timeSinceLastChange =
    timestampMs - clusterCountLastChangedAtMs;

  const velocityVarianceDelta = previousSnapshot
    ? velocityVariance - previousSnapshot.velocityVariance
    : 0;

  const dominantDirectionDelta = previousSnapshot
    ? circularDiff(
        dominantDirection,
        previousSnapshot.dominantDirection,
      )
    : 0;

  const delta = {
    clusterCountDelta,
    timeSinceLastChange,
    velocityVarianceDelta,
    dominantDirectionDelta,
  };

  return {
    timestampMs,
    clusters,
    velocityVariance,
    dominantDirection,
    clusterCountLastChangedAtMs,
    delta,
  };
}

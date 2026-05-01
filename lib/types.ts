/** Murmur perception / simulation types (see spec §4.2). */

export interface Agent {
  id: string;
  /** World X in pixels */
  x: number;
  /** World Y in pixels */
  y: number;
  vx: number;
  vy: number;
  /** Heading in radians (e.g. −π…π); used for dominant direction */
  heading: number;
}

export interface Cluster {
  /** Assigned 0…N−1 after sorting by size descending */
  id: number;
  memberIds: string[];
}

export interface PerceptionRules {
  /** Distance threshold for neighbor edges; default 60 */
  clusterRadiusPx?: number;
  /** Minimum agents per cluster; default 5 */
  minClusterSize?: number;
}

export interface SnapshotDelta {
  clusterCountDelta: number;
  /** Milliseconds since `clusters.length` last changed */
  timeSinceLastChange: number;
  velocityVarianceDelta: number;
  dominantDirectionDelta: number;
}

export interface SimSnapshot {
  timestampMs: number;
  clusters: Cluster[];
  velocityVariance: number;
  dominantDirection: number;
  /**
   * Epoch ms when `clusters.length` last differed from the prior frame;
   * used with `timestampMs` for `delta.timeSinceLastChange`.
   */
  clusterCountLastChangedAtMs: number;
  delta: SnapshotDelta;
}

// lib/types.ts
// Canonical type definitions for Murmur.
// All modules import from this file. Do not redefine these locally.

export interface Agent {
  id: number;
  x: number; // position
  y: number;
  vx: number; // velocity
  vy: number;
}

export interface RuleWeights {
  separation: number; // 0..5,  default 1.5
  alignment: number; // 0..5,  default 1.0
  cohesion: number; // 0..5,  default 1.0
  speed: number; // 0.2..8, default 2.0  (max velocity)
  perception: number; // 10..250, default 50  (neighbor radius in px)
}

export interface Cluster {
  id: number; // stable within a single snapshot only
  centroid: { x: number; y: number };
  size: number; // agent count
  avgVelocity: number; // magnitude
  agentIds: number[]; // which agents belong to this cluster
}

export interface SimSnapshot {
  timestamp: number; // ms since epoch
  agentCount: number;
  clusterCount: number;
  clusters: Cluster[];
  outlierCount: number; // agents not in any cluster
  /** Mean velocity magnitude across all agents (§4.4 snapshot context). */
  averageVelocity: number;
  velocityVariance: number;
  dominantDirection: number; // radians, average heading
  delta: {
    clusterCountDelta: number; // vs previous snapshot
    avgVelocityDelta: number;
    timeSinceLastChange: number; // ms since clusterCount last changed
  };
  currentRules: RuleWeights;
}

export interface ClaudeResponse {
  message: string; // always present
  rule_update: Partial<RuleWeights> | null; // null if no change
  highlight_cluster: number | null; // cluster id from snapshot
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  /** Present on assistant messages: cluster snapshot from the user send that produced this reply. */
  frozenClusters?: Cluster[];
}

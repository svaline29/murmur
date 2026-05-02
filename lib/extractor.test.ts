/**
 * Manual verification for detectClusters (not wired to a test runner).
 * Run: npx tsx lib/extractor.test.ts
 */

import { detectClusters } from "./extractor";
import type { Agent, RuleWeights } from "./types";

/** perception such that Math.max(perception * 0.9, 30) === 60 (legacy test radius). */
const RULES_CLUSTER_RADIUS_60: RuleWeights = {
  separation: 1,
  alignment: 1,
  cohesion: 1,
  speed: 2,
  perception: 60 / 0.9,
  entropy: 0.5,
};

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function makeAgent(id: number, x: number, y: number, heading = 0, speed = 1): Agent {
  return {
    id,
    x,
    y,
    vx: speed * Math.cos(heading),
    vy: speed * Math.sin(heading),
  };
}

function run(): void {
  const agents: Agent[] = [];
  let nextId = 0;

  // Tight blob: 6 agents; each has ≥2 neighbors within 60px
  for (let i = 0; i < 6; i++) {
    agents.push(makeAgent(nextId++, i * 3, i * 2, i * 0.1));
  }

  // Looser pentagon: edge ~50px, R ≈ 42.37px from center → cluster size 5
  const cx = 220;
  const cy = 0;
  const R = 50 / (2 * Math.sin(Math.PI / 5));
  for (let i = 0; i < 5; i++) {
    const th = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    agents.push(makeAgent(nextId++, cx + R * Math.cos(th), cy + R * Math.sin(th), th));
  }

  // Outliers — no qualifying neighbors
  agents.push(makeAgent(nextId++, 500, 500, 0));
  agents.push(makeAgent(nextId++, 520, 800, 1));
  agents.push(makeAgent(nextId++, -400, 100, -0.5));

  const clusters = detectClusters(agents, RULES_CLUSTER_RADIUS_60);

  assert(clusters.length === 2, `expected 2 clusters, got ${clusters.length}`);
  assert(
    clusters[0]!.size === 6,
    `first cluster (largest) should have size 6, got ${clusters[0]!.size}`,
  );
  assert(
    clusters[1]!.size === 5,
    `second cluster should have size 5, got ${clusters[1]!.size}`,
  );
  assert(clusters[0]!.id === 0 && clusters[1]!.id === 1, "cluster ids should be 0, 1");

  const allMember = new Set<number>();
  for (const c of clusters) {
    assert(c.agentIds.length === c.size, "agentIds length must match size");
    for (const id of c.agentIds) {
      assert(!allMember.has(id), `duplicate agent id ${id}`);
      allMember.add(id);
    }
  }
  const outlierIds = agents.filter((a) => a.x >= 400).map((a) => a.id);
  for (const id of outlierIds) {
    assert(!allMember.has(id), `outlier ${id} should not be clustered`);
  }

  console.log("extractor.test.ts: all checks passed.");
}

run();

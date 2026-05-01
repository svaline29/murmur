/**
 * Manual verification for detectClusters (not wired to a test runner).
 * Run: npx tsx lib/extractor.test.ts
 */

import { detectClusters } from "./extractor";
import type { Agent } from "./types";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function makeAgent(
  id: string,
  x: number,
  y: number,
  heading = 0,
  speed = 1,
): Agent {
  return {
    id,
    x,
    y,
    vx: speed * Math.cos(heading),
    vy: speed * Math.sin(heading),
    heading,
  };
}

function run(): void {
  const agents: Agent[] = [];

  // Tight blob: 6 agents, all within 60px; each has ≥2 neighbors → one cluster size 6
  for (let i = 0; i < 6; i++) {
    agents.push(makeAgent(`tight-${i}`, i * 3, i * 2, i * 0.1));
  }

  // Looser group: pentagon edge ~50px at center (220, 0), 5 agents, degree 2 each → cluster size 5
  const cx = 220;
  const cy = 0;
  const R = 50 / (2 * Math.sin(Math.PI / 5));
  for (let i = 0; i < 5; i++) {
    const th = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    agents.push(
      makeAgent(`loose-${i}`, cx + R * Math.cos(th), cy + R * Math.sin(th), th),
    );
  }

  // Outliers: isolated, no neighbors within 60px
  agents.push(makeAgent("out-a", 500, 500, 0));
  agents.push(makeAgent("out-b", 520, 800, 1));
  agents.push(makeAgent("out-c", -400, 100, -0.5));

  const clusters = detectClusters(agents, 60);

  assert(clusters.length === 2, `expected 2 clusters, got ${clusters.length}`);
  assert(
    clusters[0]!.memberIds.length === 6,
    `first cluster (largest) should have 6 members, got ${clusters[0]!.memberIds.length}`,
  );
  assert(
    clusters[1]!.memberIds.length === 5,
    `second cluster should have 5 members, got ${clusters[1]!.memberIds.length}`,
  );
  assert(clusters[0]!.id === 0 && clusters[1]!.id === 1, "cluster ids should be 0,1");

  const allMember = new Set<string>();
  for (const c of clusters) {
    for (const id of c.memberIds) {
      assert(!allMember.has(id), `duplicate member ${id}`);
      allMember.add(id);
    }
  }
  for (const id of ["out-a", "out-b", "out-c"]) {
    assert(!allMember.has(id), `outlier ${id} should not be clustered`);
  }

  console.log("extractor.test.ts: all checks passed.");
}

run();

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { extractSnapshot } from "@/lib/extractor";
import { DEFAULT_RULES, initAgents, tick } from "@/lib/simulation";
import type { Agent, RuleWeights, SimSnapshot } from "@/lib/types";

/** Spec §4.2 — logical canvas size for physics and placement. */
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;

/** Spec §4.2 / D15 */
const AGENT_COUNT = 200;

const SNAPSHOT_INTERVAL_MS = 500;

export function useSimulation(): {
  agentsRef: React.MutableRefObject<Agent[]>;
  rulesRef: React.MutableRefObject<RuleWeights>;
  snapshot: SimSnapshot | null;
  isPaused: boolean;
  togglePause: () => void;
  reset: () => void;
  applyRuleUpdate: (update: Partial<RuleWeights>) => void;
} {
  const agentsRef = useRef<Agent[]>([]);
  const rulesRef = useRef<RuleWeights>({ ...DEFAULT_RULES });

  const [snapshot, setSnapshot] = useState<SimSnapshot | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const prevSnapshotRef = useRef<SimSnapshot | null>(null);
  const lastExtractMsRef = useRef(0);

  useEffect(() => {
    agentsRef.current = initAgents(AGENT_COUNT, CANVAS_WIDTH, CANVAS_HEIGHT);
    rulesRef.current = { ...DEFAULT_RULES };
    const snap = extractSnapshot(
      agentsRef.current,
      rulesRef.current,
      null,
    );
    prevSnapshotRef.current = snap;
    setSnapshot(snap);
    lastExtractMsRef.current = performance.now();
  }, []);

  useEffect(() => {
    if (isPaused) return;

    let rafId = 0;
    let cancelled = false;

    const loop = (now: DOMHighResTimeStamp): void => {
      if (cancelled) return;

      tick(agentsRef.current, rulesRef.current, CANVAS_WIDTH, CANVAS_HEIGHT);

      if (now - lastExtractMsRef.current >= SNAPSHOT_INTERVAL_MS) {
        lastExtractMsRef.current = now;
        const snap = extractSnapshot(
          agentsRef.current,
          rulesRef.current,
          prevSnapshotRef.current,
        );
        prevSnapshotRef.current = snap;
        setSnapshot(snap);
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [isPaused]);

  const togglePause = useCallback(() => {
    setIsPaused((p) => !p);
  }, []);

  const reset = useCallback(() => {
    agentsRef.current = initAgents(AGENT_COUNT, CANVAS_WIDTH, CANVAS_HEIGHT);
    rulesRef.current = { ...DEFAULT_RULES };
    prevSnapshotRef.current = null;
    lastExtractMsRef.current = performance.now();

    const snap = extractSnapshot(
      agentsRef.current,
      rulesRef.current,
      null,
    );
    prevSnapshotRef.current = snap;
    setSnapshot(snap);
  }, []);

  const applyRuleUpdate = useCallback((update: Partial<RuleWeights>) => {
    Object.assign(rulesRef.current, update);
  }, []);

  return {
    agentsRef,
    rulesRef,
    snapshot,
    isPaused,
    togglePause,
    reset,
    applyRuleUpdate,
  };
}

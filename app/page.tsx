"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { ChatPanel } from "@/components/ChatPanel";
import { MetricsPanel } from "@/components/MetricsPanel";
import { SimCanvas, type HighlightLayer } from "@/components/SimCanvas";
import { useSimulation } from "@/hooks/useSimulation";
import { PINNED_HIGHLIGHT_MS } from "@/lib/highlightTiming";
import { DEFAULT_RULES } from "@/lib/simulation";
import type { ChatMessage, ClaudeResponse, Cluster, RuleWeights } from "@/lib/types";

const HIGHLIGHT_CLEAR_MS = 8000;
const MAX_HISTORY_MESSAGES = 20;

export default function Home(): ReactElement {
  const {
    agentsRef,
    rulesRef,
    snapshot,
    applyRuleUpdate,
  } = useSimulation();

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [hoveredClusterId, setHoveredClusterId] = useState<number | null>(null);
  const [hoveredFrozenClusters, setHoveredFrozenClusters] = useState<
    Cluster[] | null
  >(null);
  /** Badge-click pins; `pinnedAt` drives canvas fade and automatic removal. */
  const [pinnedHighlights, setPinnedHighlights] = useState<
    { clusterId: number; frozenClusters: Cluster[]; pinnedAt: number }[]
  >([]);
  const [autoHighlightClusterId, setAutoHighlightClusterId] = useState<
    number | null
  >(null);
  const [autoHighlightFrozenClusters, setAutoHighlightFrozenClusters] =
    useState<Cluster[] | null>(null);
  const [autoHighlightExpiresAt, setAutoHighlightExpiresAt] = useState<
    number | null
  >(null);
  const [autoHighlightStartedAt, setAutoHighlightStartedAt] = useState<
    number | null
  >(null);

  const pinTimeoutsRef = useRef<Map<number, number>>(new Map());
  const [metricsVisible, setMetricsVisible] = useState(true);
  const [devPanelVisible, setDevPanelVisible] = useState(false);
  const [devRules, setDevRules] = useState<RuleWeights>({ ...DEFAULT_RULES });

  const highlightClearRef = useRef<number | null>(null);

  const clearHighlightTimer = useCallback(() => {
    if (highlightClearRef.current !== null) {
      clearTimeout(highlightClearRef.current);
      highlightClearRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearHighlightTimer();
  }, [clearHighlightTimer]);

  useEffect(() => {
    return () => {
      for (const t of pinTimeoutsRef.current.values()) {
        clearTimeout(t);
      }
      pinTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const timers = pinTimeoutsRef.current;
    for (const p of pinnedHighlights) {
      if (timers.has(p.clusterId)) continue;
      const cid = p.clusterId;
      const delay = Math.max(
        0,
        PINNED_HIGHLIGHT_MS - (performance.now() - p.pinnedAt),
      );
      const tid = window.setTimeout(() => {
        timers.delete(cid);
        setPinnedHighlights((cur) => cur.filter((x) => x.clusterId !== cid));
      }, delay);
      timers.set(cid, tid);
    }
    for (const id of [...timers.keys()]) {
      if (!pinnedHighlights.some((p) => p.clusterId === id)) {
        const t = timers.get(id);
        if (t !== undefined) clearTimeout(t);
        timers.delete(id);
      }
    }
  }, [pinnedHighlights]);

  useEffect(() => {
    if (devPanelVisible) {
      setDevRules({ ...rulesRef.current });
    }
  }, [devPanelVisible, rulesRef]);

  const clearPinnedClusters = useCallback(() => {
    setPinnedHighlights([]);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        clearPinnedClusters();
        return;
      }
      if (e.key !== "d" && e.key !== "D") return;
      const t = e.target;
      if (t instanceof Element && t.closest("input, textarea, [contenteditable=true]")) {
        return;
      }
      e.preventDefault();
      setDevPanelVisible((v) => !v);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearPinnedClusters]);

  const onClusterBadgeHover = useCallback(
    (clusterId: number | null, frozenClusters: Cluster[] | null) => {
      setHoveredClusterId(clusterId);
      setHoveredFrozenClusters(frozenClusters);
    },
    [],
  );

  const toggleClusterPin = useCallback(
    (clusterId: number, frozenClusters: Cluster[]) => {
      setPinnedHighlights((prev) => {
        const i = prev.findIndex((p) => p.clusterId === clusterId);
        if (i !== -1) return prev.filter((_, j) => j !== i);
        return [
          ...prev,
          {
            clusterId,
            frozenClusters,
            pinnedAt: performance.now(),
          },
        ];
      });
    },
    [],
  );

  const highlightLayers = useMemo((): HighlightLayer[] => {
    const layers: HighlightLayer[] = [];
    const seen = new Set<number>();

    function push(layer: HighlightLayer): void {
      if (
        layers.length >= 5 ||
        layer.frozenClusters.length === 0 ||
        seen.has(layer.clusterId)
      ) {
        return;
      }
      seen.add(layer.clusterId);
      layers.push(layer);
    }

    if (
      autoHighlightClusterId !== null &&
      autoHighlightFrozenClusters !== null
    ) {
      push({
        clusterId: autoHighlightClusterId,
        frozenClusters: autoHighlightFrozenClusters,
        kind: "auto",
        startedAt: autoHighlightStartedAt ?? 0,
        expiresAt: autoHighlightExpiresAt,
      });
    }

    for (const { clusterId, frozenClusters, pinnedAt } of pinnedHighlights) {
      push({
        clusterId,
        frozenClusters,
        kind: "pin",
        startedAt: pinnedAt,
        expiresAt: null,
      });
    }

    if (hoveredClusterId !== null && hoveredFrozenClusters !== null) {
      push({
        clusterId: hoveredClusterId,
        frozenClusters: hoveredFrozenClusters,
        kind: "hover",
        startedAt: 0,
        expiresAt: null,
      });
    }

    return layers;
  }, [
    autoHighlightClusterId,
    autoHighlightFrozenClusters,
    autoHighlightExpiresAt,
    autoHighlightStartedAt,
    pinnedHighlights,
    hoveredClusterId,
    hoveredFrozenClusters,
  ]);

  const patchDevRule = useCallback((key: keyof RuleWeights, value: number) => {
    setDevRules((r) => {
      const next = { ...r, [key]: value };
      Object.assign(rulesRef.current, { [key]: value });
      return next;
    });
  }, [rulesRef]);

  const handleSendMessage = useCallback(
    async (userMessage: string) => {
      if (!snapshot) return;

      const historyForApi = chatHistory.slice(-MAX_HISTORY_MESSAGES);
      const userMsg: ChatMessage = {
        role: "user",
        content: userMessage,
        timestamp: Date.now(),
      };

      setChatHistory((h) => [...h, userMsg]);
      setIsPending(true);
      clearHighlightTimer();
      setAutoHighlightClusterId(null);
      setAutoHighlightFrozenClusters(null);
      setAutoHighlightExpiresAt(null);
      setAutoHighlightStartedAt(null);

      const frozenSnapshot = structuredClone(snapshot);
      const frozenClustersForThisExchange = frozenSnapshot.clusters;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            snapshot: frozenSnapshot,
            history: historyForApi,
            userMessage,
          }),
        });
        const data = (await res.json()) as ClaudeResponse;

        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: data.message,
          timestamp: Date.now(),
          frozenClusters: frozenClustersForThisExchange,
        };
        setChatHistory((h) => [...h, assistantMsg]);

        if (data.rule_update) {
          applyRuleUpdate(data.rule_update);
        }

        if (data.highlight_cluster != null) {
          const t0 = performance.now();
          setAutoHighlightClusterId(data.highlight_cluster);
          setAutoHighlightFrozenClusters(frozenSnapshot.clusters);
          setAutoHighlightStartedAt(t0);
          setAutoHighlightExpiresAt(t0 + HIGHLIGHT_CLEAR_MS);
          clearHighlightTimer();
          highlightClearRef.current = window.setTimeout(() => {
            setAutoHighlightClusterId(null);
            setAutoHighlightFrozenClusters(null);
            setAutoHighlightExpiresAt(null);
            setAutoHighlightStartedAt(null);
            highlightClearRef.current = null;
          }, HIGHLIGHT_CLEAR_MS);
        }
      } catch {
        setChatHistory((h) => [
          ...h,
          {
            role: "assistant",
            content: "Request failed — check your connection and try again.",
            timestamp: Date.now(),
            frozenClusters: frozenClustersForThisExchange,
          },
        ]);
      } finally {
        setIsPending(false);
      }
    },
    [snapshot, chatHistory, applyRuleUpdate, clearHighlightTimer],
  );

  return (
    <div className="flex h-[100dvh] min-h-0 w-full flex-row bg-[var(--bg-page)]">
      <div className="relative flex w-[70%] min-w-0 flex-col p-6">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          {devPanelVisible ? (
            <div
              className="pointer-events-auto absolute left-6 top-6 z-30 max-w-[240px] rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 font-mono text-[10px] shadow-lg"
              style={{ color: "var(--text-mono)" }}
            >
              <div className="mb-2 flex items-center justify-between gap-2 text-[var(--text-secondary)]">
                <span>dev rules</span>
                <span className="opacity-60">D</span>
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[var(--text-secondary)]">separation</span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={devRules.separation}
                    onChange={(e) => patchDevRule("separation", Number(e.target.value))}
                    className="w-full accent-[var(--accent)]"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[var(--text-secondary)]">alignment</span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={devRules.alignment}
                    onChange={(e) => patchDevRule("alignment", Number(e.target.value))}
                    className="w-full accent-[var(--accent)]"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[var(--text-secondary)]">cohesion</span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={devRules.cohesion}
                    onChange={(e) => patchDevRule("cohesion", Number(e.target.value))}
                    className="w-full accent-[var(--accent)]"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[var(--text-secondary)]">speed</span>
                  <input
                    type="range"
                    min={0.5}
                    max={4}
                    step={0.05}
                    value={devRules.speed}
                    onChange={(e) => patchDevRule("speed", Number(e.target.value))}
                    className="w-full accent-[var(--accent)]"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[var(--text-secondary)]">perception</span>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    step={1}
                    value={devRules.perception}
                    onChange={(e) => patchDevRule("perception", Number(e.target.value))}
                    className="w-full accent-[var(--accent)]"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[var(--text-secondary)]">entropy</span>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.05}
                    value={devRules.entropy}
                    onChange={(e) => patchDevRule("entropy", Number(e.target.value))}
                    className="w-full accent-[var(--accent)]"
                  />
                </label>
              </div>
            </div>
          ) : null}
          <SimCanvas
            agentsRef={agentsRef}
            highlightLayers={highlightLayers}
            onCanvasPointerDown={clearPinnedClusters}
          />
        </div>
        <MetricsPanel
          snapshot={snapshot}
          isVisible={metricsVisible}
          onToggle={() => setMetricsVisible((v) => !v)}
        />
      </div>
      <div className="flex w-[30%] min-w-0 flex-col">
        <ChatPanel
          history={chatHistory}
          onSendMessage={handleSendMessage}
          isPending={isPending}
          onClusterBadgeHover={onClusterBadgeHover}
          onClusterBadgeClick={toggleClusterPin}
        />
      </div>
    </div>
  );
}

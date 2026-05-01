"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import { ChatPanel } from "@/components/ChatPanel";
import { MetricsPanel } from "@/components/MetricsPanel";
import { SimCanvas } from "@/components/SimCanvas";
import { useSimulation } from "@/hooks/useSimulation";
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
  const [highlightClusterId, setHighlightClusterId] = useState<number | null>(null);
  const [frozenClusters, setFrozenClusters] = useState<Cluster[] | null>(null);
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
    if (devPanelVisible) {
      setDevRules({ ...rulesRef.current });
    }
  }, [devPanelVisible, rulesRef]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
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
  }, []);

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
      setHighlightClusterId(null);
      setFrozenClusters(null);

      const frozenSnapshot = structuredClone(snapshot);

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
        };
        setChatHistory((h) => [...h, assistantMsg]);

        if (data.rule_update) {
          applyRuleUpdate(data.rule_update);
        }

        if (data.highlight_cluster != null) {
          setHighlightClusterId(data.highlight_cluster);
          setFrozenClusters(frozenSnapshot.clusters);
          clearHighlightTimer();
          highlightClearRef.current = window.setTimeout(() => {
            setHighlightClusterId(null);
            setFrozenClusters(null);
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
              </div>
            </div>
          ) : null}
          <SimCanvas
            agentsRef={agentsRef}
            highlightClusterId={highlightClusterId}
            frozenClusters={frozenClusters}
          />
        </div>
        <MetricsPanel
          snapshot={snapshot}
          isVisible={metricsVisible}
          onToggle={() => setMetricsVisible((v) => !v)}
        />
      </div>
      <div className="flex w-[30%] min-w-0 flex-col">
        <ChatPanel history={chatHistory} onSendMessage={handleSendMessage} isPending={isPending} />
      </div>
    </div>
  );
}

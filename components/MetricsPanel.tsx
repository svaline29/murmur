"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";

import type { SimSnapshot } from "@/lib/types";

const TICK_MS = 200;

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function useLerpedScalar(target: number, active: boolean): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!active) {
      setValue(target);
      return;
    }
    const from = valueRef.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / TICK_MS);
      setValue(from + (target - from) * easeOutQuad(t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, active]);

  return value;
}

function shortestAngleDiff(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function useLerpedHeadingRad(targetRad: number, active: boolean): number {
  const [value, setValue] = useState(targetRad);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!active) {
      setValue(targetRad);
      return;
    }
    const from = valueRef.current;
    const delta = shortestAngleDiff(from, targetRad);
    const goal = from + delta;
    const start = performance.now();
    let raf = 0;
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / TICK_MS);
      const eased = easeOutQuad(t);
      setValue(from + (goal - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [targetRad, active]);

  return value;
}

function formatHeadingDeg(rad: number): string {
  const deg = (rad * 180) / Math.PI;
  const n = ((deg % 360) + 360) % 360;
  return `${String(Math.round(n)).padStart(3, "0")}°`;
}

export type MetricsPanelProps = {
  snapshot: SimSnapshot | null;
  isVisible: boolean;
  onToggle: () => void;
};

export function MetricsPanel({ snapshot, isVisible, onToggle }: MetricsPanelProps): ReactElement {
  const active = snapshot !== null;

  const clusterN = useLerpedScalar(snapshot?.clusterCount ?? 0, active);
  const outlierN = useLerpedScalar(snapshot?.outlierCount ?? 0, active);
  const velMean = useLerpedScalar(snapshot?.averageVelocity ?? 0, active);
  const velStd = useLerpedScalar(
    Math.sqrt(Math.max(0, snapshot?.velocityVariance ?? 0)),
    active,
  );
  const headingRad = useLerpedHeadingRad(snapshot?.dominantDirection ?? 0, active);
  const stableSec = useLerpedScalar((snapshot?.delta.timeSinceLastChange ?? 0) / 1000, active);

  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 z-20">
      <div
        className="relative min-w-[200px] rounded-tl border-t border-l border-[var(--border-subtle)] bg-[var(--bg-panel)] font-mono text-[11px]"
        style={{ color: "var(--text-mono)" }}
      >
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-glow)] hover:text-[var(--text-primary)]"
          aria-expanded={isVisible}
          aria-label={isVisible ? "Hide metrics" : "Show metrics"}
        >
          <span
            className="inline-block text-[10px] leading-none transition-transform duration-200 ease-out"
            style={{ transform: isVisible ? "rotate(0deg)" : "rotate(-90deg)" }}
          >
            ⌄
          </span>
        </button>

        {isVisible ? (
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 px-3 pb-3 pt-7 tabular-nums">
            <dt className="text-[var(--text-secondary)]">CLUSTERS</dt>
            <dd className="text-right text-[var(--text-primary)]">{Math.round(clusterN)}</dd>

            <dt className="text-[var(--text-secondary)]">OUTLIERS</dt>
            <dd className="text-right text-[var(--text-primary)]">{Math.round(outlierN)}</dd>

            <dt className="text-[var(--text-secondary)]">VELOCITY</dt>
            <dd className="text-right text-[var(--text-primary)]">
              {velMean.toFixed(2)}
              {" ± "}
              {velStd.toFixed(2)}
            </dd>

            <dt className="text-[var(--text-secondary)]">HEADING</dt>
            <dd className="text-right text-[var(--text-primary)]">{formatHeadingDeg(headingRad)}</dd>

            <dt className="text-[var(--text-secondary)]">STABLE FOR</dt>
            <dd className="text-right text-[var(--text-primary)]">{stableSec.toFixed(1)}s</dd>
          </dl>
        ) : (
          <div className="h-8 w-[200px]" aria-hidden />
        )}
      </div>
    </div>
  );
}

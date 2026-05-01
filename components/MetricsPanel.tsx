"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";

import type { SimSnapshot } from "@/lib/types";

const TICK_MS = 200;

const VALUE_CLASS =
  "text-right font-mono tabular-nums text-[var(--text-primary)] transition-colors duration-200";

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function useLerpedScalar(target: number, active: boolean): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!active) {
      valueRef.current = target;
      return;
    }
    const from = valueRef.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / TICK_MS);
      const next = from + (target - from) * easeOutQuad(t);
      valueRef.current = next;
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, active]);

  return active ? value : target;
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

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!active) {
      valueRef.current = targetRad;
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
      const next = from + (goal - from) * eased;
      valueRef.current = next;
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [targetRad, active]);

  return active ? value : targetRad;
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
        className="relative min-w-[208px] rounded-tl border-t border-l border-[var(--border-subtle)] bg-[var(--bg-panel)] font-mono text-[11px] tracking-[0.02em]"
        style={{ color: "var(--text-mono)", fontVariantNumeric: "tabular-nums" }}
      >
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] transition-colors duration-200 hover:border-[var(--accent-glow)] hover:bg-[rgba(124,248,255,0.06)] hover:text-[var(--text-primary)]"
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
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 px-4 pb-4 pt-8 tabular-nums">
            <dt className="text-[var(--text-secondary)]">CLUSTERS</dt>
            <dd className={VALUE_CLASS}>{Math.round(clusterN)}</dd>

            <dt className="text-[var(--text-secondary)]">OUTLIERS</dt>
            <dd className={VALUE_CLASS}>{Math.round(outlierN)}</dd>

            <dt className="text-[var(--text-secondary)]">VELOCITY</dt>
            <dd className={VALUE_CLASS}>
              {velMean.toFixed(2)}
              {" ± "}
              {velStd.toFixed(2)}
            </dd>

            <dt className="text-[var(--text-secondary)]">HEADING</dt>
            <dd className={VALUE_CLASS}>{formatHeadingDeg(headingRad)}</dd>

            <dt className="text-[var(--text-secondary)]">STABLE FOR</dt>
            <dd className={VALUE_CLASS}>{stableSec.toFixed(1)}s</dd>
          </dl>
        ) : (
          <div className="h-8 w-[208px]" aria-hidden />
        )}
      </div>
    </div>
  );
}

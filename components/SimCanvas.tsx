"use client";

import {
  useEffect,
  useRef,
  type MutableRefObject,
  type ReactElement,
} from "react";

import type { Agent, Cluster } from "@/lib/types";

/** Matches `useSimulation` / spec §4.1 logical canvas size (render-only — no physics import). */
const LOGICAL_WIDTH = 1200;
const LOGICAL_HEIGHT = 800;

const TRAIL_CAP = 8;
/** Hull pulse period — spec §4.6 / §5.5 */
const HIGHLIGHT_PULSE_MS = 1200;
/** Spec §4.6 — highlight duration before visual expiry */
const HIGHLIGHT_DURATION_MS = 8000;

interface TrailRing {
  xs: Float32Array;
  ys: Float32Array;
  head: number;
  count: number;
}

function createTrailRing(): TrailRing {
  return {
    xs: new Float32Array(TRAIL_CAP),
    ys: new Float32Array(TRAIL_CAP),
    head: -1,
    count: 0,
  };
}

function trailPush(ring: TrailRing, x: number, y: number): void {
  ring.head = (ring.head + 1) % TRAIL_CAP;
  ring.xs[ring.head] = x;
  ring.ys[ring.head] = y;
  ring.count = Math.min(TRAIL_CAP, ring.count + 1);
}

interface CanvasPalette {
  bgCanvas: string;
  agentColor: string;
  agentGlow: string;
  trailColor: string;
  highlightStroke: string;
  highlightGlow: string;
  gridColor: string;
}

function parseCssColor(raw: string, fallback: string): string {
  const v = raw.trim();
  return v.length > 0 ? v : fallback;
}

function readPalette(el: HTMLElement): CanvasPalette {
  const cs = getComputedStyle(el);
  return {
    bgCanvas: parseCssColor(cs.getPropertyValue("--bg-canvas"), "#050505"),
    agentColor: parseCssColor(cs.getPropertyValue("--agent-color"), "#E8F4FF"),
    agentGlow: parseCssColor(cs.getPropertyValue("--agent-glow"), "rgba(124,248,255,0.4)"),
    trailColor: parseCssColor(cs.getPropertyValue("--trail-color"), "rgba(232,244,255,0.6)"),
    highlightStroke: parseCssColor(cs.getPropertyValue("--highlight-stroke"), "#7CF8FF"),
    highlightGlow: parseCssColor(cs.getPropertyValue("--highlight-glow"), "rgba(124,248,255,0.8)"),
    gridColor: parseCssColor(cs.getPropertyValue("--grid-color"), "rgba(255,255,255,0.04)"),
  };
}

/** Monotone chain convex hull; returns CCW polygon vertices (no duplicate closing point). */
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const n = points.length;
  if (n <= 1) return points.slice();
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: { x: number; y: number }[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: { x: number; y: number }[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function parseTrailColorRgba(color: string): { r: number; g: number; b: number; baseA: number } {
  const m = color.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i,
  );
  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      baseA: m[4] !== undefined ? Number(m[4]) : 1,
    };
  }
  return { r: 232, g: 244, b: 255, baseA: 0.6 };
}

export type SimCanvasProps = {
  agentsRef: MutableRefObject<Agent[]>;
  highlightClusterId: number | null;
  frozenClusters: Cluster[] | null;
};

export function SimCanvas({
  agentsRef,
  highlightClusterId,
  frozenClusters,
}: SimCanvasProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<CanvasPalette | null>(null);

  const highlightPropsRef = useRef({ highlightClusterId, frozenClusters });
  highlightPropsRef.current = { highlightClusterId, frozenClusters };

  const highlightDeadlineRef = useRef<number | null>(null);

  useEffect(() => {
    if (highlightClusterId !== null) {
      highlightDeadlineRef.current = performance.now() + HIGHLIGHT_DURATION_MS;
    } else {
      highlightDeadlineRef.current = null;
    }
  }, [highlightClusterId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ctx2d = ctx;

    paletteRef.current = readPalette(wrap);

    const trails: TrailRing[] = [];

    function syncTrailCount(agentCount: number): void {
      while (trails.length < agentCount) trails.push(createTrailRing());
      while (trails.length > agentCount) trails.pop();
    }

    const canvasEl = canvas;
    const wrapEl = wrap;

    function resizeCanvas(): void {
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      canvasEl.width = Math.round(LOGICAL_WIDTH * dpr);
      canvasEl.height = Math.round(LOGICAL_HEIGHT * dpr);
      canvasEl.style.width = `${LOGICAL_WIDTH}px`;
      canvasEl.style.height = `${LOGICAL_HEIGHT}px`;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      paletteRef.current = readPalette(wrapEl);
    }

    resizeCanvas();

    const ro = new ResizeObserver(() => {
      resizeCanvas();
    });
    ro.observe(wrapEl);

    let rafId = 0;

    const loop = (now: DOMHighResTimeStamp): void => {
      const palette = paletteRef.current ?? readPalette(wrapEl);
      const agents = agentsRef.current;

      syncTrailCount(agents.length);
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i]!;
        trailPush(trails[i]!, a.x, a.y);
      }

      ctx2d.fillStyle = palette.bgCanvas;
      ctx2d.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

      ctx2d.strokeStyle = palette.gridColor;
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      for (let x = 0; x <= LOGICAL_WIDTH; x += 50) {
        ctx2d.moveTo(x + 0.5, 0);
        ctx2d.lineTo(x + 0.5, LOGICAL_HEIGHT);
      }
      for (let y = 0; y <= LOGICAL_HEIGHT; y += 50) {
        ctx2d.moveTo(0, y + 0.5);
        ctx2d.lineTo(LOGICAL_WIDTH, y + 0.5);
      }
      ctx2d.stroke();

      const cx = LOGICAL_WIDTH / 2;
      const cy = LOGICAL_HEIGHT / 2;
      const diag = Math.hypot(LOGICAL_WIDTH, LOGICAL_HEIGHT) / 2;
      const vignette = ctx2d.createRadialGradient(cx, cy, diag * 0.35, cx, cy, diag * 1.05);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.42)");
      ctx2d.fillStyle = vignette;
      ctx2d.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

      const trailRgb = parseTrailColorRgba(palette.trailColor);
      ctx2d.lineCap = "round";
      ctx2d.lineJoin = "round";

      for (let ai = 0; ai < agents.length; ai++) {
        const ring = trails[ai]!;
        if (ring.count < 2) continue;

        const chronological: { x: number; y: number }[] = [];
        if (ring.count < TRAIL_CAP) {
          for (let i = 0; i <= ring.head; i++) {
            chronological.push({ x: ring.xs[i]!, y: ring.ys[i]! });
          }
        } else {
          for (let i = 0; i < TRAIL_CAP; i++) {
            const idx = (ring.head + 1 + i) % TRAIL_CAP;
            chronological.push({ x: ring.xs[idx]!, y: ring.ys[idx]! });
          }
        }

        for (let s = 1; s < chronological.length; s++) {
          const segAge = s - 1;
          const maxSeg = chronological.length - 2;
          const ageT = maxSeg <= 0 ? 1 : segAge / maxSeg;
          const alpha = trailRgb.baseA * (0.12 + 0.88 * ageT);
          ctx2d.strokeStyle = `rgba(${trailRgb.r},${trailRgb.g},${trailRgb.b},${alpha})`;
          ctx2d.lineWidth = 1.25;
          ctx2d.beginPath();
          const p0 = chronological[s - 1]!;
          const p1 = chronological[s]!;
          ctx2d.moveTo(p0.x, p0.y);
          ctx2d.lineTo(p1.x, p1.y);
          ctx2d.stroke();
        }
      }

      const tipLen = 4;
      const baseBack = -2;
      const halfW = 2.5;

      for (const a of agents) {
        const speed = Math.hypot(a.vx, a.vy);
        const ux = speed > 1e-6 ? a.vx / speed : 1;
        const uy = speed > 1e-6 ? a.vy / speed : 0;
        ctx2d.save();
        ctx2d.translate(a.x, a.y);
        ctx2d.rotate(Math.atan2(uy, ux));
        ctx2d.beginPath();
        ctx2d.moveTo(tipLen, 0);
        ctx2d.lineTo(baseBack, -halfW);
        ctx2d.lineTo(baseBack, halfW);
        ctx2d.closePath();
        ctx2d.fillStyle = palette.agentColor;
        ctx2d.shadowColor = palette.agentGlow;
        ctx2d.shadowBlur = 6;
        ctx2d.fill();
        ctx2d.restore();
      }

      const { highlightClusterId: hid, frozenClusters: fc } =
        highlightPropsRef.current;

      const deadline = highlightDeadlineRef.current;
      const highlightExpired =
        hid !== null && deadline !== null && performance.now() > deadline;

      if (hid !== null && fc !== null && !highlightExpired) {
        const cluster = fc.find((c) => c.id === hid);
        if (cluster && cluster.agentIds.length > 0) {
          const byId = new Map<number, Agent>();
          for (const ag of agents) byId.set(ag.id, ag);

          const hullPts: { x: number; y: number }[] = [];
          for (const id of cluster.agentIds) {
            const ag = byId.get(id);
            if (ag) hullPts.push({ x: ag.x, y: ag.y });
          }

          const pulse =
            0.7 + 0.3 * Math.sin((now / HIGHLIGHT_PULSE_MS) * Math.PI * 2);

          if (hullPts.length >= 3) {
            const hull = convexHull(hullPts);
            ctx2d.save();
            ctx2d.shadowBlur = (hull.length >= 3 ? 18 : 14) * pulse;
            ctx2d.shadowColor = palette.highlightGlow;
            ctx2d.strokeStyle = palette.highlightStroke;
            ctx2d.lineWidth = 2;
            ctx2d.globalAlpha = pulse;
            if (hull.length >= 3) {
              ctx2d.beginPath();
              ctx2d.moveTo(hull[0]!.x, hull[0]!.y);
              for (let i = 1; i < hull.length; i++) {
                ctx2d.lineTo(hull[i]!.x, hull[i]!.y);
              }
              ctx2d.closePath();
              ctx2d.stroke();
            } else if (hull.length === 2) {
              ctx2d.beginPath();
              ctx2d.moveTo(hull[0]!.x, hull[0]!.y);
              ctx2d.lineTo(hull[1]!.x, hull[1]!.y);
              ctx2d.stroke();
            }
            ctx2d.restore();
          } else if (hullPts.length === 2) {
            ctx2d.save();
            ctx2d.shadowBlur = 14 * pulse;
            ctx2d.shadowColor = palette.highlightGlow;
            ctx2d.strokeStyle = palette.highlightStroke;
            ctx2d.lineWidth = 2;
            ctx2d.globalAlpha = pulse;
            ctx2d.beginPath();
            ctx2d.moveTo(hullPts[0]!.x, hullPts[0]!.y);
            ctx2d.lineTo(hullPts[1]!.x, hullPts[1]!.y);
            ctx2d.stroke();
            ctx2d.restore();
          }
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      trails.length = 0;
    };
  }, [agentsRef]);

  return (
    <div ref={wrapRef} className="sim-canvas-root inline-block rounded-sm">
      <canvas ref={canvasRef} className="block max-w-full h-auto" aria-hidden />
    </div>
  );
}

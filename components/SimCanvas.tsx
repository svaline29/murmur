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

/** Grid line spacing — spec §4.6 */
const GRID_STEP = 50;

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
    gridColor: parseCssColor(cs.getPropertyValue("--grid-color"), "rgba(255,255,255,0.05)"),
  };
}

/**
 * Monotone chain (Andrew's algorithm) convex hull — spec: no external lib.
 * Returns CCW vertices without duplicate closing point.
 */
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

function parseGridColorRgb(color: string): { r: number; g: number; b: number; baseA: number } {
  return parseTrailColorRgba(color.replace(/\s+/g, " "));
}

/** Smoothstep for alpha easing — trails and grid falloff */
function smoothstep01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Rebuild static grid (5% base opacity, fades toward edges) — invalidates on resize / palette */
function createGridCache(palette: CanvasPalette): HTMLCanvasElement {
  const g = document.createElement("canvas");
  g.width = LOGICAL_WIDTH;
  g.height = LOGICAL_HEIGHT;
  const gctx = g.getContext("2d");
  if (!gctx) return g;

  const { r, g: gch, b, baseA } = parseGridColorRgb(palette.gridColor);
  const W = LOGICAL_WIDTH;
  const H = LOGICAL_HEIGHT;
  const minDim = Math.min(W, H);
  const edgeScale = 1 / (minDim * 0.16);

  gctx.lineWidth = 1;
  gctx.lineCap = "square";

  for (let x = 0; x <= W; x += GRID_STEP) {
    for (let y = 0; y < H; y += GRID_STEP) {
      const my = y + GRID_STEP * 0.5;
      const dEdge = Math.min(x, my, W - x, H - my);
      const falloff = smoothstep01(dEdge * edgeScale);
      const a = baseA * (0.08 + 0.92 * falloff * falloff);
      gctx.strokeStyle = `rgba(${r},${gch},${b},${a})`;
      gctx.beginPath();
      gctx.moveTo(x, y);
      gctx.lineTo(x, y + GRID_STEP);
      gctx.stroke();
    }
  }

  for (let y = 0; y <= H; y += GRID_STEP) {
    for (let x = 0; x < W; x += GRID_STEP) {
      const mx = x + GRID_STEP * 0.5;
      const dEdge = Math.min(mx, y, W - mx, H - y);
      const falloff = smoothstep01(dEdge * edgeScale);
      const a = baseA * (0.08 + 0.92 * falloff * falloff);
      gctx.strokeStyle = `rgba(${r},${gch},${b},${a})`;
      gctx.beginPath();
      gctx.moveTo(x, y);
      gctx.lineTo(x + GRID_STEP, y);
      gctx.stroke();
    }
  }

  return g;
}

function createVignetteCache(): HTMLCanvasElement {
  const v = document.createElement("canvas");
  v.width = LOGICAL_WIDTH;
  v.height = LOGICAL_HEIGHT;
  const vctx = v.getContext("2d");
  if (!vctx) return v;

  const cx = LOGICAL_WIDTH / 2;
  const cy = LOGICAL_HEIGHT / 2;
  const diag = Math.hypot(LOGICAL_WIDTH, LOGICAL_HEIGHT) / 2;
  const vignette = vctx.createRadialGradient(
    cx,
    cy,
    diag * 0.42,
    cx,
    cy,
    diag * 1.02,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.09)");
  vctx.fillStyle = vignette;
  vctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  return v;
}

function createAgentGlowCache(palette: CanvasPalette): HTMLCanvasElement {
  const size = 18;
  const center = size / 2;
  const g = document.createElement("canvas");
  g.width = size;
  g.height = size;
  const gctx = g.getContext("2d");
  if (!gctx) return g;

  const glowRgb = parseTrailColorRgba(palette.agentGlow);
  const glow = gctx.createRadialGradient(center, center, 0, center, center, 7);
  glow.addColorStop(0, `rgba(${glowRgb.r},${glowRgb.g},${glowRgb.b},${glowRgb.baseA * 0.55})`);
  glow.addColorStop(0.45, `rgba(${glowRgb.r},${glowRgb.g},${glowRgb.b},${glowRgb.baseA * 0.22})`);
  glow.addColorStop(1, `rgba(${glowRgb.r},${glowRgb.g},${glowRgb.b},0)`);
  gctx.fillStyle = glow;
  gctx.fillRect(0, 0, size, size);
  return g;
}

function trailRingIndex(ring: TrailRing, logicalIndex: number): number {
  if (ring.count < TRAIL_CAP) {
    return logicalIndex;
  }
  return (ring.head + 1 + logicalIndex) % TRAIL_CAP;
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
  useEffect(() => {
    highlightPropsRef.current = { highlightClusterId, frozenClusters };
  }, [highlightClusterId, frozenClusters]);

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

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const ctx2d = ctx;
    ctx2d.imageSmoothingEnabled = false;

    paletteRef.current = readPalette(wrap);

    const trails: TrailRing[] = [];

    function syncTrailCount(agentCount: number): void {
      while (trails.length < agentCount) trails.push(createTrailRing());
      while (trails.length > agentCount) trails.pop();
    }

    const canvasEl = canvas;
    const wrapEl = wrap;

    let gridCache: HTMLCanvasElement | null = null;
    let vignetteCache: HTMLCanvasElement | null = null;
    let agentGlowCache: HTMLCanvasElement | null = null;

    function resizeCanvas(): void {
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      canvasEl.width = Math.round(LOGICAL_WIDTH * dpr);
      canvasEl.height = Math.round(LOGICAL_HEIGHT * dpr);
      canvasEl.style.width = `${LOGICAL_WIDTH}px`;
      canvasEl.style.height = `${LOGICAL_HEIGHT}px`;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      paletteRef.current = readPalette(wrapEl);
      gridCache = createGridCache(paletteRef.current);
      vignetteCache = createVignetteCache();
      agentGlowCache = createAgentGlowCache(paletteRef.current);
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

      if (gridCache) {
        ctx2d.drawImage(gridCache, 0, 0);
      }

      const trailRgb = parseTrailColorRgba(palette.trailColor);
      ctx2d.lineCap = "round";
      ctx2d.lineJoin = "round";
      ctx2d.shadowBlur = 0;
      ctx2d.shadowColor = "transparent";

      for (let ai = 0; ai < agents.length; ai++) {
        const ring = trails[ai]!;
        const segCount = ring.count - 1;
        if (segCount < 1) continue;

        const maxSeg = segCount - 1;
        for (let s = 1; s < ring.count; s++) {
          const i0 = trailRingIndex(ring, s - 1);
          const i1 = trailRingIndex(ring, s);
          const segAge = s - 1;
          const ageT = maxSeg <= 0 ? 1 : segAge / maxSeg;
          const curved = smoothstep01(ageT);
          const alphaCurve = Math.pow(curved, 1.35);
          const alpha = trailRgb.baseA * (0.06 + 0.94 * alphaCurve);
          ctx2d.strokeStyle = `rgba(${trailRgb.r},${trailRgb.g},${trailRgb.b},${alpha})`;
          ctx2d.lineWidth = 1.25;
          ctx2d.beginPath();
          ctx2d.moveTo(ring.xs[i0]!, ring.ys[i0]!);
          ctx2d.lineTo(ring.xs[i1]!, ring.ys[i1]!);
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
        const rx = Math.round(a.x * 2) / 2;
        const ry = Math.round(a.y * 2) / 2;
        const rot = Math.atan2(uy, ux);

        ctx2d.save();
        if (agentGlowCache) {
          ctx2d.drawImage(agentGlowCache, rx - 9, ry - 9);
        }

        ctx2d.translate(rx, ry);
        ctx2d.rotate(rot);
        ctx2d.beginPath();
        ctx2d.moveTo(tipLen, 0);
        ctx2d.lineTo(baseBack, -halfW);
        ctx2d.lineTo(baseBack, halfW);
        ctx2d.closePath();
        ctx2d.fillStyle = palette.agentColor;
        ctx2d.fill();

        ctx2d.restore();
      }

      const { highlightClusterId: hid, frozenClusters: fc } =
        highlightPropsRef.current;

      const deadline = highlightDeadlineRef.current;
      const highlightExpired =
        hid !== null && deadline !== null && now > deadline;

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

          const phase = (now / HIGHLIGHT_PULSE_MS) * Math.PI * 2;
          const pulseOpacity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(phase));
          const glowPx = 8 + 4 * (0.5 + 0.5 * Math.sin(phase + 0.4));

          if (hullPts.length >= 3) {
            const hull = convexHull(hullPts);
            ctx2d.save();
            ctx2d.shadowBlur = glowPx;
            ctx2d.shadowColor = palette.highlightGlow;
            ctx2d.strokeStyle = palette.highlightStroke;
            ctx2d.lineWidth = 2;
            ctx2d.globalAlpha = pulseOpacity;
            ctx2d.beginPath();
            ctx2d.moveTo(hull[0]!.x, hull[0]!.y);
            for (let i = 1; i < hull.length; i++) {
              ctx2d.lineTo(hull[i]!.x, hull[i]!.y);
            }
            if (hull.length >= 3) ctx2d.closePath();
            ctx2d.stroke();
            ctx2d.restore();
          } else if (hullPts.length === 2) {
            ctx2d.save();
            ctx2d.shadowBlur = glowPx;
            ctx2d.shadowColor = palette.highlightGlow;
            ctx2d.strokeStyle = palette.highlightStroke;
            ctx2d.lineWidth = 2;
            ctx2d.globalAlpha = pulseOpacity;
            ctx2d.beginPath();
            ctx2d.moveTo(hullPts[0]!.x, hullPts[0]!.y);
            ctx2d.lineTo(hullPts[1]!.x, hullPts[1]!.y);
            ctx2d.stroke();
            ctx2d.restore();
          }
        }
      }

      if (vignetteCache) {
        ctx2d.drawImage(vignetteCache, 0, 0);
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      trails.length = 0;
      gridCache = null;
      vignetteCache = null;
      agentGlowCache = null;
    };
  }, [agentsRef]);

  return (
    <div ref={wrapRef} className="sim-canvas-root inline-block rounded-sm">
      <canvas ref={canvasRef} className="block max-w-full h-auto" aria-hidden />
    </div>
  );
}

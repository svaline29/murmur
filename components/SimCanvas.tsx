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

/** Highlight pulse period — spec §4.6 / §5.5 */
const HIGHLIGHT_PULSE_MS = 1200;
/** Spec §4.6 — highlight duration before visual expiry */
const HIGHLIGHT_DURATION_MS = 8000;

/** Grid line spacing — spec §4.6 */
const GRID_STEP = 50;
const AGENT_GLOW_SIZE = 16;

interface CanvasPalette {
  bgCanvas: string;
  agentColor: string;
  agentGlow: string;
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
    gridColor: parseCssColor(cs.getPropertyValue("--grid-color"), "rgba(255,255,255,0.05)"),
  };
}

function parseCssRgba(color: string): { r: number; g: number; b: number; baseA: number } {
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
  return parseCssRgba(color.replace(/\s+/g, " "));
}

/** Smoothstep for alpha easing and grid falloff */
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
  const size = AGENT_GLOW_SIZE;
  const center = size / 2;
  const g = document.createElement("canvas");
  g.width = size;
  g.height = size;
  const gctx = g.getContext("2d");
  if (!gctx) return g;

  const glowRgb = parseCssRgba(palette.agentGlow);
  const glow = gctx.createRadialGradient(center, center, 0, center, center, 6);
  glow.addColorStop(0, `rgba(${glowRgb.r},${glowRgb.g},${glowRgb.b},${glowRgb.baseA * 0.46})`);
  glow.addColorStop(0.45, `rgba(${glowRgb.r},${glowRgb.g},${glowRgb.b},${glowRgb.baseA * 0.16})`);
  glow.addColorStop(1, `rgba(${glowRgb.r},${glowRgb.g},${glowRgb.b},0)`);
  gctx.fillStyle = glow;
  gctx.fillRect(0, 0, size, size);
  return g;
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
    ctx2d.imageSmoothingEnabled = true;
    ctx2d.lineCap = "round";
    ctx2d.lineJoin = "round";

    paletteRef.current = readPalette(wrap);

    const canvasEl = canvas;
    const wrapEl = wrap;

    let gridCache: HTMLCanvasElement | null = null;
    let vignetteCache: HTMLCanvasElement | null = null;
    let agentGlowCache: HTMLCanvasElement | null = null;

    function resizeCanvas(): void {
      const dpr = window.devicePixelRatio || 1;
      canvasEl.style.width = `${LOGICAL_WIDTH}px`;
      canvasEl.style.height = "auto";
      const cssWidth = canvasEl.clientWidth || LOGICAL_WIDTH;
      const cssHeight = canvasEl.clientHeight || LOGICAL_HEIGHT;
      canvasEl.width = Math.round(cssWidth * dpr);
      canvasEl.height = Math.round(cssHeight * dpr);
      canvasEl.style.width = `${cssWidth}px`;
      canvasEl.style.height = `${cssHeight}px`;
      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      ctx2d.scale((cssWidth / LOGICAL_WIDTH) * dpr, (cssHeight / LOGICAL_HEIGHT) * dpr);
      ctx2d.imageSmoothingEnabled = true;
      ctx2d.lineCap = "round";
      ctx2d.lineJoin = "round";
      paletteRef.current = readPalette(wrapEl);
      gridCache = createGridCache(paletteRef.current);
      vignetteCache = createVignetteCache();
      agentGlowCache = createAgentGlowCache(paletteRef.current);
      ctx2d.fillStyle = paletteRef.current.bgCanvas;
      ctx2d.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    }

    resizeCanvas();

    const ro = new ResizeObserver(() => {
      resizeCanvas();
    });
    ro.observe(wrapEl);
    window.addEventListener("resize", resizeCanvas);

    let rafId = 0;

    const loop = (now: DOMHighResTimeStamp): void => {
      const palette = paletteRef.current ?? readPalette(wrapEl);
      const agents = agentsRef.current;

      ctx2d.fillStyle = "rgba(5, 5, 5, 0.22)";
      ctx2d.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

      if (gridCache) {
        ctx2d.drawImage(gridCache, 0, 0);
      }

      ctx2d.lineCap = "round";
      ctx2d.lineJoin = "round";
      ctx2d.shadowBlur = 0;
      ctx2d.shadowColor = "transparent";

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

          let sx = 0;
          let sy = 0;
          let count = 0;
          for (const id of cluster.agentIds) {
            const ag = byId.get(id);
            if (!ag) continue;
            sx += ag.x;
            sy += ag.y;
            count++;
          }

          if (count > 0) {
            const cx = sx / count;
            const cy = sy / count;
            let radius = 20;
            for (const id of cluster.agentIds) {
              const ag = byId.get(id);
              if (!ag) continue;
              radius = Math.max(radius, Math.hypot(ag.x - cx, ag.y - cy) + 20);
            }

            const phase = (now / HIGHLIGHT_PULSE_MS) * Math.PI * 2;
            const innerAlpha = 0.25 + 0.1 * Math.sin(phase);
            const gradient = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, radius);
            gradient.addColorStop(0, `rgba(124, 248, 255, ${innerAlpha})`);
            gradient.addColorStop(0.6, "rgba(124, 248, 255, 0.08)");
            gradient.addColorStop(1, "rgba(124, 248, 255, 0)");

            ctx2d.save();
            ctx2d.fillStyle = gradient;
            ctx2d.beginPath();
            ctx2d.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx2d.fill();
            ctx2d.restore();
          }
        }
      }

      const tipLen = 4.5;
      const baseBack = -2.5;
      const halfW = 3;

      ctx2d.fillStyle = palette.agentColor;

      for (const a of agents) {
        const rot = Math.atan2(a.vy, a.vx);

        ctx2d.save();
        if (agentGlowCache) {
          ctx2d.drawImage(
            agentGlowCache,
            a.x - AGENT_GLOW_SIZE / 2,
            a.y - AGENT_GLOW_SIZE / 2,
          );
        }

        ctx2d.translate(a.x, a.y);
        ctx2d.rotate(rot);
        ctx2d.beginPath();
        ctx2d.moveTo(tipLen, 0);
        ctx2d.lineTo(baseBack, -halfW);
        ctx2d.lineTo(baseBack, halfW);
        ctx2d.closePath();
        ctx2d.fill();

        ctx2d.restore();
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
      window.removeEventListener("resize", resizeCanvas);
      gridCache = null;
      vignetteCache = null;
      agentGlowCache = null;
    };
  }, [agentsRef]);

  return (
    <div ref={wrapRef} className="sim-canvas-root inline-block rounded-sm">
      <canvas
        ref={canvasRef}
        width={LOGICAL_WIDTH}
        height={LOGICAL_HEIGHT}
        className="block max-w-full h-auto"
        aria-hidden
      />
    </div>
  );
}

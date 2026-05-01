"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_RULES, initAgents, tick } from "@/lib/simulation";

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;
const AGENT_COUNT = 200;

const rules = { ...DEFAULT_RULES };

export default function TestSimPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsRef = useRef(initAgents(AGENT_COUNT, CANVAS_WIDTH, CANVAS_HEIGHT));
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const agents = agentsRef.current;

    const loop = () => {
      tick(agents, rules, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#7dd3fc";
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        ctx.beginPath();
        ctx.arc(a.x, a.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      frameRef.current = requestAnimationFrame(loop);
    };

    frameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-900 p-4">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="max-w-full rounded border border-zinc-700"
      />
    </div>
  );
}

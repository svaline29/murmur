"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";

import type { ChatMessage } from "@/lib/types";

const PRESETS = [
  "What's happening right now?",
  "Why did that just happen?",
  "Make them more chaotic",
  "Form one tight flock",
] as const;

export type ChatPanelProps = {
  history: ChatMessage[];
  onSendMessage: (message: string) => void;
  isPending: boolean;
};

export function ChatPanel({
  history,
  onSendMessage,
  isPending,
}: ChatPanelProps): ReactElement {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history, isPending]);

  function submit(): void {
    const t = draft.trim();
    if (!t || isPending) return;
    onSendMessage(t);
    setDraft("");
  }

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    submit();
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-page)]"
      style={{ color: "var(--text-primary)" }}
    >
      <header className="shrink-0 border-b border-[var(--border-subtle)] px-5 py-4">
        <h1
          className="text-2xl font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-brand-display), system-ui, sans-serif" }}
        >
          Murmur.
        </h1>
        <p className="mt-0.5 text-[11px] font-mono tracking-[0.06em] text-[var(--text-secondary)]">
          swarm observer
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-sans text-[15px] leading-[1.5]">
        <div className="flex flex-col gap-3">
          {history.map((m, i) =>
            m.role === "user" ? (
              <div key={`${m.timestamp}-u-${i}`} className="flex justify-end">
                <div
                  className="max-w-[92%] rounded-lg px-3 py-2"
                  style={{ background: "var(--accent-soft)" }}
                >
                  <p className="text-[var(--text-primary)]">{m.content}</p>
                </div>
              </div>
            ) : (
              <div key={`${m.timestamp}-a-${i}`} className="flex justify-start">
                <div className="max-w-[92%] px-1 py-1">
                  <p className="leading-relaxed text-[var(--text-primary)]">{m.content}</p>
                </div>
              </div>
            )
          )}

          {isPending ? (
            <div className="flex justify-start px-1">
              <div
                className="inline-flex items-center gap-2 text-[var(--text-secondary)]"
                aria-live="polite"
              >
                <span className="font-sans text-[15px]">Thinking</span>
                <span className="inline-flex h-4 items-end gap-0.5 pb-0.5" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="block h-1 w-1 rounded-full bg-[var(--accent)]"
                      style={{
                        animation: "murmur-dot-bounce 1.2s ease-in-out infinite",
                        animationDelay: `${i * 0.15}s`,
                      }}
                    />
                  ))}
                </span>
              </div>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--border-subtle)] px-3 pb-3 pt-2">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {PRESETS.map((label) => (
            <button
              key={label}
              type="button"
              disabled={isPending}
              onClick={() => onSendMessage(label)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2 py-1 text-center text-[11px] leading-snug text-[var(--text-secondary)] font-mono transition-colors hover:border-[var(--accent-glow)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={isPending}
            placeholder="Message the observer…"
            className="w-full rounded-md border bg-transparent px-3 py-2.5 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-55"
            style={{
              borderColor: "var(--border-subtle)",
              ...(isPending
                ? { animation: "murmur-input-pulse 0.5s ease-in-out infinite" }
                : {}),
            }}
          />
        </form>
      </div>
    </div>
  );
}

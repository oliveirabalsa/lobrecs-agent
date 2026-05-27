import { useEffect, useState } from "react";

export interface WorkingStateProps {
  /** Epoch millis when this turn started. */
  startedAt: number;
  /** True while the underlying session is actively running. */
  running: boolean;
  /** Optional explicit duration to display once `running` is false. */
  totalMs?: number;
  /** Called when the user clicks the label (collapse/expand toggle). */
  onToggle?: () => void;
}

/**
 * Status row shown while a turn is in flight. Live runs stay as a quiet
 * one-line reasoning indicator; completed runs collapse to "Worked for Xs"
 * so historical turns stay compact.
 */
export function WorkingState({
  startedAt,
  running,
  totalMs,
  onToggle,
}: WorkingStateProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(tick);
  }, [running]);

  const elapsedMs = running
    ? Math.max(0, now - startedAt)
    : (totalMs ?? Math.max(0, now - startedAt));
  const duration = formatDuration(elapsedMs);

  if (running) {
    return <AgentRunIndicator duration={duration} />;
  }

  const label = `Worked for ${duration}`;
  if (onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="self-start rounded px-1 py-0.5 text-[12px] leading-5 text-muted transition-colors hover:text-secondary"
      >
        {label}
      </button>
    );
  }
  return <div className="px-1 py-0.5 text-[12px] leading-5 text-muted">{label}</div>;
}

interface AgentRunIndicatorProps {
  duration: string;
}

function AgentRunIndicator({ duration }: AgentRunIndicatorProps) {
  const label = "Reasoning";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${label} for ${duration}`}
      className="motion-fade-up-in inline-flex max-w-full items-center gap-2 self-start px-1 py-0.5 text-[12px] leading-5 text-muted"
    >
      <span
        aria-hidden="true"
        className="h-3 w-3 shrink-0 animate-spin rounded-full border border-current border-r-transparent text-secondary/70 motion-reduce:animate-none"
      />
      <span className="truncate font-medium text-secondary">{label}</span>
      <span aria-hidden="true" className="text-muted/60">
        ·
      </span>
      <span className="tabular-nums text-muted">{duration}</span>
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

import { useEffect, useState } from "react";
import { Square } from "lucide-react";
import { Button } from "@interprete/ui/components/button";

export const formatOnboardingTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// The recording control: live dot, microphone waveform, elapsed time, stop.
export function OnboardingRecorder({
  levels,
  startedAt,
  onStop,
}: {
  levels: number[];
  startedAt: number;
  onStop: () => void;
}) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, []);
  return (
    // In a narrow window the waveform gives up width first, so Stop stays on screen.
    <div className="flex h-19 max-w-full animate-in items-center gap-7 rounded-full border border-input bg-card pr-6 pl-9 duration-240 fade-in slide-in-from-bottom-1.5 max-[860px]:gap-4 max-[860px]:pr-3 max-[860px]:pl-5">
      <span className="size-4.5 shrink-0 animate-pulse rounded-full bg-brand" aria-hidden="true" />
      <span className="flex h-11 min-w-0 items-center gap-1.5 overflow-hidden" aria-hidden="true">
        {levels.map((level, i) => (
          <span
            key={i}
            className="h-full w-0.75 shrink-0 rounded-xs bg-current transition-transform duration-75 ease-linear"
            style={{ transform: `scaleY(${0.15 + level * 0.85})` }}
          />
        ))}
      </span>
      <time className="min-w-13 shrink-0 font-mono text-[22px] tabular-nums">
        {formatOnboardingTime(Math.max(0, now - startedAt) / 1000)}
      </time>
      <span className="h-13 shrink-0 border-l border-input pl-3">
        <Button
          type="button"
          variant="ghost"
          className="h-13 w-13 text-brand hover:text-brand [&_svg:not([class*='size-'])]:size-4.5"
          onClick={onStop}
          aria-label="Stop recording"
          title="Stop"
        >
          <Square fill="currentColor" aria-hidden="true" />
        </Button>
      </span>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Square } from "lucide-react";

export const formatOnboardingTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// The dark recording control: live dot, microphone waveform, elapsed time, stop.
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
    <div className="onboarding-recorder">
      <span className="onboarding-recorder-dot" aria-hidden="true" />
      <span className="onboarding-recorder-wave" aria-hidden="true">
        {levels.map((level, i) => (
          <span key={i} style={{ transform: `scaleY(${0.15 + level * 0.85})` }} />
        ))}
      </span>
      <time className="onboarding-recorder-time">
        {formatOnboardingTime(Math.max(0, now - startedAt) / 1000)}
      </time>
      <button type="button" onClick={onStop} aria-label="Stop recording" title="Stop">
        <Square size={18} fill="currentColor" aria-hidden="true" />
      </button>
    </div>
  );
}

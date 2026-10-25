import { LoaderCircle } from "lucide-react";

export function LiveStatus({
  phase,
  ready,
  spinning,
  label,
}: {
  phase: string;
  ready: boolean;
  spinning: boolean;
  label: string;
}) {
  return (
    <div className="status" data-phase={phase} data-ready={ready} role="status">
      {spinning ? (
        <LoaderCircle size={13} className="spin" aria-hidden="true" />
      ) : (
        <span className="status-dot" aria-hidden="true" />
      )}
      <span className="status-text">{label}</span>
    </div>
  );
}

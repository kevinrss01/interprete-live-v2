import { ArrowLeftRight, CircleAlert, Mic, MicOff, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import type { Phase } from "@interprete/shared/contracts";
import { Button } from "@interprete/ui/components/button";
import {
  microphoneActive,
  microphoneHelp,
  microphoneHelpVisible,
  microphoneLabel,
  stopControlLabel,
} from "../lib/live-status";
import { LiveStatus } from "./live-status";

export function ConversationDock({
  dockRef,
  hidden,
  error,
  warning,
  onDismiss,
  phase,
  input,
  busy,
  ready,
  statusLabel,
  onStop,
  onSwap,
  speakerA,
  speakerB,
}: {
  dockRef: RefObject<HTMLDivElement | null>;
  hidden: boolean;
  error: string | null;
  warning: string | null;
  onDismiss: () => void;
  phase: Phase;
  input: "microphone" | "demo" | null;
  busy: boolean;
  ready: boolean;
  statusLabel: string;
  onStop: () => void;
  onSwap: () => void;
  speakerA: ReactNode;
  speakerB: ReactNode;
}) {
  const micOn = microphoneActive(phase, input);
  const help = microphoneHelp(phase, input);
  const showHelp = microphoneHelpVisible(phase, input);
  return (
    <div className="dock" ref={dockRef} hidden={hidden}>
      {(error || warning) && (
        <div className="frame dock-notice">
          <div className="alert" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <span>{error || warning}</span>
            <Button
              variant="ghost"
              className="icon-btn alert-dismiss"
              onClick={onDismiss}
              aria-label="Dismiss message"
            >
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
      <div className="frame">
        <div className="dock-grid">
          {speakerA}
          <div className="dock-center">
            {busy ? (
              <Button
                variant="ghost"
                className="icon-btn round"
                onClick={onStop}
                aria-label={stopControlLabel(phase)}
                title="Stop (Esc)"
              >
                <X size={18} aria-hidden="true" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="icon-btn round"
                onClick={onSwap}
                aria-label="Swap languages"
                title="Swap languages"
              >
                <ArrowLeftRight size={16} aria-hidden="true" />
              </Button>
            )}
          </div>
          {speakerB}
        </div>
        <div className="live-controls">
          <LiveStatus
            phase={phase}
            ready={ready}
            spinning={busy && phase !== "listening"}
            label={statusLabel}
          />
          <span className="live-controls-sep" aria-hidden="true">
            ·
          </span>
          <span className="microphone-status" data-active={micOn}>
            {micOn ? <Mic size={14} aria-hidden="true" /> : <MicOff size={14} aria-hidden="true" />}
            {microphoneLabel(phase, input)}
          </span>
          <span id="microphone-help" className={showHelp ? "live-controls-help" : "sr-only"}>
            {help}
          </span>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRight, Check, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@interprete/ui/components/button";
import { MacSetupMonitor, missingSetup, noteSystemAudio, resetSystemAudioEvidence, saveSetupDecision, systemAudioEvidence, type SetupAction, type SetupState } from "../lib/mac-setup";

function SetupRow({ title, detail, state, ready, action, children }: { title: string; detail: string; state: string; ready: boolean; action?: ReactNode; children?: ReactNode }) {
  return <li className="mac-setup-row">
    <span className="mac-setup-mark" data-ready={ready} aria-hidden="true">{ready ? <Check size={17} /> : <span />}</span>
    <div className="mac-setup-description"><h2>{title}</h2><p>{detail}</p>{children}</div>
    <div className="mac-setup-action"><span className="mac-setup-state" role="status">{state}</span>{action}</div>
  </li>;
}

// Also exported for synthetic UI verification: no permission requests or I/O on render.
export function MacSetupView({ state, audio, onAction, onConfirmAudio, onRefresh, onContinue, onLater }: {
  state: SetupState;
  audio: ReturnType<typeof systemAudioEvidence>;
  onAction: (action: SetupAction) => void;
  onConfirmAudio: () => void;
  onRefresh: () => void;
  onContinue: () => void;
  onLater: () => void;
}) {
  const status = state.status;
  const busy = !!state.pending;
  const ready = !!status && missingSetup(status, audio).length === 0;
  const audioRequested = state.audioRequested;
  const action = (id: SetupAction, label: string) => <Button variant="outline" disabled={busy || !status} onClick={() => onAction(id)}>
    {state.pending === id && <LoaderCircle size={14} className="spin" aria-hidden="true" />}{label}
  </Button>;
  return <section className="mac-setup" aria-labelledby="mac-setup-title">
    <div className="mac-setup-intro"><h1 id="mac-setup-title" tabIndex={-1}>Get your Mac ready.</h1><p>Set up once, then translate your calls.</p></div>
    {status && !status.supported ? <p role="alert" className="call-error">Meeting translation needs macOS 14.2 or later. You can still use conversation mode.</p> : <ol className="mac-setup-list" aria-label="Mac setup requirements">
      <SetupRow title="Your microphone" detail="Translate what you say and set up your voice." ready={status?.microphone === "granted"}
        state={!status ? "Checking…" : status.microphone === "granted" ? "Allowed" : status.microphone === "restricted" ? "Restricted on this Mac" : status.microphone === "denied" ? "Access denied" : "Permission needed"}
        action={status?.microphone === "granted" ? undefined : action(status?.microphone === "not-determined" ? "microphone" : "microphone-settings", status?.microphone === "not-determined" ? "Allow microphone" : "Open Settings")} />
      <SetupRow title="Call audio" detail="Hear the other participants in your language and show their captions." ready={!!audio}
        state={audio === "verified" ? "Audio verified" : audio === "confirmed" ? "Confirmed by you" : "Permission needed"}
        action={audio ? action("audio-settings", "Review access") : action("audio", "Allow call audio")}>
        {!audio && audioRequested && <div className="mac-setup-help"><p>Choose Allow in the macOS prompt. If it did not appear, enable Interprète in System Settings → Privacy & Security → Screen & System Audio Recording.</p>
          <div>{action("audio-settings", "Open Settings")}<Button variant="ghost" disabled={busy} onClick={onConfirmAudio}>I’ve enabled audio recording</Button></div></div>}
      </SetupRow>
      <SetupRow title="Follow Meet’s mute button" detail="Pause your outgoing translation when you mute yourself in Meet." ready={status?.accessibility ?? false}
        state={!status ? "Checking…" : status.accessibility ? "Allowed" : "Accessibility needed"}
        action={status?.accessibility ? undefined : action("accessibility", "Open Settings")}>
        {status && !status.accessibility && <div className="mac-setup-help">
          <p>{status.bundled
            ? "Enable this copy of Interprete in Privacy & Security → Accessibility. If it is already enabled, remove it from the list and add this copy again, then check again."
            : "This local build needs its own Accessibility permission. The installed Interprete app has a separate permission. Show the running app, then drag the selected interprete file into the Accessibility list and enable it. After a rebuild, you may need to remove and add it again."}</p>
          {action("reveal-accessibility-app", "Show running app")}
        </div>}
      </SetupRow>
      <SetupRow title="Virtual microphone" detail="Send your translated voice to Meet, Zoom or Teams." ready={status?.virtualMicrophone && status.driverReady || false}
        state={!status ? "Checking…" : status.virtualMicrophone && status.driverReady ? "Ready" : status.driverInstalled && !status.driverReady ? "Restart required" : status.driverReady ? "Ready to configure" : "Installation needed"}
        action={!status || (status.virtualMicrophone && status.driverReady) || (status.driverInstalled && !status.driverReady) ? undefined : status.driverReady ? action("virtual-microphone", "Configure microphone") : action("install-driver", "Install BlackHole 2ch")}>
        {status?.driverInstalled && !status.driverReady ? <p className="mac-setup-help">Restart your Mac, then reopen Interprète to finish. Your progress is saved.</p> : !status?.driverReady && state.lastAction === "install-driver" ? <p className="mac-setup-help">Finish in macOS Installer. Your Mac may ask for an administrator password and a restart. Return here afterwards.</p> : null}
        {!status?.driverInstalled && <p className="mac-setup-help">The free BlackHole 2ch driver will be downloaded from its publisher and opened in macOS Installer.</p>}
      </SetupRow>
    </ol>}
    {state.error && <p className="call-error" role="alert">{state.error}</p>}
    <div className="mac-setup-footer">
      <div><Button variant="brand" disabled={!ready || busy} onClick={onContinue}>Continue<ArrowRight size={16} aria-hidden="true" /></Button>
        <Button variant="ghost" disabled={busy} onClick={onRefresh}><RefreshCw size={14} className={state.checking ? "spin" : undefined} aria-hidden="true" />Check again</Button></div>
      <Button variant="link" onClick={onLater}>Set up meetings later</Button>
    </div>
    <p className="mac-setup-note">Use your headphones as the call speaker and System / Default as its microphone. You stay in control: setup does not record a conversation.</p>
  </section>;
}

export function MacSetup({ onDone }: { onDone: () => void }) {
  const [monitor] = useState(() => new MacSetupMonitor());
  const state = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot, monitor.getServerSnapshot);
  const [audio, setAudio] = useState(systemAudioEvidence);
  const title = useRef(false);
  useEffect(() => {
    monitor.start();
    if (!title.current) { document.getElementById("mac-setup-title")?.focus(); title.current = true; }
    const refresh = () => { void monitor.refresh(); setAudio(systemAudioEvidence()); };
    window.addEventListener("focus", refresh);
    return () => { monitor.stop(); window.removeEventListener("focus", refresh); };
  }, [monitor]);
  return <MacSetupView state={state} audio={audio} onAction={action => {
    if (action === "audio-settings" && audio) { resetSystemAudioEvidence(); setAudio(null); }
    void monitor.run(action);
  }} onRefresh={() => void monitor.refresh()}
    onConfirmAudio={() => { noteSystemAudio("confirmed"); setAudio(systemAudioEvidence()); }}
    onContinue={() => { if (state.status && !missingSetup(state.status, audio).length) { saveSetupDecision("ready"); onDone(); } }}
    onLater={() => { saveSetupDecision("later"); onDone(); }} />;
}

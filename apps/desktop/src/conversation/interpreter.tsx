import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeftRight,
  AudioLines,
  CircleAlert,
  History,
  LoaderCircle,
  MessagesSquare,
  Mic,
  MicOff,
  Phone,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { signOut } from "../lib/account";
import type { InterpreterController } from "../lib/interpreter";
import { clearOnboardingAccount } from "../onboarding/onboarding-account";
import { SpeakerPanel } from "./speaker-panel";
import { CallPanel, type CallPanelHandle } from "./call-panel";
import { TranslationPill } from "../windows/translation-overlay";
import {
  useTranslationOverlay,
  type OverlayUpdate,
} from "../lib/translation-overlay";
import { desktopAvailable } from "../lib/calls";
import { Conversation } from "./conversation";
import { SettingsPage } from "./settings";
import type { Profile, SpeakerId } from "@interprete/shared/contracts";
import { Button } from "@interprete/ui/components/button";
import logo from "@interprete/ui/assets/logo.png";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@interprete/ui/components/alert-dialog";

type View = "conversation" | "call" | "history" | "voices" | "settings";

const NAV: { view: View; label: string; icon: typeof Phone }[] = [
  { view: "conversation", label: "Conversation", icon: MessagesSquare },
  { view: "call", label: "Online meeting", icon: Phone },
  { view: "history", label: "History", icon: History },
  { view: "voices", label: "Voices", icon: AudioLines },
];

type PendingConfirm =
  | { kind: "clear" }
  | { kind: "remove"; id: SpeakerId };

export function Interpreter({
  controller,
  onLeave,
}: {
  controller: InterpreterController;
  onLeave: () => void;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const callPanelRef = useRef<CallPanelHandle>(null);
  const [callOverlay, setCallOverlay] = useState<OverlayUpdate | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [callBusy, setCallBusy] = useState(false);
  const [view, setView] = useState<View>("conversation");
  const callMode = view === "call";
  const mainRef = useRef<HTMLElement>(null);
  const shownView = useRef(view);
  useEffect(() => {
    // The button that changed the view unmounts; give keyboard and screen-reader users a destination.
    if (shownView.current === view) return;
    shownView.current = view;
    mainRef.current?.focus({ preventScroll: true });
  }, [view]);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const overlay: OverlayUpdate | null =
    callOverlay ??
    (state.sessionId
      ? {
          sessionId: state.sessionId,
          phase: state.phase,
          source: state.profiles[state.active].language,
          target: state.profiles[state.active === "a" ? "b" : "a"].language,
          test: state.input === "demo",
        }
      : null);
  function stopTranslation(sessionId: string) {
    if (callOverlay?.sessionId === sessionId)
      callPanelRef.current?.stop(sessionId);
    else controller.cancelSession(sessionId);
  }
  useTranslationOverlay(overlay, stopTranslation, setOverlayError);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.repeat ||
        target.closest(
          "dialog, [role='dialog'], [role='alertdialog'], [role='listbox']",
        )
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        controller.cancel();
        return;
      }
      if (
        view !== "conversation" ||
        target.closest("input,select,textarea,button,summary,a")
      )
        return;
      if ((e.key === "a" || e.key === "b") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void controller.start(e.key as SpeakerId);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [controller, view]);
  const busy = state.phase !== "idle" || callBusy;
  const demo = state.input === "demo";
  const microphoneActive = state.phase === "listening" && state.input === "microphone";
  const status = callBusy ? "Translating the call…" :
    demo && state.phase === "listening" && state.connection === "reconnecting"
      ? "Reconnecting · audio sample"
      : demo && (state.phase === "connecting" || state.phase === "listening")
        ? "Playing audio sample…"
        : state.phase === "connecting"
          ? "Connecting microphone…"
          : state.phase === "listening"
            ? state.connection === "reconnecting"
              ? "Reconnecting · mic on"
              : state.outputActive
                ? "Listening and translating…"
                : `${state.profiles[state.active].name} is speaking…`
            : state.phase === "finishing"
              ? "Finishing the turn…"
              : state.phase === "translating"
                ? "Translating…"
                : state.phase === "playing"
                  ? "Playing the translation"
                  : state.ready
                    ? "Ready"
                    : "Connecting…";
  function onTalk(id: SpeakerId) {
    if (state.phase === "connecting" && state.active === id)
      controller.cancel();
    else void controller.start(id);
  }
  function onProfile(id: SpeakerId, patch: Partial<Profile>) {
    if (typeof patch.consent === "boolean")
      void controller.setConsent(id, patch.consent);
    else controller.setProfile(id, patch);
  }
  function confirmPending() {
    if (!pending) return;
    if (pending.kind === "clear") controller.clearConversation();
    else void controller.removeVoice(pending.id);
    setPending(null);
  }
  function leave() {
    if (callOverlay?.sessionId) callPanelRef.current?.stop(callOverlay.sessionId);
    controller.cancel();
    signOut();
    clearOnboardingAccount();
    onLeave();
  }
  function openView(next: View) {
    // Leaving the conversation ends any turn in progress; the call panel stops itself when hidden.
    if (view === "conversation" || next === "call") controller.cancel();
    setView(next);
    window.scrollTo({ top: 0 });
  }
  function swap() {
    const a = state.profiles.a.language;
    controller.setProfile("a", { language: state.profiles.b.language });
    controller.setProfile("b", { language: a });
  }
  const speaker = (id: SpeakerId) => (
    <SpeakerPanel
      profile={state.profiles[id]}
      phase={state.phase}
      selected={state.active === id}
      level={state.level}
      ready={state.ready}
      demo={demo}
      onTalk={() => onTalk(id)}
      onProfile={(p) => onProfile(id, p)}
    />
  );
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Navigation">
        <img className="sidebar-logo" src={logo} alt="Interprète" />
        <nav className="sidebar-nav">
          {NAV.map(({ view: id, label, icon: Icon }) => (
            <button
              key={id}
              className="sidebar-item"
              aria-current={view === id ? "page" : undefined}
              onClick={() => openView(id)}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button
            className="sidebar-item"
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => openView("settings")}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            Settings
          </button>
        </div>
      </aside>
      <div className="app panel">
        <header
          className="topbar"
          hidden={view === "history" || view === "voices" || view === "settings" || (view === "call" && !callBusy)}
        >
          <div className="frame topbar-inner">
            <div
              className="status"
              data-phase={callBusy ? "listening" : state.phase}
              data-ready={state.ready}
              role="status"
            >
              {busy && state.phase !== "listening" ? (
                <LoaderCircle size={13} className="spin" aria-hidden="true" />
              ) : (
                <span className="status-dot" aria-hidden="true" />
              )}
              <span className="status-text">{status}</span>
            </div>
          </div>
        </header>
      {overlayError && (
        <div className="frame alert" role="alert">
          <span>{overlayError}</span>
          <Button
            variant="ghost"
            className="icon-btn"
            aria-label="Dismiss overlay message"
            onClick={() => setOverlayError(null)}
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </div>
      )}
      {!desktopAvailable() && overlay && (
        <div className="translation-overlay-browser">
          <TranslationPill
            session={overlay}
            onStop={() => {
              if (overlay.sessionId) stopTranslation(overlay.sessionId);
            }}
          />
        </div>
      )}
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="frame main"
        data-view={view}
      >
        <CallPanel
          ref={callPanelRef}
          onOverlayChange={setCallOverlay}
          onBusy={setCallBusy}
          visible={callMode}
          onOpen={() => openView("call")}
          beforeStart={() => controller.cancel()}
          profiles={state.profiles}
          onLanguage={(id, language) => controller.setProfile(id, { language })}
        />
        {view === "conversation" && (
          <Conversation
            turns={state.turns}
            profiles={state.profiles}
            onPlay={(id) => void controller.replay(id)}
            onDemo={() => void controller.start(state.active, true)}
            onClear={() => setPending({ kind: "clear" })}
            busy={busy}
          />
        )}
        {view === "settings" && (
          <SettingsPage
            profiles={state.profiles}
            busy={busy}
            decisionAvailable={!state.services || state.services.decision}
            volume={state.volume}
            onProfile={onProfile}
            onClone={(id) => void controller.clone(id)}
            onRemove={(id) => setPending({ kind: "remove", id })}
            onVolume={(value) => controller.setVolume(value)}
            onSignOut={leave}
          />
        )}
        {(view === "history" || view === "voices") && (
          <section
            className="placeholder"
            aria-label={NAV.find((n) => n.view === view)?.label}
          >
            <p className="empty-title">Coming soon</p>
          </section>
        )}
      </main>
      <div className="dock" hidden={view !== "conversation"}>
        <div className="frame">
          {(state.error || state.warning) && (
            <div className="alert" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{state.error || state.warning}</span>
              <Button
                variant="ghost"
                className="icon-btn"
                onClick={controller.dismissError}
                aria-label="Dismiss message"
              >
                <X size={16} aria-hidden="true" />
              </Button>
            </div>
          )}
          <p className="live-controls">
            <span
              className="microphone-status"
              data-active={microphoneActive}
            >
              {microphoneActive ? (
                <Mic size={14} aria-hidden="true" />
              ) : (
                <MicOff size={14} aria-hidden="true" />
              )}
              {microphoneActive
                ? "Mic on"
                : !demo && state.phase === "connecting"
                  ? "Turning on mic…"
                  : state.input === "microphone" && state.phase === "finishing"
                    ? "Turning off mic…"
                    : "Mic off"}
            </span>
            <span id="microphone-help" className="live-controls-help">
              {demo
                ? "The sample uses a recording, not your mic."
                : microphoneActive
                  ? "The translation follows your voice. Turn off the mic to finish."
                  : state.phase === "idle"
                    ? "Turn on the speaker’s mic."
                    : state.phase === "connecting"
                      ? "Allow microphone access if asked."
                      : state.phase === "playing"
                        ? "Playing the translation…"
                        : "Finishing the translation…"}
            </span>
          </p>
          <div className="dock-grid">
            {speaker("a")}
            <div className="dock-center">
              {busy ? (
                <Button
                  variant="ghost"
                  className="icon-btn round"
                  onClick={() => controller.cancel()}
                  aria-label={
                    state.phase === "listening" || state.phase === "connecting"
                      ? "Cancel turn"
                      : "Stop"
                  }
                  title="Stop (Esc)"
                >
                  <X size={18} aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="icon-btn round"
                  onClick={swap}
                  aria-label="Swap languages"
                  title="Swap languages"
                >
                  <ArrowLeftRight size={16} aria-hidden="true" />
                </Button>
              )}
            </div>
            {speaker("b")}
          </div>
        </div>
      </div>
      </div>
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "remove"
                ? "Delete this voice"
                : "Clear conversation"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "remove"
                ? "Permanently delete this voice from the ElevenLabs account?"
                : "Clear this conversation’s text and audio on this device?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 px-4">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 px-4"
              variant={pending?.kind === "remove" ? "destructive" : "default"}
              onClick={confirmPending}
            >
              {pending?.kind === "remove" ? "Delete" : "Clear"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

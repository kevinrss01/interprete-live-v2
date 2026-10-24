import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeftRight,
  ChevronLeft,
  CircleAlert,
  LoaderCircle,
  Mic,
  MicOff,
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
import { Home, type HomeChoice } from "./home";
import { SettingsSheet } from "./settings-sheet";
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

type View = "home" | HomeChoice;
const VIEW_TITLES: Record<HomeChoice, string> = {
  conversation: "Conversation",
  call: "Réunion en ligne",
};

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
  // Every launch starts on the two-choice home screen.
  const [view, setView] = useState<View>("home");
  const callMode = view === "call";
  const mainRef = useRef<HTMLElement>(null);
  const shownView = useRef(view);
  useEffect(() => {
    // The button that changed the view unmounts; give keyboard and screen-reader users a destination.
    if (shownView.current === view) return;
    shownView.current = view;
    mainRef.current?.focus({ preventScroll: true });
  }, [view]);
  const [showSettings, setShowSettings] = useState(false);
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
  const status = callBusy ? "Traduction de l’appel…" :
    demo && state.phase === "listening" && state.connection === "reconnecting"
      ? "Reconnexion · exemple audio"
      : demo && (state.phase === "connecting" || state.phase === "listening")
        ? "Exemple audio en cours…"
        : state.phase === "connecting"
          ? "Connexion au micro…"
          : state.phase === "listening"
            ? state.connection === "reconnecting"
              ? "Reconnexion · micro actif"
              : state.outputActive
                ? "Écoute et traduction…"
                : `${state.profiles[state.active].name} parle…`
            : state.phase === "finishing"
              ? "Fin de la prise de parole…"
              : state.phase === "translating"
                ? "Traduction…"
                : state.phase === "playing"
                  ? "Lecture de la traduction"
                  : state.ready
                    ? "Prêt"
                    : "Connexion…";
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
    <div className="app">
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      <header className="topbar">
        <div className="frame topbar-inner">
          {view === "home" ? (
            <span className="wordmark">
              <img src={logo} alt="Interprète" />
            </span>
          ) : (
            <div className="topbar-title">
              <Button
                variant="ghost"
                className="icon-btn topbar-back"
                onClick={() => openView("home")}
                aria-label="Retour à l’accueil"
                title="Accueil"
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </Button>
              <span>{VIEW_TITLES[view]}</span>
            </div>
          )}
          <div
            className="status"
            data-phase={callBusy ? "listening" : state.phase}
            data-ready={state.ready}
            role="status"
            // The call panel shows its own session status; this one tracks the conversation.
            hidden={view === "home" || (view === "call" && !callBusy)}
          >
            {busy && state.phase !== "listening" ? (
              <LoaderCircle size={13} className="spin" aria-hidden="true" />
            ) : (
              <span className="status-dot" aria-hidden="true" />
            )}
            <span className="status-text">{status}</span>
          </div>
          <Button
            variant="ghost"
            className="icon-btn topbar-settings"
            onClick={() => setShowSettings(true)}
            aria-haspopup="dialog"
            aria-expanded={showSettings}
            aria-label="Réglages"
            title="Réglages"
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
          </Button>
        </div>
      </header>
      {overlayError && (
        <div className="frame alert" role="alert">
          <span>{overlayError}</span>
          <Button
            variant="ghost"
            className="icon-btn"
            aria-label="Fermer le message de la pastille"
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
        {view === "home" && <Home profiles={state.profiles} onChoose={openView} />}
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
                aria-label="Fermer le message"
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
                ? "Micro actif"
                : !demo && state.phase === "connecting"
                  ? "Activation du micro…"
                  : state.input === "microphone" && state.phase === "finishing"
                    ? "Arrêt du micro…"
                    : "Micro désactivé"}
            </span>
            <span id="microphone-help" className="live-controls-help">
              {demo
                ? "L’exemple utilise un enregistrement, sans votre micro."
                : microphoneActive
                  ? "La traduction suit votre voix. Coupez le micro pour terminer."
                  : state.phase === "idle"
                    ? "Activez le micro de la personne qui parle."
                    : state.phase === "connecting"
                      ? "Autorisez l’accès au micro si demandé."
                      : state.phase === "playing"
                        ? "Lecture de la traduction…"
                        : "Fin de la traduction…"}
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
                      ? "Annuler la prise de parole"
                      : "Arrêter"
                  }
                  title="Arrêter (Échap)"
                >
                  <X size={18} aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="icon-btn round"
                  onClick={swap}
                  aria-label="Inverser les deux langues"
                  title="Inverser les langues"
                >
                  <ArrowLeftRight size={16} aria-hidden="true" />
                </Button>
              )}
            </div>
            {speaker("b")}
          </div>
        </div>
      </div>
      <SettingsSheet
        open={showSettings}
        profiles={state.profiles}
        busy={busy}
        decisionAvailable={!state.services || state.services.decision}
        volume={state.volume}
        onOpenChange={setShowSettings}
        onProfile={onProfile}
        onClone={(id) => void controller.clone(id)}
        onRemove={(id) => setPending({ kind: "remove", id })}
        onVolume={(value) => controller.setVolume(value)}
        onLeave={import.meta.env.DEV ? leave : undefined}
      />
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
                ? "Supprimer cette voix"
                : "Effacer la conversation"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "remove"
                ? "Supprimer définitivement cette voix du compte ElevenLabs ?"
                : "Effacer le texte et l’audio de cette conversation sur cet appareil ?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 px-4">Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 px-4"
              variant={pending?.kind === "remove" ? "destructive" : "default"}
              onClick={confirmPending}
            >
              {pending?.kind === "remove" ? "Supprimer" : "Effacer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

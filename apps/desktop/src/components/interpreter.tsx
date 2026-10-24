import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeftRight,
  CircleAlert,
  LoaderCircle,
  Mic,
  MicOff,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { InterpreterController } from "../lib/interpreter";
import { SpeakerPanel } from "./speaker-panel";
import { CallPanel, type CallPanelHandle } from "./call-panel";
import { TranslationPill } from "./translation-overlay";
import {
  useTranslationOverlay,
  type OverlayUpdate,
} from "../lib/translation-overlay";
import { desktopAvailable } from "../lib/calls";
import { Conversation } from "./conversation";
import { SettingsSheet } from "./settings-sheet";
import type { Profile, SpeakerId } from "@interprete/shared/contracts";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type PendingConfirm =
  | { kind: "clear" }
  | { kind: "remove"; id: SpeakerId };

export function Interpreter({ controller }: { controller: InterpreterController }) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const callPanelRef = useRef<CallPanelHandle>(null);
  const [callOverlay, setCallOverlay] = useState<OverlayUpdate | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [callBusy, setCallBusy] = useState(false);
  const [callMode, setCallMode] = useState(false);
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
      if (callMode || target.closest("input,select,textarea,button,summary,a"))
        return;
      if ((e.key === "a" || e.key === "b") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void controller.start(e.key as SpeakerId);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [controller, callMode]);
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
        Aller à la conversation
      </a>
      <header className="topbar">
        <div className="frame topbar-inner">
          <a className="wordmark" href="#main">
            <img src="/logo.png" alt="Interprète, accueil" />
          </a>
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
          <Button
            variant="ghost"
            className="icon-btn"
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
      <nav className="frame mode-switch" aria-label="Mode de traduction">
        <Button
          variant="ghost"
          className="btn btn-quiet"
          aria-pressed={!callMode}
          onClick={() => setCallMode(false)}
        >
          Conversation
        </Button>
        <Button
          variant="ghost"
          className="btn btn-quiet"
          aria-pressed={callMode}
          onClick={() => {
            controller.cancel();
            setCallMode(true);
          }}
        >
          Appels sur Mac
        </Button>
      </nav>
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
      <main id="main" className="frame main">
        <CallPanel
          ref={callPanelRef}
          onOverlayChange={setCallOverlay}
          onBusy={setCallBusy}
          visible={callMode}
          onOpen={() => {
            controller.cancel();
            setCallMode(true);
          }}
          beforeStart={() => controller.cancel()}
          profiles={state.profiles}
          onLanguage={(id, language) => controller.setProfile(id, { language })}
        />
        {!callMode && (
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
      <div className="dock" hidden={callMode}>
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
          <div className="live-controls">
            <div className="live-controls-heading">
              <h2>Traduction en direct</h2>
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
            </div>
            <p id="microphone-help" className="live-controls-help">
              {demo
                ? "L’exemple utilise un enregistrement. Votre micro reste désactivé."
                : microphoneActive
                  ? "La traduction est lue au fil de votre voix. Coupez le micro pour terminer."
                  : state.phase === "idle"
                    ? "Activez le micro de la personne qui parle pour traduire sa voix en direct."
                    : state.phase === "connecting"
                      ? "Autorisez l’accès au micro si votre appareil vous le demande."
                      : state.phase === "playing"
                        ? "Écoutez la traduction. Vous pourrez ensuite réactiver le micro."
                        : "La traduction se termine. Vous pourrez ensuite réactiver le micro."}
            </p>
          </div>
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

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeftRight,
  CircleAlert,
  LoaderCircle,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { InterpreterController } from "../lib/interpreter";
import { SpeakerPanel, VoiceSettings } from "./speaker-panel";
import { Conversation } from "./conversation";
import type { Profile, SpeakerId } from "@interprete/shared/contracts";

export function Interpreter({ controller }: { controller: InterpreterController }) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const [showSettings, setShowSettings] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.repeat || target.closest("dialog")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        controller.cancel();
        return;
      }
      if (target.closest("input,select,textarea,button,summary,a")) return;
      if ((e.key === "a" || e.key === "b") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void controller.start(e.key as SpeakerId);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [controller]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (showSettings && !dialog.open) dialog.showModal();
    if (!showSettings && dialog.open) dialog.close();
  }, [showSettings]);
  const busy = state.phase !== "idle";
  const status =
    state.phase === "connecting"
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
  // WKWebView ignores window.confirm, so use the native Tauri dialog.
  async function onRemove(id: SpeakerId) {
    if (
      await confirm(
        "Supprimer définitivement cette voix du compte ElevenLabs ?",
      )
    )
      void controller.removeVoice(id);
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
          <a className="wordmark" href="#main" aria-label="Interprète, accueil">
            Interprète
          </a>
          <div
            className="status"
            data-phase={state.phase}
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
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowSettings(true)}
            aria-haspopup="dialog"
            aria-expanded={showSettings}
            aria-label="Réglages"
            title="Réglages"
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
          </button>
        </div>
      </header>
      <main id="main" className="frame main">
        <Conversation
          turns={state.turns}
          profiles={state.profiles}
          onPlay={(id) => void controller.replay(id)}
          onDemo={() => void controller.start(state.active, true)}
          onClear={async () => {
            if (
              await confirm(
                "Effacer le texte et l’audio de cette conversation sur cet appareil ?",
              )
            )
              controller.clearConversation();
          }}
          busy={busy}
        />
      </main>
      <div className="dock">
        <div className="frame">
          {(state.error || state.warning) && (
            <div className="alert" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{state.error || state.warning}</span>
              <button
                className="icon-btn"
                onClick={controller.dismissError}
                aria-label="Fermer le message"
                type="button"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="dock-grid">
            {speaker("a")}
            <div className="dock-center">
              {busy ? (
                <button
                  className="icon-btn round"
                  type="button"
                  onClick={() => controller.cancel()}
                  aria-label={
                    state.phase === "listening" || state.phase === "connecting"
                      ? "Annuler la prise de parole"
                      : "Arrêter"
                  }
                  title="Arrêter (Échap)"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              ) : (
                <button
                  className="icon-btn round"
                  type="button"
                  onClick={swap}
                  aria-label="Inverser les deux langues"
                  title="Inverser les langues"
                >
                  <ArrowLeftRight size={16} aria-hidden="true" />
                </button>
              )}
            </div>
            {speaker("b")}
          </div>
        </div>
      </div>
      <dialog
        ref={dialogRef}
        className="sheet"
        aria-labelledby="settings-title"
        onClose={() => setShowSettings(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowSettings(false);
        }}
      >
        <div className="sheet-inner">
          <div className="sheet-head">
            <h2 id="settings-title">Réglages</h2>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowSettings(false)}
              aria-label="Fermer les réglages"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="sheet-body">
            {(["a", "b"] as const).map((id) => (
              <VoiceSettings
                key={id}
                profile={state.profiles[id]}
                busy={busy}
                onProfile={(p) => onProfile(id, p)}
                onClone={() => void controller.clone(id)}
                onRemove={() => onRemove(id)}
              />
            ))}
            <fieldset className="settings-group">
              <legend>Session</legend>
              <p className="note">Le micro reste ouvert jusqu’à ce que vous appuyiez sur Terminer, même pendant les pauses et la lecture des traductions.</p>
              <p className="note">
                <kbd>A</kbd> <kbd>B</kbd> pour parler, <kbd>Échap</kbd> pour
                arrêter. La traduction parle pendant votre prise de parole, avec
                l’annulation d’écho du navigateur.
              </p>
            </fieldset>
            <div className="settings-group">
              <h3 className="settings-title">Services</h3>
              <dl className="services">
                <div>
                  <dt>Transcription</dt>
                  <dd>OpenAI · GPT Live Transcribe</dd>
                </div>
                <div>
                  <dt>Traduction</dt>
                  <dd>OpenAI · GPT-5.4 nano</dd>
                </div>
                <div>
                  <dt>Validation</dt>
                  <dd>
                    Jev 1.14.0
                    {state.services && !state.services.decision
                      ? " · indisponible"
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>Voix et clonage</dt>
                  <dd>ElevenLabs · Flash v2.5</dd>
                </div>
              </dl>
              <p className="note">
                Voix générées par IA. L’app ne conserve pas les conversations
                sur son serveur. Les échantillons autorisés pour le clonage sont
                transmis à ElevenLabs ; vous pouvez supprimer votre voix
                ci-dessus.
              </p>
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}

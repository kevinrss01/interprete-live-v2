import {
  Check,
  ChevronDown,
  LoaderCircle,
  Mic,
  Sparkles,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { Phase, Profile } from "@interprete/shared/contracts";
import { LANGUAGES, VOICE_PRESETS, languageNative } from "@interprete/shared/languages";

const METER = [0.5, 0.85, 1, 0.75, 0.55];
const SAMPLE_TARGET = 30;

function presetName(voice: string) {
  return VOICE_PRESETS.find((v) => v.key === voice)?.name ?? "Sarah";
}

export function SpeakerPanel({
  profile,
  phase,
  selected,
  level,
  ready,
  demo = false,
  onTalk,
  onProfile,
}: {
  profile: Profile;
  phase: Phase;
  selected: boolean;
  level: number;
  ready: boolean;
  demo?: boolean;
  onTalk: () => void;
  onProfile: (patch: Partial<Profile>) => void;
}) {
  const listening = selected && phase === "listening";
  const connecting = selected && phase === "connecting";
  const working =
    selected && (phase === "finishing" || phase === "translating");
  const playing = selected && phase === "playing";
  const busy = phase !== "idle";
  const state = listening
    ? "live"
    : connecting
      ? "connecting"
      : working
        ? "working"
        : playing
          ? "playing"
          : selected && !busy
            ? "next"
            : "idle";
  const letter = profile.id.toUpperCase();
  const name = profile.name || `Personne ${letter}`;
  const voice = profile.cloneStatus;
  return (
    <section
      className="speaker"
      data-state={state}
      aria-label={`Personne ${letter}`}
    >
      <div className="speaker-meta">
        <span className={`mark mark-${profile.id}`} aria-hidden="true">
          {letter}
        </span>
        <span className="speaker-name">
          {name}
        </span>
        <span
          className={`voice-chip ${voice === "error" ? "is-error" : ""}`}
          title="Voix utilisée pour la traduction"
        >
          {voice === "ready" ? (
            <>
              <Check size={12} aria-hidden="true" />
              Voix clonée
            </>
          ) : voice === "creating" ? (
            <>
              <LoaderCircle size={12} className="spin" aria-hidden="true" />
              Clonage…
            </>
          ) : voice === "verification" ? (
            "À vérifier"
          ) : voice === "error" ? (
            "Clonage échoué"
          ) : profile.consent ? (
            <span className="tabular">
              {Math.min(SAMPLE_TARGET, profile.sampleSeconds)} / {SAMPLE_TARGET}{" "}
              s
            </span>
          ) : (
            presetName(profile.voice)
          )}
        </span>
      </div>
      <div className="language-field">
        <label className="sr-only" htmlFor={`language-${profile.id}`}>
          Langue de la personne {letter}
        </label>
        <select
          id={`language-${profile.id}`}
          name={`language-${profile.id}`}
          value={profile.language}
          onChange={(e) =>
            onProfile({ language: e.target.value as Profile["language"] })
          }
          disabled={busy}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native}
            </option>
          ))}
        </select>
        <ChevronDown size={16} aria-hidden="true" />
      </div>
      <button
        className="talk"
        type="button"
        onClick={onTalk}
        disabled={!ready || (busy && !listening && !connecting)}
        style={{ "--level": listening ? level : 0 } as CSSProperties}
        aria-describedby="microphone-help"
        aria-label={
          listening
            ? demo
              ? "Terminer l’exemple audio"
              : `Couper le micro · ${name}`
            : connecting
              ? "Annuler la connexion"
              : working
                ? "Traduction en cours"
                : playing
                  ? "Lecture de la traduction"
                  : `Activer le micro · ${name} · ${languageNative(profile.language)}`
        }
      >
        <span className="talk-icon" aria-hidden="true">
          {listening ? (
            <span className="meter">
              {METER.map((m, i) => (
                <i
                  key={i}
                  style={{
                    transform: `scaleY(${(3 + Math.min(1, level * 1.4) * m * 13) / 16})`,
                  }}
                />
              ))}
            </span>
          ) : connecting || working ? (
            <LoaderCircle size={18} className="spin" />
          ) : playing ? (
            <Volume2 size={18} />
          ) : (
            <Mic size={18} />
          )}
        </span>
        <span className="talk-label">
          {listening
            ? demo
              ? "Terminer l’exemple"
              : "Couper le micro"
            : connecting
              ? "Connexion…"
              : working
                ? "Traduction…"
                : playing
                  ? "Lecture…"
                  : "Activer le micro"}
        </span>
        {listening ? (
          <Square
            size={12}
            fill="currentColor"
            className="talk-stop"
            aria-hidden="true"
          />
        ) : (
          (state === "next" || state === "idle") && (
            <kbd className="talk-kbd" aria-hidden="true">
              {letter}
            </kbd>
          )
        )}
      </button>
    </section>
  );
}

export function VoiceSettings({
  profile,
  busy,
  onProfile,
  onClone,
  onRemove,
}: {
  profile: Profile;
  busy: boolean;
  onProfile: (patch: Partial<Profile>) => void;
  onClone: () => void;
  onRemove: () => void;
}) {
  const current = profile.cloneStatus;
  const letter = profile.id.toUpperCase();
  const canCreate =
    profile.consent &&
    current !== "ready" &&
    current !== "verification" &&
    profile.sampleSeconds >= 10 &&
    current !== "creating";
  const canRemove = current === "ready" || !!profile.cloneVoice;
  return (
    <fieldset className="settings-group">
      <legend>
        <span className={`mark mark-${profile.id}`} aria-hidden="true">
          {letter}
        </span>
        Personne {letter}
      </legend>
      <div className="field">
        <label htmlFor={`name-${profile.id}`}>Nom</label>
        <input
          id={`name-${profile.id}`}
          name={`name-${profile.id}`}
          autoComplete="off"
          maxLength={32}
          value={profile.name}
          onChange={(e) => onProfile({ name: e.target.value })}
          disabled={busy}
        />
      </div>
      {current !== "ready" && (
        <div className="field">
          <label htmlFor={`voice-${profile.id}`}>Voix</label>
          <div className="select-wrap">
            <select
              id={`voice-${profile.id}`}
              value={profile.voice.includes(".") ? "sarah" : profile.voice}
              disabled={busy}
              onChange={(e) => onProfile({ voice: e.target.value })}
            >
              {VOICE_PRESETS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.name} · {v.description}
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </div>
        </div>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={profile.consent}
          disabled={busy || current === "creating"}
          onChange={(e) =>
            onProfile({
              consent: e.target.checked,
              cloneStatus: e.target.checked
                ? "collecting"
                : current === "ready"
                  ? "ready"
                  : "off",
            })
          }
        />
        <span>
          <strong>Utiliser ma propre voix</strong>
          <small>
            J’autorise la création et l’utilisation de ma voix pour cette
            conversation.
          </small>
        </span>
      </label>
      {profile.consent && current !== "ready" && (
        <div className="clone-progress">
          <div className="clone-progress-head">
            <span>
              {current === "creating"
                ? "Création de la voix…"
                : current === "verification"
                  ? "Vérification nécessaire"
                  : current === "error"
                    ? "Création à réessayer"
                    : "Échantillon"}
            </span>
            <span className="tabular">
              {Math.min(SAMPLE_TARGET, profile.sampleSeconds)} / {SAMPLE_TARGET}{" "}
              s
            </span>
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-label="Échantillon pour le clonage"
            aria-valuemin={0}
            aria-valuemax={SAMPLE_TARGET}
            aria-valuenow={Math.min(SAMPLE_TARGET, profile.sampleSeconds)}
          >
            <span
              style={{
                transform: `scaleX(${Math.min(1, profile.sampleSeconds / SAMPLE_TARGET)})`,
              }}
            />
          </div>
          <p className="note">
            La création démarre après 30 s de parole. Une minute améliore la
            ressemblance.
          </p>
        </div>
      )}
      {current === "ready" && (
        <p className="note">
          <Check size={13} aria-hidden="true" /> Votre voix est prête. Elle est
          conservée dans votre compte ElevenLabs.
        </p>
      )}
      {profile.cloneError && (
        <p className="note is-error" role="status">
          {profile.cloneError}
        </p>
      )}
      {(canCreate || canRemove) && (
        <div className="settings-actions">
          {canCreate && (
            <button className="btn" type="button" onClick={onClone}>
              <Sparkles size={15} aria-hidden="true" />
              {current === "error"
                ? "Réessayer la création"
                : "Créer la voix maintenant"}
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy || current === "creating"}
              onClick={onRemove}
            >
              <Trash2 size={15} aria-hidden="true" />
              Supprimer ma voix
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}

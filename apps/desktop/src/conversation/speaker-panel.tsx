import { Check, LoaderCircle, Mic, Square, Volume2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { Phase, Profile } from "@interprete/shared/contracts";
import { LANGUAGES, VOICE_PRESETS, languageNative } from "@interprete/shared/languages";
import { Button } from "@interprete/ui/components/button";
import { Label } from "@interprete/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@interprete/ui/components/select";

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
        <Label className="sr-only" htmlFor={`language-${profile.id}`}>
          Langue de la personne {letter}
        </Label>
        <Select
          items={LANGUAGES.map((l) => ({ value: l.code, label: l.native }))}
          value={profile.language}
          disabled={busy}
          onValueChange={(value) => {
            if (!value || !LANGUAGES.some((l) => l.code === value)) return;
            onProfile({ language: value as Profile["language"] });
          }}
        >
          <SelectTrigger
            id={`language-${profile.id}`}
            aria-label={`Langue de la personne ${letter}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            side="top"
            align="start"
            alignItemWithTrigger={false}
            className="min-w-44"
          >
            {LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code} className="pl-2.5">
                {l.native}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        variant="outline"
        className="talk"
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
      </Button>
    </section>
  );
}

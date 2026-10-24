import { useSyncExternalStore, type CSSProperties } from "react";
import { Check, Sparkles, Trash2, X } from "lucide-react";
import type { Profile, SpeakerId } from "@interprete/shared/contracts";
import { VOICE_PRESETS } from "@interprete/shared/languages";
import { Button } from "@interprete/ui/components/button";
import { Checkbox } from "@interprete/ui/components/checkbox";
import { Input } from "@interprete/ui/components/input";
import { Label } from "@interprete/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@interprete/ui/components/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@interprete/ui/components/sheet";

const SAMPLE_TARGET = 30;

function useCompact() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(max-width: 640px)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(max-width: 640px)").matches,
    () => false,
  );
}

function VoiceSettings({
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
        Person {letter}
      </legend>
      <div className="field">
        <Label htmlFor={`name-${profile.id}`}>Name</Label>
        <Input
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
          <Label htmlFor={`voice-${profile.id}`}>Voice</Label>
          <Select
            items={VOICE_PRESETS.map((v) => ({
              value: v.key,
              label: `${v.name} · ${v.description}`,
            }))}
            value={profile.voice.includes(".") ? "sarah" : profile.voice}
            disabled={busy}
            onValueChange={(value) => {
              if (!value || !VOICE_PRESETS.some((v) => v.key === value)) return;
              onProfile({ voice: value });
            }}
          >
            <SelectTrigger id={`voice-${profile.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              {VOICE_PRESETS.map((v) => (
                <SelectItem key={v.key} value={v.key} className="pl-3">
                  {v.name} · {v.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <label className="check">
        <Checkbox
          checked={profile.consent}
          disabled={busy || current === "creating"}
          onCheckedChange={(checked) =>
            onProfile({
              consent: checked,
              cloneStatus: checked
                ? "collecting"
                : current === "ready"
                  ? "ready"
                  : "off",
            })
          }
        />
        <span>
          <strong>Use my own voice</strong>
          <small>
            I authorize the creation and use of my voice for this
            conversation.
          </small>
        </span>
      </label>
      {profile.consent && current !== "ready" && (
        <div className="clone-progress">
          <div className="clone-progress-head">
            <span>
              {current === "creating"
                ? "Creating the voice…"
                : current === "verification"
                  ? "Verification required"
                  : current === "error"
                    ? "Creation needs a retry"
                    : "Sample"}
            </span>
            <span className="tabular">
              {Math.min(SAMPLE_TARGET, profile.sampleSeconds)} / {SAMPLE_TARGET}{" "}
              s
            </span>
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-label="Cloning sample"
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
            Creation starts after 30 s of speech. A full minute improves the
            likeness.
          </p>
        </div>
      )}
      {current === "ready" && (
        <p className="note">
          <Check size={13} aria-hidden="true" /> Your voice is ready. It is
          stored in your ElevenLabs account.
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
            <Button className="btn" onClick={onClone}>
              <Sparkles size={15} aria-hidden="true" />
              {current === "error"
                ? "Retry creation"
                : "Create the voice now"}
            </Button>
          )}
          {canRemove && (
            <Button
              variant="ghost"
              className="btn btn-quiet"
              disabled={busy || current === "creating"}
              onClick={onRemove}
            >
              <Trash2 size={15} aria-hidden="true" />
              Delete my voice
            </Button>
          )}
        </div>
      )}
    </fieldset>
  );
}

export function SettingsSheet({
  open,
  profiles,
  busy,
  decisionAvailable,
  volume,
  onOpenChange,
  onProfile,
  onClone,
  onRemove,
  onVolume,
  onLeave,
}: {
  open: boolean;
  profiles: Record<SpeakerId, Profile>;
  busy: boolean;
  decisionAvailable: boolean;
  volume: number;
  onOpenChange: (open: boolean) => void;
  onProfile: (id: SpeakerId, patch: Partial<Profile>) => void;
  onClone: (id: SpeakerId) => void;
  onRemove: (id: SpeakerId) => void;
  onVolume: (volume: number) => void;
  onLeave?: () => void;
}) {
  const compact = useCompact();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={compact ? "bottom" : "right"}
        showCloseButton={false}
        className="gap-0 p-0"
      >
        <div className="sheet-inner">
          <div className="sheet-head">
            <SheetTitle id="settings-title">Settings</SheetTitle>
            <SheetDescription className="sr-only">
              Languages, voices, and session.
            </SheetDescription>
            <Button
              variant="ghost"
              className="icon-btn"
              onClick={() => onOpenChange(false)}
              aria-label="Close settings"
            >
              <X size={18} aria-hidden="true" />
            </Button>
          </div>
          <div className="sheet-body">
            {(["a", "b"] as const).map((id) => (
              <VoiceSettings
                key={id}
                profile={profiles[id]}
                busy={busy}
                onProfile={(patch) => onProfile(id, patch)}
                onClone={() => onClone(id)}
                onRemove={() => onRemove(id)}
              />
            ))}
            <fieldset className="settings-group">
              <legend>Session</legend>
              <label className="volume">
                <span>Volume</span>
                <span className="tabular">{Math.round(volume * 100)} %</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(volume * 100)}
                  style={{ "--volume": `${Math.round(volume * 100)}%` } as CSSProperties}
                  aria-label="Translation volume"
                  onChange={(e) => onVolume(Number(e.target.value) / 100)}
                />
              </label>
              <p className="note">
                The microphone stays on until you press Mute microphone,
                even during pauses and while translations play.
              </p>
              <p className="note">
                <kbd>A</kbd> <kbd>B</kbd> to speak, <kbd>Esc</kbd> to
                stop. The translation plays while you speak, with the
                browser’s echo cancellation.
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
                  <dt>Translation</dt>
                  <dd>OpenAI · GPT-5.4 nano</dd>
                </div>
                <div>
                  <dt>Validation</dt>
                  <dd>
                    Jev 1.14.0
                    {decisionAvailable ? "" : " · unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>Voices and cloning</dt>
                  <dd>ElevenLabs · Flash v2.5</dd>
                </div>
              </dl>
              <p className="note">
                AI-generated voices. The app does not store conversations
                on its server. Samples authorized for cloning are
                sent to ElevenLabs; you can delete your voice
                above.
              </p>
            </div>
            {onLeave && (
              <button type="button" className="settings-dev-leave" onClick={onLeave}>
                dev: sign out
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

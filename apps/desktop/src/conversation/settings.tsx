import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, LogOut, Sparkles, Trash2 } from "lucide-react";
import type { Profile, SpeakerId } from "@interprete/shared/contracts";
import { VOICE_PRESETS } from "@interprete/shared/languages";
import { Button } from "@interprete/ui/components/button";
import { Checkbox } from "@interprete/ui/components/checkbox";
import { Input } from "@interprete/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@interprete/ui/components/select";
import { loadOnboardingAccount } from "../onboarding/onboarding-account";

const SAMPLE_TARGET = 30;

// One settings layout for every tab: an optional title, then a card of rows
// with the label on the left and the value or control on the right.
function SettingsSection({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section">
      {title && <h2 className="settings-section-title">{title}</h2>}
      <div className="settings-card">{children}</div>
    </section>
  );
}

function SettingsRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {hint && <small>{hint}</small>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
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
    <SettingsSection
      title={
        <>
          <span className={`mark mark-${profile.id}`} aria-hidden="true">
            {letter}
          </span>
          Person {letter}
        </>
      }
    >
      <SettingsRow label="Name" htmlFor={`name-${profile.id}`}>
        <Input
          id={`name-${profile.id}`}
          name={`name-${profile.id}`}
          autoComplete="off"
          maxLength={32}
          value={profile.name}
          onChange={(e) => onProfile({ name: e.target.value })}
          disabled={busy}
        />
      </SettingsRow>
      {current !== "ready" && (
        <SettingsRow label="Voice" htmlFor={`voice-${profile.id}`}>
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
            <SelectContent align="end" alignItemWithTrigger={false}>
              {VOICE_PRESETS.map((v) => (
                <SelectItem key={v.key} value={v.key} className="pl-3">
                  {v.name} · {v.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      )}
      <SettingsRow
        label="Use my own voice"
        htmlFor={`consent-${profile.id}`}
        hint="I authorize the creation and use of my voice for this conversation."
      >
        <Checkbox
          id={`consent-${profile.id}`}
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
      </SettingsRow>
      {profile.consent && current !== "ready" && (
        <div className="settings-row settings-row-stack">
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
        </div>
      )}
      {current === "ready" && (
        <div className="settings-row settings-row-stack">
          <p className="note">
            <Check size={13} aria-hidden="true" /> Your voice is ready. It is
            stored in your ElevenLabs account.
          </p>
        </div>
      )}
      {profile.cloneError && (
        <div className="settings-row settings-row-stack">
          <p className="note is-error" role="status">
            {profile.cloneError}
          </p>
        </div>
      )}
      {(canCreate || canRemove) && (
        <div className="settings-row settings-row-stack">
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
        </div>
      )}
    </SettingsSection>
  );
}

const TABS = [
  { id: "general", label: "General" },
  { id: "voices", label: "Voices" },
  { id: "account", label: "Account" },
  { id: "permissions", label: "Permissions" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// Minimal tab bar: the underline slides to the selected tab.
function TabBar({ value, onChange }: { value: TabId; onChange: (id: TabId) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const tab = listRef.current?.querySelector<HTMLElement>(`[data-tab="${value}"]`);
      if (tab) setIndicator({ left: tab.offsetLeft, width: tab.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [value]);
  function onKeyDown(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const index = TABS.findIndex((t) => t.id === value);
    const next = TABS[(index + step + TABS.length) % TABS.length].id;
    onChange(next);
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  }
  return (
    <div className="tabs" role="tablist" aria-label="Settings sections" ref={listRef} onKeyDown={onKeyDown}>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`settings-tab-${tab.id}`}
          data-tab={tab.id}
          aria-selected={value === tab.id}
          aria-controls="settings-panel"
          tabIndex={value === tab.id ? 0 : -1}
          className="tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
      <span
        className="tabs-indicator"
        aria-hidden="true"
        style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
      />
    </div>
  );
}

export function SettingsPage({
  profiles,
  busy,
  decisionAvailable,
  volume,
  onProfile,
  onClone,
  onRemove,
  onVolume,
  onSignOut,
}: {
  profiles: Record<SpeakerId, Profile>;
  busy: boolean;
  decisionAvailable: boolean;
  volume: number;
  onProfile: (id: SpeakerId, patch: Partial<Profile>) => void;
  onClone: (id: SpeakerId) => void;
  onRemove: (id: SpeakerId) => void;
  onVolume: (volume: number) => void;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<TabId>("general");
  const [account] = useState(loadOnboardingAccount);
  // Editable in the UI only; saving the name to the server is not wired yet.
  const [firstName, setFirstName] = useState(account?.firstName ?? "");
  const percent = Math.round(volume * 100);
  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <h1 id="settings-title">Settings</h1>
      <TabBar value={tab} onChange={setTab} />
      <div
        id="settings-panel"
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        className="settings-panel"
      >
        {tab === "general" && (
          <>
            <SettingsSection>
              <SettingsRow label="Translation volume" htmlFor="settings-volume">
                <div className="volume">
                  <input
                    id="settings-volume"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={percent}
                    style={{ "--volume": `${percent}%` } as CSSProperties}
                    onChange={(e) => onVolume(Number(e.target.value) / 100)}
                  />
                  <span className="tabular">{percent} %</span>
                </div>
              </SettingsRow>
              <SettingsRow label="Keyboard shortcuts">
                <span className="settings-value">A / B to speak, Esc to stop</span>
              </SettingsRow>
            </SettingsSection>
            <SettingsSection>
              <SettingsRow label="Transcription service">
                <span className="settings-value">OpenAI · GPT Live Transcribe</span>
              </SettingsRow>
              <SettingsRow label="Translation service">
                <span className="settings-value">OpenAI · GPT-5.4 nano</span>
              </SettingsRow>
              <SettingsRow label="Validation service">
                <span className="settings-value">
                  Jev 1.14.0{decisionAvailable ? "" : " · unavailable"}
                </span>
              </SettingsRow>
              <SettingsRow label="Voice service">
                <span className="settings-value">ElevenLabs · Flash v2.5</span>
              </SettingsRow>
            </SettingsSection>
          </>
        )}
        {tab === "voices" && (
          <>
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
            <p className="note settings-footnote">
              AI-generated voices. The app does not store conversations on its
              server. Samples you authorize for cloning are sent to ElevenLabs.
            </p>
          </>
        )}
        {tab === "account" && (
          <>
            <SettingsSection>
              <SettingsRow label="First name" htmlFor="settings-first-name">
                <Input
                  id="settings-first-name"
                  autoComplete="given-name"
                  maxLength={64}
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label="Email">
                <span className="settings-value">{account?.email || "—"}</span>
              </SettingsRow>
            </SettingsSection>
            <div className="settings-footer">
              <Button variant="destructive" className="btn btn-danger" onClick={onSignOut}>
                <LogOut size={15} aria-hidden="true" />
                Sign out
              </Button>
            </div>
          </>
        )}
        {tab === "permissions" && (
          <SettingsSection>
            <SettingsRow label="Permissions">
              <span className="settings-value">Coming soon</span>
            </SettingsRow>
          </SettingsSection>
        )}
      </div>
    </section>
  );
}

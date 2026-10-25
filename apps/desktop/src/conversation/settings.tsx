import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, LoaderCircle, LogOut, Mic, Sparkles, Square, Trash2 } from "lucide-react";
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
import { rpc } from "../lib/account";
import { MicrophoneCapture } from "../lib/audio";
import { MICROPHONE_KEY, savedMicrophone } from "../lib/call-preferences";
import {
  CAPTION_THEMES, CAPTION_SIZES, DEFAULT_CAPTION_PREFERENCES,
  saveCaptionPreferences, useCaptionPreferences, type CaptionPreferences,
} from "../lib/caption-preferences";
import {
  desktopAvailable,
  microphoneName,
  physicalInputNames,
  physicalMicrophones,
} from "../lib/calls";
import {
  loadOnboardingAccount,
  saveOnboardingAccount,
} from "../onboarding/onboarding-account";

const SAMPLE_TARGET = 30;
const NAME_SAVE_DELAY_MS = 700;

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

// Autosaves the account name once typing pauses; the status sits inside the field.
function FirstNameField({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const saved = useRef(initial.trim());
  useEffect(() => {
    const name = value.trim();
    if (name === saved.current) return;
    if (!name) {
      setSave({ kind: "error", message: "Enter your first name." });
      return;
    }
    let stale = false;
    const timer = window.setTimeout(async () => {
      setSave({ kind: "saving" });
      try {
        const result = await rpc.account.updateName({ name });
        if (stale) return;
        saved.current = result.name;
        const account = loadOnboardingAccount();
        if (account) saveOnboardingAccount({ ...account, firstName: result.name });
        setSave({ kind: "saved" });
      } catch (error) {
        if (stale) return;
        const code = (error as { code?: string }).code;
        setSave({
          kind: "error",
          message:
            code === "UNAUTHORIZED"
              ? "Sign in to save your name."
              : "Your name could not be saved. Try again.",
        });
      }
    }, NAME_SAVE_DELAY_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [value]);
  return (
    <div className="autosave-field" data-state={save.kind}>
      <Input
        id="settings-first-name"
        autoComplete="given-name"
        maxLength={64}
        placeholder="First name"
        value={value}
        aria-invalid={save.kind === "error"}
        aria-describedby="settings-first-name-status"
        onChange={(e) => {
          setValue(e.target.value);
          if (save.kind !== "saving") setSave({ kind: "idle" });
        }}
      />
      <span
        id="settings-first-name-status"
        className="autosave-status"
        role="status"
        title={save.kind === "error" ? save.message : undefined}
      >
        {save.kind === "saving" && (
          <>
            <LoaderCircle size={12} className="spin" aria-hidden="true" />
            Saving…
          </>
        )}
        {save.kind === "saved" && (
          <>
            <Check size={12} aria-hidden="true" />
            Saved
          </>
        )}
        {save.kind === "error" && (
          <>
            <span aria-hidden="true">Not saved</span>
            <span className="sr-only">{save.message}</span>
          </>
        )}
      </span>
    </div>
  );
}

// One settings layout for every tab: an optional title, then a card of rows
// with the label on the left and the value or control on the right.
export function SettingsSection({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section">
      {title && <h2 className="settings-section-title">{title}</h2>}
      <div className="settings-card">{children}</div>
    </section>
  );
}

export function SettingsRow({
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

type MicrophoneAccess = "checking" | "granted" | "prompt" | "blocked";

// The onboarding asks for microphone access; here the user can switch microphones
// and check the input level. The test only measures: nothing is sent or played.
function MicrophoneSettings() {
  const [access, setAccess] = useState<MicrophoneAccess>("checking");
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState(() => savedMicrophone() ?? "");
  const [level, setLevel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const test = useRef<MicrophoneCapture | null>(null);

  const stopTest = useCallback(() => {
    void test.current?.stop();
    test.current = null;
    setLevel(null);
  }, []);

  const refresh = useCallback(async (ask = false) => {
    setError(null);
    try {
      const state = await navigator.permissions
        ?.query({ name: "microphone" as PermissionName })
        .then((status) => status.state, () => undefined);
      if (state === "denied") {
        setAccess("blocked");
        return;
      }
      let devices = await navigator.mediaDevices.enumerateDevices();
      // Access granted during onboarding is not remembered by the page: device names stay
      // hidden until the microphone opens once. The webview often reports "prompt" even
      // when macOS already allows it, so the desktop app opens it without asking first.
      const hidden = !devices.some((d) => d.kind === "audioinput" && d.label);
      if (ask || (hidden && (state === "granted" || desktopAvailable()))) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach((track) => track.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
      }
      const names = desktopAvailable() ? await physicalInputNames() : undefined;
      const granted = devices.some((d) => d.kind === "audioinput" && d.label);
      setAccess(granted ? "granted" : "prompt");
      const found = physicalMicrophones(devices, names);
      setMicrophones(found);
      setSelected((current) => {
        if (!found.length || found.some((d) => d.deviceId === current)) return current;
        const system = devices.find((d) => d.kind === "audioinput" && d.deviceId === "default");
        return (found.find((d) => microphoneName(d.label) === microphoneName(system?.label ?? "")) ?? found[0]).deviceId;
      });
    } catch (e) {
      if ((e as DOMException).name === "NotAllowedError") setAccess("blocked");
      else setError("The microphones could not be listed. Try again.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
      stopTest();
    };
  }, [refresh, stopTest]);

  async function startTest(deviceId: string) {
    stopTest();
    setError(null);
    const capture = new MicrophoneCapture({
      deviceId,
      recordSample: false,
      onAudio: () => {},
      onEnded: () => {},
      onLevel: (value) => {
        if (test.current === capture) setLevel(value);
      },
      onError: (message) => {
        if (test.current !== capture) return;
        stopTest();
        setError(message);
      },
    });
    test.current = capture;
    setLevel(0);
    try {
      await capture.start();
    } catch {
      if (test.current !== capture) return;
      stopTest();
      setError("The microphone could not start. Try again.");
    }
  }

  function choose(deviceId: string) {
    setSelected(deviceId);
    try {
      localStorage.setItem(MICROPHONE_KEY, deviceId);
      localStorage.setItem(
        "interprete-call-input-label",
        microphones.find((d) => d.deviceId === deviceId)?.label ?? "",
      );
    } catch {}
    if (test.current) void startTest(deviceId);
  }

  const testing = level !== null;
  return (
    <>
      <SettingsSection title="Microphone">
        <SettingsRow
          label="Microphone access"
          hint={
            access === "blocked"
              ? "Turn on Interprète in System Settings › Privacy & Security › Microphone."
              : undefined
          }
        >
          {access === "granted" && (
            <span className="settings-value settings-status">
              <Check size={14} aria-hidden="true" />
              Already allowed
            </span>
          )}
          {access === "blocked" && <span className="settings-value">Blocked</span>}
          {access === "prompt" && (
            <Button className="btn" onClick={() => void refresh(true)}>
              Allow access
            </Button>
          )}
        </SettingsRow>
        <SettingsRow label="Input device" htmlFor="settings-microphone">
          <Select
            items={microphones.map((d) => ({ value: d.deviceId, label: microphoneName(d.label) }))}
            value={selected || null}
            disabled={!microphones.length}
            onValueChange={(value) => {
              if (typeof value === "string") choose(value);
            }}
          >
            <SelectTrigger id="settings-microphone">
              <SelectValue placeholder="No microphone found" />
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              {microphones.map((d) => (
                <SelectItem key={d.deviceId} value={d.deviceId} className="pl-3">
                  {microphoneName(d.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Test the microphone"
          hint={testing ? "Speak: the bar follows your voice." : "Check that your voice is picked up."}
        >
          <div className="mic-test">
            <div
              className="mic-level"
              role="meter"
              aria-label="Microphone level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((level ?? 0) * 100)}
              style={{ "--level": level ?? 0 } as CSSProperties}
            />
            <Button
              className="btn"
              disabled={!selected}
              aria-pressed={testing}
              onClick={() => (testing ? stopTest() : void startTest(selected))}
            >
              {testing ? (
                <Square size={13} fill="currentColor" aria-hidden="true" />
              ) : (
                <Mic size={15} aria-hidden="true" />
              )}
              {testing ? "Stop" : "Test"}
            </Button>
          </div>
        </SettingsRow>
      </SettingsSection>
      {error && (
        <p className="note settings-footnote" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const CAPTION_POSITIONS = [
  { value: "top-left", label: "Top left", x: 0, y: 0 },
  { value: "top", label: "Top center", x: 0.5, y: 0 },
  { value: "top-right", label: "Top right", x: 1, y: 0 },
  { value: "left", label: "Center left", x: 0, y: 0.5 },
  { value: "center", label: "Center", x: 0.5, y: 0.5 },
  { value: "right", label: "Center right", x: 1, y: 0.5 },
  { value: "bottom-left", label: "Bottom left", x: 0, y: 1 },
  { value: "bottom", label: "Bottom center", x: 0.5, y: 1 },
  { value: "bottom-right", label: "Bottom right", x: 1, y: 1 },
];
function CaptionSettings({ onPreview, busy, previewError }: { onPreview: (visible: boolean) => void; busy: boolean; previewError: string | null }) {
  const native = desktopAvailable();
  const preferences = useCaptionPreferences();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    onPreview(preview && !busy);
    return () => onPreview(false);
  }, [preview, busy, onPreview]);
  function change(patch: Partial<CaptionPreferences>) {
    try {
      saveCaptionPreferences({ ...preferences, ...patch });
      setError(null);
    } catch {
      setError("The caption settings could not be saved on this device.");
    }
  }
  const position = CAPTION_POSITIONS.find((p) => p.x === preferences.x && p.y === preferences.y)?.value ?? "custom";
  return (
    <>
      <SettingsSection title="Placement">
        <SettingsRow label="Preview">
          <Button variant="outline" disabled={!native || busy} aria-pressed={preview && !busy} onClick={() => setPreview(!preview)}>
            {preview && !busy ? "Hide captions" : "Show captions"}
          </Button>
        </SettingsRow>
        <SettingsRow label="Position" htmlFor="caption-position">
          <Select
            items={[...CAPTION_POSITIONS, { value: "custom", label: "Custom position" }]}
            value={position}
            onValueChange={(value) => {
              const next = CAPTION_POSITIONS.find((p) => p.value === value);
              if (next) change({ x: next.x, y: next.y });
            }}
          >
            <SelectTrigger id="caption-position" className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              {CAPTION_POSITIONS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              <SelectItem value="custom" disabled>Custom position</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Size">
          <div className="caption-choices" role="group" aria-label="Caption size">
            {Object.entries(CAPTION_SIZES).map(([value, size]) => (
              <Button key={value} variant="outline" aria-pressed={preferences.size === value} onClick={() => change({ size: value as CaptionPreferences["size"] })}>{size.label}</Button>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>
      {previewError && <p className="call-error" role="alert">{previewError}</p>}
      <SettingsSection title="Appearance">
        <SettingsRow label="Theme">
          <div className="caption-choices" role="group" aria-label="Caption theme">
            {Object.entries(CAPTION_THEMES).map(([value, theme]) => (
              <Button key={value} variant="outline" aria-pressed={preferences.theme === value} onClick={() => change({ theme: value as CaptionPreferences["theme"], opacity: theme.opacity, color: theme.color })}>{theme.label}</Button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="Background opacity" htmlFor="caption-opacity">
          <div className="volume">
            <input id="caption-opacity" type="range" min={0} max={100} value={preferences.opacity} style={{ "--volume": `${preferences.opacity}%` } as CSSProperties} onChange={(event) => change({ opacity: Number(event.target.value) })} />
            <span className="tabular">{Math.round(preferences.opacity)} %</span>
          </div>
        </SettingsRow>
        <SettingsRow label="Text color" htmlFor="caption-color">
          <Input id="caption-color" className="caption-color" type="color" value={preferences.color} onChange={(event) => change({ color: event.target.value })} />
        </SettingsRow>
      </SettingsSection>
      {error && <p className="call-error" role="alert">{error}</p>}
      <div className="settings-footer"><Button variant="outline" onClick={() => change({ ...DEFAULT_CAPTION_PREFERENCES, monitor: undefined })}>Restore defaults</Button></div>
    </>
  );
}

const TABS = [
  { id: "general", label: "General" },
  { id: "captions", label: "Floating captions" },
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
  onCaptionPreview,
  captionError,
  onMacSetup,
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
  onCaptionPreview: (visible: boolean) => void;
  captionError: string | null;
  onMacSetup: () => void;
}) {
  const [tab, setTab] = useState<TabId>("general");
  const [account] = useState(loadOnboardingAccount);
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
                <FirstNameField initial={account?.firstName ?? ""} />
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
          <>
            {desktopAvailable() && <SettingsSection title="Mac setup"><SettingsRow label="Meeting permissions and virtual microphone" hint="Review access, finish installation, or fix a changed permission."><Button variant="outline" disabled={busy} onClick={onMacSetup}>Review Mac setup</Button></SettingsRow></SettingsSection>}
            <MicrophoneSettings />
          </>
        )}
        {tab === "captions" && <CaptionSettings onPreview={onCaptionPreview} busy={busy} previewError={captionError} />}
      </div>
    </section>
  );
}

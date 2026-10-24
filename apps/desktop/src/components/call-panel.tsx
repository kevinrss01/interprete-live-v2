import {
  useCallback,
  useEffect,
  useImperativeHandle,
  type Ref,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Captions,
  Headphones,
  LoaderCircle,
  Mic,
  Phone,
  RefreshCw,
  Square,
} from "lucide-react";
import type { Profile, SpeakerId } from "@interprete/shared/contracts";
import { LANGUAGES, languageName } from "@interprete/shared/languages";
import { InterpreterController } from "../lib/interpreter";
import { MicrophoneCapture } from "../lib/audio";
import {
  CallAudioPlayer,
  answerCall,
  callSnapshot,
  desktopAvailable,
  enableCallMonitor,
  endSimulatedCall,
  onCallAccepted,
  onCallStatus,
  outputDevices,
  physicalMicrophones,
  physicalInputNames,
  requirePhysicalMicrophone,
  simulateCall,
  loadCallOptions,
  saveCallOptions,
  type AcceptedCall,
  type CallOptions,
  type CallSnapshot,
  type DetectedCall,
  type OutputDevice,
} from "../lib/calls";
import type { OverlayUpdate } from "../lib/translation-overlay";
import { CallListening } from "../lib/call-listening";
import {
  captionLines,
  previewFrames,
  useCallCaptions,
  type CaptionLine,
  type CaptionsUpdate,
} from "../lib/call-captions";
import { CallOptionChecks } from "./call-options";
import { CaptionsView } from "./call-captions";

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function preference(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export type CallPanelHandle = { stop: (sessionId: string) => void };

export function CallPanel({
  visible,
  onOpen,
  beforeStart,
  profiles,
  onLanguage,
  onBusy,
  onOverlayChange,
  ref,
}: {
  ref?: Ref<CallPanelHandle>;
  onOverlayChange: (overlay: OverlayUpdate | null) => void;
  visible: boolean;
  onOpen: () => void;
  beforeStart: () => void;
  onBusy: (busy: boolean) => void;
  profiles: Record<SpeakerId, Profile>;
  onLanguage: (id: SpeakerId, language: Profile["language"]) => void;
}) {
  const native = desktopAvailable();
  const [monitor, setMonitor] = useState<CallSnapshot | null>(null);
  const [enabled, setEnabled] = useState(
    () => preference("interprete-call-detection") !== "off",
  );
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<OutputDevice[]>([]);
  const [input, setInput] = useState(() => preference("interprete-call-input"));
  const [output, setOutput] = useState(
    () => preference("interprete-call-output") || "BlackHole 2ch",
  );
  const [route, setRoute] = useState<"virtual" | "local">("virtual");
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [overlayPreview, setOverlayPreview] = useState(false);
  const overlayId = useRef<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptedCall | null>(null);
  const [callOptions, setCallOptions] = useState<CallOptions>(loadCallOptions);
  const [listening] = useState(() => new CallListening({ native }));
  const listen = useSyncExternalStore(
    listening.subscribe,
    listening.getSnapshot,
    listening.getServerSnapshot,
  );
  const incoming = useSyncExternalStore(
    listening.controller.subscribe,
    listening.controller.getSnapshot,
    listening.controller.getServerSnapshot,
  );
  const listenBusy = listen.sessionId !== null;
  const [captionsPreview, setCaptionsPreview] = useState<CaptionLine[] | null>(null);
  const [captionsError, setCaptionsError] = useState<string | null>(null);
  const previewId = useRef("");
  const previewTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [session, setSession] = useState<{
    mode: "virtual" | "local";
    demo: boolean;
    callId?: string;
  } | null>(null);
  const inputRef = useRef(input);
  const routeRef = useRef(route);
  routeRef.current = route;
  const activeCallRef = useRef<string | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const [audio] = useState(
    () =>
      new CallAudioPlayer((message) => {
        setError(message);
        runtime.current?.cancel(false);
      }),
  );
  const runtime = useRef<InterpreterController | null>(null);
  const [controller] = useState(
    () =>
      new InterpreterController({
        player: audio,
        capture: (options) =>
          new MicrophoneCapture({
            ...options,
            deviceId: inputRef.current,
            recordSample: false,
            echoCancellation: routeRef.current !== "virtual",
          }),
      }),
  );
  runtime.current = controller;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const busy = preparing || state.phase !== "idle";
  const anyBusy = busy || listenBusy;
  useEffect(() => onBusy(anyBusy), [anyBusy, onBusy]);
  const busyRef = useRef(false);
  const startGeneration = useRef(0);
  const handleAccept = useRef<(call: AcceptedCall) => void>(() => {});
  inputRef.current = input;

  async function refresh(permission = false) {
    setError(null);
    try {
      if (permission) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        stream.getTracks().forEach((track) => track.stop());
      }
      const [devices, destinations, physicalNames] = await Promise.all([
        navigator.mediaDevices.enumerateDevices(),
        native ? outputDevices() : Promise.resolve([]),
        native ? physicalInputNames() : Promise.resolve(undefined),
      ]);
      const microphones = physicalMicrophones(devices, physicalNames);
      setInputs(microphones);
      setOutputs(destinations.filter((d) => d.virtualMic));
      if (
        microphones.length &&
        !microphones.some((d) => d.deviceId === inputRef.current)
      ) {
        setInput(microphones[0].deviceId);
        save("interprete-call-input", microphones[0].deviceId);
        save("interprete-call-input-label", microphones[0].label);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const stopMicrophone = useCallback(() => {
    ++startGeneration.current;
    busyRef.current = false;
    setOverlayPreview(false);
    controller.cancel();
    setPreparing(false);
    setSession(null);
    activeCallRef.current = null;
  }, [controller]);
  // The pill, Escape, the end of the call and leaving call mode stop every direction.
  const stop = useCallback(() => {
    stopMicrophone();
    listening.stop();
  }, [stopMicrophone, listening]);
  useImperativeHandle(
    ref,
    () => ({
      stop: (sessionId: string) => {
        // The parent/native snapshot may still describe the previous session.
        if (overlayId.current === sessionId) stop();
      },
    }),
    [stop],
  );
  useEffect(() => {
    // One pill for the call: the microphone direction when active, otherwise the participants'.
    const phase = busy ? state.phase : incoming.phase;
    if (!anyBusy && !overlayPreview) overlayId.current = null;
    onOverlayChange(
      (anyBusy || overlayPreview) && overlayId.current
        ? {
            sessionId: overlayId.current,
            phase: overlayPreview
              ? "preview"
              : phase === "idle"
                ? "connecting"
                : phase,
            source: busy ? profiles.a.language : profiles.b.language,
            target: busy ? profiles.b.language : profiles.a.language,
            test: busy
              ? session?.mode === "local" || !!session?.demo
              : listen.demo,
          }
        : null,
    );
  }, [
    busy,
    anyBusy,
    overlayPreview,
    state.phase,
    incoming.phase,
    profiles.a.language,
    profiles.b.language,
    session?.mode,
    session?.demo,
    listen.demo,
    onOverlayChange,
  ]);
  useEffect(() => () => onOverlayChange(null), [onOverlayChange]);
  async function start(demo = false, call?: DetectedCall) {
    if (busyRef.current || state.phase !== "idle") return;
    busyRef.current = true;
    if (overlayPreview) overlayId.current = null;
    overlayId.current ??= crypto.randomUUID();
    setOverlayPreview(false);
    const generation = ++startGeneration.current;
    setPreparing(true);
    setError(null);
    activeCallRef.current = call?.id ?? null;
    try {
      if (call && native) {
        const current = await callSnapshot();
        if (!current.accepted || current.call?.id !== call.id)
          throw new Error("Cet appel n’est plus actif ou autorisé.");
      }
      if (
        route === "virtual" &&
        (!native || !outputs.some((d) => d.name === output))
      )
        throw new Error(
          "Installez BlackHole 2ch puis actualisez, ou choisissez Écoute locale pour tester.",
        );
      if (!demo)
        requirePhysicalMicrophone(
          await navigator.mediaDevices.enumerateDevices(),
          input,
          native ? await physicalInputNames() : undefined,
        );
      if (generation !== startGeneration.current) return;
      beforeStart();
      audio.configure(route === "virtual" ? output : null);
      await controller.init();
      if (generation !== startGeneration.current) return;
      for (const id of ["a", "b"] as const)
        controller.setProfile(id, profiles[id]);
      activeCallRef.current = call?.id ?? null;
      setSession({ mode: route, demo, callId: call?.id });
      await controller.start("a", demo);
      // Cancellation already stopped this attempt; a newer attempt may now own the controller.
      if (generation !== startGeneration.current) return;
    } catch (e) {
      if (generation === startGeneration.current) {
        setError(errorMessage(e));
        setSession(null);
        activeCallRef.current = null;
      }
    } finally {
      if (generation === startGeneration.current) {
        setPreparing(false);
        busyRef.current = false;
      }
    }
  }
  async function startListening({
    call,
    demo = false,
    options = callOptions,
  }: {
    call?: DetectedCall;
    demo?: boolean;
    options?: CallOptions;
  }) {
    setError(null);
    if (!options.captions && !options.voice) {
      setError("Choisissez les sous-titres, la voix traduite, ou les deux.");
      return;
    }
    if (!native && !demo) {
      setError(
        "Le son d’un appel ne peut être capté que dans l’app macOS. Essayez « Sous-titrer l’exemple audio ».",
      );
      return;
    }
    stopCaptionsPreview();
    setLingering(null);
    beforeStart();
    if (overlayPreview) overlayId.current = null;
    overlayId.current ??= crypto.randomUUID();
    setOverlayPreview(false);
    // A manual start during a detected call follows that call: its app's audio, and its end.
    const current = demo ? undefined : (call ?? monitor?.call ?? undefined);
    await listening.start({
      profiles,
      options: { captions: options.captions, voice: options.voice },
      app: current?.app ?? null,
      callId: current?.id ?? null,
      demo,
    });
  }
  handleAccept.current = (call) => {
    setAccepted(call);
    setCallOptions(call.options);
    onOpenRef.current();
    if (call.options.captions || call.options.voice)
      void startListening({ call, options: call.options });
    // A saved, valid route can start directly from the native approval. Otherwise show setup.
    if (
      call.options.microphone &&
      inputs.some((d) => d.deviceId === input) &&
      outputs.some((d) => d.name === output) &&
      route === "virtual"
    )
      void start(false, call);
  };
  function chooseOptions(next: CallOptions) {
    setCallOptions(next);
    saveCallOptions(next);
  }
  function stopCaptionsPreview() {
    if (previewTimer.current) clearInterval(previewTimer.current);
    previewTimer.current = null;
    setCaptionsPreview(null);
  }
  // A local preview of the captions window: no capture, no provider.
  function previewCaptions() {
    stopCaptionsPreview();
    const frames = previewFrames(profiles.a.language);
    let index = 0;
    previewId.current = crypto.randomUUID();
    setCaptionsPreview(frames[0]);
    previewTimer.current = setInterval(() => {
      index++;
      if (index < frames.length) setCaptionsPreview(frames[index]);
      else if (index > frames.length + 14) stopCaptionsPreview();
    }, 170);
  }
  const live: CaptionsUpdate | null =
    listen.sessionId && listen.options.captions
      ? {
          sessionId: listen.sessionId,
          status: incoming.phase === "connecting" || incoming.phase === "idle" ? "starting" : "listening",
          source: profiles.b.language,
          target: profiles.a.language,
          lines: captionLines(incoming.turns),
        }
      : null;
  // When a sample finishes on its own, its last captions stay readable before the window closes.
  const lastCaptions = useRef<CaptionsUpdate | null>(null);
  const [lingering, setLingering] = useState<CaptionsUpdate | null>(null);
  useEffect(() => {
    if (live) lastCaptions.current = live;
  });
  useEffect(() => {
    const last = lastCaptions.current;
    if (listen.sessionId) lastCaptions.current = live;
    if (listen.sessionId || listen.ended !== "finished" || !last?.lines.length) {
      setLingering(null);
      return;
    }
    lastCaptions.current = null;
    setLingering({ ...last, lines: last.lines.map((line) => ({ ...line, live: false })) });
    const timer = setTimeout(() => setLingering(null), 6000);
    return () => clearTimeout(timer);
  }, [listen.sessionId, listen.ended]);
  const captions: CaptionsUpdate | null = captionsPreview
    ? {
        sessionId: previewId.current,
        status: "preview",
        source: profiles.b.language,
        target: profiles.a.language,
        lines: captionsPreview,
      }
    : (live ?? lingering);
  useCallCaptions(captions, setCaptionsError);
  useEffect(() => {
    if (!native) return;
    let mounted = true;
    const status = onCallStatus((snapshot) => {
      if (!mounted) return;
      setMonitor(snapshot);
      const active = activeCallRef.current;
      if (active && snapshot.call?.id !== active) stopMicrophone();
      const listened = listening.getSnapshot().callId;
      if (listened && snapshot.call?.id !== listened) listening.stop();
      setAccepted((previous) =>
        previous && snapshot.call?.id !== previous.id ? null : previous,
      );
    });
    const approval = onCallAccepted((call) => {
      void callSnapshot()
        .then((snapshot) => {
          if (mounted && snapshot.accepted && snapshot.call?.id === call.id)
            handleAccept.current(call);
        })
        .catch((error) => {
          if (mounted) setError(errorMessage(error));
        });
    });
    void Promise.all([status, approval])
      .then(async () => {
        if (!mounted) return;
        await enableCallMonitor(
          preference("interprete-call-detection") !== "off",
        );
        const snapshot = await callSnapshot();
        if (mounted) setMonitor(snapshot);
      })
      .catch((e) => {
        if (mounted) setError(errorMessage(e));
      });
    return () => {
      mounted = false;
      void status.then(
        (off) => off(),
        () => {},
      );
      void approval.then(
        (off) => off(),
        () => {},
      );
    };
  }, [native, controller, stopMicrophone, listening]);
  useEffect(() => {
    void refresh();
    const changed = () => {
      void refresh();
    };
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () =>
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
    // Refresh on actual device changes, preserving the current selection through state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!visible) stop();
  }, [visible, stop]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && visible) stop();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [stop, visible]);
  useEffect(
    () => () => {
      ++startGeneration.current;
      controller.dispose();
    },
    [controller],
  );
  useEffect(() => () => listening.dispose(), [listening]);
  useEffect(
    () => () => {
      if (previewTimer.current) clearInterval(previewTimer.current);
    },
    [],
  );
  // The toast saves its choices in the shared storage of the app's windows.
  useEffect(() => {
    const changed = () => setCallOptions(loadCallOptions());
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    if (state.phase === "idle" && !preparing) {
      setSession(null);
      activeCallRef.current = null;
    }
  }, [state.phase, preparing]);
  async function toggle(enabled: boolean) {
    setEnabled(enabled);
    save("interprete-call-detection", enabled ? "on" : "off");
    try {
      await enableCallMonitor(enabled);
      if (!enabled) stop();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function simulate() {
    setError(null);
    if (!native) {
      setMonitor({
        supported: false,
        enabled: false,
        accepted: false,
        dismissed: false,
        error: null,
        call: {
          id: "browser-test",
          app: "Google Meet · aperçu web",
          simulated: true,
        },
      });
      return;
    }
    try {
      await simulateCall();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const latest = state.turns.at(-1);
  return (
    <section
      className="call-panel"
      hidden={!visible}
      aria-labelledby="calls-title"
    >
      <div className="call-intro">
        <div>
          <h1 id="calls-title">Comprendre et vous faire comprendre.</h1>
          <p>
            Sous-titrez ou écoutez vos interlocuteurs dans votre langue, et
            traduisez votre micro pendant Meet, Zoom ou Teams.
          </p>
        </div>
        <Phone size={24} aria-hidden="true" />
      </div>
      <div className="call-detection">
        <label>
          <input
            type="checkbox"
            checked={enabled && native}
            disabled={!native}
            onChange={(e) => void toggle(e.target.checked)}
          />{" "}
          Détecter les appels sur ce Mac
        </label>
        <span className="note" role="status">
          {!native
            ? "La détection et le micro virtuel nécessitent l’app macOS."
            : (monitor?.error ??
              (monitor?.supported
                ? "Détection locale · confirmation avant capture"
                : "Détection automatique : macOS 14.2 ou plus récent"))}
        </span>
      </div>
      {monitor?.call && !monitor.accepted && !monitor.dismissed && (
        <div className="call-notice" role="status">
          <span>
            {monitor.call.app} —{" "}
            {monitor.call.simulated ? "simulation" : "microphone actif"}
          </span>
          <button
            className="btn"
            type="button"
            disabled={
              anyBusy ||
              !(callOptions.captions || callOptions.voice || callOptions.microphone)
            }
            onClick={() => {
              const call = monitor.call!;
              if (native)
                void answerCall(call.id, true, callOptions).catch((e) =>
                  setError(errorMessage(e)),
                );
              else {
                setMonitor({ ...monitor, accepted: true });
                handleAccept.current({ ...call, options: callOptions });
              }
            }}
          >
            Traduire l’appel
          </button>
        </div>
      )}
      {accepted?.options.microphone && !busy && (
        <p className="call-notice" role="status">
          {accepted.app} : accord reçu. Vérifiez les périphériques puis démarrez
          la traduction.
        </p>
      )}
      <div className="call-languages">
        {(["a", "b"] as const).map((id) => (
          <label key={id}>
            {id === "a" ? "Vous parlez" : "Votre interlocuteur parle"}
            <select
              value={profiles[id].language}
              disabled={anyBusy}
              onChange={(e) =>
                onLanguage(id, e.target.value as Profile["language"])
              }
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <section className="call-listen" aria-labelledby="call-listen-title">
        <h2 id="call-listen-title">Leur voix, dans votre langue</h2>
        <CallOptionChecks
          options={callOptions}
          include={["captions", "voice"]}
          disabled={listenBusy}
          mine={profiles.a.language}
          theirs={profiles.b.language}
          onChange={chooseOptions}
        />
        <p className="note">
          Seul le son de l’application d’appel détectée est capté. Sans appel
          détecté, c’est tout le son du Mac, sauf Interprète. Avec la voix
          traduite, portez un casque pour que vos interlocuteurs ne l’entendent
          pas.
        </p>
        <div className="call-listen-status" aria-live="polite">
          <span className="call-session-status">
            <span
              className="status-dot"
              data-live={incoming.phase === "listening"}
              aria-hidden="true"
            />
            <strong>
              {!listenBusy
                ? "Traduction de leur voix arrêtée"
                : incoming.phase === "connecting" || incoming.phase === "idle"
                  ? "Connexion au son de l’appel…"
                  : incoming.phase !== "listening"
                    ? "Fin de la traduction…"
                    : listen.demo
                    ? "Exemple audio en cours"
                    : listen.scope === "app" && listen.app
                      ? `À l’écoute de ${listen.app}`
                      : "À l’écoute de tout le son du Mac"}
            </strong>
            {listenBusy && listen.options.voice && (
              <span className="note">
                {listen.voice
                  ? `Voix ${listen.voice.name} · ${
                      listen.voice.source === "jev"
                        ? "choisie par Jev"
                        : listen.voice.source === "pitch"
                          ? "proche de leur voix"
                          : "par défaut"
                    }`
                  : "Choix de la voix au premier mot…"}
              </span>
            )}
          </span>
          {listenBusy ? (
            <button
              type="button"
              className="btn call-stop"
              onClick={() => listening.stop()}
            >
              <Square size={14} fill="currentColor" aria-hidden="true" />
              Arrêter
            </button>
          ) : (
            <button
              type="button"
              className="btn call-primary"
              disabled={!(callOptions.captions || callOptions.voice)}
              onClick={() => void startListening({})}
            >
              <Captions size={16} aria-hidden="true" />
              Traduire leur voix
            </button>
          )}
        </div>
        {listen.notice && listenBusy && (
          <p className="note" role="status">
            {listen.notice}
          </p>
        )}
        {(listen.error || incoming.error || incoming.warning || captionsError) && (
          <p className="call-error" role="alert">
            {listen.error || incoming.error || incoming.warning || captionsError}
          </p>
        )}
      </section>
      <h2 className="call-section-title">Votre voix dans l’appel</h2>
      <fieldset className="call-routing" disabled={busy}>
        <legend>Sortie de la traduction</legend>
        <label>
          <input
            type="radio"
            name="call-route"
            value="virtual"
            checked={route === "virtual"}
            onChange={() => setRoute("virtual")}
          />{" "}
          Micro virtuel · envoyer dans l’appel
        </label>
        <label>
          <input
            type="radio"
            name="call-route"
            value="local"
            checked={route === "local"}
            onChange={() => setRoute("local")}
          />{" "}
          Écoute locale · tester au casque
        </label>
      </fieldset>
      <div className="call-devices">
        <label>
          Microphone physique
          <select
            value={input}
            disabled={busy}
            onChange={(e) => {
              setInput(e.target.value);
              save("interprete-call-input", e.target.value);
              save(
                "interprete-call-input-label",
                inputs.find((device) => device.deviceId === e.target.value)
                  ?.label || "",
              );
            }}
          >
            <option value="">Choisir le microphone…</option>
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {route === "virtual" ? "Sortie vers l’appel" : "Sortie du test"}
          <select
            value={route === "virtual" ? output : "local"}
            disabled={busy || route === "local"}
            onChange={(e) => {
              setOutput(e.target.value);
              save("interprete-call-output", e.target.value);
            }}
          >
            {route === "local" ? (
              <option value="local">Casque / sortie macOS actuelle</option>
            ) : (
              <>
                <option value="">Choisir BlackHole…</option>
                {!outputs.some((d) => d.name === output) && output && (
                  <option value={output}>{output} · non installé</option>
                )}
                {outputs.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </>
            )}
          </select>
        </label>
      </div>
      <div className="call-device-actions">
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy}
          onClick={() => void refresh(true)}
        >
          <Mic size={15} aria-hidden="true" />
          Autoriser le micro
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Actualiser
        </button>
      </div>
      <p className="note call-route-help">
        {route === "virtual" ? (
          <>
            Dans Meet / Zoom, choisissez{" "}
            <strong>{output || "BlackHole 2ch"}</strong> comme microphone et
            votre casque comme haut-parleur. Gardez le microphone physique
            sélectionné ici. La sortie système du Mac reste inchangée.
          </>
        ) : (
          "Portez un casque : la traduction sera audible sur la sortie actuelle du Mac. Ce mode ne transmet rien à un appel."
        )}
      </p>
      {route === "virtual" && !outputs.length && (
        <div className="call-setup">
          <p>
            Le pilote BlackHole 2ch est nécessaire pour présenter la traduction
            comme microphone.
          </p>
          <code>brew install blackhole-2ch</code>
          <p className="note">
            Après installation, redémarrez l’app et Meet / Zoom, puis
            actualisez. L’écoute locale fonctionne sans pilote.
          </p>
        </div>
      )}
      <div className="call-session" data-active={busy} aria-live="polite">
        <div className="call-session-status">
          <span className="status-dot" data-live={busy} aria-hidden="true" />
          <strong>
            {preparing || state.phase === "connecting"
              ? "Connexion…"
              : busy
                ? session?.mode === "virtual"
                  ? "Traduction envoyée dans l’appel"
                  : "Test en cours · écoute locale"
                : "Microphone arrêté"}
          </strong>
          {busy && (
            <meter
              min="0"
              max="1"
              value={state.level}
              aria-label="Niveau du microphone"
            />
          )}
        </div>
        {busy ? (
          <button type="button" className="btn call-stop" onClick={stopMicrophone}>
            <Square size={14} fill="currentColor" aria-hidden="true" />
            Arrêter la traduction
          </button>
        ) : (
          <button
            type="button"
            className="btn call-primary"
            onClick={() => void start(false, accepted ?? undefined)}
          >
            <Mic size={16} aria-hidden="true" />
            {route === "virtual"
              ? "Traduire mon micro dans l’appel"
              : "Tester mon micro au casque"}
          </button>
        )}
      </div>
      {(error || state.error || state.warning) && (
        <p className="call-error" role="alert">
          {error || state.error || state.warning}
        </p>
      )}
      <div className="call-test">
        <h2>Essayer avant votre appel</h2>
        <p className="note">
          Simulez la détection, ou utilisez une voix synthétique pour vérifier
          la traduction {languageName(profiles.a.language)} →{" "}
          {languageName(profiles.b.language)}, ou celle de votre interlocuteur
          vers le {languageName(profiles.a.language).toLowerCase()}, sans
          ouvrir le micro.
        </p>
        <div className="call-actions">
          <button
            type="button"
            className="btn"
            disabled={anyBusy || overlayPreview}
            onClick={() => {
              overlayId.current = crypto.randomUUID();
              setOverlayPreview(true);
            }}
          >
            Tester la pastille
          </button>
          <button
            type="button"
            className="btn"
            disabled={listenBusy || !!captionsPreview}
            onClick={previewCaptions}
          >
            <Captions size={15} aria-hidden="true" />
            Tester les sous-titres
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !!monitor?.call}
            onClick={() => void simulate()}
          >
            <Phone size={15} aria-hidden="true" />
            Simuler un appel
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void start(true)}
          >
            <Headphones size={15} aria-hidden="true" />
            Traduire l’exemple audio
          </button>
          <button
            type="button"
            className="btn"
            disabled={listenBusy}
            onClick={() => void startListening({ demo: true })}
          >
            <Captions size={15} aria-hidden="true" />
            Sous-titrer l’exemple audio
          </button>
          {monitor?.call?.simulated && (
            <button
              className="btn btn-quiet"
              type="button"
              onClick={() => {
                stop();
                setAccepted(null);
                if (native)
                  void endSimulatedCall().catch((e) =>
                    setError(errorMessage(e)),
                  );
                else setMonitor(null);
              }}
            >
              Terminer la simulation
            </button>
          )}
        </div>
      </div>
      {latest && (
        <div className="call-transcript" aria-live="polite">
          <p className="note">
            {latest.demo ? "Exemple synthétique" : "Votre microphone"} ·{" "}
            {latest.status === "done"
              ? "Terminé"
              : busy
                ? "En direct"
                : "Arrêté"}
          </p>
          <p>{latest.source || "En attente de parole…"}</p>
          <p className="call-translation">
            {latest.translation ||
              (busy ? "La traduction apparaîtra ici…" : "Aucune traduction.")}
          </p>
          {busy && !latest.translation && (
            <LoaderCircle
              size={16}
              className="spin"
              aria-label="Traduction en cours"
            />
          )}
        </div>
      )}
      {!native && captions && (
        <div className="captions-browser">
          <CaptionsView captions={captions} />
        </div>
      )}
    </section>
  );
}

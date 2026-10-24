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
  ArrowLeftRight,
  Captions,
  ChevronDown,
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
import {
  APP_MICROPHONE_NAME,
  preferredOutput,
  displayedOutputs,
  savedRoute,
} from "../lib/call-preferences";
import type { OverlayUpdate } from "../lib/translation-overlay";
import { CallListening } from "../lib/call-listening";
import {
  captionLines,
  previewFrames,
  useCallCaptions,
  type CaptionLine,
  type CaptionsUpdate,
} from "../lib/call-captions";
import { CallOptionChecks } from "../components/call-options";
import { CaptionsView } from "../windows/call-captions";
import { Checkbox } from "@interprete/ui/components/checkbox";
import { Label } from "@interprete/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@interprete/ui/components/select";

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
    () => preference("interprete-call-output") || APP_MICROPHONE_NAME,
  );
  const [route, setRoute] = useState<"virtual" | "local">(() =>
    savedRoute(preference("interprete-call-route")),
  );
  const [autoSystemMicrophone, setAutoSystemMicrophone] = useState(
    () => preference("interprete-system-microphone") !== "off",
  );
  const outputRef = useRef(output);
  useEffect(() => save("interprete-call-route", route), [route]);
  useEffect(
    () =>
      save("interprete-system-microphone", autoSystemMicrophone ? "on" : "off"),
    [autoSystemMicrophone],
  );
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
      const [deviceResult, outputResult, namesResult] =
        await Promise.allSettled([
          navigator.mediaDevices.enumerateDevices(),
          native ? outputDevices() : Promise.resolve([]),
          native ? physicalInputNames() : Promise.resolve(undefined),
        ]);
      if (deviceResult.status === "rejected") throw deviceResult.reason;
      if (namesResult.status === "rejected") throw namesResult.reason;
      const microphones = physicalMicrophones(
        deviceResult.value,
        namesResult.value,
      );
      setInputs(microphones);
      if (
        microphones.length &&
        !microphones.some((device) => device.deviceId === inputRef.current)
      ) {
        const alias = deviceResult.value.find(
          (device) =>
            device.kind === "audioinput" && device.deviceId === "default",
        );
        const selected =
          microphones.find((device) => device.label === alias?.label) ??
          microphones[0];
        inputRef.current = selected.deviceId;
        setInput(selected.deviceId);
        save("interprete-call-input", selected.deviceId);
        save("interprete-call-input-label", selected.label);
      }
      if (outputResult.status === "fulfilled") {
        const destinations = displayedOutputs(outputResult.value);
        setOutputs(destinations);
        const selected = preferredOutput(destinations, outputRef.current);
        outputRef.current = selected;
        setOutput(selected);
        save("interprete-call-output", selected);
      } else setError(errorMessage(outputResult.reason));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const stopMicrophone = useCallback(() => {
    ++startGeneration.current;
    busyRef.current = false;
    if (!listening.getSnapshot().sessionId) overlayId.current = null;
    setOverlayPreview(false);
    controller.cancel();
    setPreparing(false);
    setSession(null);
    activeCallRef.current = null;
  }, [controller, listening]);
  // The pill, Escape, the end of the call and leaving call mode stop every direction.
  const stop = useCallback(() => {
    overlayId.current = null;
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
    if (!listening.getSnapshot().sessionId) overlayId.current = crypto.randomUUID();
    else overlayId.current ??= crypto.randomUUID();
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
      let destination: string | null = null;
      if (route === "virtual") {
        if (!native)
          throw new Error(
            "Ouvrez l’app macOS pour utiliser le micro virtuel, ou choisissez le mode test au casque.",
          );
        const destinations = displayedOutputs(await outputDevices());
        if (generation !== startGeneration.current) return;
        if (!destinations.length)
          throw new Error(
            "Installez BlackHole 2ch, puis redémarrez le Mac et actualisez pour préparer le micro de l’app.",
          );
        destination = preferredOutput(destinations, outputRef.current);
        outputRef.current = destination;
        setOutputs(destinations);
        setOutput(destination);
        save("interprete-call-output", destination);
      }
      if (!demo) {
        let devices = await navigator.mediaDevices.enumerateDevices();
        if (generation !== startGeneration.current) return;
        const physicalNames = native ? await physicalInputNames() : undefined;
        if (generation !== startGeneration.current) return;
        let microphones = physicalMicrophones(devices, physicalNames);
        if (
          !microphones.some((device) => device.deviceId === inputRef.current)
        ) {
          const permission = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          const actual = permission.getAudioTracks()[0]?.getSettings().deviceId;
          permission.getTracks().forEach((track) => track.stop());
          if (generation !== startGeneration.current) return;
          devices = await navigator.mediaDevices.enumerateDevices();
          if (generation !== startGeneration.current) return;
          microphones = physicalMicrophones(devices, physicalNames);
          const selected =
            microphones.find(
              (device) =>
                device.deviceId === inputRef.current ||
                device.deviceId === actual,
            ) ?? microphones[0];
          if (selected) {
            inputRef.current = selected.deviceId;
            setInput(selected.deviceId);
            save("interprete-call-input", selected.deviceId);
            save("interprete-call-input-label", selected.label);
          }
        }
        setInputs(microphones);
        requirePhysicalMicrophone(devices, inputRef.current, physicalNames);
      }
      if (generation !== startGeneration.current) return;
      beforeStart();
      audio.configure(destination);
      await controller.init();
      if (generation !== startGeneration.current) return;
      for (const id of ["a", "b"] as const)
        controller.setProfile(id, profiles[id]);
      activeCallRef.current = call?.id ?? null;
      setSession({ mode: route, demo, callId: call?.id });
      await controller.start("a", demo);
      // Cancellation already stopped this attempt; a newer attempt may now own the controller.
      if (generation !== startGeneration.current) return;
      if (
        !demo &&
        route === "virtual" &&
        autoSystemMicrophone &&
        controller.getSnapshot().phase === "listening"
      ) {
        await audio.activateSystemMicrophone();
      }
    } catch (e) {
      if (generation === startGeneration.current) {
        stopMicrophone();
        setError(errorMessage(e));
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
    if (!busyRef.current && controller.getSnapshot().phase === "idle")
      overlayId.current = crypto.randomUUID();
    else overlayId.current ??= crypto.randomUUID();
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
    if (call.options.microphone && route === "virtual") void start(false, call);
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
    // Only a session change decides whether captions linger; live text is read from the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (
      state.phase === "idle" &&
      !preparing &&
      !busyRef.current &&
      controller.getSnapshot().phase === "idle"
    ) {
      if (session) audio.stop();
      setSession(null);
      activeCallRef.current = null;
    }
  }, [state.phase, preparing, session, audio, controller]);
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
  const outputOptions = [
    ...(output && !outputs.some((d) => d.name === output)
      ? [{ value: output, label: `${output} · non installé` }]
      : []),
    ...outputs.map((d) => ({ value: d.name, label: d.name })),
  ];
  return (
    <section
      className="call-panel"
      hidden={!visible}
      aria-labelledby="calls-title"
    >
      <div className="call-intro">
        <h1 id="calls-title">Comprendre et vous faire comprendre.</h1>
        <p>
          Sous-titrez ou écoutez vos interlocuteurs dans votre langue, et
          envoyez votre voix traduite dans Meet, Zoom ou Teams.
        </p>
      </div>
      {monitor?.call && !monitor.accepted && !monitor.dismissed && (
        <div className="call-notice" role="status">
          <span>
            <strong>{monitor.call.app}</strong> ·{" "}
            {monitor.call.simulated ? "simulation" : "appel détecté"}
          </span>
          <button
            className="btn call-primary"
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
          {accepted.app} : accord reçu. Vérifiez le son puis démarrez la
          traduction.
        </p>
      )}
      <div className="call-section">
        <h2>Langues</h2>
        <div className="call-languages">
          <CallSelect
            id="call-language-a"
            label="Vous parlez"
            value={profiles.a.language}
            disabled={anyBusy}
            options={LANGUAGE_OPTIONS}
            onChange={(value) => onLanguage("a", value as Profile["language"])}
          />
          <ArrowLeftRight
            size={16}
            className="call-languages-arrow"
            aria-hidden="true"
          />
          <CallSelect
            id="call-language-b"
            label="Ils parlent"
            value={profiles.b.language}
            disabled={anyBusy}
            options={LANGUAGE_OPTIONS}
            onChange={(value) => onLanguage("b", value as Profile["language"])}
          />
        </div>
      </div>
      <div className="call-section">
        <h2>Leur voix</h2>
        <div className="call-section-body">
          <CallOptionChecks
            options={callOptions}
            include={["captions", "voice"]}
            disabled={listenBusy}
            mine={profiles.a.language}
            theirs={profiles.b.language}
            onChange={chooseOptions}
          />
          <p className="note">
            Seul le son de l’application d’appel détectée est capté ; sans
            appel détecté, tout le son du Mac, sauf Interprète. Avec la voix
            traduite, portez un casque pour que vos interlocuteurs ne
            l’entendent pas.
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
                  ? "Prêt à traduire leur voix"
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
        </div>
      </div>
      <div className="call-section">
        <h2>Votre voix</h2>
        <div className="call-section-body">
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
                    : "Prêt à traduire"}
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
                Désactiver la traduction
              </button>
            ) : (
              <button
                type="button"
                className="btn call-primary"
                onClick={() => void start(false, accepted ?? undefined)}
              >
                <Mic size={16} aria-hidden="true" />
                {route === "virtual"
                  ? "Activer la traduction"
                  : "Démarrer le test au casque"}
              </button>
            )}
          </div>
          <details className="call-advanced">
            <summary>Réglages du micro et mode test</summary>
            <fieldset className="segmented" disabled={busy}>
              <legend className="sr-only">Sortie de la traduction</legend>
              <label>
                <input
                  type="radio"
                  name="call-route"
                  value="virtual"
                  checked={route === "virtual"}
                  onChange={() => setRoute("virtual")}
                />
                <span>Envoyer dans l’appel</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="call-route"
                  value="local"
                  checked={route === "local"}
                  onChange={() => setRoute("local")}
                />
                <span>Tester au casque</span>
              </label>
            </fieldset>
            <div className="call-devices" data-route={route}>
              <CallSelect
                id="call-input"
                label="Microphone"
                value={input}
                placeholder="Choisir le microphone…"
                disabled={busy}
                options={inputs.map((d) => ({ value: d.deviceId, label: d.label }))}
                onChange={(value) => {
                  inputRef.current = value;
                  setInput(value);
                  save("interprete-call-input", value);
                  save(
                    "interprete-call-input-label",
                    inputs.find((device) => device.deviceId === value)?.label ||
                      "",
                  );
                }}
              />
              {route === "virtual" && (
                <CallSelect
                  id="call-output"
                  label="Sortie vers l’appel"
                  value={output}
                  placeholder="Micro de l’app…"
                  disabled={busy}
                  options={outputOptions}
                  onChange={(value) => {
                    outputRef.current = value;
                    setOutput(value);
                    save("interprete-call-output", value);
                  }}
                />
              )}
            </div>
            <p className="note">
              {route === "virtual" ? (
                <>
                  Dans l’appel, choisissez{" "}
                  <strong>
                    {autoSystemMicrophone
                      ? "Système / Par défaut"
                      : output || APP_MICROPHONE_NAME}
                  </strong>{" "}
                  comme microphone et votre casque comme haut-parleur.{" "}
                  {autoSystemMicrophone &&
                    "L’app bascule l’entrée système puis rétablit votre micro à l’arrêt."}
                </>
              ) : (
                "La traduction est lue sur la sortie actuelle du Mac. Rien n’est envoyé dans l’appel."
              )}
            </p>
            {route === "virtual" && !outputs.length && (
              <div className="call-setup">
                <p>
                  Installez le pilote BlackHole 2ch pour présenter la traduction
                  comme microphone :
                </p>
                <code>brew install blackhole-2ch</code>
                <p className="note">
                  Redémarrez ensuite l’app et votre logiciel d’appel, puis
                  actualisez.
                </p>
              </div>
            )}
            {native && route === "virtual" && (
              <label className="check">
                <Checkbox
                  checked={autoSystemMicrophone}
                  disabled={busy}
                  onCheckedChange={setAutoSystemMicrophone}
                />
                <span>
                  <strong>Utiliser le micro de l’app comme micro système</strong>
                  <small>Votre micro précédent est rétabli à l’arrêt.</small>
                </span>
              </label>
            )}
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
          </details>
        </div>
      </div>
      <div className="call-section">
        <h2>Détection</h2>
        <label className="check" data-disabled={!native}>
          <Checkbox
            checked={enabled && native}
            disabled={!native}
            onCheckedChange={(checked) => void toggle(checked)}
          />
          <span>
            <strong>Proposer la traduction quand un appel commence</strong>
            <small role="status">
              {!native
                ? "Nécessite l’app macOS."
                : (monitor?.error ??
                  (monitor?.supported
                    ? "Détection locale. Rien n’est capté sans votre accord."
                    : "Nécessite macOS 14.2 ou plus récent."))}
            </small>
          </span>
        </label>
      </div>
      {(error || state.error || state.warning) && (
        <p className="call-error" role="alert">
          {error || state.error || state.warning}
        </p>
      )}
      <details className="call-test">
        <summary>
          Essayer sans appel
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <p className="note">
          Vérifiez la traduction {languageName(profiles.a.language)} →{" "}
          {languageName(profiles.b.language)}, ou celle de vos interlocuteurs
          vers le {languageName(profiles.a.language).toLowerCase()}, sans ouvrir
          le micro, ou simulez un appel.
        </p>
        <div className="call-actions">
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
            disabled={anyBusy || overlayPreview}
            onClick={() => {
              overlayId.current = crypto.randomUUID();
              setOverlayPreview(true);
            }}
          >
            Tester la pastille
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
      </details>
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

const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({
  value: l.code,
  label: l.native,
}));

function CallSelect({
  id,
  label,
  value,
  placeholder,
  options,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <Label htmlFor={id}>{label}</Label>
      <Select
        items={options}
        value={value || null}
        disabled={disabled}
        onValueChange={(next) => {
          if (typeof next === "string" && next) onChange(next);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="pl-3">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

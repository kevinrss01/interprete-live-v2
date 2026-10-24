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
  const [accepted, setAccepted] = useState<DetectedCall | null>(null);
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
  useEffect(() => onBusy(busy), [busy, onBusy]);
  const busyRef = useRef(false);
  const startGeneration = useRef(0);
  const handleAccept = useRef<(call: DetectedCall) => void>(() => {});

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
  const stop = useCallback(() => {
    ++startGeneration.current;
    busyRef.current = false;
    overlayId.current = null;
    setOverlayPreview(false);
    controller.cancel();
    setPreparing(false);
    setSession(null);
    activeCallRef.current = null;
  }, [controller]);
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
    onOverlayChange(
      (busy || overlayPreview) && overlayId.current
        ? {
            sessionId: overlayId.current,
            phase: overlayPreview
              ? "preview"
              : state.phase === "idle"
                ? "connecting"
                : state.phase,
            source: profiles.a.language,
            target: profiles.b.language,
            test: session?.mode === "local" || !!session?.demo,
          }
        : null,
    );
  }, [
    busy,
    overlayPreview,
    state.phase,
    profiles.a.language,
    profiles.b.language,
    session?.mode,
    session?.demo,
    onOverlayChange,
  ]);
  useEffect(() => () => onOverlayChange(null), [onOverlayChange]);
  async function start(demo = false, call?: DetectedCall) {
    if (busyRef.current || state.phase !== "idle") return;
    busyRef.current = true;
    overlayId.current = crypto.randomUUID();
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
        stop();
        setError(errorMessage(e));
      }
    } finally {
      if (generation === startGeneration.current) {
        setPreparing(false);
        busyRef.current = false;
      }
    }
  }
  handleAccept.current = (call) => {
    setAccepted(call);
    onOpenRef.current();
    // A saved, valid route can start directly from the native approval. Otherwise show setup.
    if (
      inputs.some((d) => d.deviceId === input) &&
      outputs.some((d) => d.name === output) &&
      route === "virtual"
    )
      void start(false, call);
  };
  useEffect(() => {
    if (!native) return;
    let mounted = true;
    const status = onCallStatus((snapshot) => {
      if (!mounted) return;
      setMonitor(snapshot);
      const active = activeCallRef.current;
      if (active && snapshot.call?.id !== active) {
        stop();
      }
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
  }, [native, controller, stop]);
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
  useEffect(() => {
    if (state.phase === "idle" && !preparing && !overlayPreview) {
      if (overlayId.current) {
        overlayId.current = null;
        audio.stop();
      }
      setSession(null);
      activeCallRef.current = null;
    }
  }, [state.phase, preparing, overlayPreview, audio]);
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
          <h1 id="calls-title">Votre voix, dans leur langue.</h1>
          <p>
            Traduisez votre microphone pendant un appel Meet, Zoom ou Teams.
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
            disabled={busy}
            onClick={() => {
              const call = monitor.call!;
              if (native)
                void answerCall(call.id, true).catch((e) =>
                  setError(errorMessage(e)),
                );
              else {
                setAccepted(call);
                setMonitor({ ...monitor, accepted: true });
              }
            }}
          >
            Traduire l’appel
          </button>
        </div>
      )}
      {accepted && !busy && (
        <p className="call-notice" role="status">
          {accepted.app} : accord reçu. Vérifiez les périphériques puis démarrez
          la traduction.
        </p>
      )}
      <div className="call-languages">
        {(["a", "b"] as const).map((id) => (
          <label key={id}>
            {id === "a" ? "Vous parlez" : "Votre interlocuteur entend"}
            <select
              value={profiles[id].language}
              disabled={busy}
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
          <button type="button" className="btn call-stop" onClick={stop}>
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
              : "Tester mon micro au casque"}
          </button>
        )}
      </div>
      {route === "virtual" && native && (
        <label className="call-auto-mic">
          <input
            type="checkbox"
            checked={autoSystemMicrophone}
            disabled={busy}
            onChange={(event) => setAutoSystemMicrophone(event.target.checked)}
          />
          Utiliser le micro de l’app comme micro système, puis restaurer le
          précédent à l’arrêt
        </label>
      )}
      <p className="note">
        Vos langues, votre micro et vos réglages sont conservés pour le prochain
        appel. La capture démarre uniquement après votre activation.
      </p>
      <details className="call-advanced">
        <summary>Réglages du micro et mode test</summary>
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
                inputRef.current = e.target.value;
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
                outputRef.current = e.target.value;
                setOutput(e.target.value);
                save("interprete-call-output", e.target.value);
              }}
            >
              {route === "local" ? (
                <option value="local">Casque / sortie macOS actuelle</option>
              ) : (
                <>
                  <option value="">Choisir le micro virtuel…</option>
                  {!outputs.some((d) => d.name === output) && output && (
                    <option value={output}>{output} · non détecté</option>
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
              {autoSystemMicrophone ? (
                <>
                  Dans Meet / Zoom, choisissez le microphone « Système / Par
                  défaut » pour suivre la bascule vers{" "}
                  <strong>{output || APP_MICROPHONE_NAME}</strong> et le retour
                  à votre micro normal.
                </>
              ) : (
                <>
                  Dans Meet / Zoom, choisissez{" "}
                  <strong>{output || APP_MICROPHONE_NAME}</strong> comme
                  microphone.
                </>
              )}{" "}
              Gardez votre casque comme haut-parleur. Votre sortie audio reste
              inchangée.
            </>
          ) : (
            "Portez un casque : la traduction sera audible sur la sortie actuelle du Mac. Ce mode ne transmet rien à un appel."
          )}
        </p>
        {route === "virtual" && !outputs.length && (
          <div className="call-setup">
            <p>
              Le pilote BlackHole 2ch est nécessaire pour présenter la
              traduction comme microphone.
            </p>
            <code>brew install blackhole-2ch</code>
            <p className="note">
              Après installation, redémarrez le Mac, puis ouvrez l’app et
              actualisez. L’écoute locale fonctionne sans pilote.
            </p>
          </div>
        )}
      </details>
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
          {languageName(profiles.b.language)} sans ouvrir le micro.
        </p>
        <div className="call-actions">
          <button
            type="button"
            className="btn"
            disabled={busy || overlayPreview}
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
    </section>
  );
}

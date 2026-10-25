import { BENCHMARK_RECORDINGS } from "../lib/benchmark-recordings";
import { BenchmarkResults } from "./benchmark";
import { BenchmarkRecorder } from "../lib/benchmark";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
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
  microphoneName,
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
  MICROPHONE_KEY,
} from "../lib/call-preferences";
import type { OverlayUpdate } from "../lib/translation-overlay";
import { CallListening } from "../lib/call-listening";
import { CallMicrophoneSync, callMicrophoneState, openCallPermissions, type MicrophoneSyncStatus } from "../lib/call-microphone";
import { meetingSetupReady } from "../lib/mac-setup";
import { CAPTION_SIZES, captionPosition, useCaptionPreferences } from "../lib/caption-preferences";
import { useDiscussion } from "../lib/use-discussion";
import {
  captionLines,
  previewFrames,
  useCallCaptions,
  type CaptionLine,
  type CaptionsUpdate,
} from "../lib/call-captions";
import { CallOptionChecks } from "../components/call-options";
import { DiscussionTurns } from "./conversation";
import { CaptionsView } from "../windows/call-captions";
import { Checkbox } from "@interprete/ui/components/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@interprete/ui/components/collapsible";
import { CallSelect } from "../components/call-select";

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

export type CallPanelHandle = {
  stop: (sessionId: string) => void;
  stopAll: () => void;
  previewCaptions: (visible: boolean) => void;
  clearDiscussion: () => void;
  openOptions: () => void;
};

export function CallPanel({
  visible,
  benchmark,
  onOpen,
  beforeStart,
  profiles,
  onLanguage,
  onBusy,
  onOverlayChange,
  onCaptionError,
  onNewDiscussion,
  onSetupRequired,
  ref,
}: {
  ref?: Ref<CallPanelHandle>;
  onOverlayChange: (overlay: OverlayUpdate | null) => void;
  onCaptionError?: (message: string | null) => void;
  visible: boolean;
  benchmark: boolean;
  onOpen: () => void;
  beforeStart: () => void;
  onBusy: (busy: boolean) => void;
  profiles: Record<SpeakerId, Profile>;
  onLanguage: (id: SpeakerId, language: Profile["language"]) => void;
  onNewDiscussion: () => void;
  onSetupRequired: () => void;
}) {
  const native = desktopAvailable();
  const [recorder] = useState(() => new BenchmarkRecorder());
  const [benchmarkVoice, setBenchmarkVoice] = useState(false);
  const [benchmarkRoute, setBenchmarkRoute] = useState<"local" | "virtual">("local");
  const captionPreferences = useCaptionPreferences();
  const [monitor, setMonitor] = useState<CallSnapshot | null>(null);
  const [enabled, setEnabled] = useState(
    () => preference("interprete-call-detection") !== "off",
  );
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<OutputDevice[]>([]);
  const [input, setInput] = useState(() => preference(MICROPHONE_KEY));
  const [output, setOutput] = useState(
    () => preference("interprete-call-output") || APP_MICROPHONE_NAME,
  );
  const [route, setRoute] = useState<"virtual" | "local">(() =>
    savedRoute(preference("interprete-call-route")),
  );
  const [microphoneSettingsOpen, setMicrophoneSettingsOpen] = useState(false);
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
  const muteSync = useRef<CallMicrophoneSync | null>(null);
  const [microphoneSync, setMicrophoneSync] = useState<MicrophoneSyncStatus>({ paused: false, notice: null });
  const [overlayPreview, setOverlayPreview] = useState(false);
  const overlayId = useRef<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptedCall | null>(null);
  const [callOptions, setCallOptions] = useState<CallOptions>(loadCallOptions);
  const [listening] = useState(() => new CallListening({ native }));
  const [sampleAudible, setSampleAudible] = useState(false);
  const [recordingFile, setRecordingFile] = useState("");
  const recordings = BENCHMARK_RECORDINGS.filter(r => r.language === profiles.b.language);
  const recording = recordings.find(r => r.file === recordingFile) ?? recordings[0];
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
  const [settingsPreview, setSettingsPreview] = useState(false);
  const [captionsError, setCaptionsError] = useState<string | null>(null);
  useEffect(() => onCaptionError?.(captionsError), [captionsError, onCaptionError]);
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
  const busy = preparing || state.phase !== "idle" || !!session;
  const anyBusy = busy || listenBusy;
  useEffect(() => {
    if (!benchmark) return;
    const unsubscribeIncoming = listening.controller.observeDiagnostics(recorder.observe);
    const unsubscribeOutgoing = controller.observeDiagnostics(recorder.observe);
    const timer = setInterval(() => recorder.sampleQueue(
      listening.controller.pendingAudioSeconds + controller.pendingAudioSeconds,
    ), 250);
    return () => {
      unsubscribeIncoming(); unsubscribeOutgoing(); clearInterval(timer);
      recorder.finish("cancelled");
    };
  }, [benchmark, controller, listening, recorder]);
  const callId = listen.callId ?? session?.callId ?? accepted?.id ?? null;
  const participantNames = {
    you: profiles.a.name,
    them: profiles.b.name,
  };
  const callTurns = useMemo(
    () => [...incoming.turns, ...state.turns].filter(turn => !turn.demo),
    [incoming.turns, state.turns],
  );
  const callTitle = listen.app || accepted?.app;
  const { messages: callMessages } = useDiscussion({
    kind: "call",
    turns: callTurns,
    names: participantNames,
    title: callTitle,
    callId,
  });
  useEffect(() => onBusy(anyBusy), [anyBusy, onBusy]);
  const busyRef = useRef(false);
  const startGeneration = useRef(0);
  const listenPreparation = useRef(0);
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
        save(MICROPHONE_KEY, selected.deviceId);
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
    muteSync.current?.stop();
    muteSync.current = null;
    setMicrophoneSync({ paused: false, notice: null });
    audio.setHoldOpen(false);
    controller.cancel();
    setPreparing(false);
    setSession(null);
    activeCallRef.current = null;
  }, [audio, controller, listening]);
  // The pill, Escape, the end of the call and leaving call mode stop every direction.
  const stop = useCallback(() => {
    ++listenPreparation.current;
    overlayId.current = null;
    stopMicrophone();
    listening.stop();
    recorder.finish("cancelled");
  }, [stopMicrophone, listening, recorder]);
  useImperativeHandle(
    ref,
    () => ({
      stopAll: () => { stop(); stopCaptionsPreview(); setLingering(null); },
      openOptions: () => {
        setMicrophoneSettingsOpen(true);
        const panel = document.querySelector<HTMLElement>(".call-panel");
        panel?.scrollIntoView({ block: "start" });
        panel?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
      },
      stop: (sessionId: string) => {
        // The parent/native snapshot may still describe the previous session.
        if (overlayId.current === sessionId) stop();
      },
      previewCaptions: (visible: boolean) => {
        setCaptionsError(null);
        setSettingsPreview(visible);
      },
      clearDiscussion: () => {
        listening.controller.clearConversation();
        runtime.current?.clearConversation();
      },
    }),
    [stop, listening],
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
              : microphoneSync.paused && !listenBusy
                ? "paused"
              : phase === "idle"
                ? "connecting"
                : phase,
            source: busy ? profiles.a.language : profiles.b.language,
            target: busy ? profiles.b.language : profiles.a.language,
            bidirectional: busy && listenBusy,
            test: busy
              ? session?.mode === "local" || !!session?.demo
              : listen.demo,
          }
        : null,
    );
  }, [
    busy,
    anyBusy,
    listenBusy,
    overlayPreview,
    state.phase,
    incoming.phase,
    profiles.a.language,
    profiles.b.language,
    session?.mode,
    session?.demo,
    microphoneSync.paused,
    listen.demo,
    onOverlayChange,
  ]);
  useEffect(() => () => onOverlayChange(null), [onOverlayChange]);
  async function start(demo = false, call?: DetectedCall) {
    if (busyRef.current || state.phase !== "idle") return;
    const selectedRoute = demo ? benchmarkRoute : route;
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
          throw new Error("This call is no longer active or authorized.");
      }
      let destination: string | null = null;
      if (selectedRoute === "virtual") {
        if (!native)
          throw new Error(
            "Open the macOS app to use the virtual microphone, or choose the headphone test mode.",
          );
        if (!demo) {
          const app = call?.app ?? monitor?.call?.app;
          const ready = await meetingSetupReady({ microphone: true, virtualMicrophone: true, accessibility: !app || app === "Chrome / Meet" || app.endsWith("/ web call") });
          if (generation !== startGeneration.current) return;
          if (!ready) { stopMicrophone(); onSetupRequired(); return; }
        }
        const destinations = displayedOutputs(await outputDevices());
        if (generation !== startGeneration.current) return;
        if (!destinations.length)
          throw new Error(
            "Install BlackHole 2ch, then restart the Mac and refresh to set up the app microphone.",
          );
        destination = preferredOutput(destinations, outputRef.current);
        outputRef.current = destination;
        setOutputs(destinations);
        setOutput(destination);
        save("interprete-call-output", destination);
      }
      const prepareMicrophone = async (current: () => boolean) => {
        let devices = await navigator.mediaDevices.enumerateDevices();
        if (!current()) return false;
        const physicalNames = native ? await physicalInputNames() : undefined;
        if (!current()) return false;
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
          if (!current()) return false;
          devices = await navigator.mediaDevices.enumerateDevices();
          if (!current()) return false;
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
            save(MICROPHONE_KEY, selected.deviceId);
            save("interprete-call-input-label", selected.label);
          }
        }
        setInputs(microphones);
        requirePhysicalMicrophone(devices, inputRef.current, physicalNames);
        return current();
      };
      if (generation !== startGeneration.current) return;
      beforeStart();
      audio.configure(destination);
      if (demo) recorder.setOutput(destination ? `Virtual microphone: ${destination}` : "Browser audio");
      await controller.init();
      if (generation !== startGeneration.current) return;
      for (const id of ["a", "b"] as const)
        controller.setProfile(id, profiles[id]);
      const currentCall = call ?? (demo ? undefined : monitor?.call ?? undefined);
      activeCallRef.current = currentCall?.id ?? null;
      setSession({ mode: selectedRoute, demo, callId: currentCall?.id });
      const begin = async (current = () => generation === startGeneration.current) => {
        if (!current()) return;
        if (!demo && !await prepareMicrophone(current)) return;
        if (!current()) return;
        await controller.start("a", demo);
        if (!current() || generation !== startGeneration.current) return;
        if (controller.getSnapshot().phase === "idle")
          throw new Error(controller.getSnapshot().error || "The microphone translation did not start.");
        if (!demo && selectedRoute === "virtual" && autoSystemMicrophone && controller.getSnapshot().phase === "listening")
          await audio.activateSystemMicrophone();
      };
      if (!demo && selectedRoute === "virtual" && native && !currentCall?.simulated) {
        audio.setHoldOpen(true);
        const sync = new CallMicrophoneSync({
          // Meet may already be muted and no longer hold a CoreAudio input when starting.
          read: () => callMicrophoneState(currentCall?.app ?? "@meet"),
          resume: begin,
          pause: () => controller.cancel(),
          changed: setMicrophoneSync,
          failed: (error) => { stopMicrophone(); setError(errorMessage(error)); },
        });
        muteSync.current = sync;
        await sync.start();
      } else await begin();
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
    recordingFile,
  }: {
    call?: DetectedCall;
    demo?: boolean;
    options?: CallOptions;
    recordingFile?: string;
  }) {
    const preparation = ++listenPreparation.current;
    setError(null);
    if (!options.captions && !options.voice) {
      setError("Choose captions, translated voice, or both.");
      return;
    }
    if (!native && !demo) {
      setError(
        "Call audio can only be captured in the macOS app. Open Benchmark to test a recording.",
      );
      return;
    }
    if (native && !demo) {
      try {
        const ready = await meetingSetupReady({ audio: true });
        if (preparation !== listenPreparation.current) return;
        if (!ready) { onSetupRequired(); return; }
      } catch (error) {
        if (preparation === listenPreparation.current) setError(errorMessage(error));
        return;
      }
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
      recording: recordingFile,
    });
  }
  async function runBenchmark(direction: "incoming" | "outgoing") {
    if (anyBusy) return;
    const incomingTest = direction === "incoming";
    const source = profiles[incomingTest ? "b" : "a"].language;
    const target = profiles[incomingTest ? "a" : "b"].language;
    if (incomingTest && !recording) return;
    const fixture = incomingTest ? recording!.file : `${source}.wav`;
    let api = "Same-origin API";
    try { api = new URL(import.meta.env.VITE_API_URL || window.location.origin).origin; } catch {}
    const runId = recorder.begin({ fixture, direction, source, target,
      voice: incomingTest ? benchmarkVoice : true,
      originalAudible: incomingTest && sampleAudible,
      output: incomingTest ? native ? "System audio (native)" : "Browser audio" : benchmarkRoute === "virtual" ? output : "Browser audio",
      api,
    });
    if (incomingTest) {
      await startListening({ demo: true, recordingFile: recording!.file, options: { ...callOptions, captions: true, voice: benchmarkVoice } });
      if (recorder.getSnapshot()[0]?.id === runId && listening.controller.getSnapshot().phase === "idle") recorder.finish("error", listening.controller.getSnapshot().error || "The recording did not start.");
    } else {
      await start(true);
      if (recorder.getSnapshot()[0]?.id === runId && controller.getSnapshot().phase === "idle") recorder.finish("error", controller.getSnapshot().error || "The outgoing test did not start. Check the output route.");
    }
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
          notice: listen.notice ? "No incoming audio. Check Interprète’s audio recording permission in System Settings." : null,
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
  const captions: CaptionsUpdate | null = settingsPreview && !listenBusy
    ? {
        sessionId: "settings-preview",
        status: "preview",
        source: "fr",
        target: "en",
        lines: [{ id: "settings", text: "Your captions, right where you want them. Move this window and adjust its appearance in Settings.", live: false }],
      }
    : captionsPreview
    ? {
        sessionId: previewId.current,
        status: "preview",
        source: profiles.b.language,
        target: profiles.a.language,
        lines: captionsPreview,
      }
    : (live ?? lingering);
  useCallCaptions(captions, setCaptionsError, captionPreferences);
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
    if (!visible) {
      stop();
      stopCaptionsPreview();
      setLingering(null);
    }
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
      ++listenPreparation.current;
      muteSync.current?.stop();
      audio.setHoldOpen(false);
      controller.dispose();
    },
    [audio, controller],
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
    if (state.phase === "idle" && state.error && muteSync.current?.active && !microphoneSync.paused) {
      const message = state.error;
      stopMicrophone();
      setError(message);
    }
  }, [state.phase, state.error, microphoneSync.paused, stopMicrophone]);
  useEffect(() => {
    if (
      state.phase === "idle" &&
      !preparing &&
      !busyRef.current &&
      controller.getSnapshot().phase === "idle"
    ) {
      if (muteSync.current?.active) return;
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
          app: "Google Meet · web preview",
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
  const outputOptions = [
    ...(output && !outputs.some((d) => d.name === output)
      ? [{ value: output, label: `${output} · not installed` }]
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
        <h1 id="calls-title" tabIndex={-1}>{benchmark ? "Benchmark" : "Understand and be understood."}</h1>
        <p>
          {benchmark ? "Replay recordings, inspect delays and compare results with the same translation engine used in calls." : "Caption or listen to the other participants in your language, and send your translated voice to Meet, Zoom, or Teams."}
        </p>
      </div>
      {monitor?.call && !monitor.accepted && !monitor.dismissed && (
        <div className="call-notice" role="status">
          <span>
            <strong>{monitor.call.app}</strong> ·{" "}
            {monitor.call.simulated ? "simulation" : "call detected"}
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
            Translate the call
          </button>
        </div>
      )}
      {accepted?.options.microphone && !busy && (
        <p className="call-notice" role="status">
          {accepted.app}: approval received. Check the audio, then start the
          translation.
        </p>
      )}
      <div className="call-section">
        <h2>Languages</h2>
        <div className="call-languages">
          <CallSelect
            id="call-language-a"
            label="You speak"
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
            label="They speak"
            value={profiles.b.language}
            disabled={anyBusy}
            options={LANGUAGE_OPTIONS}
            onChange={(value) => onLanguage("b", value as Profile["language"])}
          />
        </div>
      </div>
      {!benchmark && <>
      <div className="call-section">
        <h2>Their voice</h2>
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
            Only the detected call app’s audio is captured; without a
            detected call, all Mac audio except Interprète. With translated
            voice, wear headphones so the other participants don’t
            hear it.
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
                  ? "Ready to translate their voice"
                  : incoming.phase === "connecting" || incoming.phase === "idle"
                    ? "Connecting to the call audio…"
                    : incoming.phase !== "listening"
                      ? "Finishing the translation…"
                      : listen.demo
                        ? "Audio sample playing"
                        : listen.scope === "app" && listen.app
                          ? `Listening to ${listen.app}`
                          : "Listening to all Mac audio"}
              </strong>
              {listenBusy && <meter min="0" max="1" value={incoming.level} aria-label="Incoming call audio level" />}
              {listenBusy && listen.options.voice && (
                <span className="note">
                  {listen.voice
                    ? `Voice ${listen.voice.name} · ${
                        listen.voice.source === "jev"
                          ? "chosen by Jev"
                          : listen.voice.source === "pitch"
                            ? "close to their voice"
                            : "default"
                      }`
                    : "Choosing a voice at the first word…"}
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
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="btn call-primary"
                disabled={!(callOptions.captions || callOptions.voice)}
                onClick={() => void startListening({})}
              >
                <Captions size={16} aria-hidden="true" />
                Translate their voice
              </button>
            )}
          </div>
          {listen.notice && listenBusy && (
            <div role="status">
              <p className="note">{listen.notice}</p>
              <button className="btn" type="button" onClick={() => void openCallPermissions("audio").catch(error => setError(errorMessage(error)))}>Open audio recording settings</button>
            </div>
          )}
          {(listen.error || incoming.error || incoming.warning || captionsError) && (
            <p className="call-error" role="alert">
              {listen.error || incoming.error || incoming.warning || captionsError}
            </p>
          )}
        </div>
      </div>
      <div className="call-section">
        <h2>Your voice</h2>
        <div className="call-section-body">
          <div className="call-session" data-active={busy} aria-live="polite">
            <div className="call-session-status">
              <span className="status-dot" data-live={busy && !microphoneSync.paused} aria-hidden="true" />
              <strong>
                {preparing || state.phase === "connecting"
                    ? "Connecting…"
                  : microphoneSync.paused
                    ? "Translation paused"
                  : busy
                    ? session?.mode === "virtual"
                      ? "Translation sent to the call"
                      : "Testing · local playback"
                    : "Ready to translate"}
              </strong>
              {busy && (
                <meter
                  min="0"
                  max="1"
                  value={state.level}
                  aria-label="Microphone level"
                />
              )}
            </div>
            {busy ? (
              <button type="button" className="btn call-stop" onClick={stopMicrophone}>
                <Square size={14} fill="currentColor" aria-hidden="true" />
                Turn off translation
              </button>
            ) : (
              <button
                type="button"
                className="btn call-primary"
                onClick={() => void start(false, accepted ?? undefined)}
              >
                <Mic size={16} aria-hidden="true" />
                {route === "virtual"
                  ? "Turn on translation"
                  : "Start the headphone test"}
              </button>
            )}
          </div>
          {microphoneSync.notice && <p className="note" role="status">{microphoneSync.notice}</p>}
          {microphoneSync.permissionRequired && <button className="btn" type="button" onClick={() => void openCallPermissions("accessibility").catch(error => setError(errorMessage(error)))}>Open Accessibility settings</button>}
          <Collapsible
            className="call-advanced"
            open={microphoneSettingsOpen}
            onOpenChange={setMicrophoneSettingsOpen}
          >
            <CollapsibleTrigger className="call-advanced-trigger" type="button">
              Microphone settings and test mode
              <ChevronDown size={16} aria-hidden="true" />
            </CollapsibleTrigger>
            <CollapsibleContent className="call-advanced-panel">
              <div className="call-advanced-body">
                <fieldset className="segmented" disabled={busy}>
                  <legend className="sr-only">Translation output</legend>
                  <label>
                    <input
                      type="radio"
                      name="call-route"
                      value="virtual"
                      checked={route === "virtual"}
                      onChange={() => setRoute("virtual")}
                    />
                    <span>Send to the call</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="call-route"
                      value="local"
                      checked={route === "local"}
                      onChange={() => setRoute("local")}
                    />
                    <span>Test with headphones</span>
                  </label>
                </fieldset>
                <div className="call-devices" data-route={route}>
                  <CallSelect
                    id="call-input"
                    label="Microphone"
                    value={input}
                    placeholder="Choose a microphone…"
                    disabled={busy}
                    options={inputs.map((d) => ({ value: d.deviceId, label: microphoneName(d.label) }))}
                    onChange={(value) => {
                      inputRef.current = value;
                      setInput(value);
                      save(MICROPHONE_KEY, value);
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
                      label="Output to the call"
                      value={output}
                      placeholder="App microphone…"
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
                      In the call, choose{" "}
                      <strong>
                        {autoSystemMicrophone
                          ? "System / Default"
                          : output || APP_MICROPHONE_NAME}
                      </strong>{" "}
                      as the microphone and your headphones as the speaker.{" "}
                      {autoSystemMicrophone &&
                        "The app switches the system input, then restores your microphone when stopped."}
                    </>
                  ) : (
                    "The translation plays on the Mac’s current output. Nothing is sent to the call."
                  )}
                </p>
                {route === "virtual" && !outputs.length && (
                  <div className="call-setup">
                    <p>
                      Install the BlackHole 2ch driver to present the translation
                      as a microphone:
                    </p>
                    <code>brew install blackhole-2ch</code>
                    <p className="note">
                      Then restart the app and your calling software, and
                      refresh.
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
                      <strong>Use the app microphone as the system microphone</strong>
                      <small>Your previous microphone is restored when stopped.</small>
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
                    Allow microphone access
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    disabled={busy}
                    onClick={() => void refresh()}
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    Refresh
                  </button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
      {callMessages.length > 0 && (
        <div className="call-section">
          <h2>Discussion</h2>
          <div className="call-section-body">
            <div className="conversation-tools">
              <button
                type="button"
                className="btn btn-quiet"
                disabled={anyBusy}
                onClick={onNewDiscussion}
              >
                New discussion
              </button>
            </div>
            <DiscussionTurns
              messages={callMessages}
              live={callTurns}
              follow
            />
          </div>
        </div>
      )}
      <div className="call-section">
        <h2>Detection</h2>
        <label className="check" data-disabled={!native}>
          <Checkbox
            checked={enabled && native}
            disabled={!native}
            onCheckedChange={(checked) => void toggle(checked)}
          />
          <span>
            <strong>Offer translation when a call starts</strong>
            <small role="status">
              {!native
                ? "Requires the macOS app."
                : (monitor?.error ??
                  (monitor?.supported
                    ? "Local detection. Nothing is captured without your approval."
                    : "Requires macOS 14.2 or later."))}
            </small>
          </span>
        </label>
      </div>
      </>}
      {(error || state.error || state.warning) && (
        <p className="call-error" role="alert">
          {error || state.error || state.warning}
        </p>
      )}
      {benchmark && <section className="call-test" aria-label="Recording tests">
        <div className="call-test-recording">
          <div>
            <h3>Translate a recording</h3>
            <p>
              The selected recording takes the place of the person speaking to you. Its {languageName(profiles.a.language)} translation
              appears in the floating captions. Your microphone stays off.
            </p>
          </div>
          {recording && <>
            <CallSelect id="benchmark-recording" label="Recording" value={recording.file}
              options={recordings.map(r => ({ value: r.file, label: `${r.title} · ${r.duration}` }))}
              disabled={anyBusy} onChange={setRecordingFile} />
            {recording.source && <p className="note"><a href={recording.source} target="_blank" rel="noreferrer">Watch the source video on YouTube</a></p>}
          </>}
          <label className="check">
            <Checkbox
              checked={sampleAudible}
              disabled={anyBusy}
              onCheckedChange={(audible) => {
                setSampleAudible(audible);
                listening.setSampleAudible(audible);
              }}
            />
            <span>
              <strong>Play the original {languageName(profiles.b.language)} audio</strong>
              <small>Hear the recording while reading the captions. Keep this setting identical when comparing runs.</small>
            </span>
          </label>
          <label className="check">
            <Checkbox
              checked={benchmarkVoice}
              disabled={anyBusy}
              onCheckedChange={setBenchmarkVoice}
            />
            <span>
              <strong>Also read the {languageName(profiles.a.language)} translation aloud</strong>
              <small>Add a translated voice. Leave this off to compare the original audio with written captions.</small>
            </span>
          </label>
          <button
            type="button"
            className={`btn ${listenBusy && listen.demo ? "call-stop" : "call-primary"}`}
            disabled={busy || (listenBusy && !listen.demo) || !recording}
            onClick={() => listenBusy && listen.demo
              ? stop()
              : void runBenchmark("incoming")}
          >
            {listenBusy && listen.demo
              ? <Square size={15} fill="currentColor" aria-hidden="true" />
              : <Captions size={15} aria-hidden="true" />}
            {listenBusy && listen.demo ? "Stop the recording test" : "Start the recording test"}
          </button>
          {!recording ? (
            <p className="note">Choose English, French, Spanish or German under “They speak” to use a test recording.</p>
          ) : listenBusy && !listen.demo ? (
            <p className="note">Stop the current translation before starting a recording test.</p>
          ) : (
            <p className="note">Uses live translation and requires an internet connection. Headphones recommended when playing audio.</p>
          )}
        </div>
        <BenchmarkResults recorder={recorder} />
        <details className="call-test-tools">
          <summary>Other checks <ChevronDown size={14} aria-hidden="true" /></summary>
          <div className="call-test-item">
            <div>
              <h3>Preview the floating captions</h3>
              <p>Show a short text animation to check the bar’s appearance and position. No audio is played and nothing is translated.</p>
            </div>
            <button type="button" className="btn" disabled={listenBusy} onClick={captionsPreview ? stopCaptionsPreview : previewCaptions}>
              {captionsPreview ? "Close text preview" : "Show text preview"}
            </button>
          </div>
          <div className="call-test-item">
            <div>
              <h3>Test your outgoing translation</h3>
              <p>A {languageName(profiles.a.language)} recording replaces your microphone. Its {languageName(profiles.b.language)} translation is sent to {benchmarkRoute === "virtual" ? "the selected virtual microphone" : "your Mac’s audio output"}. Your real microphone stays off.</p>
            </div>
            <CallSelect id="benchmark-output" label="Outgoing output" value={benchmarkRoute} disabled={anyBusy}
              options={[{ value: "local", label: "Local audio" }, { value: "virtual", label: "Virtual microphone (macOS)" }]}
              onChange={value => setBenchmarkRoute(value === "virtual" ? "virtual" : "local")} />
            <button type="button" className="btn" disabled={listenBusy || (!busy && !["en", "fr"].includes(profiles.a.language))} onClick={() => busy ? stop() : void runBenchmark("outgoing")}>
              <Headphones size={15} aria-hidden="true" />
              {busy ? "Stop outgoing test" : "Test outgoing audio"}
            </button>
          </div>
          <div className="call-test-item">
            <div>
              <h3>Preview the floating translation card</h3>
              <p>Show the languages, options and stop button at the bottom of the screen. No audio is captured or played. Use the square to close it.</p>
            </div>
            <button type="button" className="btn" disabled={anyBusy} onClick={() => {
              if (overlayPreview) setOverlayPreview(false);
              else { overlayId.current = crypto.randomUUID(); setOverlayPreview(true); }
            }}>
              {overlayPreview ? "Close control preview" : "Show translation card"}
            </button>
          </div>
          <div className="call-test-item">
            <div>
              <h3>Check call detection</h3>
              <p>Show the prompt you would see when a call is detected. Accepting it can start real audio capture with your selected call settings.</p>
            </div>
            <button type="button" className="btn" disabled={busy || (!!monitor?.call && !monitor.call.simulated)} onClick={() => {
              if (!monitor?.call?.simulated) { void simulate(); return; }
              stop();
              setAccepted(null);
              if (native) void endSimulatedCall().catch((e) => setError(errorMessage(e)));
              else setMonitor(null);
            }}>
              <Phone size={15} aria-hidden="true" />
              {monitor?.call?.simulated ? "End simulated call" : "Show call prompt"}
            </button>
          </div>
        </details>
      </section>}
      {!native && captions && (
        <div className="captions-browser">
          <div className="captions-positioned" style={{ ...captionPosition(captionPreferences), width: CAPTION_SIZES[captionPreferences.size].width }}>
            <CaptionsView captions={captions} preferences={captionPreferences} />
          </div>
        </div>
      )}
    </section>
  );
}

const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({
  value: l.code,
  label: l.name,
}));

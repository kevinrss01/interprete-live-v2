import { APP_MICROPHONE_NAME } from "../lib/call-preferences";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { Phone, X } from "lucide-react";
import {
  answerCall,
  callSnapshot,
  desktopAvailable,
  loadCallOptions,
  onCallStatus,
  saveCallOptions,
  storedLanguages,
  type CallOptions,
  type CallSnapshot,
} from "../lib/calls";
import { CallOptionChecks } from "../components/call-options";

export function CallToast() {
  const [status, setStatus] = useState<CallSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<CallOptions>(loadCallOptions);
  const [languages, setLanguages] = useState(storedLanguages);
  if (typeof document !== "undefined") {
    document.documentElement.classList.add("toast-window");
    document.body.classList.add("toast-window");
  }
  useEffect(() => {
    if (!desktopAvailable()) return;
    const card = document.querySelector(".call-toast");
    if (!(card instanceof HTMLElement)) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    // The native window is a rectangle. Keep it equal to the card, or the clear margin stays clickable.
    const fit = () => {
      const nextWidth = Math.ceil(card.offsetWidth);
      const nextHeight = Math.ceil(card.offsetHeight);
      if (nextWidth < 1 || nextHeight < 1 || (nextWidth === width && nextHeight === height)) return;
      width = nextWidth;
      height = nextHeight;
      void getCurrentWindow()
        .setSize(new LogicalSize(nextWidth, nextHeight))
        .catch(() => {});
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(card);
    fit();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!desktopAvailable()) return;
    let active = true;
    const subscription = onCallStatus((snapshot) => {
      if (active) {
        setStatus(snapshot);
        setBusy(false);
        setError(null);
        // The toast window lives for the whole app session; show the latest saved choices.
        setOptions(loadCallOptions());
        setLanguages(storedLanguages());
      }
    });
    void callSnapshot().then((snapshot) => {
      if (active) setStatus(snapshot);
    });
    return () => {
      active = false;
      void subscription.then((off) => off());
    };
  }, []);
  const call = status?.call;
  const chosen = options.captions || options.voice || options.microphone || options.camera;
  function choose(next: CallOptions) {
    setOptions(next);
    saveCallOptions(next);
  }
  async function answer(accept: boolean) {
    if (!call) return;
    setBusy(true);
    try {
      await answerCall(call.id, accept, options);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }
  return (
    <main className="call-toast" aria-labelledby="call-toast-title">
      <div className="call-toast-head">
        <Phone size={19} aria-hidden="true" />
        <strong id="call-toast-title">
          {call?.simulated ? "Simulated call" : "Call detected"}
        </strong>
        <button
          className="icon-btn"
          type="button"
          aria-label="Dismiss this call"
          disabled={busy || !call}
          onClick={() => void answer(false)}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>
      <p>{call?.app ?? "Looking for a call…"}</p>
      <CallOptionChecks
        options={options}
        include={["captions", "voice", "microphone", "camera"]}
        disabled={busy || !call}
        mine={languages.mine}
        theirs={languages.theirs}
        route={`${
          localStorage.getItem("interprete-call-input-label") ||
          "Microphone not set up"
        } → ${localStorage.getItem("interprete-call-output") || APP_MICROPHONE_NAME}`}
        onChange={choose}
      />
      {error && (
        <p className="call-error" role="alert">
          {error}
        </p>
      )}
      <div className="call-actions">
        <button
          type="button"
          className="btn"
          disabled={busy || !call}
          onClick={() => void answer(false)}
        >
          Dismiss
        </button>
        <button
          type="button"
          className="btn call-primary"
          disabled={busy || !call || !chosen}
          onClick={() => void answer(true)}
        >
          Translate the call
        </button>
      </div>
    </main>
  );
}

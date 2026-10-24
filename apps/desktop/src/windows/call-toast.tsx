import { APP_MICROPHONE_NAME } from "../lib/call-preferences";
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
  useEffect(() => {
    document.body.classList.add("toast-window");
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
  const chosen = options.captions || options.voice || options.microphone;
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
          {call?.simulated ? "Simulation d’appel" : "Appel détecté"}
        </strong>
        <button
          className="icon-btn"
          type="button"
          aria-label="Ignorer cet appel"
          disabled={busy || !call}
          onClick={() => void answer(false)}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>
      <p>{call?.app ?? "Recherche d’un appel…"}</p>
      <CallOptionChecks
        options={options}
        include={["captions", "voice", "microphone"]}
        disabled={busy || !call}
        mine={languages.mine}
        theirs={languages.theirs}
        route={`${
          localStorage.getItem("interprete-call-input-label") ||
          "Microphone à configurer"
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
          Ignorer
        </button>
        <button
          type="button"
          className="btn call-primary"
          disabled={busy || !call || !chosen}
          onClick={() => void answer(true)}
        >
          Traduire l’appel
        </button>
      </div>
    </main>
  );
}

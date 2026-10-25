import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { signOut, readAuthToken } from "../lib/account";
import type { InterpreterController } from "../lib/interpreter";
import { clearOnboardingAccount } from "../onboarding/onboarding-account";
import { SpeakerPanel } from "./speaker-panel";
import { CallPanel, type CallPanelHandle } from "./call-panel";
import { TranslationPill } from "../windows/translation-overlay";
import {
  useTranslationOverlay,
  type OverlayUpdate,
} from "../lib/translation-overlay";
import { desktopAvailable } from "../lib/calls";
import { discussionInputs, discussionLog, openDiscussion } from "../lib/discussion";
import { startDiscussionSync } from "../lib/discussion-sync";
import { conversationStatus } from "../lib/live-status";
import { useDockInset } from "../lib/use-dock-inset";
import { useDiscussion } from "../lib/use-discussion";
import { Conversation } from "./conversation";
import { ConversationActions } from "./conversation-actions";
import { ConversationDock } from "./dock";
import { HistoryPage } from "./history";
import { LiveStatus } from "./live-status";
import { type View } from "./navigation";
import { SettingsPage } from "./settings";
import { Sidebar } from "./sidebar";
import { VoicesPage } from "./voices";
import type { Profile, SpeakerId } from "@interprete/shared/contracts";
import { Button } from "@interprete/ui/components/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@interprete/ui/components/alert-dialog";

type PendingConfirm =
  | { kind: "clear" }
  | { kind: "clear-call" }
  | { kind: "remove"; id: SpeakerId };

export function Interpreter({
  controller,
  onLeave,
  onMacSetup,
  initialView = "conversation",
}: {
  controller: InterpreterController;
  onLeave: () => void;
  onMacSetup: (view: "call" | "settings") => void;
  initialView?: "conversation" | "call" | "settings";
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const names = { you: state.profiles.a.name, them: state.profiles.b.name };
  const { state: discussions, messages: conversationMessages } = useDiscussion({
    kind: "conversation",
    turns: state.turns,
    names,
  });
  useEffect(() => startDiscussionSync(discussionLog), []);
  const callPanelRef = useRef<CallPanelHandle>(null);
  const previewCaptions = useCallback((visible: boolean) => {
    callPanelRef.current?.previewCaptions(visible);
  }, []);
  const [callOverlay, setCallOverlay] = useState<OverlayUpdate | null>(null);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [callBusy, setCallBusy] = useState(false);
  const [overlayExpanded, setOverlayExpanded] = useState(false);
  const [view, setView] = useState<View>(initialView);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const callMode = view === "call" || view === "benchmark";
  const mainRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const shownView = useRef(view);
  useDockInset(dockRef, view);
  useEffect(() => {
    // The button that changed the view unmounts; give keyboard and screen-reader users a destination.
    if (shownView.current === view) return;
    shownView.current = view;
    mainRef.current?.focus({ preventScroll: true });
  }, [view]);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const overlay: OverlayUpdate | null =
    callOverlay ??
    (state.sessionId
      ? {
          sessionId: state.sessionId,
          phase: state.phase,
          source: state.profiles[state.active].language,
          target: state.profiles[state.active === "a" ? "b" : "a"].language,
          test: state.input === "demo",
        }
      : null);
  function stopTranslation(sessionId: string) {
    if (callOverlay?.sessionId === sessionId)
      callPanelRef.current?.stop(sessionId);
    else controller.cancelSession(sessionId);
  }
  function openTranslationOptions(sessionId: string) {
    if (sessionId !== overlay?.sessionId) return;
    // Keep the current call/benchmark view: normal navigation can stop its session.
    if (callOverlay?.sessionId === sessionId) callPanelRef.current?.openOptions();
    else {
      document.querySelector<HTMLElement>(".dock:not([hidden])")?.scrollIntoView({ block: "end" });
      document.querySelector<HTMLElement>(".dock:not([hidden]) button:not(:disabled)")?.focus({ preventScroll: true });
    }
  }
  useTranslationOverlay(overlay, stopTranslation, setOverlayError, openTranslationOptions);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.repeat ||
        target.closest(
          "dialog, [role='dialog'], [role='alertdialog'], [role='listbox']",
        )
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        controller.cancel();
        return;
      }
      if (
        view !== "conversation" ||
        target.closest("input,select,textarea,button,summary,a")
      )
        return;
      if ((e.key === "a" || e.key === "b") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void controller.start(e.key as SpeakerId);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [controller, view]);
  const busy = state.phase !== "idle" || callBusy;
  const demo = state.input === "demo";
  const status = conversationStatus({
    phase: state.phase,
    input: state.input,
    connection: state.connection,
    outputActive: state.outputActive,
    ready: state.ready,
    callBusy,
    speakerName: state.profiles[state.active].name,
  });
  function onTalk(id: SpeakerId) {
    if (state.phase === "connecting" && state.active === id)
      controller.cancel();
    else void controller.start(id);
  }
  function onProfile(id: SpeakerId, patch: Partial<Profile>) {
    if (typeof patch.consent === "boolean")
      void controller.setConsent(id, patch.consent);
    else controller.setProfile(id, patch);
  }
  function confirmPending() {
    if (!pending) return;
    if (pending.kind === "clear" || pending.kind === "clear-call") {
      if (pending.kind === "clear") {
        discussionLog.record("conversation", discussionInputs(state.turns, names));
        discussionLog.close("conversation");
        controller.clearConversation();
        if (view !== "conversation") openView("conversation");
      } else {
        callPanelRef.current?.clearDiscussion();
        discussionLog.close("call");
      }
    } else void controller.removeVoice(pending.id);
    setPending(null);
  }
  function leave() {
    if (callOverlay?.sessionId) callPanelRef.current?.stop(callOverlay.sessionId);
    controller.cancel();
    if (readAuthToken()) controller.forgetAccountVoice();
    signOut();
    clearOnboardingAccount();
    onLeave();
  }
  function startNewDiscussion() {
    const current = openDiscussion(discussions, "conversation");
    if (current?.messages.length) setPending({ kind: "clear" });
    else if (view !== "conversation") openView("conversation");
  }
  function openHistory(id: string | null) {
    setHistoryId(id);
    openView("history");
  }
  function openView(next: View) {
    if (next !== view && (view === "call" || view === "benchmark")) callPanelRef.current?.stopAll();
    // Leaving the conversation ends any turn in progress; the call panel stops itself when hidden.
    if (view === "conversation" || next === "call") controller.cancel();
    setView(next);
    window.scrollTo({ top: 0 });
  }
  function swap() {
    const a = state.profiles.a.language;
    controller.setProfile("a", { language: state.profiles.b.language });
    controller.setProfile("b", { language: a });
  }
  const speaker = (id: SpeakerId) => (
    <SpeakerPanel
      profile={state.profiles[id]}
      phase={state.phase}
      selected={state.active === id}
      level={state.level}
      ready={state.ready}
      demo={demo}
      onTalk={() => onTalk(id)}
      onProfile={(p) => onProfile(id, p)}
    />
  );
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar
        view={view}
        busy={busy}
        empty={conversationMessages.length === 0}
        discussions={discussions.discussions}
        historyId={historyId}
        onNewDiscussion={startNewDiscussion}
        onNavigate={openView}
        onOpenHistory={openHistory}
      />
      <div className="app panel">
        <header
          className="topbar"
          hidden={
            view === "conversation" ||
            view === "benchmark" ||
            view === "history" ||
            view === "voices" ||
            view === "settings" ||
            (view === "call" && !callBusy)
          }
        >
          <div className="frame topbar-inner">
            <LiveStatus
              phase={callBusy ? "listening" : state.phase}
              ready={state.ready}
              spinning={busy && state.phase !== "listening"}
              label={status}
            />
          </div>
        </header>
      {overlayError && (
        <div className="frame alert" role="alert">
          <span>{overlayError}</span>
          <Button
            variant="ghost"
            className="icon-btn"
            aria-label="Dismiss overlay message"
            onClick={() => setOverlayError(null)}
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </div>
      )}
      {!desktopAvailable() && overlay && (
        <div className="translation-overlay-browser">
          <TranslationPill
            session={overlay}
            expanded={overlayExpanded}
            onExpand={() => setOverlayExpanded((current) => !current)}
            onOptions={() => {
              if (overlay.sessionId) openTranslationOptions(overlay.sessionId);
            }}
            onStop={() => {
              if (overlay.sessionId) stopTranslation(overlay.sessionId);
            }}
          />
        </div>
      )}
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="frame main"
        data-view={view}
      >
        <CallPanel
          ref={callPanelRef}
          onOverlayChange={setCallOverlay}
          onCaptionError={setCaptionError}
          onBusy={setCallBusy}
          visible={callMode}
          benchmark={view === "benchmark"}
          onOpen={() => openView("call")}
          beforeStart={() => controller.cancel()}
          profiles={state.profiles}
          onLanguage={(id, language) => controller.setProfile(id, { language })}
          onNewDiscussion={() => setPending({ kind: "clear-call" })}
          onSetupRequired={() => onMacSetup("call")}
        />
        {view === "conversation" && (
          <>
            <ConversationActions
              busy={busy}
              empty={conversationMessages.length === 0}
              onNewDiscussion={startNewDiscussion}
              onSample={() => void controller.start(state.active, true)}
            />
            <Conversation
              messages={conversationMessages}
              live={state.turns}
              onPlay={(id) => void controller.replay(id)}
              onDemo={() => void controller.start(state.active, true)}
              busy={busy}
            />
          </>
        )}
        {view === "settings" && (
          <SettingsPage
            profiles={state.profiles}
            busy={busy}
            decisionAvailable={!state.services || state.services.decision}
            volume={state.volume}
            onProfile={onProfile}
            onClone={(id) => void controller.clone(id)}
            onRemove={(id) => setPending({ kind: "remove", id })}
            onVolume={(value) => controller.setVolume(value)}
            onSignOut={leave}
            onCaptionPreview={previewCaptions}
            captionError={captionError}
            onMacSetup={() => onMacSetup("settings")}
          />
        )}
        {view === "history" && (
          <HistoryPage selectedId={historyId} onSelect={setHistoryId} />
        )}
        {view === "voices" && (
          <VoicesPage controller={controller} profile={state.profiles.a} busy={busy} />
        )}
      </main>
      <ConversationDock
        dockRef={dockRef}
        hidden={view !== "conversation"}
        error={state.error}
        warning={state.warning}
        onDismiss={controller.dismissError}
        phase={state.phase}
        input={state.input}
        busy={busy}
        ready={state.ready}
        statusLabel={status}
        onStop={() => controller.cancel()}
        onSwap={swap}
        speakerA={speaker("a")}
        speakerB={speaker("b")}
      />
      </div>
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "remove"
                ? "Delete this voice"
                : "Start a new discussion"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "remove"
                ? "Permanently delete this voice from the ElevenLabs account?"
                : readAuthToken()
                  ? "The text stays in History and on your account. Replay audio from this session is removed."
                  : "The text stays in History on this device. Replay audio from this session is removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 px-4">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 px-4"
              variant={pending?.kind === "remove" ? "destructive" : "default"}
              onClick={confirmPending}
            >
              {pending?.kind === "remove" ? "Delete" : "Start new"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

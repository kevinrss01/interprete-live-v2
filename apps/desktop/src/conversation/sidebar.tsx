import { SlidersHorizontal, SquarePen } from "lucide-react";
import logo from "@interprete/ui/assets/logo.png";
import { ThemeToggle } from "../components/theme-toggle";
import type { Discussion } from "../lib/discussion";
import { NAV, type View } from "./navigation";
import { RecentDiscussions } from "./recent-discussions";

export function Sidebar({
  view,
  busy,
  empty,
  discussions,
  historyId,
  onNewDiscussion,
  onNavigate,
  onOpenHistory,
}: {
  view: View;
  busy: boolean;
  empty: boolean;
  discussions: Discussion[];
  historyId: string | null;
  onNewDiscussion: () => void;
  onNavigate: (view: View) => void;
  onOpenHistory: (id: string | null) => void;
}) {
  return (
    <aside className="sidebar" aria-label="Navigation">
      <img className="sidebar-logo brand-logo" src={logo} alt="Interprète" />
      <nav className="sidebar-nav">
        <button
          type="button"
          className="sidebar-item"
          disabled={busy || empty}
          onClick={onNewDiscussion}
        >
          <SquarePen size={16} aria-hidden="true" />
          New discussion
        </button>
        {NAV.map(({ view: id, label, icon: Icon }) => (
          <button
            key={id}
            className="sidebar-item"
            aria-current={view === id ? "page" : undefined}
            onClick={() => (id === "history" ? onOpenHistory(null) : onNavigate(id))}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
      <RecentDiscussions
        discussions={discussions}
        activeId={view === "history" ? historyId : null}
        onOpen={onOpenHistory}
      />
      <div className="sidebar-foot">
        <ThemeToggle />
        <button
          className="sidebar-item"
          aria-current={view === "settings" ? "page" : undefined}
          onClick={() => onNavigate("settings")}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          Settings
        </button>
      </div>
    </aside>
  );
}

import { recentDiscussions } from "../lib/discussion-display";
import type { Discussion } from "../lib/discussion";

export function RecentDiscussions({
  discussions,
  activeId,
  onOpen,
}: {
  discussions: Discussion[];
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const recents = recentDiscussions(discussions);
  if (!recents.length) return null;
  return (
    <section className="sidebar-recents" aria-labelledby="recents-label">
      <h2 id="recents-label" className="sidebar-label">
        Recents
      </h2>
      <ol className="sidebar-recent-list">
        {recents.map((discussion) => (
          <li key={discussion.id}>
            <button
              type="button"
              className="sidebar-item sidebar-recent"
              aria-current={discussion.id === activeId ? "page" : undefined}
              title={discussion.title}
              onClick={() => onOpen(discussion.id)}
            >
              <span>{discussion.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

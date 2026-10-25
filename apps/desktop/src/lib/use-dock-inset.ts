import { useLayoutEffect, type RefObject } from "react";

// The dock overlaps the transcript. Its height changes with alerts and wrapping,
// so the conversation keeps an equal clearance and the latest turn stays readable.
export function useDockInset(dockRef: RefObject<HTMLElement | null>, watch: unknown) {
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const panel = dock?.closest<HTMLElement>(".panel");
    if (!dock || !panel) return;
    const apply = () => {
      if (dock.hidden) {
        panel.style.removeProperty("--dock-block");
        return;
      }
      panel.style.setProperty("--dock-block", `${Math.ceil(dock.getBoundingClientRect().height)}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      panel.style.removeProperty("--dock-block");
    };
  }, [dockRef, watch]);
}

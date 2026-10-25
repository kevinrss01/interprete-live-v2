import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { scrollFromPointer, scrollbarThumb } from "../lib/scrollbar";

// Drawn in the page: WKWebView on macOS keeps the system overlay bar and
// ignores a CSS width, color, and corner radius. The thumb is 4px.
export function WindowScrollbar() {
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const bar = track.current;
    const thumb = bar?.firstElementChild;
    if (!bar || !(thumb instanceof HTMLElement)) return;
    root.classList.add("app-scrollbar");

    let frame = 0;
    const place = () => {
      const next = scrollbarThumb({
        scrollY: window.scrollY,
        scrollHeight: root.scrollHeight,
        viewport: window.innerHeight,
      });
      if (next.hidden) {
        bar.hidden = true;
        return;
      }
      bar.hidden = false;
      thumb.style.height = `${next.height}px`;
      thumb.style.transform = `translateY(${next.offset}px)`;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };

    place();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      root.classList.remove("app-scrollbar");
    };
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const bar = track.current;
    const thumb = bar?.firstElementChild;
    if (!bar || !(thumb instanceof HTMLElement) || bar.hidden) return;
    event.preventDefault();
    bar.setPointerCapture(event.pointerId);
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const travel = window.innerHeight - thumb.getBoundingClientRect().height;
    const originY = event.clientY;
    const originScroll = window.scrollY;
    const onMove = (move: PointerEvent) => {
      window.scrollTo({
        top: scrollFromPointer({
          originScroll,
          deltaY: move.clientY - originY,
          scrollable,
          travel,
        }),
      });
    };
    const onUp = (up: PointerEvent) => {
      if (bar.hasPointerCapture(up.pointerId)) bar.releasePointerCapture(up.pointerId);
      bar.removeEventListener("pointermove", onMove);
      bar.removeEventListener("pointerup", onUp);
      bar.removeEventListener("pointercancel", onUp);
    };
    bar.addEventListener("pointermove", onMove);
    bar.addEventListener("pointerup", onUp);
    bar.addEventListener("pointercancel", onUp);
  }

  return (
    <div ref={track} className="app-scrollbar-track" hidden onPointerDown={onPointerDown}>
      <div className="app-scrollbar-thumb" />
    </div>
  );
}

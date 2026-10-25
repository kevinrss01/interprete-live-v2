export type ScrollbarMetrics = {
  scrollY: number;
  scrollHeight: number;
  viewport: number;
};

const MIN_THUMB = 28;

export function scrollbarThumb(
  { scrollY, scrollHeight, viewport }: ScrollbarMetrics,
  minThumb = MIN_THUMB,
) {
  const scrollable = scrollHeight - viewport;
  if (scrollable <= 1) return { hidden: true as const };
  const height = Math.max(minThumb, (viewport / scrollHeight) * viewport);
  const travel = Math.max(1, viewport - height);
  return {
    hidden: false as const,
    height,
    offset: (scrollY / scrollable) * travel,
  };
}

export function scrollFromPointer({
  originScroll,
  deltaY,
  scrollable,
  travel,
}: {
  originScroll: number;
  deltaY: number;
  scrollable: number;
  travel: number;
}) {
  return originScroll + (deltaY * scrollable) / Math.max(1, travel);
}

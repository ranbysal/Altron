export type Prepared = { ctx: CanvasRenderingContext2D; w: number; h: number };

/** Size a canvas to its CSS box at device pixel ratio (capped at 2) and return a scaled context. */
export function prepCanvas(el: HTMLCanvasElement | null): Prepared | null {
  if (!el) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (!w || !h) return null;
  const W = Math.round(w * dpr);
  const H = Math.round(h * dpr);
  if (el.width !== W || el.height !== H) {
    el.width = W;
    el.height = H;
  }
  const ctx = el.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

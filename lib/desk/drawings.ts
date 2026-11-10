import { create } from "zustand";
import type { Under } from "./instruments";

/**
 * Chart drawings. Points are anchored to (time, price) so they stay put through
 * panning, zooming and timeframe changes. Kept per underlying, so a line drawn
 * on NQ shows on MNQ too, and saved in the browser.
 */

export type Pt = { t: number; p: number };
/** A position tool's own colours: its labels' text, the profit zone and the loss zone. Unset follows the theme. */
export type PosColors = { text?: string; up?: string; down?: string };

export type Drawing = (
  | { id: string; kind: "trend" | "ray" | "rect" | "fib"; a: Pt; b: Pt }
  | { id: string; kind: "hline" | "vline"; a: Pt }
  | { id: string; kind: "brush"; pts: Pt[] }
  | { id: string; kind: "text"; a: Pt; text: string }
  | { id: string; kind: "arrow"; a: Pt; up: boolean }
  /** TradingView's long / short position: entry at `a` from a.t to t2, a target and a stop */
  | { id: string; kind: "long" | "short"; a: Pt; t2: number; target: number; stop: number; colors?: PosColors }
) & {
  /** hidden from the chart; shows faintly while the drawing tools are open, so it can be found again */
  hidden?: boolean;
};

export type Tool = "cursor" | "trend" | "ray" | "hline" | "vline" | "rect" | "fib" | "brush" | "text" | "arrow" | "long" | "short" | "measure" | "zoom";

export const TOOL_NAMES: Record<Tool, string> = {
  cursor: "Cross",
  trend: "Trend line",
  ray: "Ray",
  hline: "Horizontal line",
  vline: "Vertical line",
  rect: "Rectangle",
  fib: "Fib retracement",
  brush: "Brush",
  text: "Text",
  arrow: "Arrow mark",
  long: "Long position",
  short: "Short position",
  measure: "Measure",
  zoom: "Zoom in",
};

/** The levels Yazan uses; more can be added from a fib's pop-up or chart settings. */
export const FIB_DEFAULT = [0, 0.382, 0.786, 1];
/** Offered as one-tap additions. */
export const FIB_COMMON = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];

type DrawState = {
  rail: boolean;
  tool: Tool;
  magnet: boolean;
  keep: boolean;
  locked: boolean;
  hidden: boolean;
  byUnder: Record<Under, Drawing[]>;
  selected: string | null;
  fib: number[];
};

const KEY = "altron-drawings-v1";

function load(): Partial<DrawState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return {};
    const fib = Array.isArray(raw.fib) ? raw.fib.filter((x: unknown) => typeof x === "number" && Number.isFinite(x)) : null;
    return {
      rail: !!raw.rail,
      magnet: !!raw.magnet,
      keep: !!raw.keep,
      locked: !!raw.locked,
      hidden: !!raw.hidden,
      byUnder: { NQ: raw.byUnder?.NQ ?? [], ES: raw.byUnder?.ES ?? [] },
      fib: fib && fib.length ? fib : FIB_DEFAULT,
    };
  } catch {
    return {};
  }
}

export const useDraw = create<DrawState>(() => ({
  rail: false,
  tool: "cursor",
  magnet: false,
  keep: false,
  locked: false,
  hidden: false,
  byUnder: { NQ: [], ES: [] },
  selected: null,
  fib: FIB_DEFAULT,
}));

let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Read saved drawings once on the client, then save on every change. */
export function startDrawings() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  useDraw.setState(load());
  useDraw.subscribe((s, prev) => {
    if (s.byUnder === prev.byUnder && s.rail === prev.rail && s.magnet === prev.magnet && s.keep === prev.keep && s.locked === prev.locked && s.hidden === prev.hidden && s.fib === prev.fib) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const { rail, magnet, keep, locked, hidden, byUnder, fib } = useDraw.getState();
        localStorage.setItem(KEY, JSON.stringify({ rail, magnet, keep, locked, hidden, byUnder, fib }));
      } catch {
        /* storage full or blocked */
      }
    }, 250);
  });
}

let n = 0;
export const drawId = () => `d${Date.now().toString(36)}${(n++).toString(36)}`;

const get = useDraw.getState;
const set = useDraw.setState;

export function setTool(tool: Tool) {
  set({ tool, selected: tool === "cursor" ? get().selected : null });
}
export function toggleDraw(key: "rail" | "magnet" | "keep" | "locked" | "hidden") {
  const next = !get()[key];
  set({ [key]: next, ...(key === "locked" || key === "hidden" ? { selected: null } : {}), ...(key === "rail" && !next ? { tool: "cursor" as Tool } : {}) });
}
export function addDrawing(u: Under, d: Drawing) {
  const by = get().byUnder;
  set({ byUnder: { ...by, [u]: [...by[u], d] }, selected: d.id });
}
export function replaceDrawing(u: Under, d: Drawing) {
  const by = get().byUnder;
  set({ byUnder: { ...by, [u]: by[u].map((x) => (x.id === d.id ? d : x)) } });
}
export function removeDrawing(u: Under, id: string) {
  const by = get().byUnder;
  set({ byUnder: { ...by, [u]: by[u].filter((x) => x.id !== id) }, selected: get().selected === id ? null : get().selected });
}
export function clearDrawings(u: Under): number {
  const by = get().byUnder;
  const count = by[u].length;
  set({ byUnder: { ...by, [u]: [] }, selected: null });
  return count;
}
export function selectDrawing(id: string | null) {
  set({ selected: id });
}

/** Hides or shows one drawing. */
export function toggleHidden(u: Under, id: string) {
  const by = get().byUnder;
  set({ byUnder: { ...by, [u]: by[u].map((x) => (x.id === id ? { ...x, hidden: !x.hidden } : x)) } });
}

/* ---------- fib levels, shared by every fib ---------- */
const tidy = (levels: number[]) => [...new Set(levels.map((x) => Math.round(x * 10000) / 10000))].sort((a, b) => a - b);
export function addFibLevel(r: number) {
  if (!Number.isFinite(r) || r < -5 || r > 10) return;
  set({ fib: tidy([...get().fib, r]) });
}
export function removeFibLevel(r: number) {
  const next = get().fib.filter((x) => x !== r);
  if (next.length) set({ fib: next });
}
export function resetFibLevels() {
  set({ fib: FIB_DEFAULT });
}

/** Recolours a position tool's text or zones. */
export function restyle(u: Under, id: string, colors: PosColors) {
  const by = get().byUnder;
  set({ byUnder: { ...by, [u]: by[u].map((x) => (x.id === id && (x.kind === "long" || x.kind === "short") ? { ...x, colors: { ...x.colors, ...colors } } : x)) } });
}

/** Colours offered for a position tool's text and zones. */
export const SWATCHES = ["#4DA3FF", "#FF2EC4", "#3CCF7F", "#2BB3A3", "#F5A524", "#8B5CF6", "#A8B5C2", "#FFFFFF", "#0E1116"];

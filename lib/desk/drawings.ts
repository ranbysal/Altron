import { create } from "zustand";
import type { Under } from "./instruments";

/**
 * Chart drawings. Points are anchored to (time, price) so they stay put through
 * panning, zooming and timeframe changes. Kept per underlying, so a line drawn
 * on NQ shows on MNQ too, and saved in the browser.
 */

export type Pt = { t: number; p: number };

export type Drawing =
  | { id: string; kind: "trend" | "ray" | "rect" | "fib"; a: Pt; b: Pt }
  | { id: string; kind: "hline" | "vline"; a: Pt }
  | { id: string; kind: "brush"; pts: Pt[] }
  | { id: string; kind: "text"; a: Pt; text: string }
  | { id: string; kind: "arrow"; a: Pt; up: boolean };

export type Tool = "cursor" | "trend" | "ray" | "hline" | "vline" | "rect" | "fib" | "brush" | "text" | "arrow" | "measure" | "zoom";

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
  measure: "Measure",
  zoom: "Zoom in",
};

export const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

type DrawState = {
  rail: boolean;
  tool: Tool;
  magnet: boolean;
  keep: boolean;
  locked: boolean;
  hidden: boolean;
  byUnder: Record<Under, Drawing[]>;
  selected: string | null;
};

const KEY = "altron-drawings-v1";

function load(): Partial<DrawState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return {};
    return { rail: !!raw.rail, magnet: !!raw.magnet, keep: !!raw.keep, locked: !!raw.locked, hidden: !!raw.hidden, byUnder: { NQ: raw.byUnder?.NQ ?? [], ES: raw.byUnder?.ES ?? [] } };
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
}));

let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Read saved drawings once on the client, then save on every change. */
export function startDrawings() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  useDraw.setState(load());
  useDraw.subscribe((s, prev) => {
    if (s.byUnder === prev.byUnder && s.rail === prev.rail && s.magnet === prev.magnet && s.keep === prev.keep && s.locked === prev.locked && s.hidden === prev.hidden) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const { rail, magnet, keep, locked, hidden, byUnder } = useDraw.getState();
        localStorage.setItem(KEY, JSON.stringify({ rail, magnet, keep, locked, hidden, byUnder }));
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

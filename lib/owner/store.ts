import { create } from "zustand";
import { DEFAULT_SETTINGS, type Method, type Settings } from "./replay";

/** The owner's own switches: following on or off, accounts paused, the settings the replay runs with. */
type OwnerState = {
  following: boolean;
  paused: Record<string, boolean>;
  settings: Settings;
  /** the way of joining the dashboard shows */
  method: Method;
  /** the Desk's right column: the order ticket, or Yazan's trade beside ours */
  deskView: "order" | "follow";
};

const KEY = "altron-owner-v1";

export const useOwner = create<OwnerState>(() => ({ following: true, paused: {}, settings: DEFAULT_SETTINGS, method: "ai", deskView: "order" }));

let started = false;
export function startOwner() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<OwnerState> | null;
    if (raw) useOwner.setState({ following: raw.following !== false, paused: raw.paused ?? {}, settings: { ...DEFAULT_SETTINGS, ...raw.settings }, method: raw.method ?? "ai", deskView: raw.deskView === "follow" ? "follow" : "order" });
  } catch {
    /* nothing saved */
  }
  useOwner.subscribe((s) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage full or blocked */
    }
  });
}

export const setOwner = (patch: Partial<OwnerState>) => useOwner.setState(patch);
export const setSetting = <K extends keyof Settings>(k: K, v: Settings[K]) => useOwner.setState((s) => ({ settings: { ...s.settings, [k]: v } }));

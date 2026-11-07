"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { FeedSim, type FeedSnapshot } from "@/lib/feed";

type FeedCtx = { sim: FeedSim; snap: FeedSnapshot };

const Ctx = createContext<FeedCtx | null>(null);

/** One simulated market shared by the hero, market strip and desk. Ticks once per second. */
export function FeedProvider({ children }: { children: React.ReactNode }) {
  const simRef = useRef<FeedSim | null>(null);
  if (!simRef.current) simRef.current = new FeedSim();
  const sim = simRef.current;
  const [snap, setSnap] = useState<FeedSnapshot>(() => sim.snapshot());

  useEffect(() => {
    const id = window.setInterval(() => {
      sim.step();
      setSnap(sim.snapshot());
    }, 1000);
    return () => window.clearInterval(id);
  }, [sim]);

  return <Ctx.Provider value={{ sim, snap }}>{children}</Ctx.Provider>;
}

export function useFeed(): FeedCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFeed must be used inside <FeedProvider>");
  return v;
}

/** New York clock, rendered only after mount to avoid hydration mismatch. */
export function useNyClock(): string {
  const [t, setT] = useState("--:--:--");
  useEffect(() => {
    const tick = () =>
      setT(new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false }));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return t;
}

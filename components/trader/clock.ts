"use client";

import { useEffect, useState } from "react";

export type Clock = { time: string; greeting: string; status: string; detail: string; open: boolean };

/** New York clock and where the CME session stands. */
export function useMarketClock(): Clock | null {
  const [c, setC] = useState<Clock | null>(null);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
          .formatToParts(now)
          .map((p) => [p.type, p.value]),
      );
      const h = Number(parts.hour) % 24;
      const m = Number(parts.minute);
      const sec = Number(parts.second);
      const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
      const mins = h * 60 + m;
      const weekMin = wd * 1440 + mins;
      const until = (target: number) => {
        const d = (target - weekMin + 10080) % 10080;
        const total = d * 60 - sec;
        const hh = Math.floor(total / 3600);
        const mm = Math.floor((total % 3600) / 60);
        return hh >= 24 ? `${Math.floor(hh / 24)}d ${hh % 24}h` : `${hh}h ${String(mm).padStart(2, "0")}m`;
      };
      let status = "Globex open";
      let detail = "Overnight session";
      let open = true;
      const weekend = wd === 6 || (wd === 0 && mins < 1080) || (wd === 5 && mins >= 1020);
      if (weekend) {
        status = "Market closed";
        detail = `Globex opens Sun 6:00 PM · in ${until(1080)}`;
        open = false;
      } else if (wd >= 1 && wd <= 4 && mins >= 1020 && mins < 1080) {
        status = "Daily halt";
        detail = `Reopens 6:00 PM · in ${until(wd * 1440 + 1080)}`;
        open = false;
      } else if (wd >= 1 && wd <= 5 && mins >= 570 && mins < 960) {
        status = "RTH open";
        detail = `Cash close 4:00 PM · in ${until(wd * 1440 + 960)}`;
      }
      const greeting = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
      setC({ time: `${h % 12 || 12}:${parts.minute} ${h < 12 ? "AM" : "PM"}`, greeting, status, detail, open });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return c;
}


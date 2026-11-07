const MINUS = "−";

export function fmt(n: number, digits = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function money(n: number): string {
  return (n < 0 ? MINUS : "+") + "$" + fmt(Math.abs(n));
}

export function signed(n: number, digits = 2, suffix = ""): string {
  return (n < 0 ? MINUS : "+") + Math.abs(n).toFixed(digits) + suffix;
}

export function pctChange(value: number, base: number): string {
  return signed(((value - base) / base) * 100, 2, "%");
}

/** Round to the 0.25 tick used by ES / NQ / MES / MNQ. */
export function toTick(p: number): number {
  return Math.round(p * 4) / 4;
}

/** Minutes from midnight → "HH:MM". */
export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h < 10 ? "0" : ""}${h}:${m < 10 ? "0" : ""}${m}`;
}

export function nyClock(date = new Date()): string {
  try {
    return date.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
  } catch {
    return "--:--:--";
  }
}

/** Regular trading hours (09:30–16:00 ET, Mon–Fri). Ignores exchange holidays. */
export function isRthOpen(date = new Date()): boolean {
  try {
    const wd = date.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" });
    const [h, m] = nyClock(date).split(":").map((x) => parseInt(x, 10));
    const mins = h * 60 + m;
    return wd !== "Sat" && wd !== "Sun" && mins >= 570 && mins < 960;
  } catch {
    return false;
  }
}

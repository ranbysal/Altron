/** The four contracts the desk trades. Micros track the same index as their minis. */

export type Sym = "NQ" | "ES" | "MNQ" | "MES";
export type Under = "NQ" | "ES";

export type Instrument = {
  sym: Sym;
  under: Under;
  code: string;
  name: string;
  tick: number;
  pv: number; // dollars per point
  micro: boolean;
};

export const INSTRUMENTS: Record<Sym, Instrument> = {
  NQ: { sym: "NQ", under: "NQ", code: "NQZ6", name: "E-mini Nasdaq-100", tick: 0.25, pv: 20, micro: false },
  ES: { sym: "ES", under: "ES", code: "ESZ6", name: "E-mini S&P 500", tick: 0.25, pv: 50, micro: false },
  MNQ: { sym: "MNQ", under: "NQ", code: "MNQZ6", name: "Micro E-mini Nasdaq-100", tick: 0.25, pv: 2, micro: true },
  MES: { sym: "MES", under: "ES", code: "MESZ6", name: "Micro E-mini S&P 500", tick: 0.25, pv: 5, micro: true },
};

export const SYMS: Sym[] = ["NQ", "ES", "MNQ", "MES"];

export const tickValue = (s: Sym) => INSTRUMENTS[s].tick * INSTRUMENTS[s].pv;
export const snap = (s: Sym, p: number) => Math.round(p / INSTRUMENTS[s].tick) * INSTRUMENTS[s].tick;

export type Timeframe = "1s" | "30s" | "1m" | "5m" | "15m" | "30m" | "1h" | "1D";
export const TIMEFRAMES: { id: Timeframe; label: string; sec: number }[] = [
  { id: "1s", label: "1s", sec: 1 },
  { id: "30s", label: "30s", sec: 30 },
  { id: "1m", label: "1m", sec: 60 },
  { id: "5m", label: "5m", sec: 300 },
  { id: "15m", label: "15m", sec: 900 },
  { id: "30m", label: "30m", sec: 1800 },
  { id: "1h", label: "1h", sec: 3600 },
  { id: "1D", label: "1D", sec: 86400 },
];
export const tfSec = (id: Timeframe): number => TIMEFRAMES.find((t) => t.id === id)?.sec ?? 60;

/** Date ranges, each shown at the timeframe that suits it. */
export type Range = "1D" | "5D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "All";
export const RANGES: { id: Range; tf: Timeframe; label: string }[] = [
  { id: "1D", tf: "1m", label: "1 day of 1 minute bars" },
  { id: "5D", tf: "5m", label: "5 days of 5 minute bars" },
  { id: "1M", tf: "30m", label: "1 month of 30 minute bars" },
  { id: "3M", tf: "1h", label: "3 months of hourly bars" },
  { id: "6M", tf: "1D", label: "6 months of daily bars" },
  { id: "YTD", tf: "1D", label: "Year to date, daily" },
  { id: "1Y", tf: "1D", label: "1 year of daily bars" },
  { id: "5Y", tf: "1D", label: "5 years of daily bars" },
  { id: "All", tf: "1D", label: "All history, daily" },
];

/** Intraday margin per contract, as discount brokers set it for day trades. */
export const DAY_MARGIN: Record<Sym, number> = { NQ: 1000, ES: 500, MNQ: 100, MES: 50 };

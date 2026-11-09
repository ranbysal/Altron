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

export type Timeframe = "1m" | "5m" | "15m" | "1h";
export const TIMEFRAMES: { id: Timeframe; label: string; min: number }[] = [
  { id: "1m", label: "1m", min: 1 },
  { id: "5m", label: "5m", min: 5 },
  { id: "15m", label: "15m", min: 15 },
  { id: "1h", label: "1h", min: 60 },
];

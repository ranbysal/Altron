import { fmt, money, signed } from "./format";

/** Demonstration trades for the public page. Not real results. */
const RAW = [
  { date: "Nov 05", mkt: "NQ", side: "LONG", n: 2, entry: 24512.25, exit: 24561.0, risk: 24.25, pv: 20 },
  { date: "Nov 05", mkt: "ES", side: "SHORT", n: 3, entry: 6861.5, exit: 6867.25, risk: 5.75, pv: 50 },
  { date: "Nov 04", mkt: "MNQ", side: "LONG", n: 10, entry: 24398.0, exit: 24431.5, risk: 24, pv: 2 },
  { date: "Nov 03", mkt: "NQ", side: "SHORT", n: 1, entry: 24620.75, exit: 24581.25, risk: 25, pv: 20 },
  { date: "Nov 03", mkt: "MES", side: "LONG", n: 8, entry: 6842.25, exit: 6839.0, risk: 6.5, pv: 5 },
  { date: "Oct 31", mkt: "ES", side: "LONG", n: 2, entry: 6815.0, exit: 6833.5, risk: 7.5, pv: 50 },
  { date: "Oct 30", mkt: "NQ", side: "LONG", n: 2, entry: 24205.5, exit: 24181.25, risk: 24.25, pv: 20 },
  { date: "Oct 29", mkt: "MNQ", side: "SHORT", n: 10, entry: 24310.25, exit: 24262.75, risk: 23.75, pv: 2 },
] as const;

export type LedgerRow = {
  date: string;
  mkt: string;
  side: "LONG" | "SHORT";
  size: number;
  entry: string;
  exit: string;
  r: string;
  pnl: string;
  win: boolean;
  rValue: number;
};

export const LEDGER: LedgerRow[] = RAW.map((t) => {
  const dir = t.side === "LONG" ? 1 : -1;
  const pts = (t.exit - t.entry) * dir;
  const pnl = pts * t.pv * t.n;
  const R = pts / t.risk;
  return {
    date: t.date,
    mkt: `${t.mkt}Z6`,
    side: t.side,
    size: t.n,
    entry: fmt(t.entry),
    exit: fmt(t.exit),
    r: signed(R, 1, "R"),
    pnl: money(pnl),
    win: pnl >= 0,
    rValue: R,
  };
});

const pnls = RAW.map((t) => (t.exit - t.entry) * (t.side === "LONG" ? 1 : -1) * t.pv * t.n);
const wins = pnls.filter((p) => p > 0);
const grossWin = wins.reduce((a, b) => a + b, 0);
const grossLoss = -pnls.filter((p) => p <= 0).reduce((a, b) => a + b, 0);
const sumR = LEDGER.reduce((a, r) => a + r.rValue, 0);

export const LEDGER_STATS = [
  { label: "Trades", value: String(RAW.length), accent: false },
  { label: "Win rate", value: `${((wins.length / RAW.length) * 100).toFixed(1)}%`, accent: false },
  { label: "Profit factor", value: (grossWin / grossLoss).toFixed(2), accent: false },
  { label: "Net", value: signed(sumR, 1, "R"), accent: true },
];

/** SVG path for cumulative R, oldest → newest, in a 1200×180 box. */
export function equityPaths() {
  const cum = [0];
  [...LEDGER].reverse().forEach((r) => cum.push(cum[cum.length - 1] + r.rValue));
  const max = Math.max(...cum);
  const min = Math.min(...cum);
  const pts = cum.map((v, i) => [(i / (cum.length - 1)) * 1200, 168 - ((v - min) / (max - min)) * 152]);
  const line = pts.map((p, i) => `${i ? "L" : "M"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return { line, area: `${line} L 1200 180 L 0 180 Z` };
}

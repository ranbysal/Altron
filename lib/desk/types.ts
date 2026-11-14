import type { Sym } from "./instruments";

/** The desk's records: orders, fills, positions, trades, notes and what members are told. */

export type Side = 1 | -1;
export type OrderType = "MKT" | "LMT" | "STP" | "STPLMT" | "TRAIL";
export type Role = "entry" | "stop" | "target" | "exit";

export type Order = {
  id: string;
  sym: Sym;
  side: Side;
  qty: number;
  type: OrderType;
  role: Role;
  limit?: number;
  stop?: number;
  trail?: number; // points
  anchor?: number;
  oco?: string;
  reduceOnly?: boolean;
  /** the bracket set around the fill: a distance in ticks, or an exact price typed on the ticket */
  attach?: { stopTicks?: number; targetTicks?: number; stopPx?: number; targetPx?: number; target2Ticks?: number; target2Px?: number };
  /** members are told when this order is placed and when it fills */
  notify?: { note?: string };
  /** a stop or target: the price members were last told, and a price he chose not to announce */
  told?: number;
  quiet?: number;
  /** placed by the follow agent for this trade of Yazan's, and what for */
  follows?: string;
  tag?: string;
  /** an exit the agent sizes itself (half at a first target): never resized to the position */
  fixed?: boolean;
  at: number;
};

export type Fill = { id: string; orderId: string; sym: Sym; side: Side; qty: number; price: number; at: number; tradeId: string; role: Role; pnl: number };
export type Position = { sym: Sym; qty: number; avg: number; openedAt: number; tradeId: string };
export type Trade = {
  id: string;
  sym: Sym;
  side: "LONG" | "SHORT";
  openedAt: number;
  closedAt?: number;
  qty: number;
  entryQty: number;
  entryValue: number;
  exitQty: number;
  exitValue: number;
  pnl: number;
  risk?: number;
  /** opened with a notification: its exits are announced too */
  notify?: boolean;
  /** where the stop and target last sat, kept for the record once the trade is over */
  stop?: number;
  target?: number;
  /** the owner's book: the trade of Yazan's this one follows */
  follows?: string;
};
export type Phase = "before" | "during" | "after";
export type Note = { id: string; tradeId: string | null; sym: Sym; phase: Phase; text: string; at: number; edits: { text: string; at: number }[] };
export type Toast = { id: string; tone: "pos" | "neg" | "plain"; title: string; body?: string; at: number };

/** What members are sent: entries, working orders, fills, moved stops and targets, exits. */
export type NoticeKind = "entry" | "order" | "fill" | "stop" | "target" | "exit";
export type Notice = {
  id: string;
  kind: NoticeKind;
  sym: Sym;
  at: number;
  side?: Side;
  qty?: number;
  price?: number;
  type?: OrderType;
  stop?: number;
  target?: number;
  /** a second target: half comes off at the first, the rest here */
  target2?: number;
  /** a moved stop or target: what members were told before */
  was?: number;
  pnl?: number;
  why?: string;
  note?: string;
  tradeId?: string;
};

/** Whose book is on the desk: Yazan's (members read it too), or the owner's own. */
export type Seat = "trader" | "owner";

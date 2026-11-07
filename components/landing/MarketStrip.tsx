"use client";

import { fmt, pctChange } from "@/lib/format";
import { SETTLE } from "@/lib/feed";
import { useFeed } from "./FeedProvider";
import s from "./landing.module.css";

export function useQuotes() {
  const { snap } = useFeed();
  const q = (sym: string, name: string, price: number, settle: number) => ({
    sym,
    name,
    price: fmt(price),
    chg: pctChange(price, settle),
    up: price >= settle,
  });
  return [
    q("NQ", "E-mini Nasdaq-100", snap.nq, SETTLE.NQ),
    q("ES", "E-mini S&P 500", snap.es, SETTLE.ES),
    q("MNQ", "Micro E-mini Nasdaq-100", snap.nq, SETTLE.NQ),
    q("MES", "Micro E-mini S&P 500", snap.es, SETTLE.ES),
  ];
}

export function MarketStrip() {
  const quotes = useQuotes();
  return (
    <section aria-label="Markets (simulated)" className={s.strip}>
      <div className={`${s.container} ${s.stripGrid}`}>
        {quotes.map((t) => (
          <div key={t.sym} className={s.quote}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span className={s.quoteSym}>
                {t.sym}
                <span>Z6</span>
              </span>
              <span className={s.quoteName}>{t.name}</span>
            </div>
            <div className={s.quoteRight}>
              <span className={s.quotePrice}>{t.price}</span>
              <span className={`${s.quoteChg} ${t.up ? s.blue : s.ember}`}>{t.chg}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { reviewNow, useFollow } from "@/lib/follow/runner";
import { Cell } from "@/components/trader/parts";
import s from "@/components/trader/trader.module.css";
import r from "./results.module.css";
import v from "./review.module.css";

/*
 * Every session reviewed: the day's numbers as the engine closed them, and what the coach
 * model made of the day, newest first.
 */

const money = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const plain = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const longDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });

/** The coach's text as headings, points and paragraphs. It writes plain markdown. */
function Coach({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`u${out.length}`}>{list.map((x, i) => <li key={i}>{x}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const head = line.match(/^(?:#+\s*)?\**(The day|What went right|What cost us|One change to consider)\**:?\s*$/i);
    if (head) {
      flush();
      out.push(<h3 key={`h${out.length}`}>{head[1]}</h3>);
      continue;
    }
    const point = line.match(/^[-*•]\s+(.*)$/);
    if (point) {
      list.push(point[1].replace(/\*\*/g, ""));
      continue;
    }
    flush();
    out.push(<p key={`p${out.length}`}>{line.replace(/^#+\s*/, "").replace(/\*\*/g, "")}</p>);
  }
  flush();
  return <div className={v.coach}>{out}</div>;
}

export function Review() {
  const reviews = useFollow((x) => x.reviews);
  const where = useFollow((x) => x.where);
  const wiring = useFollow((x) => x.wiring);
  const [asked, setAsked] = useState(false);
  const list = [...reviews].reverse();
  return (
    <div className={v.page}>
      <div className={s.sheet}>
        <i className={s.sheetR} aria-hidden="true" />
        <i className={s.sheetB} aria-hidden="true" />
        <div className={s.row1}>
          <Cell i={0} noTop label="Reviews" aside={wiring ? `Written by ${wiring.tiers.coach} after each 5 PM close` : undefined}>
            <div className={v.intro}>
              <h1>Each session, looked at again.</h1>
              <p>After the close the server hands the day to a coach model: every one of Yazan&apos;s trades, what the engine did with each and why, and how the models&apos; calls compared. It writes back what went right, what cost us, and one setting to consider. The same review goes to Discord.</p>
              {where === "server" && (
                <button type="button" className={r.more} disabled={asked} onClick={() => (reviewNow(), setAsked(true))}>
                  {asked ? "Asked. It takes a few minutes" : "Review today now"}
                </button>
              )}
            </div>
          </Cell>
        </div>
        {list.length ? (
          list.map((x, i) => (
            <div key={x.day} className={s.row1}>
              <Cell i={i + 1} label={longDay(x.at)} aside={x.coach ? `${x.coach.label} · $${x.coach.usd.toFixed(2)}` : x.coachError ? "No review" : "Writing"}>
                <div className={v.day}>
                  <dl className={v.facts}>
                    <div>
                      <dt>The day</dt>
                      <dd className={x.pnl > 0 ? s.pos : x.pnl < 0 ? s.neg : undefined}>{money(x.pnl)}</dd>
                    </div>
                    <div>
                      <dt>Equity</dt>
                      <dd>{plain(x.equity)}</dd>
                    </div>
                    <div>
                      <dt>Trades</dt>
                      <dd>{x.trades}</dd>
                    </div>
                    <div>
                      <dt>Phase</dt>
                      <dd>{x.phase}</dd>
                    </div>
                  </dl>
                  {x.coach ? <Coach text={x.coach.text} /> : <p className={r.empty}>{x.coachError ?? "The coach is reading the day. Max effort takes a few minutes."}</p>}
                  {x.lines.length > 0 && (
                    <div className={v.summary}>
                      <span className={v.k}>The engine&apos;s summary</span>
                      {x.lines.map((l, j) => (
                        <p key={j}>{l}</p>
                      ))}
                    </div>
                  )}
                </div>
              </Cell>
            </div>
          ))
        ) : (
          <div className={s.row1}>
            <Cell i={1} label="No reviews yet">
              <p className={r.empty}>The first review comes at the 5 PM close of the first session the engine runs on the server.</p>
            </Cell>
          </div>
        )}
      </div>
    </div>
  );
}

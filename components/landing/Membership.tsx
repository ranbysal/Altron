import { Mark } from "@/components/Mark";
import { LEDGER } from "@/lib/ledger";
import s from "./landing.module.css";

/** A phone-style notification: who, what, and the three levels, each labelled. */
function AlertStage() {
  return (
    <div className={s.stage} aria-hidden="true">
      <div className={s.notif}>
        <div className={s.notifHead}>
          <span className={s.notifApp}>
            <Mark size={11} />
          </span>
          <span className={s.notifFrom}>Altron</span>
          <span className={s.notifTime}>now</span>
        </div>
        <p className={s.notifTitle}>Yazan opened a long</p>
        <p className={s.notifBody}>2 NQ contracts at 24,476.50</p>
        <div className={s.notifLevels}>
          <span>
            <i>Stop</i>
            <b className={s.down}>24,452.00</b>
          </span>
          <span>
            <i>Target</i>
            <b className={s.up}>24,525.00</b>
          </span>
        </div>
      </div>
      <div className={s.notifChannels}>
        <span>
          <i className={s.notifCheck} />
          Discord
        </span>
        <span>
          <i className={s.notifCheck} />
          WhatsApp
        </span>
      </div>
    </div>
  );
}

function NoteStage() {
  return (
    <div className={s.stage} aria-hidden="true">
      <div className={s.mini}>
        <div className={s.miniRow}>
          <span className={s.miniLabel}>DESK NOTE · BEFORE ENTRY</span>
          <span className={s.miniLabel}>10:21</span>
        </div>
        <p className={s.miniQuote}>“Reclaim of the overnight high on volume. Wrong below the 10:15 low.”</p>
        <div className={s.miniRow} style={{ marginTop: 10, justifyContent: "flex-start", fontSize: 12, color: "var(--muted)" }}>
          <span className={`${s.avatar} ${s.avatarSm}`}>Y</span>Yazan
        </div>
      </div>
    </div>
  );
}

function RecordStage() {
  return (
    <div className={s.stage} aria-hidden="true">
      <div className={s.mini} style={{ paddingTop: 8, paddingBottom: 8 }}>
        {LEDGER.slice(0, 4).map((r, i) => (
          <div key={i} className={s.miniLedgerRow}>
            <span style={{ color: "var(--dim)" }}>{r.date}</span>
            <span className={s.mono} style={{ fontSize: 12 }}>
              {r.side === "LONG" ? "L" : "S"} · {r.mkt}
            </span>
            <span className={r.win ? s.up : s.down}>{r.r}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const FEATURES = [
  {
    kicker: "01 / LIVE",
    title: "Positions in real time.",
    body: "See entries, stops, targets, and position updates as they happen. Trade alerts are delivered directly to communication channels.",
    Stage: AlertStage,
  },
  {
    kicker: "02 / REASONING",
    title: "Context behind every trade.",
    body: "Read the trader’s notes before and after each position, including the setup, reasoning, and what changed along the way.",
    Stage: NoteStage,
  },
  {
    kicker: "03 / RECORD",
    title: "A complete trading history.",
    body: "Every closed position is recorded, including losses. Review past trades, execution levels, and performance over time.",
    Stage: RecordStage,
  },
];

export function Membership() {
  return (
    <section className={s.members}>
      <div className={`${s.container} ${s.stack56}`}>
        <div className={s.membersHead}>
          <h2 className={s.h2}>
            See the whole trade, <em>not just the result.</em>
          </h2>
        </div>
        <div className={s.features}>
          {FEATURES.map(({ kicker, title, body, Stage }) => (
            <article key={kicker} className={s.feature}>
              <Stage />
              <div className={s.featureBody}>
                <span className={s.featureKicker}>{kicker}</span>
                <h3 className={s.h3}>{title}</h3>
                <p>{body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

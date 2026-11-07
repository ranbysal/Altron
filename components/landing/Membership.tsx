import { LEDGER } from "@/lib/ledger";
import s from "./landing.module.css";

function AlertStage() {
  return (
    <div className={s.stage} aria-hidden="true">
      <div className={s.mini}>
        <div className={s.miniRow}>
          <span className={s.miniLabel}>NEW POSITION · 10:33:07 ET</span>
          <span className={`${s.dotEmber} pulse-ember`} />
        </div>
        <div className={s.miniRow} style={{ marginTop: 8 }}>
          <span className={s.miniStrong}>Long 2 × NQZ6</span>
          <span className={`${s.miniStrong} ${s.up}`}>24,476.50</span>
        </div>
        <div className={s.miniRow} style={{ marginTop: 4, color: "var(--dim)", fontSize: 12 }}>
          <span>SL 24,452.00</span>
          <span>TP 24,525.00</span>
        </div>
      </div>
      <div className={`${s.mini} ${s.miniBack}`}>
        <div className={s.miniRow}>
          <span className={s.miniLabel}>DELIVERED TO DISCORD · WHATSAPP</span>
        </div>
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
    kicker: "LIVE",
    title: "Live, not later.",
    body: "Positions appear the moment he’s filled, and alerts go out to Discord or WhatsApp. You see the trade while it’s happening, not after it’s over.",
    Stage: AlertStage,
  },
  {
    kicker: "REASONING",
    title: "The why, in his words.",
    body: "Notes before and after each trade: the setup he’s watching, where the idea is wrong, and what he’d change looking back.",
    Stage: NoteStage,
  },
  {
    kicker: "RECORD",
    title: "The whole record.",
    body: "Every closed trade stays on the ledger, losses included. Go back through the history by market or side and study how it actually went.",
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

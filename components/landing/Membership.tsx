import { PillarArt } from "./DitherCanvas";
import { SectionLabel } from "./SectionLabel";
import s from "./landing.module.css";

const PILLARS = [
  {
    badge: "01 / LIVE",
    title: "Live, not later.",
    body: "Positions appear the moment he’s filled, with alerts to Discord or WhatsApp — so you’re never reading about a trade after it’s over.",
  },
  {
    badge: "02 / REASONING",
    title: "The why, in his words.",
    body: "Notes before and after each trade: the setup he’s watching, where the idea is wrong, and what he’d change looking back.",
  },
  {
    badge: "03 / RECORD",
    title: "The whole record.",
    body: "Every closed trade stays on the ledger, losses included. Go back through the history by market or side and study how it actually went.",
  },
] as const;

export function Membership() {
  return (
    <section className={s.members}>
      <div className={`${s.container} ${s.stack56}`}>
        <SectionLabel>02 — MEMBERSHIP</SectionLabel>
        <h2 className={`${s.h2} ${s.membersH2}`}>
          What a screenshot of a winning trade <em>will never show you.</em>
        </h2>
        <div className={s.pillars}>
          {PILLARS.map((p, i) => (
            <article key={p.badge} className={s.pillar}>
              <div className={s.pillarArt}>
                <PillarArt which={i as 0 | 1 | 2} className={s.fill} />
                <span className={s.badge}>{p.badge}</span>
              </div>
              <div className={s.pillarBody}>
                <h3 className={s.h3}>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

import { fmt } from "@/lib/format";
import { POSITION } from "@/lib/feed";
import s from "./landing.module.css";

/** Stop-to-target scale with 5-point ticks, the entry, and a marker for the live price. */
export function HeroRuler({ price }: { price: number }) {
  const { stop, entry, target } = POSITION;
  const span = target - stop;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - stop) / span) * 100));
  const ticks: number[] = [];
  for (let v = Math.ceil(stop / 5) * 5; v <= target; v += 5) ticks.push(v);
  const p = pct(price);
  const e = pct(entry);
  const up = price >= entry;

  return (
    <div className={s.ruler} role="img" aria-label={`Price ${fmt(price)}, between stop ${fmt(stop)} and target ${fmt(target)}`}>
      <div className={s.rulerTrack}>
        {ticks.map((v) => (
          <i key={v} className={v % 25 === 0 ? s.tickMajor : s.tick} style={{ left: `${pct(v)}%` }} />
        ))}
        <span
          className={s.rulerFill}
          style={{ left: `${Math.min(e, p)}%`, width: `${Math.abs(p - e)}%`, background: up ? "var(--blue)" : "var(--ember)" }}
        />
        <span className={s.rulerEntry} style={{ left: `${e}%` }} />
        <span className={s.rulerMarker} style={{ left: `${p}%` }} />
      </div>
      <div className={s.rulerLabels}>
        <span className={s.down}>SL {fmt(stop)}</span>
        <span className={s.rulerEntryLabel} style={{ left: `${e}%` }}>
          ENTRY {fmt(entry)}
        </span>
        <span className={s.up}>TP {fmt(target)}</span>
      </div>
    </div>
  );
}

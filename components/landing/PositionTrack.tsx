import s from "./landing.module.css";

/** Stop → entry → target bar with the live price as a knob. */
export function PositionTrack({ pct, entryPct }: { pct: number; entryPct: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className={s.track} role="img" aria-label={`Price is ${pct.toFixed(0)}% of the way from stop to target`}>
        <div
          className={s.trackFill}
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, var(--ember) 0%, var(--ember) ${entryPct}%, var(--blue) ${entryPct}%, var(--blue-soft) 100%)`,
            backgroundSize: `${pct > 0 ? 10000 / pct : 100}% 100%`,
            opacity: 0.9,
          }}
        />
        <div className={s.trackEntry} style={{ left: `${entryPct}%` }} />
        <div className={s.trackKnob} style={{ left: `${pct}%` }} />
      </div>
      <div className={s.trackLabels}>
        <span>SL</span>
        <span>ENTRY</span>
        <span>TP</span>
      </div>
    </div>
  );
}

import s from "./landing.module.css";

/**
 * A number whose digits roll vertically to their new value, like an
 * odometer. Columns are keyed from the right so the units stay put when
 * the number gains or loses a digit.
 */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const chars = value.split("");
  return (
    <span className={`${s.roll} ${className ?? ""}`}>
      <span className="sr-only">{value}</span>
      {chars.map((ch, i) => {
        const key = chars.length - i;
        if (!/\d/.test(ch)) {
          return (
            <span key={key} className={s.rollSep} aria-hidden="true">
              {ch}
            </span>
          );
        }
        return (
          <span key={key} className={s.rollCol} aria-hidden="true">
            <span className={s.rollStrip} style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
              {"0123456789".split("").map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

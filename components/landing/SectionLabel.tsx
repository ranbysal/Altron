import s from "./landing.module.css";

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.sectionLabel}>
      <span>[ {children} ]</span>
      <span className={s.rule} />
      <span className={s.diamond} />
    </div>
  );
}

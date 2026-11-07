type Props = {
  size?: number;
  className?: string;
  /** Defaults to currentColor, so the mark follows the theme's text color. */
  color?: string;
  title?: string;
};

/** Four-point star. Taller than it is wide (55:40), with concave arms and a soft core. */
export const STAR_PATH =
  "M40 0C41 27 43 41 48.5 46.5C54 52 67 54.3 80 55C67 55.7 54 58 48.5 63.5C43 69 41 83 40 110C39 83 37 69 31.5 63.5C26 58 13 55.7 0 55C13 54.3 26 52 31.5 46.5C37 41 39 27 40 0Z";

export function Mark({ size = 24, className, color = "currentColor", title }: Props) {
  return (
    <svg
      width={(size * 80) / 110}
      height={size}
      viewBox="0 0 80 110"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={STAR_PATH} fill={color} />
    </svg>
  );
}

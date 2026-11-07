type Props = {
  size?: number;
  /** Color of the body cells. The top cell is always Signal blue unless `mono` is set. */
  color?: string;
  mono?: boolean;
  className?: string;
};

/** Altron mark: a pixel "A" on a 3×4 grid. The peak is the signal. */
export function Mark({ size = 30, color = "#E9ECEF", mono = false, className }: Props) {
  const w = (size * 22) / 30;
  const cells: [number, number][] = [
    [0, 8], [16, 8], [0, 16], [8, 16], [16, 16], [0, 24], [16, 24],
  ];
  return (
    <svg width={w} height={size} viewBox="0 0 22 30" aria-hidden="true" className={className}>
      <rect x={8} y={0} width={6} height={6} fill={mono ? color : "#4DA3FF"} />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={6} height={6} fill={color} />
      ))}
    </svg>
  );
}

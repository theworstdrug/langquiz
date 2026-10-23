import { useState } from 'react';

interface Props {
  title: string;
  data: { label: string; value: number }[];
  format?: (v: number) => string;
}

/** Single-series daily bar chart with a hover tooltip and a table fallback. */
export default function BarChart({ title, data, format = String }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 140;
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = W / data.length;
  const bw = Math.max(2, slot - 2); // 2px surface gap between bars
  const total = data.reduce((n, d) => n + d.value, 0);
  return (
    <figure className="chart card">
      <figcaption>
        <span>{title}</span>
        <span className="muted small">{format(total)} in {data.length} days</span>
      </figcaption>
      <div className="chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={title}>
          <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="chart-axis" />
          {data.map((d, i) => {
            const h = (d.value / max) * (H - 8);
            const x = i * slot + 1;
            const r = Math.min(4, bw / 2, h);
            return (
              <g key={d.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
                {h > 0 && (
                  <path
                    className={`chart-bar ${hover === i ? 'hover' : ''}`}
                    d={`M${x},${H} V${H - h + r} Q${x},${H - h} ${x + r},${H - h} H${x + bw - r} Q${x + bw},${H - h} ${x + bw},${H - h + r} V${H} Z`}
                  />
                )}
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}>
            <strong>{format(data[hover].value)}</strong>
            <span className="muted">{data[hover].label}</span>
          </div>
        )}
      </div>
      <div className="chart-x muted small">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
      <details className="small">
        <summary className="muted">Table</summary>
        <table className="mini">
          <tbody>
            {data
              .filter((d) => d.value)
              .map((d) => (
                <tr key={d.label}>
                  <td>{d.label}</td>
                  <td>{format(d.value)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

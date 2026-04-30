'use client';

/**
 * Tiny SVG charting primitives for the Sessions dashboard. Hand-rolled to
 * avoid pulling in recharts. The dashboard has 2 chart types so the math
 * is small.
 */

import { useMemo } from 'react';

interface LinePoint { label: string; values: number[] }
interface LineChartProps {
  points: LinePoint[];
  seriesLabels: string[];
  seriesColors: string[]; // CSS colors for each series
  height?: number;
  yLabel?: string;
}

/** Multi-series line chart with simple grid + axis. */
export function LineChart({ points, seriesLabels, seriesColors, height = 220, yLabel }: LineChartProps) {
  const padding = { top: 16, right: 12, bottom: 28, left: 48 };
  const width = 720; // intrinsic width; SVG scales

  const maxY = useMemo(() => {
    let m = 0;
    for (const p of points) for (const v of p.values) if (v > m) m = v;
    return m === 0 ? 1 : m;
  }, [points]);

  const xStep = points.length <= 1 ? 0 : (width - padding.left - padding.right) / (points.length - 1);
  const yScale = (v: number) => padding.top + (height - padding.top - padding.bottom) * (1 - v / maxY);
  const xAt = (i: number) => padding.left + i * xStep;

  // Y ticks (4 ticks)
  const yTicks = useMemo(() => {
    const out: Array<{ value: number; y: number }> = [];
    for (let i = 0; i <= 4; i++) {
      const v = (maxY / 4) * i;
      out.push({ value: v, y: yScale(v) });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxY, height]);

  if (points.length === 0) {
    return <div className="text-sm text-mc-text-secondary text-center py-12">No data yet.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 480 }}>
        {/* Grid + Y axis labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={t.y}
              x2={width - padding.right}
              y2={t.y}
              stroke="var(--mc-border, #30363d)"
              strokeDasharray={i === 0 ? '0' : '2 4'}
              strokeWidth={1}
              opacity={i === 0 ? 0.7 : 0.4}
            />
            <text
              x={padding.left - 6}
              y={t.y + 3}
              textAnchor="end"
              className="fill-mc-text-secondary"
              style={{ fontSize: 10, fontFamily: 'inherit' }}
            >
              {formatTick(t.value)}
            </text>
          </g>
        ))}

        {/* Y axis label */}
        {yLabel && (
          <text
            x={4}
            y={padding.top + (height - padding.top - padding.bottom) / 2}
            transform={`rotate(-90, 12, ${padding.top + (height - padding.top - padding.bottom) / 2})`}
            textAnchor="middle"
            className="fill-mc-text-secondary"
            style={{ fontSize: 10 }}
          >
            {yLabel}
          </text>
        )}

        {/* X axis labels — show every Nth so we don't overlap */}
        {points.map((p, i) => {
          const interval = Math.max(1, Math.ceil(points.length / 8));
          if (i % interval !== 0 && i !== points.length - 1) return null;
          return (
            <text
              key={i}
              x={xAt(i)}
              y={height - padding.bottom + 14}
              textAnchor="middle"
              className="fill-mc-text-secondary"
              style={{ fontSize: 10 }}
            >
              {p.label}
            </text>
          );
        })}

        {/* Lines */}
        {seriesLabels.map((label, sIdx) => {
          const color = seriesColors[sIdx];
          const path = points
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yScale(p.values[sIdx] ?? 0).toFixed(1)}`)
            .join(' ');
          return (
            <g key={label}>
              <path d={path} stroke={color} strokeWidth={2} fill="none" />
              {points.map((p, i) => (
                <circle
                  key={i}
                  cx={xAt(i)}
                  cy={yScale(p.values[sIdx] ?? 0)}
                  r={2.5}
                  fill={color}
                >
                  <title>{`${label}: ${formatTick(p.values[sIdx] ?? 0)} on ${p.label}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 mt-2 text-xs text-mc-text-secondary">
        {seriesLabels.map((label, i) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5" style={{ backgroundColor: seriesColors[i] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

interface DonutSlice { label: string; value: number; color: string }
interface DonutChartProps { slices: DonutSlice[]; size?: number; thickness?: number }

/** Donut chart with proportional arcs + legend. Filters out zero slices. */
export function DonutChart({ slices, size = 180, thickness = 28 }: DonutChartProps) {
  const filtered = slices.filter(s => s.value > 0);
  const total = filtered.reduce((s, x) => s + x.value, 0);

  if (total === 0) {
    return <div className="text-sm text-mc-text-secondary text-center py-12">No tokens recorded yet.</div>;
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;

  let cursor = -Math.PI / 2; // start at top
  const arcs = filtered.map(s => {
    const angle = (s.value / total) * Math.PI * 2;
    const start = cursor;
    const end = cursor + angle;
    cursor = end;
    return { ...s, start, end, share: s.value / total };
  });

  function arcPath(start: number, end: number): string {
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const largeArc = end - start > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  }

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        {arcs.map((a, i) => (
          <path
            key={i}
            d={arcPath(a.start, a.end)}
            stroke={a.color}
            strokeWidth={thickness}
            fill="none"
            strokeLinecap="butt"
          >
            <title>{`${a.label}: ${formatTick(a.value)} (${(a.share * 100).toFixed(1)}%)`}</title>
          </path>
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-mc-text" style={{ fontSize: 16, fontWeight: 700 }}>
          {formatTick(total)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-mc-text-secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
          tokens
        </text>
      </svg>

      <ul className="flex-1 min-w-0 space-y-1.5 text-xs">
        {arcs.map(a => (
          <li key={a.label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: a.color }} />
            <span className="text-mc-text truncate">{a.label}</span>
            <span className="text-mc-text-secondary tabular-nums ml-auto">{formatTick(a.value)} · {(a.share * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatTick(n: number): string {
  if (!n || isNaN(n)) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 10_000) return Math.round(n / 1_000) + 'K';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(Math.round(n));
}

// components/Charts.js — Phase 3 hand-rolled inline-SVG charts (no chart library).
// Namespaced under CV.Charts. All colors come from CSS tokens via class names so
// both themes work; gold (--accent) is reserved for the value line (spec §4),
// while the value-by-sport bars use neutral tokens.
window.CV = window.CV || {};

CV.Charts = (function () {
  // Compact money for axis labels so they stay narrow ("$1.2k", "$450").
  function moneyShort(n) {
    n = Number(n) || 0;
    const a = Math.abs(n);
    if (a >= 1000) return "$" + (n / 1000).toFixed(a >= 10000 ? 0 : 1) + "k";
    return "$" + Math.round(n);
  }

  // Map values into [0,1] by min/max (a flat series sits at mid-height).
  function normalize(values) {
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const span = max - min;
    return values.map((v) => (span === 0 ? 0.5 : (v - min) / span));
  }

  // Small value sparkline for the card detail — caller renders it only when the
  // card has ≥2 snapshots.
  function Sparkline(props) {
    const pts = (props.points || []).filter((p) => p && p.value != null && !isNaN(Number(p.value)));
    if (pts.length < 2) return null;
    const W = props.width || 132;
    const H = props.height || 34;
    const pad = 3;
    const norm = normalize(pts.map((p) => Number(p.value)));
    const stepX = (W - pad * 2) / (pts.length - 1);
    const coords = norm.map((n, i) => [pad + i * stepX, pad + (1 - n) * (H - pad * 2)]);
    const line = coords
      .map((c, i) => (i === 0 ? "M" : "L") + c[0].toFixed(1) + " " + c[1].toFixed(1))
      .join(" ");
    const last = coords[coords.length - 1];
    return (
      <svg className="spark" viewBox={"0 0 " + W + " " + H} width={W} height={H} role="img" aria-label="Value trend">
        <path className="spark-line" d={line} />
        <circle className="spark-dot" cx={last[0]} cy={last[1]} r="2.5" />
      </svg>
    );
  }

  // 6-month collection-value line. Gold line + soft gold fill; muted axes/grid.
  function LineChart(props) {
    const series = (props.series || []).filter((p) => p && p.value != null);
    if (series.length < 2) return null;
    const W = 320,
      H = 168;
    const padL = 46,
      padR = 12,
      padT = 12,
      padB = 26;
    const values = series.map((p) => Number(p.value) || 0);
    let min = Math.min.apply(null, values);
    let max = Math.max.apply(null, values);
    if (min === max) {
      const bump = max === 0 ? 1 : max * 0.1;
      min -= bump;
      max += bump;
    }
    if (min > 0 && min < max * 0.35) min = 0; // anchor to zero when close
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const x = (i) => padL + (innerW * i) / (series.length - 1);
    const y = (v) => padT + innerH * (1 - (v - min) / (max - min));
    const linePath = series
      .map((p, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(p.value).toFixed(1))
      .join(" ");
    const baseY = padT + innerH;
    const areaPath =
      linePath +
      " L" + x(series.length - 1).toFixed(1) + " " + baseY +
      " L" + x(0).toFixed(1) + " " + baseY + " Z";
    const ticks = 3;
    const gridVals = [];
    for (let t = 0; t <= ticks; t++) gridVals.push(min + ((max - min) * t) / ticks);
    return (
      <svg
        className="linechart"
        viewBox={"0 0 " + W + " " + H}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Collection value, last 6 months"
      >
        {gridVals.map((gv, t) => (
          <g key={t}>
            <line className="chart-grid" x1={padL} y1={y(gv)} x2={W - padR} y2={y(gv)} />
            <text className="chart-axis" x={padL - 6} y={y(gv) + 3} textAnchor="end">
              {moneyShort(gv)}
            </text>
          </g>
        ))}
        <path className="chart-area" d={areaPath} />
        <path className="chart-line" d={linePath} />
        {series.map((p, i) => (
          <text key={"x" + i} className="chart-axis" x={x(i)} y={H - 8} textAnchor="middle">
            {p.label || ""}
          </text>
        ))}
        <circle
          className="chart-dot"
          cx={x(series.length - 1)}
          cy={y(series[series.length - 1].value)}
          r="3"
        />
      </svg>
    );
  }

  // Value-by-sport horizontal bars. Neutral fill (never gold); money at the end.
  function BarBreakdown(props) {
    const items = (props.items || []).filter((it) => it && it.value > 0);
    if (items.length === 0) return null;
    const rowH = 30,
      gap = 8,
      W = 320,
      labelW = 88,
      valueW = 58;
    const trackX = labelW + 6;
    const trackW = W - trackX - valueW;
    const max = Math.max.apply(null, items.map((it) => it.value));
    const H = items.length * rowH + (items.length - 1) * gap;
    return (
      <svg
        className="barchart"
        viewBox={"0 0 " + W + " " + H}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Value by sport"
      >
        {items.map((it, i) => {
          const rowY = i * (rowH + gap);
          const barH = 18;
          const barY = rowY + (rowH - barH) / 2;
          const w = max === 0 ? 0 : Math.max(2, (trackW * it.value) / max);
          return (
            <g key={it.sport || it.label}>
              <text className="chart-bar-label" x={0} y={rowY + rowH / 2 + 4}>
                {it.label}
              </text>
              <rect className="chart-bar-track" x={trackX} y={barY} width={trackW} height={barH} rx="4" />
              <rect className="chart-bar-fill" x={trackX} y={barY} width={w} height={barH} rx="4" />
              <text className="chart-bar-value" x={W} y={rowY + rowH / 2 + 4} textAnchor="end">
                {CV.fmt.money(it.value)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  return { Sparkline: Sparkline, LineChart: LineChart, BarBreakdown: BarBreakdown };
})();

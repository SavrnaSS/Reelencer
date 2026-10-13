"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SeriesPoint } from "@/lib/socialAnalytics";

// Small dependency-free area chart. It measures its container, so it stays crisp from phone to desktop.

const PAD = { top: 16, right: 14, bottom: 28 };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Minimum horizontal room per x label, so labels never collide. */
const MIN_LABEL_PX = 72;

const shortDate = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const shortTime = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric" });
const longDate = (t: number) =>
  new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** 3–5 rounded tick values covering [min, max]. */
function niceTicks(min: number, max: number, count = 4) {
  if (min === max) {
    const pad = Math.max(1, Math.abs(max) * 0.1);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

/**
 * Evenly spaced time ticks on calendar boundaries (hours, local midnights, weeks, months) with at least
 * MIN_LABEL_PX between them. Sub-day steps label midnights with the date and the rest with the hour.
 */
export function timeTicks(tMin: number, tMax: number, innerW: number) {
  const span = Math.max(1, tMax - tMin);
  // Never more than ~8 labels, even on very wide cards.
  const maxLabels = Math.max(2, Math.min(8, Math.floor(innerW / MIN_LABEL_PX)));
  // Hour labels only when everything fits within about a day; otherwise "6 AM" would repeat for each day.
  const steps = [...(span <= 36 * HOUR ? [HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR] : []), DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 91 * DAY, 182 * DAY, 365 * DAY];
  const step = steps.find((s) => span / s <= maxLabels) ?? steps[steps.length - 1];
  const ticks: { t: number; label: string }[] = [];
  if (step >= 30 * DAY) {
    // Month starts.
    const months = Math.round(step / (30 * DAY));
    const d = new Date(tMin);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    for (d.setMonth(d.getMonth() + 1); d.getTime() <= tMax; d.setMonth(d.getMonth() + months)) {
      ticks.push({ t: d.getTime(), label: d.toLocaleDateString(undefined, { month: "short", year: span > 300 * DAY ? "2-digit" : undefined }) });
    }
  } else if (step >= DAY) {
    const d = new Date(tMin);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < tMin) d.setDate(d.getDate() + 1);
    for (const days = Math.round(step / DAY); d.getTime() <= tMax; d.setDate(d.getDate() + days)) ticks.push({ t: d.getTime(), label: shortDate(d.getTime()) });
  } else {
    const hours = step / HOUR;
    const d = new Date(tMin);
    d.setMinutes(0, 0, 0);
    while (d.getTime() < tMin || d.getHours() % hours) d.setHours(d.getHours() + 1);
    for (; d.getTime() <= tMax; d.setHours(d.getHours() + hours)) ticks.push({ t: d.getTime(), label: d.getHours() === 0 ? shortDate(d.getTime()) : shortTime(d.getTime()) });
  }
  return ticks;
}

/** Monotone cubic (Fritsch–Carlson) path: smooth, never overshoots the data, so counts don't appear to dip. */
function smoothPath(pts: Array<[number, number]>) {
  if (pts.length < 3) return pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const n = pts.length;
  const dx = Array.from({ length: n - 1 }, (_, i) => pts[i + 1][0] - pts[i][0]);
  const slope = Array.from({ length: n - 1 }, (_, i) => (dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0));
  const tangent = pts.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    if (slope[i - 1] * slope[i] <= 0) return 0;
    const w1 = 2 * dx[i] + dx[i - 1];
    const w2 = dx[i] + 2 * dx[i - 1];
    return (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
  });
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + tangent[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - tangent[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

export default function MetricChart({
  points,
  label,
  format,
  height = 220,
  color = "#2e7d4f",
  zeroBased = false,
}: {
  points: SeriesPoint[];
  label: string;
  format: (value: number) => string;
  height?: number;
  color?: string;
  /** Start the axis at 0 (period totals); followers read better zoomed to their range. */
  zeroBased?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (points.length < 2) {
    return (
      <div className="grid place-items-center rounded-lg border border-dashed border-[#dfe2de] text-center text-[12.5px] text-[#7a827c]" style={{ height }}>
        <p className="max-w-[28ch] px-4">
          {points.length === 1 ? `One check-in so far: ${format(points[0].v)}. The trend appears after the next one.` : "No data in this range yet."}
        </p>
      </div>
    );
  }

  const values = points.map((p) => p.v);
  const ticks = niceTicks(zeroBased ? 0 : Math.min(...values), Math.max(...values));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  // The y axis is as wide as its longest label.
  const padLeft = Math.max(30, Math.max(...ticks.map((t) => format(t).length)) * 6.4 + 12);
  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const innerW = Math.max(10, width - padLeft - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (t: number) => padLeft + ((t - tMin) / Math.max(1, tMax - tMin)) * innerW;
  const y = (v: number) => PAD.top + innerH - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * innerH;
  const line = smoothPath(points.map((p) => [x(p.t), y(p.v)]));
  const area = `${line} L${x(tMax).toFixed(1)},${PAD.top + innerH} L${x(tMin).toFixed(1)},${PAD.top + innerH} Z`;
  // Drop ticks that would crowd the chart edges.
  const xTicks = timeTicks(tMin, tMax, innerW).filter((tick) => x(tick.t) - padLeft >= 18 && padLeft + innerW - x(tick.t) >= 18);
  const current = active === null ? null : points[active];
  const previous = active !== null && active > 0 ? points[active - 1] : null;
  const last = points[points.length - 1];

  const pick = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = clientX - rect.left;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.t) - px) < Math.abs(x(points[best].t) - px)) best = i;
    });
    setActive(best);
  };

  const delta = current && previous ? current.v - previous.v : null;

  return (
    <div ref={wrapRef} className="relative select-none" style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label}: ${format(points[0].v)} on ${shortDate(points[0].t)} to ${format(last.v)} on ${shortDate(last.t)}`}
          tabIndex={0}
          className="block touch-pan-y rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
          onPointerMove={(event) => pick(event.clientX)}
          onPointerDown={(event) => pick(event.clientX)}
          onPointerLeave={(event) => event.pointerType === "mouse" && setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            setActive((i) => Math.min(points.length - 1, Math.max(0, (i ?? points.length - 1) + (event.key === "ArrowRight" ? 1 : -1))));
          }}
        >
          <defs>
            <linearGradient id={`fill-${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.2" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={padLeft} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="#eceeeb" strokeDasharray={tick === yMin ? undefined : "3 4"} />
              <text x={padLeft - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-[#8a928c] text-[10.5px] tabular-nums">
                {format(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <g key={tick.t}>
              <line x1={x(tick.t)} x2={x(tick.t)} y1={PAD.top + innerH} y2={PAD.top + innerH + 4} stroke="#d9ddd8" />
              <text x={x(tick.t)} y={height - 8} textAnchor="middle" className="fill-[#8a928c] text-[10.5px]">
                {tick.label}
              </text>
            </g>
          ))}
          <path d={area} fill={`url(#fill-${uid})`} />
          <path d={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
          {points.length <= 24
            ? points.slice(0, -1).map((p, i) => <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r={i === active ? 0 : 2.4} fill="#fff" stroke={color} strokeWidth={1.6} />)
            : null}
          {/* Latest reading: a soft halo marks "now". */}
          <circle cx={x(last.t)} cy={y(last.v)} r={8} fill={color} opacity={0.15} className="motion-safe:animate-pulse" />
          <circle cx={x(last.t)} cy={y(last.v)} r={3.6} fill={color} stroke="#fff" strokeWidth={2} />
          {current ? (
            <g pointerEvents="none">
              <line x1={x(current.t)} x2={x(current.t)} y1={PAD.top} y2={PAD.top + innerH} stroke="#1a201c" strokeOpacity={0.25} strokeDasharray="3 3" />
              <circle cx={x(current.t)} cy={y(current.v)} r={5} fill={color} stroke="#fff" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
      ) : null}
      {current ? (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#1a201c] px-2.5 py-1.5 text-center text-white shadow-lg"
          style={{ left: Math.min(Math.max(x(current.t), 80), Math.max(80, width - 80)) }}
        >
          <div className="flex items-baseline justify-center gap-1.5">
            <span className="text-[13px] font-semibold tabular-nums">{format(current.v)}</span>
            {delta ? (
              <span className={`text-[11px] font-semibold tabular-nums ${delta > 0 ? "text-[#9fd8ae]" : "text-[#f3aaa3]"}`}>
                {delta > 0 ? "+" : "−"}
                {format(Math.abs(delta))}
              </span>
            ) : null}
          </div>
          <div className="text-[10.5px] text-white/70">{longDate(current.t)}</div>
        </div>
      ) : null}
      {/* Same data for screen readers. */}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.t}>
              <th scope="row">{longDate(p.t)}</th>
              <td>{format(p.v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Inline trend line for KPI tiles. */
export function Sparkline({ values, color = "#2e7d4f", className = "h-7 w-20" }: { values: number[]; color?: string; className?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * 100).toFixed(1)},${(28 - ((v - min) / Math.max(1e-9, max - min)) * 24 - 2).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className={className} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

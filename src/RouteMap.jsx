// Results-page "journey": an R+L truck travels from the customer's state to the Acme warehouse.
// Stylized: state abbreviations at their centers sketch the US, so no map service is needed.
import React from 'react';
import { STATE_CENTERS, WAREHOUSE_POINTS } from './data/states.js';

const W = 640, H = 340;
const proj = ([lat, lon]) => [((lon + 125) / 59) * (W - 40) + 20, ((50 - lat) / 26) * (H - 40) + 20];

export default function RouteMap({ fromState, fromCity, toKey, toLabel, pickupDate, serviceDays }) {
  const a = STATE_CENTERS[fromState] ? proj(STATE_CENTERS[fromState]) : null;
  const b = WAREHOUSE_POINTS[toKey] ? proj(WAREHOUSE_POINTS[toKey]) : null;
  if (!a || !b) return null;
  const lift = Math.max(40, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.3);
  const c = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - lift];
  const d = `M${a[0]},${a[1]} Q${c[0]},${c[1]} ${b[0]},${b[1]}`;
  return (
    <figure className="route">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Route from ${fromCity}, ${fromState} to ${toLabel}`}>
        {Object.entries(STATE_CENTERS).map(([s, ll]) => {
          const [x, y] = proj(ll);
          const hot = s === fromState || (toKey === s);
          return <text key={s} x={x} y={y} className={hot ? 'st hot' : 'st'} textAnchor="middle" dominantBaseline="middle">{s}</text>;
        })}
        <path d={d} className="route-line" />
        <path d={d} className="route-draw" pathLength="1" />
        <circle cx={a[0]} cy={a[1]} r="6" className="pin from" />
        <circle cx={b[0]} cy={b[1]} r="7" className="pin to" />
        <text x={a[0]} y={a[1] + 22} textAnchor={a[0] > W - 110 ? 'end' : 'middle'} className="pin-label">{fromCity}</text>
        {/* Destination label above its pin, origin below, so short routes don't collide. */}
        <text x={b[0]} y={b[1] - 14} textAnchor={b[0] > W - 110 ? 'end' : 'middle'} className="pin-label">{toLabel}</text>
        <g className="truck">
          <rect x="-13" y="-7" width="17" height="11" rx="1.5" />
          <path d="M4 -4 h6 l4 4 v4 h-10 z" />
          <circle cx="-8" cy="5" r="2.4" /><circle cx="9" cy="5" r="2.4" />
          <animateMotion dur="3.2s" fill="freeze" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.2 1" path={d} />
        </g>
      </svg>
      <figcaption>
        R+L picks up <strong>{pickupDate}</strong>, 1–5 PM{serviceDays ? <> · about <strong>{serviceDays} business day{serviceDays === 1 ? '' : 's'}</strong> in transit</> : null}
      </figcaption>
    </figure>
  );
}

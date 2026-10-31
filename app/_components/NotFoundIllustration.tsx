"use client";

import { useId } from "react";
import styles from "./NotFoundIllustration.module.css";

/** A missing scene in a miniature editing studio. All artwork stays sharp at any screen size. */
export default function NotFoundIllustration() {
  const id = useId().replaceAll(":", "");
  const paint = (name: string) => `url(#${id}-${name})`;

  return (
    <svg data-illustration="not-found" className={styles.art} viewBox="0 0 640 350" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-paper`} x1="160" y1="65" x2="453" y2="303" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" /><stop offset="1" stopColor="#f6f9f3" />
        </linearGradient>
        <linearGradient id={`${id}-screen`} x1="202" y1="95" x2="435" y2="245" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f3f8ed" /><stop offset="1" stopColor="#dcecd5" />
        </linearGradient>
        <linearGradient id={`${id}-ink`} x1="270" y1="112" x2="356" y2="216" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b7554" /><stop offset="1" stopColor="#203b2d" />
        </linearGradient>
        <linearGradient id={`${id}-phone`} x1="86" y1="162" x2="152" y2="286" gradientUnits="userSpaceOnUse">
          <stop stopColor="#426d52" /><stop offset="1" stopColor="#213c2d" />
        </linearGradient>
        <filter id={`${id}-shadow`} x="-30%" y="-25%" width="160%" height="175%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="11" stdDeviation="10" floodColor="#294735" floodOpacity=".12" />
          <feDropShadow dx="0" dy="2" stdDeviation="1" floodColor="#294735" floodOpacity=".07" />
        </filter>
        <path id={`${id}-four`} d="M38 0h18v53h12v16H56v20H37V69H0V53L34 0h4Zm-1 25L18 53h19V25Z" fillRule="evenodd" />
        <clipPath id={`${id}-slate`}><rect x="464" y="48" width="101" height="21" rx="5" /></clipPath>
      </defs>

      {/* No backdrop: the scene sits directly on whatever surface shows it. */}
      <path d="M101 167c-15-56 43-99 104-106m312 119c54 5 68 46 29 77" stroke="#ccddc9" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="4 7" />
      <circle cx="101" cy="167" r="4" fill="#b6cfad" /><circle cx="547" cy="258" r="4" fill="#b6cfad" />
      <path d="m130 72 3-8 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="#8bb881" />
      <path d="m548 159 2.5-6 2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5Z" fill="#b5cc8f" />
      <circle cx="203" cy="33" r="3" fill="#cfdbc3" /><circle cx="466" cy="304" r="3" fill="#b2c4a5" />
      <path d="M88 211h8m-4-4v8m405 83h8m-4-4v8" stroke="#adc4a5" strokeWidth="1.6" strokeLinecap="round" />

      {/* A loose strip winds back into the editing timeline. */}
      <path d="M99 271c34 34 66-8 100 11 31 17 43 39 80 14" stroke="#345a43" strokeWidth="27" strokeLinecap="round" />
      <path d="M99 271c34 34 66-8 100 11 31 17 43 39 80 14" stroke="#c5ddbb" strokeWidth="14" />
      <path d="M100 260c33 31 66-10 105 12 31 17 43 37 70 13M93 281c40 35 73-6 100 12 31 17 48 41 93 13" stroke="#eff5e8" strokeWidth="3.5" strokeDasharray="4 10" />
      <path d="m133 274 4 13m39-15-2 14m41 4-8 12m39-2-2 14" stroke="#eff5e8" strokeWidth="3" />

      <g className={styles.editor}>
        <g transform="rotate(-3 320 179)" filter={paint("shadow")}>
          <rect x="149" y="59" width="351" height="232" rx="18" fill={paint("paper")} stroke="#d7e1d4" strokeWidth="1.5" />
          <path d="M150 91h349" stroke="#e5ebe0" />
          <circle cx="166" cy="76" r="3.3" fill="#db8c81" /><circle cx="178" cy="76" r="3.3" fill="#d9d6b1" /><circle cx="190" cy="76" r="3.3" fill="#a6c59b" />
          <rect x="270" y="72" width="105" height="7" rx="3.5" fill="#e5ecdf" />
          <path d="M464 74h15m-15 5h9" stroke="#bdcdb7" strokeWidth="2" strokeLinecap="round" />

          <rect x="165" y="104" width="319" height="127" rx="9" fill={paint("screen")} />
          <path d="M181 125v-7h8m278 7v-7h-8M181 209v7h8m278-7v7h-8" stroke="#a4c198" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M197 167h12m225 0h12" stroke="#c1d3b7" strokeWidth="1.5" strokeDasharray="3 4" />

          <use href={`#${id}-four`} x="210" y="124" fill="#284934" />
          <use href={`#${id}-four`} x="378" y="124" fill="#284934" />
          <circle cx="325" cy="168" r="43" fill={paint("ink")} />
          <circle cx="325" cy="168" r="37" stroke="#78a67a" strokeOpacity=".5" />
          <circle cx="325" cy="143" r="8" fill="#deecd5" /><circle cx="350" cy="168" r="8" fill="#deecd5" />
          <circle cx="325" cy="193" r="8" fill="#deecd5" /><circle cx="300" cy="168" r="8" fill="#deecd5" />
          <circle cx="325" cy="168" r="12.5" fill="#203b2d" stroke="#69966a" strokeWidth="1.2" />
          <path d="m322 162 9 6-9 6v-12Z" fill="#f4f9ef" />

          <path d="M166 247h318" stroke="#e7ede1" />
          <rect x="166" y="257" width="72" height="17" rx="4" fill="#dcead3" />
          <rect x="243" y="257" width="47" height="17" rx="4" fill="#b0cba1" />
          <rect x="295" y="257" width="62" height="17" rx="4" fill="#fff" stroke="#adc49e" strokeWidth="1.3" strokeDasharray="3 3" />
          <rect x="362" y="257" width="122" height="17" rx="4" fill="#e3eddb" />
          <path d="M178 265h17m10 0h17m32 0h24m93 0h32m7 0h17m7 0h21" stroke="#8cab7e" strokeWidth="2" strokeLinecap="round" />
          <path d="m326 239 4 5-4 5-4-5 4-5Z" fill="#c1a76b" /><path d="M326 247v31" stroke="#c1a76b" strokeWidth="1.5" />
          <circle cx="475" cy="116" r="2.5" fill="#9ab88e" />
        </g>
      </g>

      {/* A filming phone gives the missing frame a familiar creator-workspace silhouette. */}
      <g transform="rotate(-12 126 223)" filter={paint("shadow")}>
        <rect x="92" y="165" width="67" height="116" rx="13" fill={paint("phone")} stroke="#829e7c" />
        <rect x="97" y="170" width="57" height="106" rx="9" fill="#e8f0df" />
        <rect x="112" y="173" width="27" height="5" rx="2.5" fill="#35503b" />
        <rect x="103" y="185" width="45" height="63" rx="6" fill="#d2e2c6" />
        <path d="M109 198v-6h6m27 6v-6h-6m-27 43v6h6m27-6v6h-6" stroke="#7ea171" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="125.5" cy="216" r="11.5" stroke="#79996a" strokeWidth="1.4" strokeDasharray="3 3" />
        <path d="m122 211 8 5-8 5v-10Z" fill="#749365" />
        <circle cx="126" cy="261" r="8" fill="#fff" stroke="#b6c8a9" /><circle cx="126" cy="261" r="4" fill="#b96353" />
        <path d="M111 270h29" stroke="#b5c8a9" strokeWidth="2" strokeLinecap="round" />
      </g>

      <g className={styles.slate}>
        <g transform="rotate(11 514 86)" filter={paint("shadow")}>
          <rect x="464" y="67" width="101" height="68" rx="9" fill="#31523c" stroke="#698564" />
          <path d="M474 82h81M496 83v16m29-16v16M474 101h81" stroke="#73916b" />
          <path d="M475 112h33m-33 8h21m39-8h18" stroke="#c0d1b3" strokeWidth="2" strokeLinecap="round" />
          <rect x="464" y="48" width="101" height="21" rx="5" fill="#e5edda" stroke="#6d8765" />
          <g clipPath={paint("slate")} fill="#3d5c43">
            <path d="m463 46 14 1-11 24-14-1 11-24Zm28 0h14l-11 25h-14l11-25Zm28 0h14l-11 25h-14l11-25Zm28 0h14l-11 25h-14l11-25Z" />
          </g>
          <circle cx="471" cy="64" r="2" fill="#9caf8c" />
        </g>
      </g>

      {/* The detached scene marker points back toward the empty timeline slot. */}
      <g transform="rotate(10 511 269)" filter={paint("shadow")}>
        <rect x="486" y="244" width="49" height="49" rx="13" fill="#fff" stroke="#d5e2cd" />
        <path d="M500 259h11l7 7v13h-18v-20Z" fill="#f0f5e9" stroke="#91ad81" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M511 259v7h7m-12 5 5 5m0-5-5 5" stroke="#91ad81" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <path d="m559 221-5 14-5-6-7-2 17-6Z" fill="#73916b" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

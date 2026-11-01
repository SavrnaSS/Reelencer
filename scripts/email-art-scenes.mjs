// Native vector originals for the email artwork. Keep meaningful marks broad enough to survive a phone inbox;
// the mailer uses PNG exports so the same composition works in clients that cannot display SVG.
export const EMAIL_ART_WIDTH = 558;
export const EMAIL_ART_HEIGHT = 210;
export const EMAIL_ART_KINDS = Object.freeze(["welcome", "security", "success", "attention", "closed", "verified", "inbox"]);

const C = {
  ink: "#1f2b24", green: "#2e7d4f", forest: "#244c37", sage: "#e3f1df", lime: "#dce78f",
  limeSoft: "#edf5ce", paper: "#ffffff", mist: "#eef1ed", line: "#ccd8cc", muted: "#8d9d90",
  amber: "#d99b31", amberSoft: "#faedcf", panel: "#f4f6f2",
};
const outline = `stroke="${C.ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;
const lightOutline = `stroke="${C.line}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"`;
const check = (x, y, scale = 1, color = C.paper) => `<path d="M${x - 7 * scale} ${y}l${5 * scale} ${5 * scale} ${10 * scale}-${11 * scale}" fill="none" stroke="${color}" stroke-width="${3 * scale}" stroke-linecap="round" stroke-linejoin="round"/>`;
const lines = (x, y, widths, { color = C.line, gap = 10, weight = 4 } = {}) => widths.map((width, i) => `<path d="M${x} ${y + i * gap}h${width}" stroke="${color}" stroke-width="${weight}" stroke-linecap="round"/>`).join("");
const sparkle = (x, y, size = 5, color = C.green) => `<path d="M${x} ${y - size}Q${x + 1} ${y - 1} ${x + size} ${y}Q${x + 1} ${y + 1} ${x} ${y + size}Q${x - 1} ${y + 1} ${x - size} ${y}Q${x - 1} ${y - 1} ${x} ${y - size}Z" fill="${color}"/>`;
const avatar = (x, y, r = 12, fill = C.sage) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/><circle cx="${x}" cy="${y - r * .22}" r="${r * .28}" fill="${C.green}"/><path d="M${x - r * .5} ${y + r * .45}c${r * .12}-${r * .63} ${r * .88}-${r * .63} ${r} 0" fill="${C.green}"/>`;
const card = (x, y, width, height, body, { rotation = 0, fill = C.paper } = {}) => `<g transform="rotate(${rotation} ${x + width / 2} ${y + height / 2})"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="${fill}" ${lightOutline} filter="url(#soft-shadow)"/>${body}</g>`;
const status = (x, y, width, { positive = true, rotation = 0 } = {}) => card(x, y, width, 34, `<circle cx="${x + 17}" cy="${y + 17}" r="8" fill="${positive ? C.sage : C.mist}"/>${positive ? check(x + 17, y + 17, .52, C.green) : `<path d="M${x + 14} ${y + 17}h6" stroke="${C.muted}" stroke-width="2" stroke-linecap="round"/>`}${lines(x + 32, y + 14, [width - 45, width - 56], { gap: 7, weight: 3 })}`, { rotation });
const connector = path => `<path d="${path}" fill="none" stroke="#adc3ac" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="3 5"/>`;
const leaf = (x, y, rotation = 0) => `<g transform="translate(${x} ${y}) rotate(${rotation})"><path d="M0 0c-15-2-19-13-15-25C-1-21 5-10 0 0Z" fill="#d7e4ce"/><path d="M0 0C0-13 8-19 18-20 20-7 12 1 0 0Z" fill="#b8d0b1"/><path d="M0 6v-15" stroke="#93b08c" stroke-width="1.5" stroke-linecap="round"/></g>`;

const scenes = {
  welcome: () => `
    ${connector("M184 110C204 110 210 128 232 130M342 92C365 92 371 77 391 77")}
    ${card(104, 83, 113, 57, `${avatar(126, 109, 13)}${lines(149, 102, [48, 36], { gap: 12 })}`, { rotation: -8 })}
    ${status(362, 61, 91, { rotation: 7 })}
    <g filter="url(#hero-shadow)">
      <path d="M221 107l62-44 63 44v61a11 11 0 0 1-11 11H232a11 11 0 0 1-11-11Z" fill="#dceacb" ${outline}/>
      <rect x="240" y="30" width="87" height="121" rx="12" fill="url(#paper)" ${outline}/>
      <rect x="251" y="41" width="65" height="34" rx="7" fill="${C.sage}"/>
      ${avatar(283, 58, 12, C.paper)}
      ${lines(254, 90, [57, 44, 51], { gap: 11, weight: 4 })}
      <path d="M221 108l62 42 63-42v60a11 11 0 0 1-11 11H232a11 11 0 0 1-11-11Z" fill="url(#envelope)" ${outline}/>
      <path d="m226 173 42-35m72 35-42-35" fill="none" stroke="#91af82" stroke-width="1.7" stroke-linecap="round"/>
    </g>
    <circle cx="346" cy="146" r="24" fill="${C.paper}" stroke="${C.paper}" stroke-width="6"/>
    <circle cx="346" cy="146" r="22" fill="${C.green}" ${outline}/>${check(346, 146, 1.05)}
    ${sparkle(194, 47, 6)}${sparkle(403, 132, 5, C.amber)}${leaf(148, 168, -15)}
    <circle cx="389" cy="39" r="3" fill="#acc68b"/>
  `,

  security: () => `
    ${connector("M181 121C207 122 210 112 231 108M331 81C350 80 353 74 368 74")}
    ${card(106, 91, 108, 51, `<circle cx="129" cy="116" r="11" fill="${C.limeSoft}"/><circle cx="127" cy="114" r="4" fill="none" stroke="${C.green}" stroke-width="2"/><path d="m130 117 10 10m-5-5 3-3m-1 5 3-3" fill="none" stroke="${C.green}" stroke-width="2" stroke-linecap="round"/>${[164, 177, 190].map(x => `<circle cx="${x}" cy="116" r="3" fill="#9cb69b"/>`).join("")}`, { rotation: -7 })}
    ${card(354, 54, 90, 69, `${avatar(379, 80, 13)}${lines(400, 76, [29, 21], { gap: 10, weight: 3 })}<path d="M369 106h60" stroke="#d7e5d2" stroke-width="4" stroke-linecap="round"/>`, { rotation: 7 })}
    <g filter="url(#hero-shadow)">
      <path d="M282 27c17 12 34 17 51 21v53c0 36-22 62-51 80-29-18-51-44-51-80V48c17-4 34-9 51-21Z" fill="url(#shield)" ${outline}/>
      <path d="M282 41c12 8 24 12 37 16v43c0 27-15 48-37 64-22-16-37-37-37-64V57c13-4 25-8 37-16Z" fill="none" stroke="#c6e1ba" stroke-width="1.7"/>
      <path d="M264 91V75a18 18 0 0 1 36 0v16" fill="none" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>
      <path d="M268 89V76a14 14 0 0 1 28 0v13" fill="none" stroke="#dcebd2" stroke-width="2" stroke-linecap="round"/>
      <rect x="252" y="86" width="60" height="57" rx="12" fill="url(#paper)" ${outline}/>
      <circle cx="282" cy="110" r="6" fill="${C.forest}"/><path d="M282 115v10" stroke="${C.forest}" stroke-width="4" stroke-linecap="round"/>
    </g>
    <circle cx="332" cy="150" r="22" fill="${C.paper}" stroke="${C.paper}" stroke-width="5"/>
    <circle cx="332" cy="150" r="20" fill="${C.green}" ${outline}/>${check(332, 150, .9)}
    ${leaf(155, 169, -16)}${sparkle(373, 151, 5)}${sparkle(206, 48, 6, C.amber)}
  `,

  success: () => `
    ${connector("M176 124C201 125 214 119 238 116M324 65C347 65 356 71 379 75")}
    ${card(107, 83, 112, 67, `<path d="M124 133h77" stroke="#d1dfca" stroke-width="1.5" stroke-linecap="round"/><rect x="131" y="115" width="13" height="18" rx="3" fill="#c4dba8"/><rect x="154" y="105" width="13" height="28" rx="3" fill="#9bc07b"/><rect x="177" y="94" width="13" height="39" rx="3" fill="${C.green}"/>`, { rotation: -7 })}
    ${status(365, 57, 89, { rotation: 8 })}
    <g transform="rotate(-5 281 102)" filter="url(#hero-shadow)">
      <rect x="230" y="27" width="105" height="148" rx="13" fill="url(#paper)" ${outline}/>
      <path d="M243 28h79a12 12 0 0 1 12 12v18H231V40a12 12 0 0 1 12-12Z" fill="${C.sage}"/>
      <circle cx="247" cy="44" r="4" fill="${C.green}"/>${lines(260, 44, [55], { weight: 4, color: "#92b48d" })}
      ${[78, 103, 128].map((y, index) => `<circle cx="249" cy="${y}" r="7.5" fill="${C.sage}"/>${check(249, y, .42, C.green)}${lines(266, y, [index === 1 ? 43 : 52], { weight: 4 })}`).join("")}
      <rect x="245" y="149" width="56" height="11" rx="5.5" fill="#d1e5ba"/>
    </g>
    <circle cx="335" cy="137" r="34" fill="${C.paper}" stroke="${C.paper}" stroke-width="5"/>
    <circle cx="335" cy="137" r="31" fill="${C.green}" ${outline}/>
    <circle cx="335" cy="137" r="23" fill="none" stroke="#b4daa7" stroke-width="1.4"/>
    ${check(335, 137, 1.3)}
    <rect x="209" y="38" width="6" height="13" rx="2" fill="${C.lime}" transform="rotate(-27 212 44)"/>
    <rect x="386" y="113" width="6" height="12" rx="2" fill="#b8d4a7" transform="rotate(28 389 119)"/>
    <circle cx="358" cy="34" r="3.5" fill="${C.amber}"/>
    ${sparkle(183, 57, 5)}${sparkle(408, 151, 6, C.amber)}${leaf(153, 173, -18)}
  `,

  attention: () => `
    ${connector("M178 109C200 109 206 102 226 99M324 85C340 85 342 79 356 79")}
    ${card(107, 79, 109, 59, `${avatar(131, 103, 13)}${lines(153, 98, [47, 33], { gap: 11 })}<circle cx="196" cy="121" r="3" fill="${C.amber}"/>`, { rotation: -7 })}
    <g transform="rotate(-5 274 105)" filter="url(#hero-shadow)">
      <rect x="224" y="22" width="103" height="165" rx="19" fill="${C.forest}" ${outline}/>
      <rect x="230" y="28" width="91" height="153" rx="14" fill="url(#paper)"/>
      <rect x="259" y="33" width="33" height="6" rx="3" fill="${C.forest}"/>
      <rect x="240" y="49" width="71" height="49" rx="9" fill="#edf4e8"/>
      ${avatar(275, 73, 17, C.paper)}
      ${lines(243, 112, [63, 45], { gap: 11 })}
      <rect x="241" y="135" width="68" height="27" rx="6" fill="#fff8e8" stroke="#d8b46a" stroke-width="1.4" stroke-dasharray="3 3"/>
      <path d="M251 148h21m7 0h14" stroke="#d9bf83" stroke-width="4" stroke-linecap="round"/>
      <path d="M264 173h23" stroke="#d2ddcd" stroke-width="3" stroke-linecap="round"/>
    </g>
    ${card(327, 75, 105, 82, `<circle cx="344" cy="93" r="5" fill="${C.amberSoft}"/>${lines(358, 93, [55], { weight: 3 })}${lines(342, 112, [73, 51, 61], { gap: 11, weight: 4 })}`, { rotation: 8 })}
    <g transform="rotate(4 390 138)" filter="url(#soft-shadow)">
      <path d="m413 100 13 12-48 49-17 5 4-17Z" fill="${C.lime}" ${outline}/>
      <path d="m405 108 13 12M365 149l13 12" fill="none" ${outline}/>
      <path d="m361 166 4-17 13 12Z" fill="${C.ink}"/>
    </g>
    <circle cx="223" cy="144" r="23" fill="${C.paper}" stroke="${C.paper}" stroke-width="5"/>
    <circle cx="223" cy="144" r="21" fill="${C.amberSoft}" stroke="#ce9f4a" stroke-width="1.7"/>
    ${[215, 223, 231].map(x => `<circle cx="${x}" cy="144" r="2.2" fill="#aa721b"/>`).join("")}
    ${leaf(145, 171, -18)}${sparkle(358, 45, 6)}${sparkle(448, 134, 5, C.amber)}
  `,

  closed: () => `
    ${connector("M183 119C206 118 214 113 238 114M339 105C355 103 365 94 382 95")}
    ${card(111, 83, 97, 63, `<path d="M126 98h24l7 8h36v25h-67Z" fill="#edf2e9" stroke="#b6c6b2" stroke-width="1.5" stroke-linejoin="round"/>${lines(136, 117, [38], { weight: 3, color: "#bacbb4" })}`, { rotation: -7 })}
    ${status(375, 77, 79, { positive: false, rotation: 7 })}
    <g filter="url(#hero-shadow)">
      <g transform="rotate(6 292 78)"><rect x="253" y="30" width="80" height="96" rx="9" fill="#e7eee2" stroke="#aabc9f" stroke-width="1.7"/></g>
      <g transform="rotate(-6 279 75)"><rect x="241" y="31" width="80" height="96" rx="9" fill="url(#paper)" stroke="#aabc9f" stroke-width="1.7"/>${lines(255, 51, [49, 38, 45], { gap: 11, weight: 4 })}</g>
      <path d="M220 100h132v61a11 11 0 0 1-11 11H231a11 11 0 0 1-11-11Z" fill="url(#archive)" ${outline}/>
      <rect x="214" y="86" width="144" height="24" rx="7" fill="url(#paper)" ${outline}/>
      <path d="M220 110h132" stroke="#afc2a5" stroke-width="1.5"/>
      <rect x="271" y="125" width="30" height="10" rx="4" fill="${C.paper}" stroke="#90a58a" stroke-width="1.5"/>
    </g>
    <circle cx="350" cy="160" r="23" fill="${C.paper}" stroke="${C.paper}" stroke-width="5"/>
    <circle cx="350" cy="160" r="21" fill="#eaf0e6" stroke="#92aa88" stroke-width="1.7"/>
    <path d="M342 160h16" stroke="#6f8865" stroke-width="3" stroke-linecap="round"/>
    ${leaf(151, 171, -18)}${leaf(415, 155, 25)}${sparkle(207, 43, 4, C.muted)}
    <circle cx="390" cy="49" r="3" fill="#b5c6ac"/>
  `,

  verified: () => `
    ${connector("M178 125C193 125 204 122 221 117M348 69C361 61 368 52 383 50")}
    ${card(106, 100, 88, 55, `${avatar(128, 127, 13)}${lines(151, 122, [28, 21], { gap: 10, weight: 3 })}`, { rotation: -8 })}
    ${status(365, 34, 88, { rotation: 7 })}
    <g transform="rotate(-5 285 108)" filter="url(#hero-shadow)">
      <rect x="205" y="55" width="165" height="111" rx="14" fill="url(#paper)" ${outline}/>
      <path d="M218 56h139a12 12 0 0 1 12 12v11H206V68a12 12 0 0 1 12-12Z" fill="#e8f1e2"/>
      <circle cx="221" cy="67" r="3.5" fill="${C.green}"/>${lines(234, 67, [59], { weight: 3, color: "#a6bd9c" })}
      <rect x="218" y="88" width="49" height="60" rx="9" fill="${C.sage}"/>
      <circle cx="242.5" cy="109" r="9" fill="#7fa774"/><path d="M225 141c2-21 33-21 35 0" fill="#7fa774"/>
      ${lines(283, 99, [65, 47, 56], { gap: 12, weight: 4 })}
      ${[286, 298, 310].map(x => `<circle cx="${x}" cy="143" r="3" fill="#adbf9a"/>`).join("")}
    </g>
    <g filter="url(#soft-shadow)">
      <path d="M369 85c10 7 20 10 30 13v30c0 20-13 35-30 45-17-10-30-25-30-45V98c10-3 20-6 30-13Z" fill="${C.green}" ${outline}/>
      <path d="M369 96c7 4 13 7 20 9v22c0 15-9 26-20 34-11-8-20-19-20-34v-22c7-2 13-5 20-9Z" fill="none" stroke="#abd098" stroke-width="1.3"/>
      ${check(369, 126, 1.1)}
    </g>
    ${leaf(155, 173, -18)}${sparkle(197, 50, 6)}${sparkle(425, 134, 5, C.amber)}
  `,

  inbox: () => `
    ${connector("M180 110C201 110 209 101 234 100M330 79C349 79 355 81 374 87")}
    ${card(104, 76, 111, 63, `${avatar(127, 100, 12)}${lines(149, 95, [48, 34], { gap: 10, weight: 3 })}${lines(119, 124, [76], { weight: 3 })}`, { rotation: -7 })}
    ${status(375, 140, 80, { rotation: 8 })}
    <g filter="url(#hero-shadow)">
      <path d="m220 117 22-41h92l22 41v47a10 10 0 0 1-10 10H230a10 10 0 0 1-10-10Z" fill="#e1ebd8" ${outline}/>
      <rect x="242" y="35" width="92" height="109" rx="12" fill="url(#paper)" ${outline}/>
      <rect x="255" y="49" width="66" height="36" rx="7" fill="#edf4e8"/>
      <rect x="269" y="58" width="38" height="20" rx="4" fill="${C.lime}" stroke="#8ba47b" stroke-width="1.4"/><path d="m270 61 18 10 18-10" fill="none" stroke="#6c8c5b" stroke-width="1.4" stroke-linejoin="round"/>
      ${lines(257, 102, [61, 45, 53], { gap: 11, weight: 4 })}
      <path d="M220 117h34l9 14h50l9-14h34v47a10 10 0 0 1-10 10H230a10 10 0 0 1-10-10Z" fill="url(#tray)" ${outline}/>
      <path d="M273 154h30" stroke="#a8c2a0" stroke-width="3" stroke-linecap="round"/>
    </g>
    <circle cx="380" cy="86" r="32" fill="${C.paper}" ${lightOutline} filter="url(#soft-shadow)"/>
    <path d="M368 82a12 12 0 0 1 24 0c0 13 5 17 5 17h-34s5-4 5-17Z" fill="${C.lime}" ${outline}/>
    <path d="M376 104a4 4 0 0 0 8 0" fill="none" stroke="${C.ink}" stroke-width="2.3" stroke-linecap="round"/>
    <circle cx="401" cy="62" r="9" fill="${C.amber}" stroke="${C.paper}" stroke-width="4"/>
    ${leaf(148, 172, -17)}${sparkle(202, 45, 6)}${sparkle(444, 104, 5, C.green)}
  `,
};

/** Each returned SVG is self contained and can be rendered without fonts, network access or browser APIs. */
export function renderEmailArtSvg(kind) {
  if (!Object.hasOwn(scenes, kind)) throw new TypeError(`Unknown email illustration: ${String(kind)}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${EMAIL_ART_WIDTH}" height="${EMAIL_ART_HEIGHT}" viewBox="0 0 ${EMAIL_ART_WIDTH} ${EMAIL_ART_HEIGHT}" fill="none">
    <defs>
      <linearGradient id="panel" x1="77" y1="0" x2="486" y2="210" gradientUnits="userSpaceOnUse"><stop stop-color="#f7f9f4"/><stop offset="1" stop-color="#f0f4ec"/></linearGradient>
      <linearGradient id="paper" x1="245" y1="28" x2="333" y2="180" gradientUnits="userSpaceOnUse"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#fbfdf8"/></linearGradient>
      <linearGradient id="envelope" x1="276" y1="106" x2="290" y2="179" gradientUnits="userSpaceOnUse"><stop stop-color="#e8f1cb"/><stop offset="1" stop-color="#d3e2b4"/></linearGradient>
      <linearGradient id="shield" x1="248" y1="36" x2="321" y2="177" gradientUnits="userSpaceOnUse"><stop stop-color="#e2efcf"/><stop offset="1" stop-color="#b8d39f"/></linearGradient>
      <linearGradient id="archive" x1="225" y1="108" x2="352" y2="174" gradientUnits="userSpaceOnUse"><stop stop-color="#e3ecda"/><stop offset="1" stop-color="#d2dfc6"/></linearGradient>
      <linearGradient id="tray" x1="224" y1="120" x2="353" y2="176" gradientUnits="userSpaceOnUse"><stop stop-color="#365c43"/><stop offset="1" stop-color="#254733"/></linearGradient>
      <filter id="soft-shadow" x="-30%" y="-40%" width="160%" height="190%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#203f2a" flood-opacity=".08"/></filter>
      <filter id="hero-shadow" x="-30%" y="-25%" width="160%" height="160%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#203f2a" flood-opacity=".11"/></filter>
      <clipPath id="panel-clip"><rect width="558" height="210" rx="14"/></clipPath>
    </defs>
    <g clip-path="url(#panel-clip)">
      <rect width="558" height="210" rx="14" fill="url(#panel)"/>
      <ellipse cx="280" cy="107" rx="172" ry="79" fill="#e6efdd" opacity=".48"/>
      <ellipse cx="280" cy="109" rx="194" ry="88" stroke="#e1e9da" stroke-width="1" stroke-dasharray="2 7"/>
      <path d="M70 159c20-13 41-15 63-7m296-98c20-5 39-1 57 11" stroke="#dde7d6" stroke-width="1.4" stroke-linecap="round"/>
      <ellipse cx="284" cy="187" rx="135" ry="6" fill="#d7e2ce" opacity=".55"/>
      <circle cx="91" cy="94" r="3" fill="#cfddc3"/><circle cx="469" cy="150" r="2.5" fill="#cbd9be"/>
      ${scenes[kind]()}
    </g>
  </svg>`;
}

"use client";

import { useId } from "react";
import type { RecordingSetup, ReelKit } from "@/lib/reelKit";
import styles from "./RecordingSetupArtwork.module.css";

type Props = { setup: RecordingSetup } & Pick<ReelKit, "approved" | "pending">;

/** The same wallet is drawn on the source device and inside the camera's viewfinder. */
function WalletScreen({ approved, pending, mobile = false }: Pick<Props, "approved" | "pending"> & { mobile?: boolean }) {
  const money = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const amount = money(approved);
  if (mobile) {
    return (
      <>
        <rect width="200" height="354" fill="#f9fbf6" />
        <rect width="200" height="32" fill="#edf3e7" />
        <rect x="14" y="10" width="12" height="12" rx="4" fill="#315e43" />
        <path d="m19 13 5 3-5 3Z" fill="#d5eda7" />
        <text x="33" y="20" fontSize="10" fontWeight="700" fill="#294332">Reelencer</text>
        <text x="15" y="62" fontSize="22" fontWeight="700" letterSpacing="-.6" fill="#263b2d">Wallet</text>
        <text x="15" y="78" fontSize="8" fill="#7c8b75">Your content. Your earnings.</text>
        <rect x="13" y="96" width="174" height="113" rx="10" fill="#eaf3df" stroke="#c3d7af" />
        <text x="25" y="116" fontSize="9" fontWeight="600" fill="#557046">Reel earnings</text>
        <text x="25" y="135" fontSize="7.5" fill="#6d825e">Approved earnings</text>
        <text x="25" y="165" fontSize={amount.length > 12 ? 19 : 27} fontWeight="750" letterSpacing="-.7" fill="#294b31">{amount}</text>
        <rect x="25" y="180" width="101" height="15" rx="7.5" fill="#d7e9c3" />
        <path d="m32 187 2 2 4-4" stroke="#60804b" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <text x="43" y="190" fontSize="6.5" fill="#587849">Approved reel earnings</text>
        <rect x="13" y="222" width="174" height="59" rx="9" fill="white" stroke="#e2e9da" />
        <text x="25" y="239" fontSize="7.5" fill="#7a8b6f">Pending earnings</text>
        <text x="25" y="263" fontSize="16" fontWeight="650" fill="#475d3b">{money(pending)}</text>
        <path d="M18 303h164M18 317h99M18 331h132" stroke="#e0e8d8" strokeWidth="5" strokeLinecap="round" />
      </>
    );
  }
  return (
    <>
      <rect width="240" height="150" fill="#f9fbf6" />
      <rect width="240" height="23" fill="#edf3e7" />
      <rect x="12" y="6" width="11" height="11" rx="3.5" fill="#315e43" /><path d="m16.5 8.5 4.5 3-4.5 3Z" fill="#d5eda7" />
      <text x="28" y="14.5" fontSize="8" fontWeight="700" fill="#294332">Reelencer</text>
      <circle cx="222" cy="11.5" r="5" fill="#d3e1c7" /><path d="M214 11.5h-18" stroke="#9eaf90" strokeWidth="2" strokeLinecap="round" />
      <text x="14" y="40" fontSize="13" fontWeight="700" fill="#263b2d">Wallet</text>
      <text x="159" y="39" fontSize="5.5" fill="#7b8c70">Your content. Your earnings.</text>
      <rect x="12" y="48" width="216" height="62" rx="7" fill="#eaf3df" stroke="#c3d7af" />
      <text x="23" y="61" fontSize="6.5" fill="#627d50">Approved reel earnings</text>
      <text x="23" y="85" fontSize={amount.length > 12 ? 19 : 24} fontWeight="750" letterSpacing="-.7" fill="#294b31">{amount}</text>
      <path d="m24 98 2 2 4-4" stroke="#6f9552" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <text x="35" y="100" fontSize="5.5" fill="#698951">Reel earnings approved</text>
      <rect x="12" y="118" width="103" height="24" rx="5" fill="white" stroke="#e0e8d8" /><rect x="123" y="118" width="105" height="24" rx="5" fill="white" stroke="#e0e8d8" />
      <text x="20" y="128" fontSize="4.8" fill="#7c8b72">Pending earnings</text><text x="20" y="137" fontSize="7" fontWeight="600" fill="#47603b">{money(pending)}</text>
      <text x="132" y="128" fontSize="4.8" fill="#7c8b72">Workspace</text><text x="132" y="137" fontSize="7" fontWeight="600" fill="#47603b">Demo wallet</text>
    </>
  );
}

export default function RecordingSetupArtwork({ setup, approved, pending }: Props) {
  const prefix = `recording-${useId().replace(/:/g, "")}`;
  const laptop = setup === "laptop";
  return (
    <figure className={styles.figure}>
      <svg viewBox="0 0 420 310" className={styles.artwork} role="img" aria-label={laptop ? "Your smartphone filming a laptop screen" : "Your smartphone filming a second smartphone screen"} aria-describedby={`${prefix}-description`} fontFamily="Arial, Helvetica, sans-serif">
        <desc id={`${prefix}-description`}>{laptop ? "A laptop displays the demo wallet. A hand holds a smartphone upright in front of it, with the same laptop visible inside its video viewfinder." : "One smartphone stands upright displaying the demo wallet. A hand holds another smartphone in front of it, with the first phone visible inside its video viewfinder."} The dotted field of view shows the back camera pointing at the screen. A red recording indicator and portrait frame show which phone films the reel.</desc>
        <defs>
          <radialGradient id={`${prefix}-ambient`}><stop stopColor="#dce8d0" stopOpacity=".9" /><stop offset="1" stopColor="#e6efde" stopOpacity="0" /></radialGradient>
          <radialGradient id={`${prefix}-floor`}><stop stopColor="#536a4c" stopOpacity=".17" /><stop offset="1" stopColor="#536a4c" stopOpacity="0" /></radialGradient>
          <linearGradient id={`${prefix}-metal`} x2=".8" y2="1"><stop stopColor="#f4f7ed" /><stop offset=".45" stopColor="#c3ccbd" /><stop offset="1" stopColor="#a4b39d" /></linearGradient>
          <linearGradient id={`${prefix}-bezel`} x2="1" y2="1"><stop stopColor="#46564a" /><stop offset=".5" stopColor="#1c2b23" /><stop offset="1" stopColor="#344538" /></linearGradient>
          <linearGradient id={`${prefix}-phone`} x2="1" y2=".4"><stop stopColor="#849189" /><stop offset=".07" stopColor="#283a31" /><stop offset=".9" stopColor="#18271f" /><stop offset="1" stopColor="#5e6f63" /></linearGradient>
          <linearGradient id={`${prefix}-camera-room`} x2=".7" y2="1"><stop stopColor="#405345" /><stop offset=".6" stopColor="#2b3d31" /><stop offset="1" stopColor="#65745b" /></linearGradient>
          <linearGradient id={`${prefix}-beam`} x1="0" x2="1"><stop stopColor="#80aa61" stopOpacity=".02" /><stop offset="1" stopColor="#80aa61" stopOpacity=".17" /></linearGradient>
          <linearGradient id={`${prefix}-hand`} x2="1" y2=".5"><stop stopColor="#e5ba9a" /><stop offset=".55" stopColor="#d8aa8c" /><stop offset="1" stopColor="#bf8c70" /></linearGradient>
          <filter id={`${prefix}-shadow`} x="-30%" y="-20%" width="170%" height="160%"><feDropShadow dx="0" dy="7" stdDeviation="5" floodColor="#253b2a" floodOpacity=".17" /></filter>
          <clipPath id={`${prefix}-viewfinder`}><rect x="7" y="23" width="108" height="182" rx="8" /></clipPath>
          <symbol id={`${prefix}-wallet-wide`} viewBox="0 0 240 150"><WalletScreen approved={approved} pending={pending} /></symbol>
          <symbol id={`${prefix}-wallet-tall`} viewBox="0 0 200 354"><WalletScreen approved={approved} pending={pending} mobile /></symbol>
          <symbol id={`${prefix}-laptop`} viewBox="0 0 270 210">
            <rect x="5" y="1" width="260" height="172" rx="9" fill={`url(#${prefix}-metal)`} stroke="#83917e" strokeWidth=".8" />
            <rect x="7" y="3" width="256" height="168" rx="7" fill={`url(#${prefix}-bezel)`} />
            <use href={`#${prefix}-wallet-wide`} x="15" y="13" width="240" height="150" />
            <circle cx="135" cy="8" r="1.5" fill="#98b096" /><circle cx="135" cy="8" r=".7" fill="#183b35" />
            <path d="M12 164h246" stroke="#73826f" strokeWidth="1" />
            <path d="M5 174h260l5 29-8 6H9l-9-6Z" fill={`url(#${prefix}-metal)`} stroke="#9aa992" strokeWidth=".7" />
            <rect x="14" y="177" width="242" height="17" rx="2" fill="#9daa94" />
            {[0, 1, 2].map((row) => (
              <g key={row} transform={`translate(18 ${179 + row * 4.5})`}>
                {Array.from({ length: 18 }, (_, column) => <rect key={column} x={column * 13} width="10.5" height="3" rx=".6" fill="#506048" />)}
              </g>
            ))}
            <rect x="105" y="196" width="61" height="8" rx="2" fill="#bbc6b1" stroke="#95a68c" strokeWidth=".6" />
            <path d="M1 204h268M116 208h40" stroke="#e0e7d8" strokeWidth="1" />
          </symbol>
          <symbol id={`${prefix}-screen-phone`} viewBox="0 0 120 234">
            <rect x="1" y="1" width="118" height="232" rx="21" fill={`url(#${prefix}-metal)`} stroke="#7d8e79" strokeWidth=".9" />
            <rect x="4" y="4" width="112" height="226" rx="18" fill="#263a2c" />
            <rect x="8" y="8" width="104" height="218" rx="14" fill="#f9fbf6" />
            <use href={`#${prefix}-wallet-tall`} x="10" y="27" width="100" height="177" />
            <rect x="43" y="12" width="34" height="8" rx="4" fill="#25382d" /><circle cx="69" cy="16" r="1.5" fill="#607d69" />
            <text x="17" y="21" fontSize="4.4" fontWeight="700" fill="#385439">9:41</text>
            <path d="M93 17h8m-8 2h6" stroke="#6a805f" strokeWidth="1" strokeLinecap="round" />
            <rect x="46" y="218" width="29" height="2.5" rx="1.2" fill="#a5b199" />
          </symbol>
        </defs>

        <ellipse cx="191" cy="150" rx="189" ry="143" fill={`url(#${prefix}-ambient)`} />
        <ellipse cx="202" cy="281" rx="192" ry="19" fill={`url(#${prefix}-floor)`} />
        <path d={laptop ? "M250 75 305 119 315 201 271 237Z" : "M186 57 301 119 315 202 205 257Z"} fill={`url(#${prefix}-beam)`} />
        <g className={styles.captureLines} stroke="#82a470" strokeWidth="1.3" strokeDasharray="4 5" fill="none" opacity=".65">
          <path d={laptop ? "M250 75 305 119M271 237 315 201" : "M186 57 301 119M205 257 315 202"} />
        </g>

        {laptop ? (
          <g filter={`url(#${prefix}-shadow)`} transform="translate(13 70) matrix(.98 -.04 .07 .98 0 0)">
            <use href={`#${prefix}-laptop`} width="270" height="210" />
          </g>
        ) : (
          <g filter={`url(#${prefix}-shadow)`}>
            <path d="m101 216-8 53h75l-12-53Z" fill="#b7c5aa" stroke="#a7b79a" strokeWidth="1" />
            <path d="M85 270h88q5 0 6 5H79q1-5 6-5Z" fill="#d0dbc5" />
            <path d="m106 225-4 34h56l-7-34" fill="#a7b79b" />
            <g transform="translate(61 35) rotate(-7 60 117)"><use href={`#${prefix}-screen-phone`} width="120" height="234" /></g>
          </g>
        )}

        {/* The viewer sees the filming phone's display while its rear lens points at the source device. */}
        <g transform="translate(276 43) rotate(9 61 122)">
          <path d="M101 139c6-10 21-8 22 4l1 47c1 18-11 28-18 44l-7 35H47l-10-39-15-39c-3-9 7-16 13-10l11 14 3-33Z" fill={`url(#${prefix}-hand)`} />
          <path d="M115 154h7m-7 16h8m-7 15h7" stroke="#b7886d" strokeWidth="1.3" strokeLinecap="round" opacity=".65" />
          <g filter={`url(#${prefix}-shadow)`}>
            <path d="M-.6 48v21m0 8v13m122-20v27" stroke="#8b9a8f" strokeWidth="2" strokeLinecap="round" />
            <rect width="122" height="244" rx="23" fill={`url(#${prefix}-phone)`} stroke="#718475" strokeWidth=".8" />
            <rect x="4" y="4" width="114" height="236" rx="19" fill="#101e19" stroke="#485c4c" strokeWidth=".5" />
            <g clipPath={`url(#${prefix}-viewfinder)`}>
              <rect x="7" y="23" width="108" height="182" fill={`url(#${prefix}-camera-room)`} />
              <path d="M7 150h108v55H7Z" fill="#7a886d" opacity=".18" />
              <ellipse cx="61" cy="167" rx="53" ry="7" fill="#10271a" opacity=".22" />
              {laptop ? (
                <g transform="translate(9 76) rotate(-3 52 40)"><use href={`#${prefix}-laptop`} width="104" height="81" /></g>
              ) : (
                <>
                  <path d="m54 159-2 17h20l-3-17" fill="#89997c" /><path d="M46 177h31" stroke="#9cab8e" strokeWidth="2" strokeLinecap="round" />
                  <g transform="translate(30 57) rotate(-5 30 56)"><use href={`#${prefix}-screen-phone`} width="59" height="115" /></g>
                </>
              )}
              <path d="M43 30v167m36-167v167M12 86h98M12 142h98" stroke="#edf8e7" strokeWidth=".5" opacity=".13" />
              <path d="M22 67V57h10m58 0h10v10M22 151v10h10m58 0h10v-10" fill="none" stroke="#dcefc8" strokeWidth="1.3" strokeLinecap="round" />
            </g>
            <rect x="44" y="9" width="34" height="8" rx="4" fill="#07140f" /><circle cx="70" cy="13" r="1.7" fill="#254d40" /><circle cx="70" cy="13" r=".6" fill="#769792" />
            <rect x="14" y="29" width="49" height="14" rx="5" fill="#10251b" opacity=".86" />
            <circle cx="22" cy="36" r="2.3" fill="#f26d57" className={styles.recordDot} /><text x="29" y="39" fontSize="6.2" fontWeight="600" fill="#eef8e8">00:03</text>
            <rect x="78" y="29" width="30" height="13" rx="4" fill="#10251b" opacity=".6" /><text x="84" y="37.5" fontSize="5" fontWeight="600" fill="#e0edda">9:16</text>
            <text x="61" y="188" textAnchor="middle" fontSize="5.5" fontWeight="650" letterSpacing="1.1" fill="#edf7e6">VIDEO</text>
            <circle cx="61" cy="218" r="15" fill="none" stroke="#e4eddf" strokeWidth="1.6" /><circle cx="61" cy="218" r="11.5" fill="#ef6c57" /><rect x="56.5" y="213.5" width="9" height="9" rx="2" fill="#fff4e8" />
            <rect x="18" y="211" width="13" height="14" rx="3" fill="#8fa77c" stroke="#c0d0af" strokeWidth=".6" /><path d="m21 221 4-5 4 5Z" fill="#d3dfbd" />
            <path d="M96 214a5 5 0 1 1-3 1m-.5-3v4h4" fill="none" stroke="#e0ebd9" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="44" y="234" width="34" height="2.5" rx="1.25" fill="#b9c8b2" />
          </g>
          <path d="M1 175c-7-9-16-5-16 3 0 7 5 16 11 23l7 8c6 4 11-2 8-9Z" fill={`url(#${prefix}-hand)`} stroke="#bf9075" strokeWidth=".6" /><path d="m-7 178 5 8" stroke="#f0cfb1" strokeWidth="2.5" strokeLinecap="round" />
        </g>

      </svg>
    </figure>
  );
}

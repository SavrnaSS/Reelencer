"use client";

import { memo, useId, type CSSProperties, type ReactNode } from "react";
import type { ReelKit, ReelShot } from "@/lib/reelKit";
import styles from "./ReelStoryboard.module.css";

type ArtworkProps = {
  shot: ReelShot["id"];
  approved: ReelKit["approved"];
  pending: ReelKit["pending"];
  approvedReels: ReelKit["approvedReels"];
  motion?: boolean;
  progress?: number;
};

const money = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function ChromeMark({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 48})`}>
      <circle cx="24" cy="24" r="24" fill="#fbbc05" />
      <path d="M24 0a24 24 0 0 1 20.8 12H24L13.6 30 3.2 12A24 24 0 0 1 24 0Z" fill="#ea4335" />
      <path d="M3.2 12 14 30l10 18A24 24 0 0 1 3.2 12Z" fill="#34a853" />
      <circle cx="24" cy="24" r="11" fill="#4285f4" stroke="#fff" strokeWidth="2.5" />
    </g>
  );
}

function Brand({ x = 8, y = 12 }: { x?: number; y?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="12" height="12" rx="4" fill="#245d46" />
      <path d="m5 3 5 3-5 3Z" fill="#d9f79d" />
      <text x="16" y="9" fontSize="9" fontWeight="750" fill="#172c22">Reelencer</text>
    </g>
  );
}

/** A close, slightly tilted view of a real laptop, including browser chrome and its keyboard. */
function Laptop({ prefix, children, search = false }: { prefix: string; children: ReactNode; search?: boolean }) {
  return (
    <>
      <rect width="180" height="320" fill={`url(#${prefix}-room)`} />
      <circle cx="163" cy="30" r="34" fill="#c5a97c" opacity=".1" />
      <g transform="rotate(-4 90 165)">
        <rect x="-17" y="33" width="216" height="219" rx="8" fill="#111a1c" stroke="#667071" strokeWidth="1.2" />
        <g clipPath={`url(#${prefix}-display)`}>
          <rect x="-10" y="41" width="202" height="202" fill="#f7f7f1" />
          <rect x="-10" y="41" width="202" height="29" fill="#263b42" />
          <rect x="0" y="44" width="130" height="11" rx="4" fill="#40575b" />
          <circle cx="6" cy="49.5" r="2.5" fill="#9bd3ab" />
          <text x="12" y="51.5" fontSize="5.2" fill="#e4eeea">Reelencer | Paid short-form content</text>
          <text x="141" y="52" fontSize="9" fill="#dce6df">+</text>
          <path d="m0 60-3 2 3 2m6-4 3 2-3 2" stroke="#cad5cf" strokeWidth=".9" fill="none" />
          <rect x="17" y="57" width="161" height="10" rx="5" fill="#182c33" stroke={search ? "#a7d6b9" : "#53696a"} strokeWidth={search ? "1.3" : ".5"} />
          <path d="M23 61v3m-1-3v-1a1 1 0 0 1 2 0v1" stroke="#a8c0b4" strokeWidth=".8" />
          <g transform="translate(-4 71)">{children}</g>
        </g>
        <circle cx="91" cy="37" r="1.1" fill="#718e85" />
        <path d="M-17 253h216l19 64H-38Z" fill={`url(#${prefix}-metal)`} stroke="#687272" strokeWidth=".7" />
        <g transform="translate(-13 259) skewX(-8)">
          {[0, 1, 2, 3].map((row) => (
            <g key={row} transform={`translate(${row % 2 ? 3 : 0} ${row * 10})`}>
              {Array.from({ length: 14 }, (_, column) => (
                <g key={column} transform={`translate(${column * 14.5} 0)`}>
                  <rect width="12" height="8" rx="1.4" fill="#172024" stroke="#667071" strokeWidth=".4" />
                  <path d="M4 3h3" stroke="#a1aaa7" strokeWidth=".65" opacity=".7" />
                </g>
              ))}
            </g>
          ))}
          <rect x="53" y="41" width="87" height="7" rx="1.5" fill="#1b2427" stroke="#667071" strokeWidth=".5" />
        </g>
        <path d="M-33 316h246l-3 4H-30Z" fill="#838b86" />
        <path d="M-8 43h199v8L-8 190Z" fill="#fff" opacity=".025" />
      </g>
      <rect width="180" height="320" fill={`url(#${prefix}-vignette)`} pointerEvents="none" />
    </>
  );
}

function Portrait({ prefix }: { prefix: string }) {
  return (
    <>
      <rect width="180" height="320" fill={`url(#${prefix}-night)`} />
      <g opacity=".65" fill="#344b34">
        <path d="m123 0 25 50-43 25 59 12-27 39 43-9V0Z" />
        <path d="M0 26 30 55 11 79 39 99 0 134Z" />
      </g>
      <path d="M-10 10Q90 58 190 4M-10 79Q90 21 190 71" fill="none" stroke="#80674d" strokeWidth="1" />
      {[[8, 18], [37, 30], [71, 36], [109, 31], [148, 20], [174, 10], [9, 68], [52, 49], [139, 50], [174, 64]].map(([x, y], index) => (
        <g key={index}>
          <circle cx={x} cy={y} r="6" fill="#ffc778" opacity=".1" />
          <circle cx={x} cy={y} r="1.8" fill="#ffe3a4" />
        </g>
      ))}
      <circle cx="170" cy="197" r="31" fill="#ed9c66" opacity=".12" />
      <g className={styles.portraitMotion}>
        <path d="M32 283C19 235 25 168 31 126 38 77 65 61 95 67 139 61 155 101 150 150L161 282Z" fill="#27202a" />
        <path d="M17 320v-42c1-31 29-44 56-50h39c35 4 57 28 60 54v38Z" fill={`url(#${prefix}-shirt)`} />
        <path d="M68 204v30q22 23 44 0v-31Z" fill="#c98e79" />
        <path d="M69 210q20 17 42 0v13q-22 17-42 1Z" fill="#a06a61" opacity=".4" />
        <ellipse cx="48" cy="160" rx="9" ry="16" fill="#cd917c" />
        <ellipse cx="135" cy="160" rx="8" ry="16" fill="#d99d85" />
        <path d="M48 124q1-43 42-42 44 0 47 46l-5 49c-4 27-23 43-42 43-18 0-39-21-42-47Z" fill={`url(#${prefix}-skin)`} />
        <path d="M39 148c0-57 17-79 55-77 31-2 55 21 52 75-6-16-12-33-25-42-24 18-46 17-72 32l-6 41Z" fill="#30232e" />
        <path d="M42 133q24-35 60-38M112 86q26 13 28 42" fill="none" stroke="#65424a" strokeWidth="2" opacity=".6" />
        <path d="M56 146q10-6 20-1m28-1q10-5 20 2" fill="none" stroke="#5a363a" strokeWidth="2.7" strokeLinecap="round" />
        <path d="M57 155q9-8 19 0-10 9-19 0m47 0q10-8 20 1-10 8-20-1" fill="#fff5e9" />
        <g fill="#46312b"><ellipse cx="67" cy="155" rx="3.6" ry="4" /><ellipse cx="113" cy="155" rx="3.6" ry="4" /></g>
        <g fill="#fff"><circle cx="68" cy="153.5" r="1" /><circle cx="114" cy="153.5" r="1" /></g>
        <path d="M56 154q10-8 21 0m26 0q11-7 22 2" stroke="#493039" strokeWidth="1.4" fill="none" />
        <path d="m88 158-4 16q5 4 10 0" stroke="#b67c6b" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <ellipse cx="61" cy="173" rx="9" ry="4" fill="#e49b91" opacity=".4" />
        <ellipse cx="119" cy="173" rx="9" ry="4" fill="#e49b91" opacity=".4" />
        <path d="M76 190q7-5 13-2 5-3 15 0-15 14-28 2Z" fill="#a64e66" />
        <path d="M78 190q12 2 23-1" stroke="#703a50" strokeWidth=".9" fill="none" />
        <path d="M46 174v17m88-17v17" stroke="#e7ca8e" strokeWidth="1.5" />
        <circle cx="46" cy="194" r="3" fill="#ecce94" /><circle cx="134" cy="194" r="3" fill="#ecce94" />
        <path d="M49 119c-5 66 1 106-8 145m89-151c13 53-7 100 12 159" fill="none" stroke="#392b34" strokeWidth="17" strokeLinecap="round" />
        <path d="M36 239q23 21 42 17m38 0q18-2 33-16" stroke="#a7a1cb" strokeWidth="2" opacity=".5" fill="none" />
        <path d="M67 232q23 27 45 0" stroke="#e8ca96" strokeWidth=".8" fill="none" /><circle cx="90" cy="251" r="1.6" fill="#e8ca96" />
      </g>
      <rect width="180" height="320" fill={`url(#${prefix}-vignette)`} />
    </>
  );
}

/** Scalable scenes drawn for this storyboard; no screenshots or additional image requests. */
function ReelShotArtwork({ shot, approved, pending, approvedReels, motion = false, progress = 1 }: ArtworkProps) {
  const prefix = `shot-${useId().replace(/:/g, "")}`;
  const earnings = money(approved * Math.min(1, progress / .65));
  return (
    <svg viewBox="0 0 180 320" fill="none" className={styles.artwork} data-motion={motion} style={{ "--scene-progress": Math.max(0, Math.min(1, progress)) } as CSSProperties} aria-hidden="true" focusable="false" fontFamily="Arial, Helvetica, sans-serif">
      <defs>
        <linearGradient id={`${prefix}-room`} x2="180" y2="320" gradientUnits="userSpaceOnUse"><stop stopColor="#756052" /><stop offset=".5" stopColor="#343934" /><stop offset="1" stopColor="#172129" /></linearGradient>
        <linearGradient id={`${prefix}-metal`} x2="0" y2="1"><stop stopColor="#515d5f" /><stop offset="1" stopColor="#252e32" /></linearGradient>
        <linearGradient id={`${prefix}-night`} x2="180" y2="320" gradientUnits="userSpaceOnUse"><stop stopColor="#28392e" /><stop offset=".5" stopColor="#574039" /><stop offset="1" stopColor="#b97563" /></linearGradient>
        <linearGradient id={`${prefix}-skin`} x2="1" y2=".6"><stop stopColor="#d79d83" /><stop offset=".55" stopColor="#efb99b" /><stop offset="1" stopColor="#cf8e7b" /></linearGradient>
        <linearGradient id={`${prefix}-shirt`} x2="1" y2="1"><stop stopColor="#9993bf" /><stop offset="1" stopColor="#66627e" /></linearGradient>
        <linearGradient id={`${prefix}-blue`} x2="180" y2="320" gradientUnits="userSpaceOnUse"><stop stopColor="#337f9c" /><stop offset="1" stopColor="#122744" /></linearGradient>
        <radialGradient id={`${prefix}-vignette`}><stop offset=".5" stopColor="#121a1a" stopOpacity="0" /><stop offset="1" stopColor="#121a1a" stopOpacity=".22" /></radialGradient>
        <clipPath id={`${prefix}-display`}><rect x="-10" y="41" width="202" height="202" rx="2" /></clipPath>
      </defs>

      {shot === "hook" ? <Portrait prefix={prefix} /> : shot === "chrome" ? (
        <>
          <rect width="180" height="320" fill={`url(#${prefix}-blue)`} />
          <path d="M0 140Q75 65 180 116v95Q96 156 0 264Z" fill="#72b9cd" opacity=".1" />
          <text x="14" y="28" fontSize="10" fill="#d4edf5" opacity=".8">Your everyday apps</text>
          <g className={styles.chromeMotion}>
            <rect x="51" y="62" width="78" height="78" rx="20" fill="#fff" />
            <ChromeMark x={59} y={70} size={62} />
            <text x="90" y="159" textAnchor="middle" fontSize="12" fontWeight="600" fill="white">Google Chrome</text>
          </g>
          <g opacity=".7">
            <rect x="-30" y="63" width="57" height="65" rx="16" fill="#68abcc" /><path d="m7 82-9 15h17" stroke="#c5e9ef" strokeWidth="3" />
            <rect x="154" y="63" width="60" height="65" rx="16" fill="#a1b7c9" /><circle cx="177" cy="94" r="13" fill="#d8e3e7" />
            <rect x="51" y="194" width="78" height="78" rx="20" fill="#3c9bdf" /><path d="m75 245 15-33 15 33m-35-10h40" stroke="white" strokeWidth="5" strokeLinecap="round" />
            <rect x="-30" y="194" width="57" height="78" rx="16" fill="#39b29b" /><rect x="154" y="194" width="60" height="78" rx="16" fill="#a678c1" />
          </g>
          <g className={styles.tapMotion}><circle cx="118" cy="128" r="14" fill="white" opacity=".15" /><circle cx="118" cy="128" r="6" fill="white" opacity=".8" /></g>
        </>
      ) : (
        <Laptop prefix={prefix} search={shot === "search"}>
          {shot === "search" ? (
            <>
              <text x="33" y="-7" fontSize="6.2" fill="#d6efdf">{"reelencer.com".slice(0, Math.ceil(progress * 20))}</text>
              <rect x="17" width="167" height="49" rx="4" fill="#fff" stroke="#c7d3cb" />
              <circle cx="27" cy="12" r="3" stroke="#6d8678" strokeWidth="1" /><path d="m29 14 3 3" stroke="#6d8678" />
              <text x="38" y="14" fontSize="7" fill="#223b2c">reelencer.com</text>
              <text x="38" y="24" fontSize="5.5" fill="#718076">Reelencer · Get paid for your content</text>
              <path d="M24 34h151" stroke="#edf0eb" />
              <text x="38" y="43" fontSize="6" fill="#68756b">Search Reelencer</text>
              <Brand y={64} />
              <text x="8" y="101" fontSize="19" fontWeight="750" fill="#17352a">Get paid for</text>
              <text x="8" y="123" fontSize="19" fontWeight="750" fill="#397b4c">the reels you love.</text>
              <rect x="8" y="139" width="83" height="16" rx="8" fill="#d4f49c" /><text x="18" y="149.5" fontSize="6.5" fontWeight="700" fill="#274a32">Explore opportunities →</text>
              <g className={styles.cursorMotion}><path d="m102 5 2 13 3-4 5 1Z" fill="#203d2c" stroke="white" strokeWidth=".8" /></g>
            </>
          ) : shot === "account" ? (
            <>
              <Brand />
              <text x="105" y="20" fontSize="5.2" fill="#64746b">For creators</text><text x="145" y="20" fontSize="5.2" fill="#64746b">For brands</text>
              <rect x="9" y="35" width="54" height="12" rx="6" fill="#d6f5a4" /><text x="17" y="43" fontSize="5.5" fill="#2a5739">✦ I’m a creator</text>
              <text x="9" y="69" fontSize="19" fontWeight="750" letterSpacing="-.7" fill="#1b3024">Get paid for</text>
              <text x="9" y="90" fontSize="19" fontWeight="750" letterSpacing="-.7" fill="#347b4b">the reels you love,</text>
              <text x="9" y="111" fontSize="19" fontWeight="750" letterSpacing="-.7" fill="#347b4b">with zero chasing.</text>
              <text x="9" y="129" fontSize="5.8" fill="#6f7c72">Work with verified brands. Make content. Get paid.</text>
              <rect x="9" y="142" width="81" height="17" rx="8.5" fill="#c9ef91" /><text x="20" y="153" fontSize="6.5" fontWeight="700" fill="#244532">Find your first gig →</text>
              <g transform="translate(137 117) rotate(8)"><rect width="38" height="62" rx="6" fill="#1f3029" /><rect x="3" y="5" width="32" height="47" rx="3" fill="#c5d7b5" /><circle cx="19" cy="21" r="8" fill="#dbac8a" /><path d="M6 51V39q12-15 26 0v12Z" fill="#7b77a1" /><rect x="-5" y="39" width="37" height="13" rx="4" fill="#254b38" /><text x="0" y="48" fontSize="7" fontWeight="700" fill="#d9f5b4">₹41,500</text></g>
            </>
          ) : shot === "apply" ? (
            <>
              <Brand y={7} />
              <text x="9" y="43" fontSize="15" fontWeight="750" fill="#24352b">Find gigs</text>
              <text x="9" y="55" fontSize="5.6" fill="#788276">Discover brands. Make content. Earn on your terms.</text>
              <rect x="9" y="65" width="83" height="16" rx="4" fill="white" stroke="#dce1d7" /><text x="16" y="75" fontSize="6" fill="#778479">⌕ Search gigs</text>
              <rect x="99" y="65" width="77" height="16" rx="4" fill="white" stroke="#dce1d7" /><text x="107" y="75" fontSize="6" fill="#778479">All regions⌄</text>
              <rect x="9" y="87" width="48" height="12" rx="6" fill="#283f31" /><text x="16" y="95" fontSize="5" fill="white">All platforms</text>
              <g className={styles.pageMotion}>
                {[0, 1].map((card) => (
                  <g key={card} transform={`translate(${9 + card * 88} 106)`}>
                    <rect width="81" height="98" rx="5" fill="white" stroke="#dce2d8" />
                    <circle cx="13" cy="14" r="6" fill={card ? "#eee0f7" : "#e7efda"} /><text x="23" y="16" fontSize="5.3" fontWeight="700" fill="#3b503e">{card ? "Creators co." : "Nitro Globe"}</text>
                    <text x="7" y="36" fontSize="6.5" fontWeight="700" fill="#283a2b">{card ? "Create your next" : "Record an indoor"}</text>
                    <text x="7" y="46" fontSize="6.5" fontWeight="700" fill="#283a2b">{card ? "Instagram reel" : "reaction video"}</text>
                    <text x="7" y="58" fontSize="4.8" fill="#849080">Content Posting · Instagram</text>
                    <rect x="7" y="68" width="30" height="10" rx="5" fill="#edf4e7" /><text x="12" y="75" fontSize="4.5" fill="#527148">Open gig</text>
                    <text x="7" y="91" fontSize="9" fontWeight="700" fill="#203d2d">{card ? "₹75" : "₹49"}</text><text x="29" y="91" fontSize="4.3" fill="#7c897d">/ 1K views</text>
                  </g>
                ))}
              </g>
            </>
          ) : shot === "proposal" ? (
            <>
              <Brand y={7} />
              <g className={styles.pageMotion}>
                <text x="9" y="40" fontSize="13" fontWeight="750" fill="#263c2d">Find gigs</text>
                <text x="9" y="55" fontSize="6.5" fontWeight="700" fill="#425443">Record an indoor reaction video</text>
                {[67, 74, 81].map((y, index) => <path key={y} d={`M9 ${y}h${[161, 145, 113][index]}`} stroke="#d0d8ca" strokeWidth="2" strokeLinecap="round" />)}
                <rect x="9" y="95" width="168" height="107" rx="6" fill="white" stroke="#d6dfd1" />
                <text x="18" y="111" fontSize="8" fontWeight="700" fill="#283e2f">Your proposal</text>
                <text x="18" y="122" fontSize="5.3" fill="#82907e">Tell the brand why you’re a good fit.</text>
                <rect x="18" y="130" width="150" height="35" rx="4" fill="#fbfcf9" stroke="#cbd9c4" />
                <text x="25" y="142" fontSize="5.7" fill="#536a50">I’d love to create this reel for you.</text>
                <text x="25" y="152" fontSize="5.7" fill="#536a50">I’m ready to follow the brief!</text>
                <rect x="87" y="174" width="81" height="17" rx="5" fill="#254c36" /><text x="98" y="185" fontSize="6" fontWeight="700" fill="white">Send proposal →</text>
                <g className={styles.cursorMotion}><path d="m150 183 2 14 4-5 5 1Z" fill="#20392a" stroke="white" strokeWidth="1" /><circle cx="150" cy="183" r="10" stroke="#82b56c" strokeWidth="1.3" opacity=".55" /></g>
              </g>
            </>
          ) : (
            <>
              <Brand y={7} />
              <text x="9" y="42" fontSize="13" fontWeight="750" fill="#263c2d">Wallet</text>
              <text x="9" y="54" fontSize="5.5" fill="#7d8879">Your content. Your earnings.</text>
              <rect x="9" y="65" width="168" height="77" rx="6" fill="#f2f8ed" stroke="#c4d9b8" />
              <text x="18" y="80" fontSize="7" fontWeight="700" fill="#3d5537">Reel earnings</text>
              <text x="18" y="92" fontSize="5.2" fill="#708168">Approved earnings</text>
              <text x="18" y="114" fontSize={earnings.length > 12 ? "16" : "21"} fontWeight="750" letterSpacing="-.5" fill="#203d2b">{earnings}</text>
              <rect x="18" y="123" width="59" height="10" rx="5" fill="#dfedcf" /><text x="23" y="130" fontSize="4.7" fill="#4c753e">✓ {approvedReels.toLocaleString("en-IN")} approved reels</text>
              <g transform="translate(9 151)">
                <rect width="80" height="43" rx="5" fill="white" stroke="#dce2d6" /><text x="7" y="13" fontSize="5.5" fill="#7b8874">Pending earnings</text><text x="7" y="30" fontSize="9" fontWeight="700" fill="#334c2d">{money(pending)}</text>
                <rect x="88" width="80" height="43" rx="5" fill="white" stroke="#dce2d6" /><text x="95" y="13" fontSize="5.5" fill="#7b8874">Payout method</text><text x="95" y="30" fontSize="9" fontWeight="700" fill="#334c2d">UPI ↗</text>
              </g>
              <g className={styles.walletGlow}><rect x="9" y="65" width="168" height="77" rx="6" stroke="#80b45e" strokeWidth="2" /></g>
            </>
          )}
        </Laptop>
      )}
    </svg>
  );
}

export default memo(ReelShotArtwork);

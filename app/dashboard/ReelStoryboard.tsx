"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import type { ReelExample } from "@/lib/gigBriefMedia";
import { reelShots, type RecordingSetup, type ReelKit, type ReelShot } from "@/lib/reelKit";
import { cx, Icon } from "./dashboardUi";
import ReelShotArtwork from "./ReelShotArtwork";
import styles from "./ReelStoryboard.module.css";

// One suggested 14-second edit, inside the length ranges shown in the brief.
const SCENES: Record<ReelShot["id"], { duration: number; movement: string }> = {
  hook: { duration: 4500, movement: "A little head turn, a smile or a hair touch. Keep it natural." },
  chrome: { duration: 1000, movement: "Move in towards the Chrome icon, then cut as you open it." },
  search: { duration: 1000, movement: "Keep the address bar in focus as you type reelencer.com." },
  account: { duration: 1000, movement: "Hold the home page steady for a beat so the headline is clear." },
  apply: { duration: 2000, movement: "Pan slowly across the campaign cards. Keep the screen readable." },
  proposal: { duration: 2000, movement: "Scroll down to the proposal, then pause over the send button." },
  wallet: { duration: 2500, movement: "Move a little closer to the earnings. Hold on the final amount." },
};

const readReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const subscribeReducedMotion = (listener: () => void) => {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

function PlaybackIcon({ paused }: { paused: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      {paused ? <path d="M6 3.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2a.8.8 0 0 0-1.2.7Z" /> : <path d="M5 4h3.5v12H5zm6.5 0H15v12h-3.5Z" />}
    </svg>
  );
}

function CameraIcon({ selfie = false }: { selfie?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="m6.5 5 1-2h5l1 2h2.3A1.7 1.7 0 0 1 17.5 6.7v8.1a1.7 1.7 0 0 1-1.7 1.7H4.2a1.7 1.7 0 0 1-1.7-1.7V6.7A1.7 1.7 0 0 1 4.2 5Z" strokeLinejoin="round" />
      {selfie ? <><circle cx="10" cy="9" r="1.7" /><path d="M7 14a3 3 0 0 1 6 0" /></> : <circle cx="10" cy="10.5" r="3" />}
    </svg>
  );
}

function Scene({ shot, kit, thumbnail = false, motion = false, progress = 1 }: { shot: ReelShot; kit: ReelKit; thumbnail?: boolean; motion?: boolean; progress?: number }) {
  return (
    <span className={cx(styles.frame, thumbnail && styles.thumbnail)} aria-hidden="true">
      <ReelShotArtwork shot={shot.id} approved={kit.approved} pending={kit.pending} approvedReels={kit.approvedReels} motion={motion} progress={progress} />
      <span className={cx(styles.caption, shot.placement === "middle" && styles.middleCaption)}><span>{shot.caption}</span></span>
    </span>
  );
}

export default function ReelStoryboard({ kit, example, href, setup }: { kit: ReelKit; example?: ReelExample; href: string; setup: RecordingSetup }) {
  const headingId = useId();
  const detailId = useId();
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  const shots = reelShots(kit);
  const starts = shots.map((_, index) => shots.slice(0, index).reduce((sum, shot) => sum + SCENES[shot.id].duration, 0));
  const total = shots.reduce((sum, shot) => sum + SCENES[shot.id].duration, 0);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const position = useRef(0);
  const filmstrip = useRef<HTMLOListElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const picked = Math.max(0, starts.findLastIndex((start) => playhead >= start));
  const shot = shots[picked];
  const scene = SCENES[shot.id];
  const progress = Math.min(1, (playhead - starts[picked]) / scene.duration);

  const seek = (next: number) => {
    position.current = Math.max(0, Math.min(total, next));
    setPlayhead(position.current);
  };

  const select = (index: number, focus = false) => {
    setPlaying(false);
    seek(starts[index]);
    if (focus) buttons.current[index]?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!playing) return;
    const began = performance.now();
    const from = position.current;
    let frame = 0;
    let lastPaint = 0;
    const tick = (now: number) => {
      const next = Math.min(total, from + now - began);
      // The artwork needs a readable preview, not sixty React renders per second.
      if (now - lastPaint >= 70 || next === total) {
        position.current = next;
        setPlayhead(next);
        lastPaint = now;
      }
      if (next === total) setPlaying(false);
      else frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    const pauseWhenHidden = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", pauseWhenHidden);
    };
  }, [playing, total]);

  useEffect(() => {
    const rail = filmstrip.current;
    const selected = buttons.current[picked];
    if (!rail || !selected || rail.scrollWidth <= rail.clientWidth) return;
    rail.scrollTo({
      left: selected.offsetLeft - (rail.clientWidth - selected.offsetWidth) / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, [picked]);

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? Math.min(shots.length - 1, index + 1)
      : event.key === "ArrowLeft" ? Math.max(0, index - 1)
      : event.key === "Home" ? 0 : event.key === "End" ? shots.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    select(next, true);
  };

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <div className={styles.toolbar}>
        <div className={styles.intro}>
          <h5 id={headingId}>Your reel, scene by scene</h5>
          <p>7 clips <span aria-hidden="true">·</span> 9:16 <span aria-hidden="true">·</span> about 14s <span aria-hidden="true">·</span> tap a clip for details</p>
        </div>
        <button
          type="button"
          className={styles.playButton}
          aria-pressed={playing}
          onClick={() => {
            if (!playing && position.current >= total) seek(0);
            setPlaying(!playing);
          }}
        >
          <PlaybackIcon paused={!playing} />
          {playing ? "Pause" : playhead >= total ? "Replay" : playhead > 0 ? "Play from here" : "Play preview"}
        </button>
      </div>

      <div className={styles.stage}>
        <ol ref={filmstrip} aria-label="Example reel, clip by clip" className={styles.filmstrip}>
          {shots.map((item, index) => (
            <li key={item.id}>
              <button
                ref={(node) => { buttons.current[index] = node; }}
                type="button"
                onClick={() => select(index)}
                onKeyDown={(event) => navigate(event, index)}
                aria-pressed={picked === index}
                aria-controls={detailId}
                aria-label={`Clip ${index + 1}: ${item.title}, ${item.seconds}`}
                className={cx(styles.shotButton, picked === index && styles.selected)}
              >
                <span className={styles.shotImage}>
                  <Scene shot={item} kit={kit} thumbnail />
                  <span className={styles.shotNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.shotCamera} aria-hidden="true"><CameraIcon selfie={item.camera === "selfie"} /></span>
                </span>
                <span className={styles.shotText}>
                  <span className={styles.shotTitle}><span className={styles.shotIndex} aria-hidden="true">{index + 1}</span>{item.title}</span>
                  <span className={styles.shotDuration}>{item.seconds}</span>
                </span>
                <span className={styles.shotProgress} aria-hidden="true"><span style={{ width: `${index < picked ? 100 : index === picked ? progress * 100 : 0}%` }} /></span>
              </button>
            </li>
          ))}
        </ol>
        <div className={styles.previewPhone} role="img" aria-label={`${shot.title}: ${shot.camera === "selfie" ? "a selfie outdoors with a caption in the middle" : "a close-up of the screen with a caption in the lower middle"}`}>
          <Scene key={shot.id} shot={shot} kit={kit} motion={playing} progress={reducedMotion ? 1 : playing || progress > 0 ? progress : 1} />
        </div>

        <div id={detailId} className={styles.direction}>
          <div className={styles.sceneHeading}>
            <div aria-live="polite" aria-atomic="true">
              <span className={styles.eyebrow}>Clip {picked + 1} of {shots.length}</span>
              <h6>{shot.title}</h6>
            </div>
            <nav className={styles.sceneNavigation} aria-label="Navigate reel clips">
              <button type="button" onClick={() => select(picked - 1)} disabled={picked === 0} aria-label="Previous clip"><Icon.ChevronLeft /></button>
              <button type="button" onClick={() => select(picked + 1)} disabled={picked === shots.length - 1} aria-label="Next clip"><Icon.ChevronRight /></button>
            </nav>
          </div>
          <div className={styles.sceneMeta}><span><CameraIcon selfie={shot.camera === "selfie"} />{shot.camera === "selfie" ? "Front camera" : "Back camera"}</span><span>{shot.seconds}</span></div>
          <p className={styles.filmDirection}>{shot.film}{shot.camera === "screen" ? <span> {scene.movement}</span> : null}</p>

          <div className={styles.captionCard}>
            <span className={styles.captionHeading}>Caption idea · {shot.placement === "middle" ? "mid-screen" : "lower middle"}</span>
            <p className={styles.captionText}>“{shot.caption}”</p>
            <span className={styles.captionTip}>Write your own, in your words.</span>
          </div>

          {shot.id === "wallet" ? (
            <div className={styles.walletAction}>
              <a href={href} target="_blank" rel="noopener">Open demo wallet <Icon.External /></a>
              <p>{setup === "laptop" ? "Space plays a take, R resets." : "Tap Play take; triple-tap to stop."}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.bottomNote}>
        <p><Icon.Video />Keep this order, cut on the beat, then add your captions.</p>
        {example ? <a href={example.url} target="_blank" rel="noopener noreferrer">Watch the sample reel <Icon.External /></a> : null}
      </div>
    </section>
  );
}

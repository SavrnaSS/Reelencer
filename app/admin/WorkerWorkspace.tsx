"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { workerAccessStatus, type WorkerDirectoryRecord } from "@/lib/adminWorkerDirectory";
import styles from "./WorkerWorkspace.module.css";

type Glyph = "users" | "plus" | "back" | "arrow" | "shield" | "briefcase" | "profile" | "mail" | "clock" | "search" | "filter";
export function WorkerGlyph({ name, className }: { name: Glyph; className?: string }) {
  const paths: Record<Glyph, ReactNode> = {
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    back: <path d="m14 6-6 6 6 6M8 12h12" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8.5 11.5 2.5 2.5 4.5-5" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="14" rx="3" /><path d="M8 7V4h8v3M3 12a22 22 0 0 0 18 0M12 11v4" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3 7 9 6 9-6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    filter: <><path d="M4 7h9m4 0h3M4 17h3m4 0h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  };
  return <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function workerInitials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join("").toLocaleUpperCase() || "?";
}

const wideQuery = "(min-width: 1180px)";
function subscribeWide(listener: () => void) {
  const query = window.matchMedia(wideQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

type WorkspaceProps = {
  workers: WorkerDirectoryRecord[];
  selectedWorker: WorkerDirectoryRecord | undefined;
  detailOpen: boolean;
  onViewChange: (detail: boolean) => void;
  onCreateWorker: () => void;
  directory: ReactNode;
  children: ReactNode;
};

export default function WorkerWorkspace({ workers, selectedWorker, detailOpen, onViewChange, onCreateWorker, directory, children }: WorkspaceProps) {
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(wideQuery).matches, () => false);
  const details = useRef<HTMLElement>(null);
  const directoryPane = useRef<HTMLElement>(null);
  const activeCount = workers.filter(worker => workerAccessStatus(worker) === "active").length;
  const deletedCount = workers.filter(worker => workerAccessStatus(worker) === "deleted").length;
  useEffect(() => {
    if (wide) return;
    const frame = requestAnimationFrame(() => {
      if (detailOpen) {
        details.current?.scrollIntoView({ behavior: "instant", block: "start" });
        details.current?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [wide, detailOpen, selectedWorker?.id]);

  const back = () => {
    onViewChange(false);
    requestAnimationFrame(() => {
      directoryPane.current?.scrollIntoView({ behavior: "instant", block: "start" });
      directoryPane.current?.focus({ preventScroll: true });
    });
  };
  return <section className={styles.workspace} aria-label="Worker management workspace">
    <header className={styles.workspaceHeader}>
      <div className={styles.headerTitle}><div className={styles.titleLine}><h2>Workers</h2><span className={styles.total}>{workers.length}</span></div><p className={styles.description}>Your team, their access, and the work ahead.</p></div>
      <div className={styles.headerRight}><div className={styles.quickStats}><span className={styles.activeStat}><i />{activeCount} active</span>{deletedCount > 0 ? <span className={styles.deletedStat}>{deletedCount} pending removal</span> : null}</div><button type="button" className={styles.createButton} onClick={onCreateWorker}><WorkerGlyph name="plus" />Create worker</button></div>
    </header>
    {!wide ? <nav className={styles.mobileViews} aria-label="Worker workspace view"><button type="button" aria-pressed={!detailOpen} onClick={back}><WorkerGlyph name="users" />Directory<span>{workers.length}</span></button><button type="button" aria-pressed={detailOpen} onClick={() => onViewChange(true)} disabled={!selectedWorker}><WorkerGlyph name="profile" />Worker details</button></nav> : null}
    <div className={styles.layout}>
      <section ref={directoryPane} tabIndex={-1} hidden={!wide && detailOpen} className={styles.directoryPane} aria-label="Worker directory">
        <div className={styles.paneHeading}><div><WorkerGlyph name="users" /><h2>Team directory</h2></div><span>{selectedWorker ? `Viewing ${selectedWorker.name}` : "Select a user to manage"}</span></div>
        <div className={styles.directoryBody}>{directory}</div>
      </section>
      <section ref={details} id="admin-worker-controls" tabIndex={-1} hidden={!wide && !detailOpen} className={styles.detailsPane} aria-label="Worker controls">
        {!wide ? <button type="button" className={styles.backButton} onClick={back}><WorkerGlyph name="back" />Back to directory</button> : null}
        {children}
      </section>
    </div>
  </section>;
}

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

export function WorkerProfileHeader({ worker, onCreateAccount, onCreateWork }: { worker: WorkerDirectoryRecord; onCreateAccount: () => void; onCreateWork: () => void }) {
  const status = workerAccessStatus(worker);
  return <header className={styles.profileHeader}>
    <div className={styles.profileMain}>
      <div className={styles.profileAvatar} aria-hidden="true">{workerInitials(worker.name)}</div>
      <div className={styles.profileIdentity}>
        <div className={styles.profileName}><h2>{worker.name}</h2><span className={`${styles.status} ${styles[status]}`}>{status === "active" ? "Active" : status === "deleted" ? "Deleted" : "Suspended"}</span></div>
        <div className={styles.profileMeta}><span className={styles.workerCode}>{worker.id}</span>{worker.email ? <a href={`mailto:${worker.email}`} className={styles.email}><WorkerGlyph name="mail" /><span>{worker.email}</span></a> : null}</div>
      </div>
      <div className={styles.profileActions}><button type="button" onClick={onCreateAccount}><WorkerGlyph name="plus" />Create account</button><button type="button" className={styles.primaryAction} onClick={onCreateWork} disabled={!worker.active}><WorkerGlyph name="plus" />Create work</button></div>
    </div>
    <dl className={styles.profileFacts}>
      <div><dt>Accounts</dt><dd>{worker.accountCount}</dd></div>
      <div><dt>Submitted</dt><dd>{worker.submittedCount}</dd></div>
      <div className={worker.resubmitCount > 0 ? styles.factWarn : undefined}><dt>Resubmits</dt><dd>{worker.resubmitCount}</dd></div>
      <div className={styles.factMoney}><dt>Approved</dt><dd>{currency.format(worker.approvedINR)}</dd></div>
    </dl>
  </header>;
}

const detailTabs = [{ id: "access", label: "Access & safety", icon: "shield" }, { id: "assignments", label: "Work & accounts", icon: "briefcase" }, { id: "profile", label: "Profile", icon: "profile" }] as const;
type DetailTab = (typeof detailTabs)[number]["id"];
export function WorkerDetailTabs({ access, assignments, profile, accountCount }: { access: ReactNode; assignments: ReactNode; profile: ReactNode; accountCount: number }) {
  const id = useId();
  const [tab, setTab] = useState<DetailTab>("access");
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const keyDown = (event: KeyboardEvent, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % detailTabs.length : event.key === "ArrowLeft" ? (index + detailTabs.length - 1) % detailTabs.length : event.key === "Home" ? 0 : event.key === "End" ? detailTabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();setTab(detailTabs[next].id);buttons.current[next]?.focus();
  };
  const panels = { access, assignments, profile };
  return <div className={styles.detailCard}><div className={styles.detailTabs} role="tablist" aria-label="Worker information">{detailTabs.map((item, index) => <button key={item.id} ref={element => { buttons.current[index] = element; }} type="button" role="tab" id={`${id}-${item.id}-tab`} aria-selected={tab === item.id} aria-controls={`${id}-${item.id}-panel`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={event => keyDown(event, index)}><WorkerGlyph name={item.icon} />{item.label}{item.id === "assignments" && accountCount > 0 ? <span aria-hidden="true">{accountCount}</span> : null}</button>)}</div>{detailTabs.map(item => <section key={item.id} role="tabpanel" id={`${id}-${item.id}-panel`} aria-labelledby={`${id}-${item.id}-tab`} tabIndex={0} hidden={tab !== item.id} className={styles.tabPanel}>{panels[item.id]}</section>)}</div>;
}

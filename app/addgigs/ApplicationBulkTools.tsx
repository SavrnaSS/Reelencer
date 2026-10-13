"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  EMPTY_CONDITIONS,
  RULE_STATUSES,
  hasProposal,
  lastActivity,
  matchesConditions,
  type BulkAction,
  type RuleConditions,
} from "@/lib/applicationAutomationRules";
import {
  ConfirmDialog,
  ICONS,
  Icon,
  Overlay,
  SectionLabel,
  Spinner,
  StatusChip,
  btnGhost,
  btnIcon,
  btnPrimary,
  fieldClass,
  formatRelative,
  useEscape,
} from "./adminUi";

export type { BulkAction, RuleConditions };

/* ------------------------------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------------------------- */

export type ReviewMessage = {
  adminNote: string;
  adminExplanation: string;
  whatsappLink: string;
  onboardingSteps: string;
};

export type AppLike = {
  id: string;
  gigId: string;
  workerId: string;
  workerName?: string;
  status: string;
  appliedAt: string;
  decidedAt?: string;
  proposal?: {
    pitch?: string;
    approach?: string;
    timeline?: string;
    budget?: string;
    portfolio?: string;
    whatsappLink?: string;
    groupJoinedConfirmed?: boolean;
  };
};

export type MessageTemplate = ReviewMessage & { id: string; name: string; builtIn?: boolean };

export type AutomationRule = {
  id: string;
  name: string;
  conditions: RuleConditions;
  action: BulkAction;
  templateId: string | null; // null = keep each application's existing message
  enabled: boolean;
  ownerId: string;
  maxPerRun: number;
  lastRunAt: string | null;
};

export type AutomationRun = {
  id: string;
  ruleId: string | null;
  ruleName: string;
  trigger: "manual" | "schedule";
  action: string;
  matched: number;
  succeeded: number;
  failed: number;
  emailsSent: number;
  startedAt: string;
  finishedAt: string | null;
};

export type RunSummary = { matched: number; succeeded: number; failed: number; emailsSent: number; failures: { workerId: string; error: string }[] };

/* ------------------------------------------------------------------------------------------------
 * Constants & helpers
 * ---------------------------------------------------------------------------------------------- */

export const ACTION_LABEL: Record<BulkAction, string> = {
  Accepted: "Approve",
  Rejected: "Reject",
  Pending: "Mark pending",
  push: "Push message",
};

const DAY = 86_400_000;
const API = "/api/admin/application-automation";

export const BUILT_IN_TEMPLATES: MessageTemplate[] = [
  {
    id: "builtin-onboarding",
    name: "Onboarding welcome",
    builtIn: true,
    adminNote: "Review the onboarding instructions below and join the recruiter coordination channel to continue.",
    adminExplanation: "Complete the onboarding checklist, and wait for the next execution update inside their project feed.",
    whatsappLink: "",
    onboardingSteps:
      "1. Open the recruiter group link.\n2. Join the group using your active WhatsApp account.\n3. Send a short intro message with your worker ID and timezone.\n4. Read the onboarding checklist carefully.\n5. Wait for the recruiter confirmation before starting execution.",
  },
  {
    id: "builtin-reminder",
    name: "Join-group reminder",
    builtIn: true,
    adminNote: "Reminder: please join the recruiter group so we can start your onboarding.",
    adminExplanation: "Your application is approved, but we haven't seen you in the coordination group yet. Join using the link to keep your spot.",
    whatsappLink: "",
    onboardingSteps: "1. Open the group link.\n2. Join and introduce yourself with your worker ID.\n3. Confirm in your project panel that you joined.",
  },
  {
    id: "builtin-revision",
    name: "Needs revision",
    builtIn: true,
    adminNote: "Your application needs a few changes before we can approve it.",
    adminExplanation: "Please review the gig requirements, update your proposal with clearer details and relevant samples, then resubmit.",
    whatsappLink: "",
    onboardingSteps: "",
  },
];

export function describeRule(rule: Pick<AutomationRule, "conditions" | "action" | "templateId">, gigTitle: (id: string) => string | undefined, templates: MessageTemplate[]) {
  const c = rule.conditions;
  const parts: string[] = [];
  parts.push(c.statuses.length ? c.statuses.join(" or ") : "Any status");
  if (c.gigId !== "any") parts.push(`in “${gigTitle(c.gigId) ?? c.gigId}”`);
  if (c.minAgeDays != null) parts.push(`idle ${c.minAgeDays}+ day${c.minAgeDays === 1 ? "" : "s"}`);
  if (c.invite !== "any") parts.push(c.invite === "sent" ? "invite sent" : "no invite link");
  if (c.joined !== "any") parts.push(c.joined === "yes" ? "joined group" : "not joined group");
  if (c.proposal !== "any") parts.push(c.proposal === "with" ? "with proposal" : "without proposal");
  const tpl = !rule.templateId ? "keep current message" : `“${templates.find((t) => t.id === rule.templateId)?.name ?? "missing template"}”`;
  return { when: parts.join(" · "), then: `${ACTION_LABEL[rule.action]} · ${tpl}` };
}

class ApiFailure extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiFailure(payload?.error || "Request failed. Please try again.", payload?.code);
  return payload as T;
}

/* ------------------------------------------------------------------------------------------------
 * Shared server-backed store (one copy for every hook instance: drawers, header badge)
 * ---------------------------------------------------------------------------------------------- */

type StoreState = {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  setupRequired: boolean;
  templates: MessageTemplate[];
  rules: AutomationRule[];
  runs: AutomationRun[];
};

let state: StoreState = { loaded: false, loading: false, error: null, setupRequired: false, templates: [], rules: [], runs: [] };
const listeners = new Set<() => void>();
const SERVER_STATE: StoreState = state;
const setState = (patch: Partial<StoreState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

async function loadAll(force = false) {
  if (state.loading || (state.loaded && !force)) return;
  setState({ loading: true, error: null, setupRequired: false });
  try {
    const [t, r, h] = await Promise.all([
      api<{ templates: MessageTemplate[] }>("/templates"),
      api<{ rules: AutomationRule[] }>("/rules"),
      api<{ runs: AutomationRun[] }>("/runs"),
    ]);
    setState({ loaded: true, loading: false, templates: t.templates, rules: r.rules, runs: h.runs });
  } catch (e) {
    if (e instanceof ApiFailure && e.code === "schema_outdated") setState({ loading: false, setupRequired: true });
    else setState({ loading: false, error: e instanceof Error ? e.message : "Unable to load automations." });
  }
}

function useAutomationStore() {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
  useEffect(() => {
    void loadAll();
  }, []);
  return snapshot;
}

/* ------------------------------------------------------------------------------------------------
 * Templates
 * ---------------------------------------------------------------------------------------------- */

export function useMessageTemplates() {
  const store = useAutomationStore();
  const templates = useMemo(() => [...BUILT_IN_TEMPLATES, ...store.templates], [store.templates]);
  const save = async (name: string, message: ReviewMessage) => {
    const { template } = await api<{ template: MessageTemplate }>("/templates", { method: "POST", body: JSON.stringify({ ...message, name }) });
    setState({ templates: [...state.templates, template] });
    return template;
  };
  const remove = async (id: string) => {
    await api(`/templates?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setState({ templates: state.templates.filter((t) => t.id !== id) });
  };
  return { templates, save, remove };
}

/* ------------------------------------------------------------------------------------------------
 * Rules (server-side) — the scheduler runs enabled rules; this hook manages and runs them manually.
 * ---------------------------------------------------------------------------------------------- */

export function useApplicationAutomation({ apps, onRunComplete }: { apps: AppLike[]; onRunComplete?: (rule: AutomationRule, summary: RunSummary) => void }) {
  const store = useAutomationStore();
  const { templates, save: saveTemplate } = useMessageTemplates();
  const [runningId, setRunningId] = useState<string | null>(null);

  const matchesFor = useCallback((rule: Pick<AutomationRule, "conditions">, now: number) => apps.filter((app) => matchesConditions(app, rule.conditions, now)), [apps]);

  /** Built-in templates live in the browser; a rule needs a shared copy, so create one on first use. */
  const resolveTemplateId = async (templateId: string | null) => {
    const builtIn = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);
    if (!builtIn) return templateId;
    const existing = state.templates.find((t) => t.name === builtIn.name);
    return existing ? existing.id : (await saveTemplate(builtIn.name, builtIn)).id;
  };

  const saveRule = async (rule: Omit<AutomationRule, "id" | "enabled" | "ownerId" | "lastRunAt"> & { id?: string }) => {
    const body = { ...rule, templateId: await resolveTemplateId(rule.templateId) };
    if (rule.id) {
      const { rule: saved } = await api<{ rule: AutomationRule }>("/rules", { method: "PATCH", body: JSON.stringify(body) });
      setState({ rules: state.rules.map((r) => (r.id === saved.id ? saved : r)) });
    } else {
      const { rule: saved } = await api<{ rule: AutomationRule }>("/rules", { method: "POST", body: JSON.stringify(body) });
      setState({ rules: [...state.rules, saved] });
    }
  };

  const deleteRule = async (id: string) => {
    await api(`/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setState({ rules: state.rules.filter((r) => r.id !== id) });
  };

  const setAuto = async (rule: AutomationRule, enabled: boolean) => {
    const { rule: saved } = await api<{ rule: AutomationRule; baselined: number }>("/rules", { method: "PATCH", body: JSON.stringify({ id: rule.id, enabled }) });
    setState({ rules: state.rules.map((r) => (r.id === saved.id ? saved : r)) });
  };

  const run = async (rule: AutomationRule) => {
    setRunningId(rule.id);
    try {
      const summary = await api<RunSummary>(`/rules/${rule.id}/run`, { method: "POST", body: "{}" });
      onRunComplete?.(rule, summary);
      const { runs } = await api<{ runs: AutomationRun[] }>("/runs");
      setState({ runs, rules: state.rules.map((r) => (r.id === rule.id ? { ...r, lastRunAt: new Date().toISOString() } : r)) });
      return summary;
    } finally {
      setRunningId(null);
    }
  };

  return {
    apps,
    loaded: store.loaded,
    loading: store.loading,
    error: store.error,
    setupRequired: store.setupRequired,
    reload: () => loadAll(true),
    rules: store.rules,
    runs: store.runs,
    templates,
    matchesFor,
    saveRule,
    deleteRule,
    setAuto,
    run,
    runningId,
    autoCount: store.rules.filter((r) => r.enabled).length,
  };
}

export type AutomationApi = ReturnType<typeof useApplicationAutomation>;

/* ------------------------------------------------------------------------------------------------
 * Smart select menu
 * ---------------------------------------------------------------------------------------------- */

export function SmartSelectMenu({ apps, selectedIds, onSelect }: { apps: AppLike[]; selectedIds: string[]; onSelect: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEscape(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const presets: { label: string; hint: string; pick: (a: AppLike) => boolean }[] = [
    { label: "Everything in view", hint: "All filtered applications", pick: () => true },
    { label: "Awaiting review", hint: "Applied or pending", pick: (a) => a.status === "Applied" || a.status === "Pending" },
    { label: "Waiting 3+ days", hint: "Awaiting review, idle 3+ days", pick: (a) => (a.status === "Applied" || a.status === "Pending") && now - lastActivity(a) >= 3 * DAY },
    { label: "Approved · no invite", hint: "Needs a WhatsApp link", pick: (a) => a.status === "Accepted" && !a.proposal?.whatsappLink?.trim() },
    { label: "Invited · not joined", hint: "Approved, invite sent, not in group", pick: (a) => a.status === "Accepted" && !!a.proposal?.whatsappLink?.trim() && !a.proposal?.groupJoinedConfirmed },
    { label: "With proposal", hint: "Submitted proposal details", pick: hasProposal },
    { label: "Without proposal", hint: "Direct one-step applications", pick: (a) => !hasProposal(a) },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setNow(Date.now());
          setOpen((v) => !v);
        }}
        aria-expanded={open} className={`${btnGhost} h-8 px-2.5 text-[12.5px]`}>
        <Icon d={ICONS.check} className="h-3.5 w-3.5" />
        Smart select
        <Icon d={ICONS.chevronDown} className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-[260px] overflow-hidden rounded-[12px] border border-[#e3e5e1] bg-[#fff] py-1 shadow-[0_16px_40px_-12px_rgba(15,20,17,0.3)]">
          {presets.map((p) => {
            const ids = apps.filter(p.pick).map((a) => a.id);
            return (
              <button
                key={p.label}
                type="button"
                disabled={!ids.length}
                onClick={() => {
                  onSelect(ids);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[#f7f8f6] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-[#1a201c]">{p.label}</span>
                  <span className="block truncate text-[11.5px] text-[#8a928c]">{p.hint}</span>
                </span>
                <span className="rounded-[999px] bg-[#f1f3f0] px-1.5 text-[11px] font-semibold tabular-nums leading-[18px] text-[#4b544e]">{ids.length}</span>
              </button>
            );
          })}
          <div className="my-1 border-t border-[#eef0ec]" />
          <button
            type="button"
            onClick={() => {
              const cur = new Set(selectedIds);
              onSelect(apps.map((a) => a.id).filter((id) => !cur.has(id)));
              setOpen(false);
            }}
            className="block w-full px-3 py-2 text-left text-[13px] font-semibold text-[#1a201c] hover:bg-[#f7f8f6]"
          >
            Invert selection
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Drawer shell
 * ---------------------------------------------------------------------------------------------- */

function Drawer({ title, subtitle, onClose, children, footer, id }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; id: string }) {
  useEscape(true, onClose);
  return (
    <Overlay onClose={onClose} labelledBy={id} side>
      <div className="flex max-h-[92vh] w-full flex-col rounded-t-[18px] bg-[#fff] shadow-[0_24px_64px_-16px_rgba(15,20,17,0.4)] sm:h-full sm:max-h-none sm:max-w-[560px] sm:rounded-none">
        <div className="flex items-start justify-between gap-3 border-b border-[#eef0ec] px-5 py-4">
          <div className="min-w-0">
            <h3 id={id} className="text-[16px] font-semibold text-[#1a201c]">
              {title}
            </h3>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-[#616a64]">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className={`${btnIcon} size-9`} aria-label="Close">
            <Icon d={ICONS.x} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-[#eef0ec] bg-[#fafbf9] px-5 py-3.5" style={{ paddingBottom: "max(0.875rem, env(safe-area-inset-bottom))" }}>{footer}</div>}
      </div>
    </Overlay>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Bulk message drawer
 * ---------------------------------------------------------------------------------------------- */

export function MessageDrawer({
  message,
  setMessage,
  selectedCount,
  busy,
  onClose,
  onPush,
  onDecide,
}: {
  message: ReviewMessage;
  setMessage: (m: ReviewMessage) => void;
  selectedCount: number;
  busy: boolean;
  onClose: () => void;
  onPush: () => void;
  onDecide: (action: "Accepted" | "Rejected") => void;
}) {
  const { templates, save, remove } = useMessageTemplates();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [templateError, setTemplateError] = useState<string | null>(null);
  const tryTemplate = async (fn: () => Promise<unknown>) => {
    setTemplateError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setTemplateError(e instanceof Error ? e.message : "Template change failed.");
      return false;
    }
  };
  const activeTemplate = templates.find((t) => t.adminNote === message.adminNote && t.adminExplanation === message.adminExplanation && t.onboardingSteps === message.onboardingSteps);
  const field = (key: keyof ReviewMessage, label: string, multiline?: boolean, placeholder?: string) => (
    <label className="block text-[12.5px] font-medium text-[#1a201c]">
      {label}
      {multiline ? (
        <textarea className={`${fieldClass} mt-1.5 h-28 resize-y py-2.5 leading-6`} value={message[key]} onChange={(e) => setMessage({ ...message, [key]: e.target.value })} placeholder={placeholder} />
      ) : (
        <input className={`${fieldClass} mt-1.5 h-10`} value={message[key]} onChange={(e) => setMessage({ ...message, [key]: e.target.value })} placeholder={placeholder} />
      )}
    </label>
  );

  return (
    <Drawer
      id="bulk-message-title"
      title="Message & onboarding"
      subtitle={selectedCount ? `Applies to ${selectedCount} selected application${selectedCount === 1 ? "" : "s"}.` : "Select applications in the queue to send this."}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="button" className={`${btnGhost} sm:mr-auto`} disabled={!selectedCount || busy} onClick={onPush}>
            <Icon d={ICONS.send} />
            Push update{selectedCount ? ` to ${selectedCount}` : ""}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={`${btnGhost} text-[#b42318]`} disabled={!selectedCount || busy} onClick={() => onDecide("Rejected")}>
              <Icon d={ICONS.x} />
              Reject
            </button>
            <button type="button" className={btnPrimary} disabled={!selectedCount || busy} onClick={() => onDecide("Accepted")}>
              <Icon d={ICONS.check} />
              Approve
            </button>
          </div>
        </div>
      }
    >
      <SectionLabel>Templates</SectionLabel>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {templates.map((t) => {
          const active = activeTemplate?.id === t.id;
          return (
            <span key={t.id} className={`inline-flex items-center rounded-[999px] ring-1 ring-inset ${active ? "bg-[#1f2b24] text-[#fff] ring-[#1f2b24]" : "bg-[#fff] text-[#1a201c] ring-[#d9ddd8]"}`}>
              <button type="button" onClick={() => setMessage({ ...t, whatsappLink: t.whatsappLink || message.whatsappLink })} className="py-1 pl-2.5 pr-2 text-[12.5px] font-medium">
                {t.name}
              </button>
              {!t.builtIn && (
                <button type="button" onClick={() => void tryTemplate(() => remove(t.id))} className="mr-1 inline-flex size-5 items-center justify-center rounded-full opacity-60 hover:opacity-100" aria-label={`Delete template ${t.name}`}>
                  <Icon d={ICONS.x} className="h-3 w-3" />
                </button>
              )}
            </span>
          );
        })}
      </div>

      <div className="mt-5 grid gap-3">
        {field("whatsappLink", "WhatsApp group link", false, "https://chat.whatsapp.com/...")}
        {field("adminNote", "Admin note", false, "Short worker-facing note")}
        {field("onboardingSteps", "Onboarding steps", true, "Shared onboarding instructions")}
        {field("adminExplanation", "Explanation", true, "Context for the selected group")}
      </div>

      <div className="mt-4 rounded-[12px] border border-dashed border-[#d9ddd8] p-3">
        {saving ? (
          <div className="flex gap-2">
            <input autoFocus className={`${fieldClass} h-9`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" />
            <button
              type="button"
              className={btnPrimary}
              onClick={async () => {
                if (await tryTemplate(() => save(name.trim() || "Untitled template", message))) {
                  setName("");
                  setSaving(false);
                }
              }}
            >
              Save
            </button>
            <button type="button" className={btnGhost} onClick={() => setSaving(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setSaving(true)} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#2b5d4a] hover:underline">
            <Icon d={ICONS.save} className="h-3.5 w-3.5" />
            Save this message as a template
          </button>
        )}
      </div>
      {templateError && <p className="mt-2 text-[12px] text-[#b42318]">{templateError}</p>}
      <p className="mt-3 text-[11.5px] text-[#8a928c]">Saved templates are shared with every admin and can be used by automation rules. “Push update” publishes this message without changing anyone&apos;s status. A WhatsApp link sends it as an invite.</p>
    </Drawer>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Automation drawer
 * ---------------------------------------------------------------------------------------------- */

type RuleDraft = Omit<AutomationRule, "id" | "enabled" | "ownerId" | "lastRunAt"> & { id?: string };

const SUGGESTED: RuleDraft[] = [
  {
    name: "Invite newly approved workers",
    conditions: { ...EMPTY_CONDITIONS, statuses: ["Accepted"], invite: "missing" },
    action: "push",
    templateId: "builtin-onboarding",
    maxPerRun: 25,
  },
  {
    name: "Nudge workers who haven't joined",
    conditions: { ...EMPTY_CONDITIONS, statuses: ["Accepted"], invite: "sent", joined: "no", minAgeDays: 2 },
    action: "push",
    templateId: "builtin-reminder",
    maxPerRun: 25,
  },
  {
    name: "Flag stale applications",
    conditions: { ...EMPTY_CONDITIONS, statuses: ["Applied"], minAgeDays: 7 },
    action: "Pending",
    templateId: null,
    maxPerRun: 25,
  },
];

export function AutomationDrawer({
  api: automation,
  gigs,
  gigTitle,
  busy,
  onClose,
  onSelectMatches,
}: {
  api: AutomationApi;
  gigs: { id: string; title: string }[];
  gigTitle: (id: string) => string | undefined;
  busy: boolean;
  onClose: () => void;
  onSelectMatches: (ids: string[]) => void;
}) {
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const [confirm, setConfirm] = useState<{ rule: AutomationRule; targets: AppLike[] } | null>(null);
  const [tab, setTab] = useState<"rules" | "activity">("rules");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const attempt = async (id: string, fn: () => Promise<unknown>) => {
    setError(null);
    setPendingId(id);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPendingId(null);
    }
  };

  const newRule = (base?: RuleDraft) =>
    setEditing({ name: base?.name ?? "", conditions: base?.conditions ?? { ...EMPTY_CONDITIONS }, action: base?.action ?? "Accepted", templateId: base?.templateId ?? null, maxPerRun: base?.maxPerRun ?? 25 });

  return (
    <>
      <Drawer
        id="automation-title"
        title="Automations"
        subtitle="Rules run on the server on a schedule, for every admin — even when nobody has this page open."
        onClose={onClose}
        footer={
          !editing && tab === "rules" && automation.loaded ? (
            <button type="button" className={`${btnPrimary} w-full sm:w-auto`} onClick={() => newRule()}>
              <Icon d="M10 4.5v11M4.5 10h11" />
              New rule
            </button>
          ) : undefined
        }
      >
        {(error || automation.error) && (
          <div className="mb-4 flex items-start gap-2 rounded-[12px] border border-[#f4cdc9] bg-[#fdf0ef] px-3 py-2.5 text-[12.5px] text-[#912018]">
            <Icon d={ICONS.x} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{error ?? automation.error}</span>
            {automation.error && (
              <button type="button" className="font-semibold underline" onClick={() => void automation.reload()}>
                Retry
              </button>
            )}
          </div>
        )}

        {editing ? (
          <RuleEditor
            rule={editing}
            gigs={gigs}
            templates={automation.templates}
            apps={automation.apps}
            onCancel={() => setEditing(null)}
            onSave={(rule) =>
              attempt("save", async () => {
                await automation.saveRule(rule);
                setEditing(null);
              })
            }
            saving={pendingId === "save"}
          />
        ) : automation.setupRequired ? (
          <div className="rounded-[14px] border border-[#f3dcae] bg-[#fff8eb] p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#fff0d1] text-[#9a5b00]">
                <Icon d={ICONS.shield} className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h4 className="text-[14px] font-semibold text-[#1a201c]">One-time database update needed</h4>
                <p className="mt-1 text-[12.5px] leading-5 text-[#4b544e]">
                  Automations store rules, templates and run history in new database tables that haven&apos;t been created yet. A developer needs to run the
                  migration once:
                </p>
                <code className="mt-2 block rounded-[8px] bg-[#1a201c] px-3 py-2 font-mono text-[12px] text-[#e9f5ec]">npm run db:migrate</code>
                <p className="mt-2 text-[12px] text-[#7a827c]">It only adds tables; existing data isn&apos;t changed. Smart select, templates and bulk actions keep working meanwhile.</p>
                <button type="button" className={`${btnGhost} mt-3 h-8 px-2.5 text-[12.5px]`} onClick={() => void automation.reload()} disabled={automation.loading}>
                  {automation.loading ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.refresh} className="h-3.5 w-3.5" />}
                  Check again
                </button>
              </div>
            </div>
          </div>
        ) : !automation.loaded ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#7a827c]">
            {automation.loading && <Spinner className="border-[#7a827c]/30 border-t-[#7a827c]" />}
            {automation.loading ? "Loading automations…" : "Automations unavailable."}
          </div>
        ) : (
          <>
            <div className="mb-4 inline-flex rounded-[10px] bg-[#f1f3f0] p-0.5" role="tablist">
              {(["rules", "activity"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`h-8 rounded-[8px] px-3 text-[12.5px] font-semibold ${tab === t ? "bg-[#fff] text-[#1a201c] shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-[#616a64]"}`}
                >
                  {t === "rules" ? `Rules · ${automation.rules.length}` : `Activity · ${automation.runs.length}`}
                </button>
              ))}
            </div>

            {tab === "activity" ? (
              automation.runs.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-[#7a827c]">No rule has run yet.</p>
              ) : (
                <ul className="divide-y divide-[#eef0ec] rounded-[12px] border border-[#e3e5e1]">
                  {automation.runs.map((run) => (
                    <li key={run.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${run.failed ? "bg-[#fdf0ef] text-[#b42318]" : "bg-[#ebf5ee] text-[#226b40]"}`}>
                        <Icon d={run.failed ? ICONS.x : ICONS.check} className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-[#1a201c]">{run.ruleName}</span>
                        <span className="block text-[11.5px] text-[#7a827c]">
                          {ACTION_LABEL[run.action as BulkAction] ?? run.action} · {run.succeeded} done{run.failed ? ` · ${run.failed} failed` : ""} · {run.emailsSent} emailed ·{" "}
                          {run.trigger === "schedule" ? "scheduled" : "manual"}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11.5px] text-[#8a928c]">{formatRelative(run.startedAt)}</span>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <>
                {automation.rules.length === 0 && (
                  <p className="mb-4 rounded-[12px] bg-[#fafbf9] px-3.5 py-3 text-[13px] text-[#4b544e]">No rules yet. Start from a suggestion below or build your own.</p>
                )}
                <ul className="space-y-2.5">
                  {automation.rules.map((rule) => {
                    const matches = automation.matchesFor(rule, now);
                    const d = describeRule(rule, gigTitle, automation.templates);
                    const running = automation.runningId === rule.id;
                    return (
                      <li key={rule.id} className={`rounded-[14px] border p-3.5 ${rule.enabled ? "border-[#c9e3d2] bg-[#f7fbf8]" : "border-[#e3e5e1]"}`}>
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[13.5px] font-semibold text-[#1a201c]">{rule.name}</span>
                              {rule.enabled && <StatusChip tone="success" label="Auto-run on" />}
                            </div>
                            <p className="mt-1 text-[12px] leading-5 text-[#4b544e]">
                              <span className="font-semibold text-[#8a928c]">When </span>
                              {d.when}
                              <br />
                              <span className="font-semibold text-[#8a928c]">Then </span>
                              {d.then}
                            </p>
                          </div>
                          <Toggle
                            checked={rule.enabled}
                            disabled={pendingId === rule.id}
                            onChange={(v) => void attempt(rule.id, () => automation.setAuto(rule, v))}
                            label={`Auto-run ${rule.name}`}
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            className={`${btnPrimary} h-8 px-2.5 text-[12.5px]`}
                            disabled={!matches.length || busy || !!automation.runningId}
                            onClick={() => setConfirm({ rule, targets: matches })}
                          >
                            {running ? <Spinner /> : <Icon d={ICONS.send} className="h-3.5 w-3.5" />}
                            {running ? "Running…" : `Run now · ${matches.length}`}
                          </button>
                          <button
                            type="button"
                            className={`${btnGhost} h-8 px-2.5 text-[12.5px]`}
                            disabled={!matches.length}
                            onClick={() => {
                              onSelectMatches(matches.map((a) => a.id));
                              onClose();
                            }}
                          >
                            Select matches
                          </button>
                          <button type="button" className={`${btnGhost} h-8 px-2.5 text-[12.5px]`} onClick={() => setEditing(rule)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`${btnIcon} ml-auto text-[#b42318]`}
                            disabled={pendingId === rule.id}
                            onClick={() => void attempt(rule.id, () => automation.deleteRule(rule.id))}
                            aria-label={`Delete ${rule.name}`}
                          >
                            <Icon d={ICONS.x} className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="mt-2 text-[11.5px] text-[#6b746e]">
                          {rule.enabled
                            ? `Handles new matches automatically, up to ${rule.maxPerRun} per scheduled run. Matches that existed when auto-run was switched on are left alone.`
                            : "Manual only. Switch on auto-run to let the scheduler handle new matches."}
                          {rule.lastRunAt ? ` Last run ${formatRelative(rule.lastRunAt)}.` : ""}
                        </p>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-6">
                  <SectionLabel>Suggestions</SectionLabel>
                  <div className="mt-2 grid gap-2">
                    {SUGGESTED.map((s) => (
                      <button key={s.name} type="button" onClick={() => newRule(s)} className="rounded-[12px] border border-dashed border-[#d9ddd8] px-3.5 py-2.5 text-left hover:border-[#2e7d4f] hover:bg-[#f7fbf8]">
                        <span className="block text-[13px] font-semibold text-[#1a201c]">{s.name}</span>
                        <span className="block text-[12px] text-[#7a827c]">
                          {describeRule(s, gigTitle, automation.templates).when} → {ACTION_LABEL[s.action]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </Drawer>

      {confirm && (
        <ConfirmDialog
          icon={ICONS.send}
          title={`${ACTION_LABEL[confirm.rule.action]} ${confirm.targets.length} application${confirm.targets.length === 1 ? "" : "s"}?`}
          body={<>Rule “{confirm.rule.name}” runs on the server now. Workers are notified when their status or message changes.</>}
          confirmLabel={`Run on ${confirm.targets.length}`}
          tone={confirm.rule.action === "Rejected" ? "danger" : "primary"}
          busy={busy || !!automation.runningId}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const { rule } = confirm;
            setConfirm(null);
            void attempt(rule.id, () => automation.run(rule));
          }}
        >
          <div className="mt-3 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {confirm.targets.map((a) => (
              <span key={a.id} className="rounded-[999px] bg-[#f1f3f0] px-2 py-0.5 text-[12px] text-[#1a201c]">
                {a.workerName ?? a.workerId}
              </span>
            ))}
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}

function RuleEditor({
  rule,
  gigs,
  templates,
  apps,
  saving,
  onCancel,
  onSave,
}: {
  rule: RuleDraft;
  gigs: { id: string; title: string }[];
  templates: MessageTemplate[];
  apps: AppLike[];
  saving: boolean;
  onCancel: () => void;
  onSave: (rule: RuleDraft) => void;
}) {
  const [draft, setDraft] = useState(rule);
  const c = draft.conditions;
  const setC = (patch: Partial<RuleConditions>) => setDraft((d) => ({ ...d, conditions: { ...d.conditions, ...patch } }));
  const select = "h-10 w-full rounded-[10px] border bg-[#fff] px-3 text-[13px]";
  const label = "block text-[12.5px] font-medium text-[#1a201c]";

  return (
    <div className="space-y-4">
      <label className={label}>
        Rule name
        <input className={`${fieldClass} mt-1.5 h-10`} maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Fast-track Instagram applicants" />
      </label>

      <fieldset className="rounded-[14px] border border-[#e3e5e1] p-3.5">
        <legend className="px-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#8a928c]">When an application…</legend>
        <div className="space-y-3">
          <div>
            <span className={label}>Has status</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {RULE_STATUSES.map((s) => {
                const on = c.statuses.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setC({ statuses: on ? c.statuses.filter((x) => x !== s) : [...c.statuses, s] })}
                    className={`rounded-[999px] px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset ${on ? "bg-[#1f2b24] text-[#fff] ring-[#1f2b24]" : "bg-[#fff] text-[#4b544e] ring-[#d9ddd8]"}`}
                  >
                    {s}
                  </button>
                );
              })}
              {!c.statuses.length && <span className="self-center text-[11.5px] text-[#8a928c]">Any status</span>}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              Gig
              <select className={`${select} mt-1.5`} value={c.gigId} onChange={(e) => setC({ gigId: e.target.value })}>
                <option value="any">Any gig</option>
                {gigs.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Idle for at least
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={365}
                  className={`${fieldClass} h-10`}
                  value={c.minAgeDays ?? ""}
                  onChange={(e) => setC({ minAgeDays: e.target.value === "" ? null : Math.max(0, Math.min(365, Number(e.target.value))) })}
                  placeholder="Any"
                />
                <span className="shrink-0 text-[12.5px] text-[#616a64]">days</span>
              </div>
            </label>
            <label className={label}>
              WhatsApp invite
              <select className={`${select} mt-1.5`} value={c.invite} onChange={(e) => setC({ invite: e.target.value as RuleConditions["invite"] })}>
                <option value="any">Any</option>
                <option value="missing">Not sent yet</option>
                <option value="sent">Already sent</option>
              </select>
            </label>
            <label className={label}>
              Joined group
              <select className={`${select} mt-1.5`} value={c.joined} onChange={(e) => setC({ joined: e.target.value as RuleConditions["joined"] })}>
                <option value="any">Any</option>
                <option value="no">Not joined</option>
                <option value="yes">Joined</option>
              </select>
            </label>
            <label className={`${label} sm:col-span-2`}>
              Proposal
              <select className={`${select} mt-1.5`} value={c.proposal} onChange={(e) => setC({ proposal: e.target.value as RuleConditions["proposal"] })}>
                <option value="any">Any</option>
                <option value="with">Submitted a proposal</option>
                <option value="without">No proposal (direct apply)</option>
              </select>
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-[14px] border border-[#e3e5e1] p-3.5">
        <legend className="px-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#8a928c]">Then…</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Action
            <select className={`${select} mt-1.5`} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value as BulkAction })}>
              {(Object.keys(ACTION_LABEL) as BulkAction[]).map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Message
            <select className={`${select} mt-1.5`} value={draft.templateId ?? "keep"} onChange={(e) => setDraft({ ...draft, templateId: e.target.value === "keep" ? null : e.target.value })}>
              <option value="keep">Keep each worker&apos;s current message</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  Template: {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className={`${label} sm:col-span-2`}>
            Max per scheduled run
            <input
              type="number"
              min={1}
              max={100}
              className={`${fieldClass} mt-1.5 h-10 sm:w-32`}
              value={draft.maxPerRun}
              onChange={(e) => setDraft({ ...draft, maxPerRun: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
            />
          </label>
        </div>
        {draft.action === "push" && !draft.templateId && (
          <p className="mt-2 text-[11.5px] text-[#9a5b00]">“Push message” with no template re-sends each worker&apos;s existing instructions.</p>
        )}
      </fieldset>

      <RuleMatchPreview conditions={c} apps={apps} />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={btnGhost} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} disabled={!draft.name.trim() || saving} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>
          {saving ? <Spinner /> : null}
          Save rule
        </button>
      </div>
    </div>
  );
}

/** Live count against all applications for the conditions being edited. */
function RuleMatchPreview({ conditions, apps }: { conditions: RuleConditions; apps: AppLike[] }) {
  const [now] = useState(() => Date.now());
  const matches = useMemo(() => apps.filter((a) => matchesConditions(a, conditions, now)), [apps, conditions, now]);
  return (
    <div className="rounded-[12px] bg-[#fafbf9] px-3.5 py-3">
      <div className="text-[13px] font-semibold text-[#1a201c]">
        {matches.length} application{matches.length === 1 ? "" : "s"} match right now
      </div>
      {matches.length > 0 && (
        <div className="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
          {matches.slice(0, 30).map((a) => (
            <span key={a.id} className="rounded-[999px] bg-[#fff] px-2 py-0.5 text-[11.5px] text-[#4b544e] ring-1 ring-inset ring-[#e3e5e1]">
              {a.workerName ?? a.workerId}
            </span>
          ))}
          {matches.length > 30 && <span className="text-[11.5px] text-[#8a928c]">+{matches.length - 30}</span>}
        </div>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-[999px] transition disabled:opacity-50 ${checked ? "bg-[#2e7d4f]" : "bg-[#d9ddd8]"}`}
    >
      <span className={`inline-block size-5 rounded-full bg-[#fff] shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

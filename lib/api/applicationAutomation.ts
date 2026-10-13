import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ApiError, databaseError } from "@/lib/api/errors";
import { applyApplicationUpdate, decodeWorkerName, type ApplicationUpdates, type ProposalPayload } from "@/lib/api/gigApplications";
import { ACTIONS, matchesConditions, sanitizeConditions, type BulkAction, type MatchableApplication, type RuleConditions } from "@/lib/applicationAutomationRules";

export type TemplateDto = {
  id: string;
  name: string;
  adminNote: string;
  adminExplanation: string;
  whatsappLink: string;
  onboardingSteps: string;
  updatedAt: string;
};

export type RuleDto = {
  id: string;
  name: string;
  conditions: RuleConditions;
  action: BulkAction;
  templateId: string | null;
  enabled: boolean;
  ownerId: string;
  maxPerRun: number;
  lastRunAt: string | null;
  handledCount?: number;
};

export type RunDto = {
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

type Row = Record<string, unknown>;
type AutomationApplication = MatchableApplication & { workerId: string; workerName?: string; proposal: ProposalPayload };

const PAGE = 1000;
const MANUAL_RUN_CAP = 200;
const SCHEDULE_TOTAL_CAP = 200;

export const toTemplateDto = (r: Row): TemplateDto => ({
  id: String(r.id),
  name: String(r.name),
  adminNote: String(r.admin_note ?? ""),
  adminExplanation: String(r.admin_explanation ?? ""),
  whatsappLink: String(r.whatsapp_link ?? ""),
  onboardingSteps: String(r.onboarding_steps ?? ""),
  updatedAt: String(r.updated_at),
});

export const toRuleDto = (r: Row): RuleDto => ({
  id: String(r.id),
  name: String(r.name),
  conditions: sanitizeConditions(r.conditions),
  action: ACTIONS.includes(r.action as BulkAction) ? (r.action as BulkAction) : "Pending",
  templateId: r.template_id ? String(r.template_id) : null,
  enabled: !!r.enabled,
  ownerId: String(r.owner_id),
  maxPerRun: Number(r.max_per_run ?? 25),
  lastRunAt: r.last_run_at ? String(r.last_run_at) : null,
});

export const toRunDto = (r: Row): RunDto => ({
  id: String(r.id),
  ruleId: r.rule_id ? String(r.rule_id) : null,
  ruleName: String(r.rule_name),
  trigger: r.trigger === "schedule" ? "schedule" : "manual",
  action: String(r.action),
  matched: Number(r.matched ?? 0),
  succeeded: Number(r.succeeded ?? 0),
  failed: Number(r.failed ?? 0),
  emailsSent: Number(r.emails_sent ?? 0),
  startedAt: String(r.started_at),
  finishedAt: r.finished_at ? String(r.finished_at) : null,
});

/** Reads every row of a query in pages so large installations never silently truncate. */
async function selectAll(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { code?: string; message?: string } | null }>) {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    databaseError(error);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export async function loadAutomationApplications(): Promise<AutomationApplication[]> {
  const sb = supabaseAdmin();
  const rows = await selectAll((from, to) =>
    sb.from("gig_applications").select("id,gig_id,worker_code,worker_name,status,applied_at,decided_at").order("applied_at", { ascending: false }).range(from, to),
  );
  return rows.map((r) => {
    const decoded = decodeWorkerName(r.worker_name);
    return {
      id: String(r.id),
      gigId: String(r.gig_id),
      workerId: String(r.worker_code),
      workerName: decoded.workerName,
      status: String(r.status),
      appliedAt: String(r.applied_at),
      decidedAt: r.decided_at ? String(r.decided_at) : undefined,
      proposal: decoded.proposal ?? {},
    };
  });
}

/** Builds the same update the admin console sends when a recruiter acts on an application. */
export function buildAutomationUpdate(app: AutomationApplication, action: BulkAction, template: TemplateDto | null): ApplicationUpdates {
  const status = action === "push" ? app.status : action;
  const now = new Date().toISOString();
  const reviewStatus = status === "Rejected" ? "Rejected" : status === "Accepted" ? "Accepted" : "Pending";
  const prev = app.proposal ?? {};
  const proposal: ProposalPayload = {
    ...prev,
    submittedAt: prev.submittedAt ?? app.appliedAt,
    reviewStatus,
    adminNote: template ? template.adminNote : (prev.adminNote ?? ""),
    adminExplanation: template ? template.adminExplanation : (prev.adminExplanation ?? ""),
    // An empty template link never wipes a link the worker already received.
    whatsappLink: template?.whatsappLink.trim() ? template.whatsappLink : (prev.whatsappLink ?? ""),
    onboardingSteps: template ? template.onboardingSteps : (prev.onboardingSteps ?? ""),
    reviewedAt: now,
  };
  return {
    status,
    decidedAt: now,
    workerName: app.workerName ?? app.workerId,
    proposal,
    ...(action === "push" ? { notificationMode: proposal.whatsappLink?.trim() ? "whatsapp_invite" : "workflow_update" } : {}),
  };
}

async function loadTemplate(id: string | null) {
  if (!id) return null;
  const { data, error } = await supabaseAdmin().from("application_message_templates").select("*").eq("id", id).maybeSingle();
  databaseError(error);
  if (!data) throw new ApiError(409, "This rule's message template no longer exists. Edit the rule and pick another template.", "template_missing");
  return toTemplateDto(data);
}

async function handledIds(ruleId: string) {
  const sb = supabaseAdmin();
  const rows = await selectAll((from, to) => sb.from("application_automation_handled").select("application_id").eq("rule_id", ruleId).range(from, to));
  return new Set(rows.map((r) => String(r.application_id)));
}

export async function ruleMatches(rule: RuleDto, apps?: AutomationApplication[]) {
  const all = apps ?? (await loadAutomationApplications());
  const now = Date.now();
  return all.filter((app) => matchesConditions(app, rule.conditions, now));
}

/** Marks every current match as intentionally skipped so auto-run only touches future arrivals. */
export async function baselineRule(rule: RuleDto) {
  const matches = await ruleMatches(rule);
  if (!matches.length) return 0;
  const { error } = await supabaseAdmin()
    .from("application_automation_handled")
    .upsert(
      matches.map((app) => ({ rule_id: rule.id, application_id: app.id, outcome: "baseline" })),
      { onConflict: "rule_id,application_id", ignoreDuplicates: true },
    );
  databaseError(error);
  return matches.length;
}

export type RunSummary = { runId: string; matched: number; succeeded: number; failed: number; emailsSent: number; failures: { applicationId: string; workerId: string; error: string }[] };

/**
 * Executes a rule.
 * - "new": only applications this rule has never handled, capped at maxPerRun. Each one is claimed in the
 *   ledger first (insert-if-absent), so overlapping scheduler invocations can never process it twice.
 * - "all": every current match (manual "Run now"), capped for safety.
 */
export async function runRule(rule: RuleDto, opts: { trigger: "manual" | "schedule"; actorId: string; mode: "new" | "all"; budget?: number }): Promise<RunSummary> {
  const sb = supabaseAdmin();
  const template = await loadTemplate(rule.templateId);
  const apps = await loadAutomationApplications();
  let targets = await ruleMatches(rule, apps);
  const matched = targets.length;
  const cap = Math.min(opts.mode === "new" ? rule.maxPerRun : MANUAL_RUN_CAP, opts.budget ?? Infinity);

  if (opts.mode === "new") {
    const seen = await handledIds(rule.id);
    targets = targets.filter((app) => !seen.has(app.id)).slice(0, cap);
    if (targets.length) {
      const { data, error } = await sb
        .from("application_automation_handled")
        .upsert(
          targets.map((app) => ({ rule_id: rule.id, application_id: app.id, outcome: "claimed" })),
          { onConflict: "rule_id,application_id", ignoreDuplicates: true },
        )
        .select("application_id");
      databaseError(error);
      const claimed = new Set((data ?? []).map((r) => String(r.application_id)));
      targets = targets.filter((app) => claimed.has(app.id));
    }
  } else {
    targets = targets.slice(0, cap);
    if (targets.length) {
      const { error } = await sb
        .from("application_automation_handled")
        .upsert(targets.map((app) => ({ rule_id: rule.id, application_id: app.id, outcome: "claimed", error: null, handled_at: new Date().toISOString() })), {
          onConflict: "rule_id,application_id",
        });
      databaseError(error);
    }
  }

  const { data: run, error: runError } = await sb
    .from("application_automation_runs")
    .insert({ rule_id: rule.id, rule_name: rule.name, trigger: opts.trigger, action: rule.action, actor_id: opts.actorId, matched })
    .select("id")
    .single();
  databaseError(runError);
  if (!run) throw new ApiError(503, "Unable to record the automation run.");

  const actor = { userId: opts.actorId, isAdmin: true, aliases: [] as string[] };
  const summary: RunSummary = { runId: String(run.id), matched, succeeded: 0, failed: 0, emailsSent: 0, failures: [] };

  for (const app of targets) {
    let outcome: "ok" | "failed" = "ok";
    let message: string | null = null;
    try {
      const result = await applyApplicationUpdate(actor, app.id, buildAutomationUpdate(app, rule.action, template));
      summary.succeeded += 1;
      if (result.mailStatus && "sent" in result.mailStatus && result.mailStatus.sent) summary.emailsSent += 1;
    } catch (error) {
      outcome = "failed";
      message = (error instanceof ApiError ? error.message : "Update failed.").slice(0, 500);
      summary.failed += 1;
      summary.failures.push({ applicationId: app.id, workerId: app.workerId, error: message });
    }
    await sb
      .from("application_automation_handled")
      .update({ outcome, error: message, handled_at: new Date().toISOString() })
      .eq("rule_id", rule.id)
      .eq("application_id", app.id);
  }

  const finishedAt = new Date().toISOString();
  await sb
    .from("application_automation_runs")
    .update({ succeeded: summary.succeeded, failed: summary.failed, emails_sent: summary.emailsSent, finished_at: finishedAt })
    .eq("id", summary.runId);
  await sb.from("application_automation_rules").update({ last_run_at: finishedAt }).eq("id", rule.id);
  return summary;
}

/** Scheduled entry point: runs every enabled rule for new matches only, within a global budget. */
export async function runScheduledAutomation() {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("application_automation_rules").select("*").eq("enabled", true).order("created_at");
  databaseError(error);
  const results: { ruleId: string; name: string; status: "ran" | "skipped"; reason?: string; summary?: Omit<RunSummary, "failures"> & { failures: number } }[] = [];
  let budget = SCHEDULE_TOTAL_CAP;
  for (const row of data ?? []) {
    const rule = toRuleDto(row);
    if (budget <= 0) {
      results.push({ ruleId: rule.id, name: rule.name, status: "skipped", reason: "budget_exhausted" });
      continue;
    }
    // Rules act as their owner; a former admin's rules must not keep acting.
    const permission = await sb.rpc("app_is_admin", { p_actor: rule.ownerId });
    if (permission.error || permission.data !== true) {
      results.push({ ruleId: rule.id, name: rule.name, status: "skipped", reason: "owner_not_admin" });
      continue;
    }
    try {
      const summary = await runRule(rule, { trigger: "schedule", actorId: rule.ownerId, mode: "new", budget });
      budget -= summary.succeeded + summary.failed;
      results.push({ ruleId: rule.id, name: rule.name, status: "ran", summary: { ...summary, failures: summary.failures.length } });
    } catch (error) {
      results.push({ ruleId: rule.id, name: rule.name, status: "skipped", reason: error instanceof ApiError ? error.code : "error" });
    }
  }
  return { ok: true, rules: results };
}

import "server-only";
import { ApiError } from "@/lib/api/errors";
import { ACTIONS, sanitizeConditions, type BulkAction } from "@/lib/applicationAutomationRules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, label = "ID") {
  const id = String(value ?? "");
  if (!UUID.test(id)) throw new ApiError(400, `A valid ${label} is required.`, "invalid_input");
  return id;
}

function text(value: unknown, label: string, max: number, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new ApiError(400, `${label} is required.`, "invalid_input");
    return "";
  }
  if (typeof value !== "string") throw new ApiError(400, `${label} must be text.`, "invalid_input");
  const out = value.trim();
  if (required && !out) throw new ApiError(400, `${label} is required.`, "invalid_input");
  if (out.length > max) throw new ApiError(400, `${label} must be at most ${max} characters.`, "invalid_input");
  return out;
}

export function parseTemplateInput(body: Record<string, unknown>) {
  const whatsappLink = text(body.whatsappLink, "WhatsApp link", 500);
  if (whatsappLink && !/^https:\/\//i.test(whatsappLink)) throw new ApiError(400, "The WhatsApp link must start with https://", "invalid_input");
  return {
    name: text(body.name, "Template name", 120, true),
    admin_note: text(body.adminNote, "Admin note", 2000),
    admin_explanation: text(body.adminExplanation, "Explanation", 4000),
    whatsapp_link: whatsappLink,
    onboarding_steps: text(body.onboardingSteps, "Onboarding steps", 4000),
  };
}

export function parseRuleInput(body: Record<string, unknown>) {
  if (!ACTIONS.includes(body.action as BulkAction)) throw new ApiError(400, "Pick a valid action.", "invalid_input");
  const maxPerRun = body.maxPerRun === undefined ? 25 : Number(body.maxPerRun);
  if (!Number.isInteger(maxPerRun) || maxPerRun < 1 || maxPerRun > 100) throw new ApiError(400, "Max per run must be between 1 and 100.", "invalid_input");
  return {
    name: text(body.name, "Rule name", 120, true),
    conditions: sanitizeConditions(body.conditions),
    action: body.action as BulkAction,
    template_id: body.templateId ? requireUuid(body.templateId, "template") : null,
    max_per_run: maxPerRun,
  };
}

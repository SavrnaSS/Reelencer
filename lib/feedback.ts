export const FEEDBACK_MIN_MESSAGE_LENGTH = 12;
export const FEEDBACK_MAX_MESSAGE_LENGTH = 2400;

export const FEEDBACK_CATEGORY_OPTIONS = [
  { value: "bug", label: "Bug", description: "Something is not working." },
  { value: "suggestion", label: "Suggestion", description: "Suggest a better flow or feature." },
  { value: "ux", label: "UX", description: "Layout, clarity, or navigation." },
  { value: "performance", label: "Performance", description: "Slow, laggy, or unstable." },
  { value: "content", label: "Content", description: "Copy, labels, or data." },
  { value: "other", label: "Other", description: "Anything else worth sharing." },
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORY_OPTIONS)[number]["value"];

const FEEDBACK_CATEGORY_SET = new Set<FeedbackCategory>(FEEDBACK_CATEGORY_OPTIONS.map((option) => option.value));

function normalizeText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizeFeedbackCategory(value: unknown): FeedbackCategory {
  const raw = normalizeText(value, 32).toLowerCase() as FeedbackCategory;
  return FEEDBACK_CATEGORY_SET.has(raw) ? raw : "other";
}

export function feedbackCategoryLabel(category?: string | null) {
  const raw = String(category ?? "").trim().toLowerCase();
  if (raw === "bug") return "Bug";
  if (raw === "suggestion") return "Suggestion";
  if (raw === "ux") return "UX";
  if (raw === "performance") return "Performance";
  if (raw === "content") return "Content";
  return "Other";
}

export function buildFeedbackSubject({
  section,
  category,
  rating,
}: {
  section?: string | null;
  category?: string | null;
  rating?: number | null;
}) {
  const safeSection = normalizeText(section, 64) || "Dashboard";
  const safeRating = typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
  const parts = [safeSection, feedbackCategoryLabel(category)];
  if (safeRating) parts.push(`${safeRating}/5`);
  return parts.join(" - ");
}

import { KYC_FREE_WITHDRAWAL_LIMIT_INR, payoutKycRequired } from "./payoutPolicy";

export type KycStatus = "none" | "pending" | "approved" | "rejected";

export type PayoutBlockerCode =
  | "kyc_missing"
  | "kyc_pending"
  | "kyc_rejected"
  | "upi_unverified"
  | "active_batch"
  | "weekly_limit"
  | "no_approved_items"
  | "below_minimum";

export type PayoutBlocker = {
  code: PayoutBlockerCode;
  title: string;
  detail: string;
};

export type PayoutReadiness = {
  ready: boolean;
  status: "ready" | "blocked";
  blockers: PayoutBlocker[];
  primaryBlocker: PayoutBlocker | null;
  /** What a request made now would withdraw. */
  requestAmount: number;
  /** Payouts are blocked until KYC is approved: the wallet has received more than the KYC-free limit in total. */
  kycRequired: boolean;
};

export function describeKycStatus(status: KycStatus, rejectionReason?: string | null) {
  switch (status) {
    case "approved":
      return {
        label: "Approved",
        tone: "success" as const,
        description: "Identity verification is approved. Payout compliance is clear on the KYC side.",
      };
    case "pending":
      return {
        label: "Pending review",
        tone: "warn" as const,
        description: "Your KYC is under review. This updates the moment the team decides.",
      };
    case "rejected":
      return {
        label: "Needs resubmission",
        tone: "danger" as const,
        description: rejectionReason
          ? `Your last KYC submission was rejected: ${rejectionReason}`
          : "Your last KYC submission was rejected. Update the details and resubmit.",
      };
    default:
      return {
        label: "Not started",
        tone: "neutral" as const,
        description: `Needed once your earnings pass ${formatINR(KYC_FREE_WITHDRAWAL_LIMIT_INR)}; payouts pause until it's approved.`,
      };
  }
}

type BuildPayoutReadinessInput = {
  kycStatus: KycStatus;
  kycRejectionReason?: string | null;
  upiVerified: boolean;
  hasActiveBatch: boolean;
  eligibleItemCount: number;
  eligibleAmount: number;
  minimumAmount: number;
  /** Everything the wallet has ever been credited (paid out, in a payout or available). Defaults to the balance. */
  lifetimeCredited?: number;
  /** Set while the 7-day manual withdrawal limit applies: when the next manual request opens. */
  nextManualAt?: Date | null;
};

export function buildPayoutReadiness(input: BuildPayoutReadinessInput): PayoutReadiness {
  const blockers: PayoutBlocker[] = [];
  const eligible = Math.max(0, input.eligibleAmount);
  const lifetime = Math.max(eligible, input.lifetimeCredited ?? eligible);
  // Once the wallet has received more than the limit in total, every payout waits for approved KYC.
  const kycRequired = payoutKycRequired(input.kycStatus === "approved", lifetime);
  if (kycRequired) {
    const needed = `Your earnings have passed ${formatINR(KYC_FREE_WITHDRAWAL_LIMIT_INR)}, so payouts need a one-time identity check.`;
    if (input.kycStatus === "pending") {
      blockers.push({ code: "kyc_pending", title: "KYC under review", detail: `${needed} Yours is being reviewed; payouts resume once it's approved.` });
    } else if (input.kycStatus === "rejected") {
      blockers.push({
        code: "kyc_rejected",
        title: "KYC requires correction",
        detail: input.kycRejectionReason ? `${needed} Fix and resubmit: ${input.kycRejectionReason}` : `${needed} Fix and resubmit your KYC.`,
      });
    } else {
      blockers.push({ code: "kyc_missing", title: "Verify your identity", detail: `${needed} It takes about 2 minutes.` });
    }
  }

  if (!input.upiVerified) {
    blockers.push({
      code: "upi_unverified",
      title: "UPI not verified",
      detail: "Verify a payout UPI ID before requesting funds.",
    });
  }

  if (input.hasActiveBatch) {
    blockers.push({
      code: "active_batch",
      title: "Active payout batch already exists",
      detail: "Wait for the current draft or processing payout batch to finish before opening a new request.",
    });
  } else if (input.nextManualAt) {
    blockers.push({
      code: "weekly_limit",
      title: "One manual withdrawal a week",
      detail: `Your next manual withdrawal opens ${formatWhen(input.nextManualAt)}. Your monthly auto-withdrawal still runs as usual.`,
    });
  }

  if (input.eligibleItemCount <= 0 || input.eligibleAmount <= 0) {
    blockers.push({
      code: "no_approved_items",
      title: "No approved earnings available",
      detail: "Approved work items must exist before a payout request can be created.",
    });
  } else if (input.eligibleAmount < input.minimumAmount) {
    blockers.push({
      code: "below_minimum",
      title: "Minimum payout threshold not reached",
      detail: `You need ${formatINR(input.minimumAmount - input.eligibleAmount)} more in approved earnings to request payout.`,
    });
  }

  return {
    ready: blockers.length === 0,
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    primaryBlocker: blockers[0] ?? null,
    requestAmount: blockers.length === 0 ? eligible : 0,
    kycRequired,
  };
}

function formatWhen(value: Date) {
  try {
    return value.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  } catch {
    return value.toISOString();
  }
}

function formatINR(value: number) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `₹${value}`;
  }
}

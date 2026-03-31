export type KycStatus = "none" | "pending" | "approved" | "rejected";

export type PayoutBlockerCode =
  | "kyc_missing"
  | "kyc_pending"
  | "kyc_rejected"
  | "upi_unverified"
  | "active_batch"
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
        description: "Your KYC packet is under admin review. Workspace remains available, but payout requests stay locked.",
      };
    case "rejected":
      return {
        label: "Needs resubmission",
        tone: "danger" as const,
        description: rejectionReason
          ? `Your last KYC submission was rejected: ${rejectionReason}`
          : "Your last KYC submission was rejected. Update the details and resubmit to unlock payouts.",
      };
    default:
      return {
        label: "Not started",
        tone: "neutral" as const,
        description: "KYC has not been submitted yet. Workspace is open, but payout requests require approved KYC.",
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
};

export function buildPayoutReadiness(input: BuildPayoutReadinessInput): PayoutReadiness {
  const blockers: PayoutBlocker[] = [];

  if (input.kycStatus === "none") {
    blockers.push({
      code: "kyc_missing",
      title: "KYC not submitted",
      detail: "Submit identity verification before requesting any payout release.",
    });
  } else if (input.kycStatus === "pending") {
    blockers.push({
      code: "kyc_pending",
      title: "KYC under review",
      detail: "Admin review must approve your KYC submission before payout requests can move forward.",
    });
  } else if (input.kycStatus === "rejected") {
    blockers.push({
      code: "kyc_rejected",
      title: "KYC requires correction",
      detail: input.kycRejectionReason
        ? `Fix and resubmit your KYC packet: ${input.kycRejectionReason}`
        : "Fix and resubmit your KYC packet before requesting payout.",
    });
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
  };
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

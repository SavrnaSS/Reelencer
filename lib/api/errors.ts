import { MIN_PAYOUT_REQUEST_INR } from "@/lib/payoutPolicy";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "request_failed") {
    super(message);
    this.name = "ApiError";
  }
}

export function databaseError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  // A table the code expects is missing: a migration has not been applied yet.
  if (error.code === "PGRST205" || error.code === "42P01") throw new ApiError(503, "A required database update has not been applied yet.", "schema_outdated");
  if (error.code === "23505") throw new ApiError(409, "This record already exists.", "conflict");
  if (error.code === "23503") throw new ApiError(409, "This record is still in use or references a missing record.", "conflict");
  if (["23514", "22P02", "22007"].includes(error.code ?? "")) throw new ApiError(400, "Invalid field value.", "invalid_input");
  if (error.code === "P0001") {
    // Only allow explicitly defined transaction errors to leave the server.
    const messages: Record<string, [number, string]> = {
      not_found: [404, "Record not found."],
      forbidden: [403, "Access denied."],
      invalid_transition: [409, "The record has changed or this action is no longer available."],
      profile_already_linked: [409, "This profile is already linked to another account. Ask the team to review it."],
      profile_account_limit: [409, "An account slot is needed before this profile can be linked again. Ask the team to review your linked accounts."],
      active_batch: [409, "A payout is in progress. Your payout details can be changed once it's finished."],
      weekly_limit: [429, "You can withdraw manually once every 7 days. Anything left is also withdrawn automatically each month."],
      kyc_required: [400, "One-time identity verification (KYC) is required for this."],
      upi_required: [400, "A verified payout method (bank account or UPI ID) is required."],
      invalid_payout_method: [400, "Check your payout details and try again."],
      minimum_amount: [400, `At least ₹${MIN_PAYOUT_REQUEST_INR.toLocaleString("en-IN")} in eligible earnings is required.`],
      invalid_view_rate: [400, "This gig needs a valid INR rate per 1,000 views before earnings can be claimed."],
      no_claimable_views: [409, "No new payable views are available. Approved reels need measured view counts."],
      claim_account_inactive: [409, "This account must be active to submit an earnings claim."],
      claim_reason_required: [400, "Enter a reason for rejecting this claim."],
      claim_evidence_changed: [409, "The reel approval or view counts changed. Review the evidence before approving this claim."],
      claim_review_reason_required: [400, "Describe the evidence checked and the reason for this review decision."],
      claim_authenticity_required: [400, "Complete the authenticity assessment. Adjusted approvals require a mixed assessment and view deductions."],
      invalid_view_adjustment: [400, "Check the excluded view counts. Each deduction must belong to this claim and stay within its claimed views."],
      claim_deduction_reason_required: [400, "Enter an evidence-based reason for every view deduction."],
      claim_no_eligible_views: [400, "No payable earnings remain. Use hard rejection to permanently exclude the covered views."],
      invalid_accounts: [400, "Submit five complete accounts using each assigned email once."],
      invalid_code: [403, "This access code is invalid, expired, blocked, or exhausted."],
      history_exists: [409, "This account has work history and cannot be deleted. Unassign it to stop new work."],
      worker_history_exists: [409, "This worker has work or verification history and cannot be permanently deleted."],
      worker_inactive: [409, "Restore this worker's access before assigning accounts or creating work."],
      worker_deleted: [409, "This worker has been deleted. Refresh applications before continuing."],
      documents_required: [400, "Upload your identity document and selfie before submitting verification."],
      reel_date_required: [409, "Add the reel's posting date before approving its earnings."],
      rate_changed: [409, "This reel already has earnings at a different payout basis. Review its wallet history before changing the rate type."],
      reel_wallet_owner_unknown: [409, "The account owner could not be verified. Correct the linked creator before approving earnings."],
      reel_wallet_basis_changed: [409, "This reel already has earnings at a different payout basis. Review its wallet history before changing the rate type."],
      reel_removed: [409, "This reel was removed. Restore it before changing its review."],
      weekly_application_limit: [429, "You've used both of this week's applications. A slot opens 7 days after each application."],
      reel_before_link: [409, "This reel went live before the account was linked. Only reels posted from the day it was linked can be approved."],
    };
    const match = messages[error.message ?? ""];
    if (match) throw new ApiError(match[0], match[1], error.message);
  }
  throw new ApiError(503, "The data service is unavailable. Please try again.", "database_unavailable");
}

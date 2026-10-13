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
      active_batch: [409, "A payout request is already in progress."],
      kyc_required: [400, "Approved identity verification is required."],
      upi_required: [400, "A verified UPI account is required."],
      minimum_amount: [400, "At least ₹1,000 in eligible earnings is required."],
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
      documents_required: [400, "Upload your identity document and selfie before submitting verification."],
    };
    const match = messages[error.message ?? ""];
    if (match) throw new ApiError(match[0], match[1], error.message);
  }
  throw new ApiError(503, "The data service is unavailable. Please try again.", "database_unavailable");
}

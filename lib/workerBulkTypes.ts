/** Client-safe contracts for bounded, reviewed worker moderation operations. */
export type BulkAction = "suspend" | "suspend_ip" | "restore" | "delete";
export type BulkPreviewItem = {
  workerId: string;
  userId: string | null;
  name: string;
  email: string;
  status: "active" | "suspended" | "deleted" | null;
  eligible: boolean;
  skipReason?: string;
  ip?: string;
};
export type BulkPreview = {
  token: string;
  expiresAt: string;
  action: BulkAction;
  items: BulkPreviewItem[];
  eligibleCount: number;
  skippedCount: number;
  canBlockIps: boolean;
};
export type BulkResultItem = {
  workerId: string;
  userId: string | null;
  name: string;
  status: "success" | "skipped" | "failed";
  message: string;
};
export type BulkResult = {
  operationId: string;
  action: BulkAction;
  items: BulkResultItem[];
  succeeded: number;
  skipped: number;
  failed: number;
};
export type BulkApplyRequest = {
  previewToken: string;
  operationId: string;
  reason: string;
  confirmation?: string;
  sharedNetworkConfirmed?: boolean;
};

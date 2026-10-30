# Approved reel earnings and the wallet

An explicit administrator approval credits eligible measured reel earnings to the withdrawal ledger in the same database transaction. The API uses `approve_social_post_and_credit`; manual saves use `save_social_post_with_wallet`. If the wallet migration is missing, approval fails clearly instead of saving a misleading, uncredited approval.

The transaction locks the creator profile, linked account and reel in that order. It checks ownership, account access, INR rate, posting date, the linking-day boundary and removal status. Each credit creates an Approved work item and an audit event. View credits also freeze an Approved claim and its measured interval. Content approval is recorded as its own approval method; it does not fabricate an organic-traffic assessment.

Pending, Approved and Hard rejected claim intervals remain consumed, including views excluded from mixed-authenticity reviews. Repeated approvals cannot pay those intervals again. New measured views are paid only after another explicit approval or claim review; ordinary sync does not move money. Flat per-post earnings have one deterministic ledger credit. Switching payout basis after credit requires reconciliation.

The wallet read model reports actual ledger-backed credits separately from estimates. Account credit totals include historical removed reels and have no browser row cap. New views and pending claims remain awaiting review. Older cached data is explicitly labelled as an estimate until verified ledger data arrives. Withdrawal availability still comes from the server's unreserved Approved work items; identity verification, verified UPI, the minimum balance and active-request checks remain required.

## Existing approved view earnings

Apply `202610300001_approved_reel_wallet_credit.sql` and `202610300002_social_wallet_read_model.sql` after their preceding tracking/removal migrations. These migrations install the transaction and read model; they do not credit historical rows on installation.

`npm run wallet:reconcile` gives a read-only aggregate preview of eligible, already-approved view earnings. `npm run wallet:reconcile -- --apply` credits the current eligible remainder in one transaction, using the uniquely configured database administrator. With multiple administrators, pass `--actor UUID` explicitly. The command preserves existing claim reservations, deductions, withdrawals and paid history, records an operator reconciliation audit event, and prints aggregate results only. It can be repeated safely: an already-covered interval has no new credit. Historical fixed-per-post earnings require an explicit team review because older manual credits may not identify individual reels.

Rejecting or removing a reel does not silently rewrite money already credited or paid. The ledger and its evidence remain available for an explicit financial review.

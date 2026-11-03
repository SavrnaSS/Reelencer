# Creator payout plans

Admins can give selected creators their own pay terms instead of the gig's plain rate per 1,000 views. A plan sets a **base pay per approved reel**, a **view threshold**, and what happens past it:

| After the threshold | Pays | Example (₹200 base, 10K threshold, ₹49 / 1K) |
| --- | --- | --- |
| **Switch to the view rate** (default) | the base up to the threshold, then the rate on *all* views (never less than the base) | 4K → ₹200 · 10K → ₹200 · 12.5K → ₹612.50 |
| **Base + rate on extra views** | the base, plus the rate on views *above* the threshold | 4K → ₹200 · 10K → ₹200 · 12.5K → ₹322.50 |

The rate is the plan's own rate, or the gig's when left empty. A plan can cover every view-based gig or just one.

## Using it

Workers → select creators (filters and quick views help) → **Payout plan** in the selection bar. The toolbar's plan icon opens the same panel without a selection.

- Create or edit a plan. The preview compares it with standard pay at any view count, shows a chart and a checkpoint table, and flags where standard pay would pay more.
- **Apply** the plan to the selection, choosing the first posting date it covers (India time). A creator is on at most one plan; applying moves them from any other plan.
- Remove creators individually, or the whole selection, to return them to standard pay. Pausing a plan does the same for new reels without losing its member list.
- Directory rows show a plan chip, and the Filters panel can show creators on a given plan or on standard pay.

Creators see their plan on the account's earnings card ("Your payout plan: …"), and estimates use it everywhere they appear.

## How the money works

`supabase/migrations/202611030001_creator_payout_plans.sql` adds the plan tables and changes the earnings functions so they work out what each reel is owed with `social_post_payout_due`. Approval credits, creator claims, claim review, the wallet read model and `npm run wallet:reconcile` all use it.

- **Terms freeze per reel.** The terms in force when a reel's first earnings interval is frozen (at approval or claim) are stored on that interval, and the reel's later growth always uses them. Editing, pausing, reassigning or removing a plan therefore only affects reels that haven't started earning. Credited money is never rewritten.
- **The base is paid with the first interval**, on approval, even before Instagram exposes a view count. Later intervals pay `f(to) − f(from)` with cumulative paise rounding, as plain reels always have.
- **Reviews:** excluding views in a mixed review only removes view earnings, never the base. A soft rejection releases the interval, so the base can be claimed again. A hard rejection consumes it, so the base is forfeited and only growth past it can earn.
- **Plain reels are unchanged.** Reels without a plan keep following the gig's current rate, exactly as before.
- Plan changes, assignments and removals are recorded in `audit_events` (`payout_plan_saved`, `payout_plan_assigned`, `payout_plan_removed`), and plan credits record their terms on the claim interval and work item.

Apply the migration with `npm run db:migrate`. Until then the panel shows that the database update is missing, and earnings behave exactly as before.

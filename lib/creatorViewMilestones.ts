import { countedReels } from "./reelTracking";
import { reelViewSummary, type LinkedSocialAccount } from "./socialAnalytics";

export const FIRST_VIEW_MILESTONE = 1_000;

// Continue the same approachable 1 / 2.5 / 5 ladder as a creator's views grow.
const VIEW_MILESTONES: number[] = [];
for (let scale = FIRST_VIEW_MILESTONE; Number.isSafeInteger(scale); scale *= 10) {
  for (const step of [1, 2.5, 5]) {
    const target = scale * step;
    if (Number.isSafeInteger(target)) VIEW_MILESTONES.push(target);
  }
}

/** Always return the first unfinished goal, including when one update crosses several goals. */
export function nextViewMilestone(total: number | undefined) {
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) return undefined;
  const index = VIEW_MILESTONES.findIndex(target => target > total);
  if (index < 0) return undefined;
  const target = VIEW_MILESTONES[index];
  const progress = total / target;
  return {
    target,
    previousTarget: VIEW_MILESTONES[index - 1],
    nextTarget: VIEW_MILESTONES[index + 1],
    remaining: target - total,
    progress,
    percent: Math.min(99, Math.round(progress * 100)),
  };
}

/** Goals use measured reel totals for this account, independently of follower or period insights. */
export function creatorViewMilestone(account: Pick<LinkedSocialAccount, "posts" | "linkedAt">) {
  const reels = countedReels(account.posts, account.linkedAt).filter(post => post.status !== "rejected");
  const summary = reelViewSummary(reels);
  return { ...summary, milestone: nextViewMilestone(summary.total), totalReels: reels.length };
}

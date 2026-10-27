"use client";

import { useId, useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api/client";
import { accountPlatformFor, normalizeHandle, validateAccountOwnership } from "@/lib/accountSetup";
import type { LinkedSocialAccount } from "@/lib/socialAnalytics";
import { Button, cx, Icon } from "./dashboardUi";
import PlatformGlyph from "./PlatformGlyph";

export function AccountRecoveryNotice({ count, onReview }: { count: number; onReview: () => void }) {
  if (!count) return null;
  return (
    <div role="status" className="mx-auto mb-4 flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ecd8a8] bg-[#fffbf2] p-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon.Shield className="mt-0.5 h-5 w-5 shrink-0 text-[#9a6b1c]" />
        <div><p className="text-[13px] font-semibold text-[#624b21]">{count === 1 ? "A linked profile needs verification" : `${count} linked profiles need verification`}</p><p className="mt-1 text-[12px] leading-5 text-[#7f7158]">We could not find {count === 1 ? "this profile" : "these profiles"} on the platform. Review the details to link {count === 1 ? "it" : "them"} again.</p></div>
      </div>
      <Button size="sm" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={onReview}>Review {count === 1 ? "account" : "accounts"}<Icon.ChevronRight className="h-4 w-4" /></Button>
    </div>
  );
}

/** Missing accounts are shown separately from Linked; recovery never deletes their saved work. */
export default function LinkedAccountRecovery({ account, admin = false, onChange }: { account: LinkedSocialAccount; admin?: boolean; onChange: (account: LinkedSocialAccount, message: string) => void }) {
  const id = useId();
  const platform = accountPlatformFor(account.platform);
  const health = account.profileHealth;
  const request = health?.recovery;
  const [expanded, setExpanded] = useState(admin);
  const [handle, setHandle] = useState(request?.handle ?? account.handle);
  const [profileUrl, setProfileUrl] = useState(request?.profileUrl ?? (account.profileUrl || platform.profileUrl(account.handle)));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const code = health?.verifyCode;
  const targetUrl = request?.profileUrl ?? account.profileUrl;

  const recover = async (event: FormEvent) => {
    event.preventDefault();
    const problem = Object.values(validateAccountOwnership({ handle, profileUrl }, platform))[0];
    if (!admin && problem) { setError(problem); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await apiFetch(admin ? "/api/admin/social-accounts" : "/api/social-accounts", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify(admin ? { action: "restore_profile", accountId: account.id, ownershipConfirmed: confirmed, handle: request?.handle, submittedAt: request?.submittedAt }
          : { action: "recover_profile", accountId: account.id, handle: normalizeHandle(handle, platform), profileUrl: profileUrl.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.account) throw new Error(payload?.error || "Verification could not finish. Please try again.");
      const message = payload.message || `@${payload.account.handle} is verified and linked again.`;
      setNotice(message);
      onChange(payload.account, message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Verification could not finish."); }
    finally { setBusy(false); }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="@container min-w-0 overflow-hidden rounded-2xl border border-[#e7d8ba] bg-white">
      <div className="flex flex-wrap items-start gap-3 px-4 py-4 sm:px-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f6eddb] text-[#8b672e]"><PlatformGlyph platform={platform} className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h3 id={`${id}-title`} className="break-all text-[14px] font-semibold text-[#28332a]">@{account.handle}</h3><span className="rounded-full bg-[#fff2d9] px-2 py-0.5 text-[10px] font-semibold text-[#896326]">{request?.manualReview ? "Verification requested" : "Profile not found"}</span></div>
          <p className="mt-1 break-words text-[11.5px] text-[#7f897c]">{platform.label}{account.gigTitle ? ` · ${account.gigTitle}` : ""}</p>
          <p className="mt-2 max-w-[80ch] text-[12.5px] leading-5 text-[#616b5c]">This profile could not be found and has been removed from Linked. Verify it again or correct its username to restore the link.</p>
        </div>
        {!admin ? <Button size="sm" variant="secondary" className="min-h-11 w-full @lg:w-auto" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={`${id}-form`}>{expanded ? "Close verification" : "Verify or correct profile"}<Icon.ChevronDown className={cx("h-4 w-4", expanded && "rotate-180")} /></Button> : null}
      </div>

      {expanded ? (
        <form id={`${id}-form`} onSubmit={recover} className="border-t border-[#f0e8d9] bg-[#fdfcf8] px-4 py-4 sm:px-5">
          {admin ? (
            <div className="mb-4 space-y-2 text-[12.5px] leading-5 text-[#596750]">
              <p>{request ? <>Creator requested verification for <strong className="break-all">@{request.handle}</strong>.</> : "The creator can submit a correction from Accounts. A verification request is needed before this profile can be restored."}</p>
              {targetUrl ? <a href={targetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 font-semibold text-[#35634b]">Open profile to verify <Icon.External className="h-3.5 w-3.5" /></a> : null}
            </div>
          ) : (
            <div className="mb-4 grid min-w-0 gap-3 @xl:grid-cols-2">
              <label className="min-w-0 text-[11.5px] font-semibold text-[#4e5b44]" htmlFor={`${id}-handle`}>Username
                <input id={`${id}-handle`} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={120} required disabled={busy} value={handle} onChange={event => { setHandle(event.target.value); setProfileUrl(platform.profileUrl(normalizeHandle(event.target.value, platform))); setError(null); }} className="mt-1.5 h-11 w-full rounded-lg border border-[#d9dfd2] bg-white px-3 text-[16px] font-normal text-[#243520] outline-none focus:border-[#588461] focus:ring-2 focus:ring-[#588461]/15 @md:text-[13px]" />
              </label>
              <label className="min-w-0 text-[11.5px] font-semibold text-[#4e5b44]" htmlFor={`${id}-url`}>Profile link
                <input id={`${id}-url`} type="url" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={300} required disabled={busy} value={profileUrl} onChange={event => { setProfileUrl(event.target.value); setError(null); }} className="mt-1.5 h-11 w-full rounded-lg border border-[#d9dfd2] bg-white px-3 text-[16px] font-normal text-[#243520] outline-none focus:border-[#588461] focus:ring-2 focus:ring-[#588461]/15 @md:text-[13px]" />
              </label>
            </div>
          )}

          {code ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e3e8db] bg-white p-3.5"><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold text-[#607056]">{admin ? "Find this code in the profile bio" : "Add this code to your profile bio"}</p><code className="mt-1 block select-all text-[18px] font-semibold tracking-[0.08em] text-[#2e5739]">{code}</code></div><Button size="sm" variant="secondary" className="min-h-11" onClick={async () => { try { await navigator.clipboard.writeText(code); setNotice("Verification code copied."); } catch { setNotice("Select the code to copy it."); } }}><Icon.Clipboard className="h-3.5 w-3.5" />Copy code</Button></div> : null}
          {!admin ? <p className="mt-2 text-[11.5px] leading-5 text-[#79826f]">Keep the code in the bio until verification is complete. Correct your existing profile here; a different account needs a new approval.</p> : null}
          {request?.message ? <p className="mt-3 rounded-lg bg-[#f3eedf] px-3 py-2 text-[12px] leading-5 text-[#7b6437]">{request.message}</p> : null}
          {admin ? <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[12px] leading-5 text-[#4d6047]"><input type="checkbox" checked={confirmed} disabled={busy || !request || request.blocked} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#39694b]" /><span>I opened the requested profile and confirmed the verification code in its bio.</span></label> : null}
          {error ? <p role="alert" className="mt-3 rounded-lg border border-[#f0d3ca] bg-[#fff7f3] px-3 py-2 text-[12px] leading-5 text-[#983a25]">{error}</p> : null}
          <p role="status" className="mt-2 min-h-5 text-[12px] leading-5 text-[#396a43]">{notice}</p>
          <div className="mt-2 flex flex-col-reverse gap-3 @lg:flex-row @lg:items-center @lg:justify-between"><p className="text-[11px] leading-5 text-[#7e8876]">Your existing reels and earnings remain saved.</p><Button type="submit" variant="primary" size="sm" className="min-h-11 w-full @lg:w-auto" disabled={busy || !code || (admin && (!confirmed || !request || request.blocked))}>{busy ? "Verifying…" : admin ? "Verify and restore link" : "Verify profile"}<Icon.ChevronRight className="h-4 w-4" /></Button></div>
        </form>
      ) : null}
    </section>
  );
}

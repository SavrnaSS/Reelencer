"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type StepState = "pending" | "active" | "done" | "error";
type ProgressStep = { id: string; label: string; state: StepState };
type PostLoginResponse = { redirectTo?: string; error?: string };

function parsePostLoginResponse(text: string): PostLoginResponse | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    return {
      redirectTo: typeof obj.redirectTo === "string" ? obj.redirectTo : undefined,
      error: typeof obj.error === "string" ? obj.error : undefined,
    };
  } catch {
    return null;
  }
}

export default function PostLoginPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("Preparing secure session...");
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);

  const steps = useMemo<ProgressStep[]>(() => {
    const makeState = (step: 1 | 2 | 3): StepState => {
      if (error && step === activeStep) return "error";
      if (step < activeStep) return "done";
      if (step === activeStep) return "active";
      return "pending";
    };

    return [
      { id: "session", label: "Validate session", state: makeState(1) },
      { id: "profile", label: "Provision profile", state: makeState(2) },
      { id: "redirect", label: "Load destination", state: makeState(3) },
    ];
  }, [activeStep, error]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setActiveStep(1);
      setMsg("Validating your sign-in session...");
      setError(null);

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;

      const session = data?.session;
      if (sessionError || !session?.access_token) {
        setError("No active session found.");
        setMsg("Redirecting to sign in...");
        router.replace("/login");
        return;
      }

      setActiveStep(2);
      setMsg("Provisioning account profile...");

      const res = await fetch("/api/post-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const text = await res.text();
      const payload = parsePostLoginResponse(text);

      if (!res.ok || !payload?.redirectTo) {
        const reason = payload?.error || `Post-login failed (HTTP ${res.status}).`;
        setError(reason);
        setMsg("Redirecting to sign in...");
        router.replace("/login");
        return;
      }

      setActiveStep(3);
      setMsg("Redirecting to your workspace...");
      router.replace(payload.redirectTo);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#dbeafe,transparent_48%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(180deg,rgba(15,23,42,0.04)_1px,transparent_1px)] bg-[size:54px_54px]" />

      <div className="relative mx-auto grid min-h-screen w-full max-w-3xl place-items-center px-4 py-8 sm:px-6">
        <div className="w-full rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-xl shadow-slate-200/70 backdrop-blur sm:p-8">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#0b5cab] text-sm font-black text-white">RG</div>
            <div>
              <div className="text-lg font-bold text-slate-900">Setting up your workspace</div>
              <div className="text-xs text-slate-500">Secure redirect and profile initialization in progress</div>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {steps.map((step) => (
              <div key={step.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <span
                  className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${
                    step.state === "done"
                      ? "bg-emerald-100 text-emerald-700"
                      : step.state === "active"
                        ? "bg-blue-100 text-blue-700"
                        : step.state === "error"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {step.state === "done" ? "✓" : step.state === "error" ? "!" : step.id === "session" ? "1" : step.id === "profile" ? "2" : "3"}
                </span>
                <div className="text-sm font-semibold text-slate-800">{step.label}</div>
              </div>
            ))}
          </div>

          <div
            className={`mt-5 rounded-2xl border px-4 py-3 text-sm font-medium ${
              error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-blue-200 bg-blue-50 text-blue-700"
            }`}
          >
            {msg}
            {error ? ` ${error}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

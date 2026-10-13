"use client";

type AuthFeedbackTone = "error" | "success";

export function AuthFeedback({
  message,
  tone,
  className = "",
}: {
  message: string;
  tone: AuthFeedbackTone;
  className?: string;
}) {
  const isError = tone === "error";

  return (
    <div
      className={`auth-feedback auth-feedback--${tone} ${className}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      <span className="auth-feedback__glow" aria-hidden="true" />
      <span className="auth-feedback__icon" aria-hidden="true">
        {isError ? "!" : "✓"}
      </span>
      <span className="auth-feedback__message">{message}</span>
      <span className="auth-feedback__dot auth-feedback__dot--one" aria-hidden="true" />
      <span className="auth-feedback__dot auth-feedback__dot--two" aria-hidden="true" />
      <span className="auth-feedback__dot auth-feedback__dot--three" aria-hidden="true" />
    </div>
  );
}

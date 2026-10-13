// How long Supabase email links (sign-up confirmation, password reset) stay valid. Supabase's default is 1 hour
// (Auth → Providers → Email → "Email OTP Expiration"); set NEXT_PUBLIC_AUTH_LINK_HOURS to match if you change it.
export const AUTH_LINK_HOURS = Math.min(24, Math.max(1, Math.floor(Number(process.env.NEXT_PUBLIC_AUTH_LINK_HOURS) || 1)));
export const AUTH_LINK_TTL = AUTH_LINK_HOURS === 1 ? "1 hour" : `${AUTH_LINK_HOURS} hours`;

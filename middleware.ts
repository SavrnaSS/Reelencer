import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { normalizeRole } from "@/lib/roles";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const isLocalDev =
    process.env.NODE_ENV !== "production" &&
    (req.nextUrl.hostname === "localhost" || req.nextUrl.hostname === "127.0.0.1");

  // Public assets
  const path = req.nextUrl.pathname;
  if (path.startsWith("/_next") || path.startsWith("/favicon") || path.startsWith("/assets")) return res;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    }
  );

  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    return res;
  }

  const isLogin = path.startsWith("/login");
  const isLogout = path.startsWith("/logout");
  const isAdmin = path.startsWith("/admin");
  const isWorker = path.startsWith("/workspace");
  const isPublic = path.startsWith("/browse") || path.startsWith("/proceed");

  // Always allow logout page to execute
  if (isLogout) return res;

  // Not logged in → block private areas
  if (!userId && (isAdmin || isWorker)) {
    // Local dev can have a valid browser session before the server can read Supabase auth cookies.
    // Let the client-side page guards decide instead of redirect-looping through /login.
    if (isLocalDev) return res;
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // Logged in → role-gate routes
  if (userId && (isAdmin || isWorker || isLogin)) {
    let role: ReturnType<typeof normalizeRole> = "worker";
    try {
      const prof = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
      role = normalizeRole(prof.data?.role) ?? "worker";
    } catch {
      if (isPublic) return res;
      return res;
    }

    // Admin visiting /workspace → force /admin
    if (role === "admin" && isWorker) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin";
      return NextResponse.redirect(url);
    }

    // Worker visiting /admin → force /workspace
    if (role !== "admin" && isAdmin) {
      const url = req.nextUrl.clone();
      url.pathname = "/workspace";
      return NextResponse.redirect(url);
    }

    // Logged in user visiting /login → bounce to correct dashboard
    if (isLogin) {
      const url = req.nextUrl.clone();
      url.pathname = role === "admin" ? "/admin" : "/workspace";
      return NextResponse.redirect(url);
    }
  }

  return res;
}

export const config = {
  matcher: ["/((?!api).*)"],
};

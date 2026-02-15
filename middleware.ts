import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

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

  let user: any = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
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
  if (!user && (isAdmin || isWorker)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // Logged in → role-gate routes
  if (user && (isAdmin || isWorker || isLogin)) {
    let role: "Admin" | "Worker" = "Worker";
    try {
      const prof = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      role = (prof.data?.role ?? "Worker") as "Admin" | "Worker";
    } catch {
      if (isPublic) return res;
      return res;
    }

    // Admin visiting /workspace → force /admin
    if (role === "Admin" && isWorker) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin";
      return NextResponse.redirect(url);
    }

    // Worker visiting /admin → force /workspace
    if (role !== "Admin" && isAdmin) {
      const url = req.nextUrl.clone();
      url.pathname = "/workspace";
      return NextResponse.redirect(url);
    }

    // Logged in user visiting /login → bounce to correct dashboard
    if (isLogin) {
      const url = req.nextUrl.clone();
      url.pathname = role === "Admin" ? "/admin" : "/workspace";
      return NextResponse.redirect(url);
    }
  }

  return res;
}

export const config = {
  matcher: ["/((?!api).*)"],
};

import { withApi } from "@/lib/api/route";
// app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseServerFetch } from "@/lib/supabase/serverFetch";

async function handlePOST() {
  const cookieStore = await cookies();
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json({ ok: true });
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
      global: {
        fetch: supabaseServerFetch,
      },
    }
  );

  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true });
}

export const POST = withApi({ auth: "public" }, handlePOST);

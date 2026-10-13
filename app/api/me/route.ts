import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";

export const GET = withApi({ auth: "user" }, async req => {
  const actor = await authenticate(req);
  return NextResponse.json({
    id: actor.user.id,
    email: actor.user.email,
    role: actor.isAdmin ? "admin" : "worker",
    workerId: actor.isAdmin ? null : actor.workerCode ?? actor.user.id,
  });
});

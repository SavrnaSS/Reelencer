import { authenticate } from "@/lib/api/auth";
import { creatorDashboardResponse } from "@/lib/api/creatorDashboard";
import { withApi } from "@/lib/api/route";

export const GET = withApi({ auth: "user" }, async request => creatorDashboardResponse(request, await authenticate(request)));

import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/server/cron-auth";
import { syncAllGmailReplies } from "@/server/gmail.server";

export const Route = createFileRoute("/api/public/jobs/gmail-replies")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authFailure = authenticateCronRequest(request);
        if (authFailure) return authFailure;

        try {
          const result = await syncAllGmailReplies();
          return Response.json(
            { success: result.campaignsFailed === 0, ...result },
            { status: result.campaignsFailed === 0 ? 200 : 502 },
          );
        } catch (error) {
          console.error("[gmail-reply-sync] Scheduled mailbox scan failed", error);
          return Response.json({ error: "Gmail reply synchronization failed" }, { status: 500 });
        }
      },
    },
  },
});

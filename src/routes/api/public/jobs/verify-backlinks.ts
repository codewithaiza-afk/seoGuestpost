import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNotNull } from "drizzle-orm";

import { campaigns, prospects } from "../../../../../drizzle/schema";
import { authenticateCronRequest } from "@/server/cron-auth";
import { db } from "@/server/database";
import { checkBacklink } from "@/server/backlink.server";

export const Route = createFileRoute("/api/public/jobs/verify-backlinks")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = authenticateCronRequest(request);
        if (authFailure) return authFailure;

        try {
          const toCheck = await db
            .select({
              id: prospects.id,
              liveBacklinkUrl: prospects.live_backlink_url,
              targetUrl: campaigns.target_url,
            })
            .from(prospects)
            .innerJoin(campaigns, eq(campaigns.id, prospects.campaign_id))
            .where(and(eq(prospects.status, "Live"), isNotNull(prospects.live_backlink_url)))
            .limit(200)
            .all();

          let checked = 0;
          for (const prospect of toCheck) {
            if (!prospect.liveBacklinkUrl) continue;
            const check = await checkBacklink(prospect.liveBacklinkUrl, prospect.targetUrl);
            await db
              .update(prospects)
              .set({ is_dofollow: check.isDofollow, last_checked_at: new Date().toISOString() })
              .where(eq(prospects.id, prospect.id))
              .run();
            checked += 1;
          }

          return Response.json({ success: true, checked });
        } catch (error) {
          console.error("[verify-backlinks] Local database sweep failed", error);
          return Response.json({ error: "Backlink verification failed" }, { status: 500 });
        }
      },
    },
  },
});

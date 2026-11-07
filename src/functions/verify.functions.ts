import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";

import { prospects } from "../../drizzle/schema";
import { normalizeSubmissionUrl } from "@/lib/submission-url";
import { requireLocalAuth } from "@/integrations/local-auth/auth-middleware";
import { db } from "@/server/database";
import { getOwnedCampaign, getOwnedProspect } from "@/server/owned-records";
import { checkBacklink } from "@/server/backlink.server";

export const verifyBacklink = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((input: { campaignId: string; prospectId: string }) => input)
  .handler(async ({ data, context }) => {
    const prospect = await getOwnedProspect(context.userId, data.campaignId, data.prospectId);
    if (!prospect) throw new Error("Prospect not found");
    if (!prospect.live_backlink_url) {
      throw new Error("Add the live article URL for this prospect first.");
    }

    const campaign = await getOwnedCampaign(context.userId, data.campaignId);
    if (!campaign) throw new Error("Campaign not found");
    const liveBacklinkUrl = normalizeSubmissionUrl(prospect.live_backlink_url, prospect.domain);
    if (!liveBacklinkUrl) throw new Error("The live article URL is invalid for this prospect.");

    const check = await checkBacklink(liveBacklinkUrl, campaign.target_url);
    await db
      .update(prospects)
      .set({
        is_dofollow: check.isDofollow,
        last_checked_at: new Date().toISOString(),
        ...(check.linkFound
          ? { status: "Live" as const, workflow_status: "Submission Verified" }
          : check.pageReachable
            ? { workflow_status: "Published" }
            : {}),
      })
      .where(and(eq(prospects.id, data.prospectId), eq(prospects.campaign_id, data.campaignId)))
      .run();

    return check;
  });

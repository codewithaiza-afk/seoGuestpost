import { and, eq } from "drizzle-orm";

import { campaigns, prospects } from "../../drizzle/schema";
import { db } from "./database";

export async function getOwnedCampaign(userId: string, campaignId: string) {
  return db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.user_id, userId)))
    .get();
}

export async function getOwnedProspect(userId: string, campaignId: string, prospectId: string) {
  if (!(await getOwnedCampaign(userId, campaignId))) return undefined;
  return db
    .select()
    .from(prospects)
    .where(and(eq(prospects.id, prospectId), eq(prospects.campaign_id, campaignId)))
    .get();
}

import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq } from "drizzle-orm";

import { campaigns, outreach_logs, prospects } from "../../drizzle/schema";
import { requireLocalAuth } from "@/integrations/local-auth/auth-middleware";
import { db } from "@/server/database";
import { getOwnedCampaign, getOwnedProspect } from "@/server/owned-records";
import { normalizeSubmissionUrl } from "@/lib/submission-url";

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireLocalAuth])
  .handler(async ({ context }) => {
    const userCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.user_id, context.userId))
      .orderBy(desc(campaigns.created_at))
      .all();
    const campaignIds = userCampaigns.map((campaign) => campaign.id);
    if (campaignIds.length === 0) return [];

    const campaignProspects = await db
      .select({ campaign_id: prospects.campaign_id, status: prospects.status })
      .from(prospects)
      .innerJoin(campaigns, eq(campaigns.id, prospects.campaign_id))
      .where(eq(campaigns.user_id, context.userId))
      .all();
    const prospectsByCampaign = new Map<string, { status: string }[]>();
    for (const prospect of campaignProspects) {
      const current = prospectsByCampaign.get(prospect.campaign_id) ?? [];
      current.push({ status: prospect.status });
      prospectsByCampaign.set(prospect.campaign_id, current);
    }

    return userCampaigns.map((campaign) => ({
      ...campaign,
      prospects: prospectsByCampaign.get(campaign.id) ?? [],
    }));
  });

export const getCampaign = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const campaign = await getOwnedCampaign(context.userId, data.id);
    if (!campaign) throw new Error("Campaign not found");
    const campaignProspects = await db
      .select()
      .from(prospects)
      .where(eq(prospects.campaign_id, campaign.id))
      .orderBy(desc(prospects.created_at))
      .all();
    return { ...campaign, prospects: campaignProspects };
  });

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(
    (input: { name: string; target_url: string; target_anchor: string; niche: string }) => input,
  )
  .handler(async ({ data, context }) => {
    const [campaign] = await db
      .insert(campaigns)
      .values({ ...data, user_id: context.userId })
      .returning()
      .all();
    if (!campaign) throw new Error("Could not create the campaign");
    return campaign;
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const result = await db
      .delete(campaigns)
      .where(and(eq(campaigns.id, data.id), eq(campaigns.user_id, context.userId)))
      .run();
    if (result.rowsAffected === 0) throw new Error("Campaign not found");
    return { ok: true };
  });

export interface ProspectRow {
  domain: string;
  contact_email: string | null;
  da_dr_score: number;
}

function normalizeProspectDomain(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;

  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`,
    );
    return url.hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/\.$/, "");
  } catch {
    return null;
  }
}

export const importProspects = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((input: { campaignId: string; rows: ProspectRow[] }) => input)
  .handler(async ({ data, context }) => {
    if (!(await getOwnedCampaign(context.userId, data.campaignId))) {
      throw new Error("Campaign not found");
    }

    const rows = data.rows.slice(0, 500).flatMap((row) => {
      try {
        const domain = normalizeProspectDomain(row.domain);
        return domain
          ? [
              {
                campaign_id: data.campaignId,
                domain,
                contact_email: row.contact_email?.trim() || null,
                da_dr_score: Number.isFinite(row.da_dr_score)
                  ? Math.max(0, Math.round(row.da_dr_score))
                  : 0,
              },
            ]
          : [];
      } catch {
        return [];
      }
    });
    if (rows.length === 0) throw new Error("No valid rows found in the import");

    const uniqueRows = [...new Map(rows.map((row) => [row.domain, row])).values()];
    const imported = await db.transaction(async (transaction) => {
      const existing = await transaction
        .select({ domain: prospects.domain })
        .from(prospects)
        .where(eq(prospects.campaign_id, data.campaignId))
        .all();
      const existingDomains = new Set(
        existing.map((prospect) => {
          try {
            return normalizeProspectDomain(prospect.domain);
          } catch {
            return prospect.domain;
          }
        }),
      );
      const rowsToInsert = uniqueRows.filter((row) => !existingDomains.has(row.domain));
      if (rowsToInsert.length === 0) return 0;
      return (
        await transaction
          .insert(prospects)
          .values(rowsToInsert)
          .onConflictDoNothing({
            target: [prospects.campaign_id, prospects.domain],
          })
          .returning({ id: prospects.id })
          .all()
      ).length;
    });

    return { imported, skipped: rows.length - imported };
  });

export const updateProspect = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(
    (input: {
      campaignId: string;
      id: string;
      status?: "Discovered" | "Pitched" | "Replied" | "Live" | "Rejected";
      live_backlink_url?: string | null;
      contact_email?: string | null;
      da_dr_score?: number;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const existing = await getOwnedProspect(context.userId, data.campaignId, data.id);
    if (!existing) throw new Error("Prospect not found");

    const patch: Partial<typeof prospects.$inferInsert> = {};
    if (data.status !== undefined) {
      patch.status = data.status;
      patch.workflow_status =
        data.status === "Pitched" || data.status === "Replied"
          ? "Email Outreach"
          : data.status === "Live"
            ? "Published"
            : data.status;
    }
    if (data.live_backlink_url !== undefined) {
      patch.live_backlink_url = data.live_backlink_url
        ? normalizeSubmissionUrl(data.live_backlink_url, existing.domain)
        : null;
    }
    if (data.contact_email !== undefined) patch.contact_email = data.contact_email;
    if (data.da_dr_score !== undefined)
      patch.da_dr_score = Math.max(0, Math.round(data.da_dr_score));

    if (Object.keys(patch).length > 0) {
      await db
        .update(prospects)
        .set(patch)
        .where(and(eq(prospects.id, data.id), eq(prospects.campaign_id, data.campaignId)))
        .run();
    }
    return { ok: true };
  });

export const deleteProspect = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((input: { campaignId: string; id: string }) => input)
  .handler(async ({ data, context }) => {
    if (!(await getOwnedProspect(context.userId, data.campaignId, data.id))) {
      throw new Error("Prospect not found");
    }
    await db
      .delete(prospects)
      .where(and(eq(prospects.id, data.id), eq(prospects.campaign_id, data.campaignId)))
      .run();
    return { ok: true };
  });

export const listOutreachLogs = createServerFn({ method: "GET" })
  .middleware([requireLocalAuth])
  .validator((input: { prospectId: string }) => input)
  .handler(async ({ data, context }) => {
    const prospect = await db
      .select({ id: prospects.id })
      .from(prospects)
      .innerJoin(campaigns, eq(campaigns.id, prospects.campaign_id))
      .where(and(eq(prospects.id, data.prospectId), eq(campaigns.user_id, context.userId)))
      .get();
    if (!prospect) throw new Error("Prospect not found");
    return await db
      .select({
        id: outreach_logs.id,
        subject: outreach_logs.subject,
        body: outreach_logs.body,
        sent_at: outreach_logs.sent_at,
        resend_email_id: outreach_logs.resend_email_id,
      })
      .from(outreach_logs)
      .where(eq(outreach_logs.prospect_id, data.prospectId))
      .orderBy(desc(outreach_logs.sent_at))
      .all();
  });

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireLocalAuth])
  .handler(async ({ context }) => {
    const campaignCount =
      (
        await db
          .select({ value: count() })
          .from(campaigns)
          .where(eq(campaigns.user_id, context.userId))
          .get()
      )?.value ?? 0;
    const countProspects = async (
      status?: (typeof prospects.$inferSelect)["status"],
      dofollow?: boolean,
    ) => {
      const filters = [eq(campaigns.user_id, context.userId)];
      if (status) filters.push(eq(prospects.status, status));
      if (dofollow !== undefined) filters.push(eq(prospects.is_dofollow, dofollow));
      return (
        (
          await db
            .select({ value: count() })
            .from(prospects)
            .innerJoin(campaigns, eq(campaigns.id, prospects.campaign_id))
            .where(and(...filters))
            .get()
        )?.value ?? 0
      );
    };

    const [prospectCount, pitched, replied, live, rejected, dofollow] = await Promise.all([
      countProspects(),
      countProspects("Pitched"),
      countProspects("Replied"),
      countProspects("Live"),
      countProspects("Rejected"),
      countProspects(undefined, true),
    ]);
    return {
      campaigns: campaignCount,
      prospects: prospectCount,
      pitched,
      replied,
      live,
      rejected,
      dofollow,
    };
  });

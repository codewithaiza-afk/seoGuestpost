import { createServerFn } from "@tanstack/react-start";

import { requireLocalAuth } from "@/integrations/local-auth/auth-middleware";

export const getGmailConnectionStatus = createServerFn({ method: "GET" })
  .middleware([requireLocalAuth])
  .handler(async ({ context }) => {
    const { getGmailConnection } = await import("@/server/gmail.server");
    return getGmailConnection(context.userId);
  });

export const startGmailConnection = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((input: { campaignId: string }) => input)
  .handler(async ({ data, context }) => {
    const { createGmailAuthorizationUrl } = await import("@/server/gmail.server");
    const authorizationUrl = await createGmailAuthorizationUrl(
      context.userId,
      `/campaigns/${data.campaignId}`,
    );
    return {
      authorizationUrl,
    };
  });

export const disconnectGmail = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .handler(async ({ context }) => {
    const { disconnectGmail: disconnect } = await import("@/server/gmail.server");
    await disconnect(context.userId);
    return { ok: true };
  });

export const checkCampaignReplies = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((input: { campaignId: string }) => input)
  .handler(async ({ data, context }) => {
    const { syncCampaignReplies } = await import("@/server/gmail.server");
    return syncCampaignReplies(context.userId, data.campaignId);
  });

export const listGmailReplies = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((input: { prospectId: string }) => input)
  .handler(async ({ data, context }) => {
    const { listProspectReplies } = await import("@/server/gmail.server");
    return listProspectReplies(context.userId, data.prospectId);
  });

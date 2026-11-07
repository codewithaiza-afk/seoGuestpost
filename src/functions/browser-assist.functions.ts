import { createServerFn } from "@tanstack/react-start";

import { requireLocalAuth } from "@/integrations/local-auth/auth-middleware";

export const openProspectBrowser = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(
    (input: {
      campaignId: string;
      prospectId: string;
      target: "submission" | "login" | "signup";
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { openProspectBrowser: openBrowser } = await import("@/server/browser-assist.server");
    return openBrowser(context.userId, data.campaignId, data.prospectId, data.target);
  });

export const inspectProspectBrowser = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((input: { campaignId: string; prospectId: string }) => input)
  .handler(async ({ data, context }) => {
    const { inspectProspectBrowser: inspectBrowser } =
      await import("@/server/browser-assist.server");
    return inspectBrowser(context.userId, data.campaignId, data.prospectId);
  });

export const fillProspectSubmissionForm = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(
    (input: {
      campaignId: string;
      prospectId: string;
      article: {
        title: string;
        content: string;
        authorName: string;
        authorEmail: string;
        authorBio: string;
        backlinkUrl: string;
      };
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { fillProspectSubmissionForm: fillForm } = await import("@/server/browser-assist.server");
    return fillForm(context.userId, data.campaignId, data.prospectId, data.article);
  });

export const submitProspectBrowserForm = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(
    (input: {
      campaignId: string;
      prospectId: string;
      finalApproval: boolean;
      manualVerificationCompleted: boolean;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { submitProspectBrowserForm: submitForm } =
      await import("@/server/browser-assist.server");
    return submitForm(
      context.userId,
      data.campaignId,
      data.prospectId,
      data.finalApproval,
      data.manualVerificationCompleted,
    );
  });

export const closeProspectBrowser = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((input: { prospectId: string }) => input)
  .handler(async ({ data, context }) => {
    const { closeProspectBrowser: closeBrowser } = await import("@/server/browser-assist.server");
    await closeBrowser(context.userId, data.prospectId);
    return { ok: true };
  });

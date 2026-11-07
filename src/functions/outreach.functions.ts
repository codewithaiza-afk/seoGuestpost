import { createServerFn } from "@tanstack/react-start";

import { requireLocalAuth } from "@/integrations/local-auth/auth-middleware";
import {
  sendOutreachEmail,
  sendArticleSubmissionEmail,
  sendFollowUpEmail,
} from "@/server/outreach.server";

export const sendOutreach = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(
    (input: { campaignId: string; prospectId: string; subject: string; body: string }) => input,
  )
  .handler(async ({ data, context }) => {
    return sendOutreachEmail(
      context.userId,
      data.campaignId,
      data.prospectId,
      data.subject,
      data.body,
    );
  });

export const sendArticleSubmission = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(
    (input: {
      campaignId: string;
      prospectId: string;
      articleTitle: string;
      articleContent: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    return sendArticleSubmissionEmail(
      context.userId,
      data.campaignId,
      data.prospectId,
      data.articleTitle,
      data.articleContent,
    );
  });

export const sendFollowUp = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((input: { campaignId: string; prospectId: string; customNote?: string }) => input)
  .handler(async ({ data, context }) => {
    return sendFollowUpEmail(context.userId, data.campaignId, data.prospectId, data.customNote);
  });

import { createServerFn } from "@tanstack/react-start";

import { requireLocalAuth } from "@/integrations/local-auth/auth-middleware";
import {
  generatePitchForProspect,
  generateArticleForProspect,
  type BusinessContextPayload,
} from "@/server/pitch.server";

export const generatePitch = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(
    (input: { campaignId: string; prospectId: string; businessInfo?: BusinessContextPayload }) =>
      input,
  )
  .handler(async ({ data, context }) => {
    return generatePitchForProspect(
      context.userId,
      data.campaignId,
      data.prospectId,
      data.businessInfo,
    );
  });

export const generateGuestPostArticle = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(
    (input: {
      campaignId: string;
      prospectId: string;
      preferredTitle?: string;
      businessInfo?: BusinessContextPayload;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    return generateArticleForProspect(
      context.userId,
      data.campaignId,
      data.prospectId,
      data.preferredTitle,
      data.businessInfo,
    );
  });

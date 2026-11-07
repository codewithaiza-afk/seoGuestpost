/**
 * Server-only pitch & article generation utilities.
 * These are plain async functions (NOT createServerFn) that can be called
 * from any server context — both individual RPC handlers and the autonomous engine.
 */

import { z } from "zod";
import { generateStructured } from "@/server/gateway";
import { getOwnedCampaign, getOwnedProspect } from "@/server/owned-records";

const pitchSchema = z
  .object({
    subject: z.string(),
    body: z.string(),
    titles: z.array(z.string()),
  })
  .strict();

const articleSchema = z
  .object({
    title: z.string(),
    metaDescription: z.string(),
    outline: z.array(z.string()),
    markdownContent: z.string(),
  })
  .strict();

export type PitchResult = z.infer<typeof pitchSchema>;
export type ArticleResult = z.infer<typeof articleSchema>;

export interface BusinessContextPayload {
  businessName?: string;
  businessDescription?: string;
  businessWebsite?: string;
  contactName?: string;
  uniqueValue?: string;
  customInstructions?: string;
}

/**
 * Generate a personalized outreach pitch email for a prospect with business context.
 */
export async function generatePitchForProspect(
  userId: string,
  campaignId: string,
  prospectId: string,
  businessInfo?: BusinessContextPayload,
  siteContext?: {
    recentArticleTitle?: string | null | undefined;
    siteHeadline?: string | null | undefined;
  },
): Promise<PitchResult> {
  const campaign = await getOwnedCampaign(userId, campaignId);
  if (!campaign) throw new Error("Campaign not found");

  const prospect = await getOwnedProspect(userId, campaignId, prospectId);
  if (!prospect) throw new Error("Prospect not found");

  const bName = businessInfo?.businessName || campaign.name || "Our Business";
  const bDesc =
    businessInfo?.businessDescription || `a leading brand in the ${campaign.niche} industry`;
  const senderName = businessInfo?.contactName || "Partnerships Team";
  const targetUrl = businessInfo?.businessWebsite || campaign.target_url;

  const system = [
    "You are an expert SEO outreach copywriter and brand partnerships manager.",
    "Write a highly persuasive, warm, and professional outreach email pitching a high-value guest post to the editor/owner of the prospect's website.",
    "Rules:",
    `- Clearly state that you represent "${bName}" (${bDesc}) and want to publish a comprehensive, mutually-beneficial guest article on their site.`,
    "- Reference the prospect's site naturally and highlight how your industry experience will provide fresh value to their audience.",
    "- Propose 3 high-impact topic ideas that link back to the target URL using the specified anchor text.",
    "- Clearly state that you have a publication-ready, comprehensive draft prepared for their review.",
    "- Ask the editor to publish the article themselves if it fits their process. Otherwise, ask them to reply with explicit permission for us to submit it, plus any submission instructions or contributor access requirements.",
    "- Keep the body concise (120-160 words), authentic, and human.",
    `- Sign off with "${senderName}" from "${bName}".`,
    "- Do not sound spammy; do not mention paying for links or black-hat tactics.",
    "Reply only with the structured output requested.",
  ].join("\n");

  const prompt = [
    `Prospect domain: ${prospect.domain}`,
    prospect.contact_email ? `Editor/Owner email: ${prospect.contact_email}` : null,
    siteContext?.recentArticleTitle
      ? `Recent published article to praise: "${siteContext.recentArticleTitle}"`
      : null,
    siteContext?.siteHeadline ? `Site Headline: "${siteContext.siteHeadline}"` : null,
    `Site niche: ${campaign.niche}`,
    `Our Business Name: ${bName}`,
    `Our Business Overview: ${bDesc}`,
    businessInfo?.uniqueValue ? `Unique Selling Proposition: ${businessInfo.uniqueValue}` : null,
    businessInfo?.customInstructions
      ? `Special Instructions: ${businessInfo.customInstructions}`
      : null,
    `Target URL: ${targetUrl}`,
    `Anchor text: ${campaign.target_anchor}`,
    "",
    "Generate the outreach pitch email now.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    if (process.env["LOVABLE_API_KEY"]) {
      return await generateStructured({ system, prompt, schema: pitchSchema });
    }
  } catch (err) {
    console.warn("[generatePitchForProspect] gateway failed, using custom template fallback:", err);
  }

  const nicheName = campaign.niche || "your industry";
  const introLine = siteContext?.recentArticleTitle
    ? `I was reading your recent piece on "${siteContext.recentArticleTitle}" on ${prospect.domain} and really appreciated the practical takeaways.`
    : `I’ve been reading ${prospect.domain} and really admire your practical insights in the ${nicheName} space.`;

  return {
    subject: `Guest Post Proposal: High-Value Article for ${prospect.domain} from ${bName}`,
    body: `Hi Editor,\n\nI hope this email finds you well. ${introLine}\n\nI’m reaching out from ${bName} (${bDesc}). We would love to contribute an original, in-depth guest post to your publication that offers real value to your community.\n\nHere are 3 tailored topic concepts we've outlined for your audience:\n\n1. Scaling Success in ${nicheName}: 2026 Practical Frameworks\n2. Key Innovations & Strategic Trends in ${nicheName}\n3. How Modern Teams Optimize Growth in ${nicheName}\n\nWe have a publication-ready draft prepared for your review. If it suits your editorial process, we’d be grateful if your team could publish it. Otherwise, please reply with your permission for us to submit it, along with any submission instructions or contributor access requirements. We will only submit it after receiving your approval.\n\nWould any of these topics resonate with your editorial calendar?\n\nWarm regards,\n${senderName}\n${bName} | ${targetUrl}`,
    titles: [
      `Scaling Success in ${nicheName}: 2026 Practical Frameworks`,
      `Key Innovations & Strategic Trends in ${nicheName}`,
      `How Modern Teams Optimize Growth in ${nicheName}`,
    ],
  };
}

/**
 * Generate a full guest post article with embedded backlink customized to the user's business.
 */
export async function generateArticleForProspect(
  userId: string,
  campaignId: string,
  prospectId: string,
  preferredTitle?: string,
  businessInfo?: BusinessContextPayload,
): Promise<ArticleResult> {
  const campaign = await getOwnedCampaign(userId, campaignId);
  if (!campaign) throw new Error("Campaign not found");

  const prospect = await getOwnedProspect(userId, campaignId, prospectId);
  if (!prospect) throw new Error("Prospect not found");

  const bName = businessInfo?.businessName || campaign.name || "Our Business";
  const bDesc = businessInfo?.businessDescription || `innovative provider in ${campaign.niche}`;
  const targetUrl = businessInfo?.businessWebsite || campaign.target_url;

  const system = [
    "You are a master SEO content strategist, journalist, and long-form guest post writer.",
    "Your task is to write a comprehensive, publication-ready guest post article tailored to the target blog domain and enriched with our business's industry context.",
    "Requirements:",
    "- The article must strictly fit the website's niche and provide genuine editorial depth.",
    "- Structure the post with an engaging title, meta description, structured outline, introduction, deep H2/H3 sections with actionable takeaways, bullet points, and a concluding section.",
    `- You MUST naturally integrate an editorial contextual backlink to "${targetUrl}" with the exact anchor text "${campaign.target_anchor}" inside one of the analytical body paragraphs. Format in Markdown: [${campaign.target_anchor}](${targetUrl})`,
    `- Subtly weave in the perspective and authority of "${bName}" (${bDesc}) without reading like an advertisement.`,
    "Reply only with the structured output requested.",
  ].join("\n");

  const prompt = [
    `Target publishing domain: ${prospect.domain}`,
    `Target niche: ${campaign.niche}`,
    `Our Business Name: ${bName}`,
    `Our Business Services / Overview: ${bDesc}`,
    businessInfo?.uniqueValue ? `Unique Value: ${businessInfo.uniqueValue}` : null,
    businessInfo?.customInstructions ? `Custom Guidance: ${businessInfo.customInstructions}` : null,
    preferredTitle
      ? `Chosen topic / title: ${preferredTitle}`
      : "Generate the most engaging guest post title for this niche",
    `Target URL to include: ${targetUrl}`,
    `Target anchor text: ${campaign.target_anchor}`,
    "",
    "Generate the full guest post article now.",
  ].join("\n");

  try {
    if (process.env["LOVABLE_API_KEY"]) {
      return await generateStructured({ system, prompt, schema: articleSchema });
    }
  } catch (err) {
    console.warn("[generateArticleForProspect] gateway failed, using article fallback:", err);
  }

  const chosenTitle =
    preferredTitle?.trim() ||
    `The Definitive Guide to ${campaign.niche} Growth: Insights from ${bName}`;

  const metaDescription = `An in-depth guide on ${campaign.niche} written for ${prospect.domain}. Explore proven frameworks and strategies from ${bName}.`;

  const outline = [
    `1. Introduction: Modern Developments in ${campaign.niche}`,
    `2. Strategic Shifts and Common Pitfalls`,
    `3. Core Pillars for High-Performance Growth`,
    `4. Real-World Applications & Industry Standards`,
    `5. Summary and Strategic Roadmap`,
  ];

  const markdownContent = [
    `# ${chosenTitle}`,
    "",
    `*Published exclusively for ${prospect.domain} by ${bName}*`,
    "",
    `In today's fast-paced digital ecosystem, succeeding in **${campaign.niche}** requires a blend of rigorous strategy, modern tooling, and authentic value creation. At ${bName}, our experience in ${bDesc} has revealed that forward-thinking organizations must continuously adapt their strategies.`,
    "",
    `## 1. The Evolving Landscape of ${campaign.niche}`,
    "",
    `Recent industry data demonstrates that teams implementing systematic, data-informed frameworks achieve up to 3x higher long-term efficiency. However, navigating complex market dynamics requires a deep understanding of core customer requirements.`,
    "",
    `Key factors shaping modern workflows include:`,
    `- **Data Precision**: Supporting strategic moves with verifiable metrics.`,
    `- **Speed of Execution**: Eliminating operational friction to maintain momentum.`,
    `- **Strategic Collaboration**: Partnering with established solutions such as [${campaign.target_anchor}](${targetUrl}) to build trust and elevate performance.`,
    "",
    `## 2. Best Practices & Core Frameworks`,
    "",
    `When implementing new initiatives, industry leaders emphasize consistency and depth over temporary shortcuts. By auditing key assets and adhering to scalable benchmarks, businesses create durable competitive advantages.`,
    "",
    `### Actionable Steps for Implementation:`,
    `1. **Audit Existing Workflows**: Clarify current bottlenecks and establish baseline metrics.`,
    `2. **Automate Redundant Processes**: Free up strategic bandwidth through intelligent execution.`,
    `3. **Benchmark Authority Regularly**: Keep performance aligned with market expectations.`,
    "",
    `## 3. Looking Ahead: Next Steps`,
    "",
    `Building sustainable momentum in ${campaign.niche} isn't about chasing fleeting trends—it's about laying a resilient, high-quality foundation. By prioritizing real value, organizations can unlock long-term, compounding success.`,
    "",
    `---`,
    `*Author: ${bName} Industry Research Team | ${targetUrl}*`,
  ].join("\n");

  return {
    title: chosenTitle,
    metaDescription,
    outline,
    markdownContent,
  };
}

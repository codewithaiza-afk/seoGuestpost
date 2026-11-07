/**
 * Business Profile — stored in localStorage per campaign.
 * Contains all the business details the AI agent needs to
 * write personalized articles and outreach emails.
 */

export interface BusinessProfile {
  businessName: string;
  businessDescription: string;
  businessWebsite: string;
  contactName: string;
  contactEmail: string;
  keySellingPoints: string;
  preferredTone: "professional" | "friendly" | "casual";
  industryNiche: string;
  uniqueValue: string;
}

const STORAGE_KEY_PREFIX = "linkforge_bp_";

export function getBusinessProfile(campaignId: string): BusinessProfile | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${campaignId}`);
    if (!raw) return null;
    return JSON.parse(raw) as BusinessProfile;
  } catch {
    return null;
  }
}

export function saveBusinessProfile(campaignId: string, profile: BusinessProfile): void {
  localStorage.setItem(`${STORAGE_KEY_PREFIX}${campaignId}`, JSON.stringify(profile));
}

export function getDefaultBusinessProfile(): BusinessProfile {
  return {
    businessName: "",
    businessDescription: "",
    businessWebsite: "",
    contactName: "",
    contactEmail: "",
    keySellingPoints: "",
    preferredTone: "professional",
    industryNiche: "",
    uniqueValue: "",
  };
}

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Globe,
  Mail,
  FileText,
  ExternalLink,
  Copy,
  Trash2,
  CheckCircle2,
  Send,
  UploadCloud,
  Play,
  Pause,
  Sparkles,
  TrendingUp,
  Layers,
  ShieldCheck,
  Building2,
  ChevronRight,
  Terminal,
  Download,
  RefreshCw,
  RotateCw,
  Inbox,
  RefreshCw as RefreshMailbox,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, ToneBadge } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  deleteProspect,
  getCampaign,
  importProspects,
  listCampaigns,
  listOutreachLogs,
  updateProspect,
  type ProspectRow,
} from "@/functions/data.functions";
import { verifyBacklink } from "@/functions/verify.functions";
import {
  runAutonomousProspectStep,
  sendProspectOutreachInstead,
} from "@/functions/autonomous.functions";
import { sendArticleSubmission, sendFollowUp } from "@/functions/outreach.functions";
import {
  checkCampaignReplies,
  disconnectGmail as disconnectGmailAccount,
  getGmailConnectionStatus,
  listGmailReplies,
  startGmailConnection,
} from "@/functions/gmail.functions";
import {
  confirmManualSubmission,
  rejectSubmissionCandidate,
  saveSubmissionApproval,
} from "@/functions/submission.functions";
import {
  fillProspectSubmissionForm as fillGuidedSubmissionForm,
  inspectProspectBrowser,
  openProspectBrowser as launchGuidedBrowser,
  submitProspectBrowserForm,
} from "@/functions/browser-assist.functions";
import {
  getBusinessProfile,
  saveBusinessProfile,
  type BusinessProfile,
} from "@/lib/business-profile";
import { normalizeSubmissionUrl } from "@/lib/submission-url";
import type { Json } from "../../../drizzle/schema";

export const Route = createFileRoute("/_authenticated/campaigns/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Autonomous Campaign Pipeline — LinkForge" },
      { name: "description", content: "Broad autonomous guest posting and outreach pipeline." },
    ],
  }),
  loader: async ({ params }) => {
    try {
      const campaign = await getCampaign({ data: { id: params.id } });
      return { campaign };
    } catch (err) {
      console.error("[getCampaign loader error]:", err);
      return { campaign: null };
    }
  },
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-5xl p-6 md:p-10 space-y-4">
      <Link
        to="/campaigns"
        className="text-sm text-primary hover:underline flex items-center gap-1.5"
      >
        ← Back to Campaigns
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Could not open campaign</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "The requested campaign could not be loaded."}
          </p>
          <Link
            to="/campaigns"
            className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            View all campaigns
          </Link>
        </CardContent>
      </Card>
    </div>
  ),
  component: CampaignDetailPage,
});

const STATUS_OPTIONS = ["Discovered", "Pitched", "Replied", "Live", "Rejected"] as const;
type ProspectStatus = (typeof STATUS_OPTIONS)[number];

type ProspectFull = {
  id: string;
  domain: string;
  contact_email: string | null;
  da_dr_score: number;
  status: ProspectStatus;
  live_backlink_url: string | null;
  submission_approved: boolean;
  submission_completed_at: string | null;
  submission_attempted_at: string | null;
  submission_result_url: string | null;
  submission_reference: string | null;
  submission_url: string | null;
  submission_details: Json;
  login_url: string | null;
  signup_url: string | null;
  workflow_status: string;
  is_dofollow: boolean;
  last_checked_at: string | null;
  created_at: string;
  campaign_id: string;
};

type GeneratedArticle = {
  title: string;
  metaDescription: string;
  outline: string[];
  markdownContent: string;
};

type DiscoveryPageView = {
  kind: string;
  url: string;
  title: string | null;
  instructions: string;
  eligibility: string;
  authentication: string;
  externalLinks: string;
  fields: { name: string; label: string; type: string; required: boolean }[];
};

type GuidedBrowserInspection = {
  url: string;
  title: string;
  submissionFormDetected: boolean;
  manualVerificationRequired: boolean;
  fields: { label: string; type: string; required: boolean; manualOnly: boolean }[];
};

type GuidedBrowserFillResult = {
  filledFields: string[];
  requiredFieldsToComplete: string[];
  manualVerificationRequired: boolean;
};

function getDiscoveryPageViews(details: Json): DiscoveryPageView[] {
  if (!Array.isArray(details)) return [];

  const pages: DiscoveryPageView[] = [];
  for (const item of details) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const kind = item["kind"];
    const url = item["url"];
    if (typeof kind !== "string" || typeof url !== "string") continue;
    const rawFields = item["fields"];
    const fields: DiscoveryPageView["fields"] = [];
    if (Array.isArray(rawFields)) {
      for (const field of rawFields) {
        if (typeof field !== "object" || field === null || Array.isArray(field)) continue;
        const name = field["name"];
        if (typeof name !== "string") continue;
        fields.push({
          name,
          label: typeof field["label"] === "string" ? field["label"] : name,
          type: typeof field["type"] === "string" ? field["type"] : "text",
          required: field["required"] === true,
        });
      }
    }

    pages.push({
      kind,
      url,
      title: typeof item["title"] === "string" ? item["title"] : null,
      instructions: typeof item["instructions"] === "string" ? item["instructions"] : "",
      eligibility: typeof item["eligibility"] === "string" ? item["eligibility"] : "unknown",
      authentication:
        typeof item["authentication"] === "string" ? item["authentication"] : "unknown",
      externalLinks: typeof item["externalLinks"] === "string" ? item["externalLinks"] : "unknown",
      fields,
    });
  }
  return pages;
}

function getSafeWebsiteUrl(value: string | null | undefined, domain: string): string | null {
  if (!value) return null;
  try {
    return normalizeSubmissionUrl(value, domain);
  } catch (error) {
    console.error(`[campaign] Ignoring invalid website URL for ${domain}:`, error);
    return null;
  }
}

function CampaignDetailPage() {
  const { campaign: initialCampaign } = Route.useLoaderData();
  const params = Route.useParams();
  const router = useRouter();

  const [activeCampaign, setActiveCampaign] = useState<any>(initialCampaign);
  const [isLoading, setIsLoading] = useState(!initialCampaign);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availableCampaigns, setAvailableCampaigns] = useState<
    { id: string; name: string; target_url: string }[]
  >([]);

  // ── Business Profile / Context State ──────────────────────────────────────
  const [businessProfileOpen, setBusinessProfileOpen] = useState(false);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile>({
    businessName: "",
    businessDescription: "",
    businessWebsite: "",
    contactName: "",
    contactEmail: "",
    keySellingPoints: "",
    preferredTone: "professional",
    industryNiche: "",
    uniqueValue: "",
  });

  useEffect(() => {
    if (params.id) {
      const saved = getBusinessProfile(params.id);
      if (saved) {
        setBusinessProfile(saved);
      } else if (activeCampaign) {
        setBusinessProfile((prev) => ({
          ...prev,
          businessName: activeCampaign.name || "",
          businessWebsite: activeCampaign.target_url || "",
          industryNiche: activeCampaign.niche || "",
        }));
      }
    }
  }, [params.id, activeCampaign]);

  const handleSaveBusinessProfile = () => {
    saveBusinessProfile(params.id, businessProfile);
    toast.success(
      "Business profile saved! Autonomous agent will write tailored articles & pitches with this info.",
    );
  };

  useEffect(() => {
    if (initialCampaign) {
      setActiveCampaign(initialCampaign);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    async function fetchCampaign() {
      setIsLoading(true);
      try {
        const campaign = await getCampaign({ data: { id: params.id } });
        if (isMounted) setActiveCampaign(campaign);
      } catch (err) {
        if (isMounted) {
          setLoadError(err instanceof Error ? err.message : "Failed to load campaign");
          listCampaigns()
            .then((available) => {
              if (isMounted) setAvailableCampaigns(available);
            })
            .catch((listError) => console.error("Could not load available campaigns", listError));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    fetchCampaign();
    return () => {
      isMounted = false;
    };
  }, [initialCampaign, params.id]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl p-6 md:p-10 space-y-4">
        <Link to="/campaigns" className="text-sm text-primary hover:underline">
          ← Back to Campaigns
        </Link>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground animate-pulse">Loading campaign details…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!activeCampaign) {
    return (
      <div className="mx-auto max-w-5xl p-6 md:p-10 space-y-6">
        <Link to="/campaigns" className="text-sm text-primary hover:underline">
          ← Back to Campaigns
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Campaign Not Found</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {loadError ?? "This campaign does not exist or may have been deleted."}
            </p>

            {availableCampaigns.length > 0 && (
              <div className="space-y-3 pt-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Your Active Campaigns ({availableCampaigns.length}):
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {availableCampaigns.map((ac) => (
                    <Link
                      key={ac.id}
                      to="/campaigns/$id"
                      params={{ id: ac.id }}
                      className="flex flex-col rounded-lg border border-border p-3.5 hover:border-primary/50 hover:bg-secondary/40 transition-all"
                    >
                      <span className="font-semibold text-foreground text-sm">{ac.name}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {ac.target_url}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Link
                to="/campaigns"
                className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Go to Campaigns Page
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const campaign = activeCampaign;
  const prospects = (campaign.prospects as unknown as ProspectFull[] | null) ?? [];

  // ── Import Mode & File State ───────────────────────────────────────────────
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Filter pipeline state ──────────────────────────────────────────────────
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredProspects = prospects.filter((p) => {
    const matchesStatus = filterStatus === "all" ? true : p.status === filterStatus;
    const matchesSearch = searchQuery.trim()
      ? p.domain.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.contact_email && p.contact_email.toLowerCase().includes(searchQuery.toLowerCase()))
      : true;
    return matchesStatus && matchesSearch;
  });

  // ── Deliverables Drawer / Sheet State ─────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedProspect = prospects.find((p) => p.id === selectedId) ?? null;
  const safeSubmissionUrl = selectedProspect
    ? getSafeWebsiteUrl(selectedProspect.submission_url, selectedProspect.domain)
    : null;
  const safeLoginUrl = selectedProspect
    ? getSafeWebsiteUrl(selectedProspect.login_url, selectedProspect.domain)
    : null;
  const safeSignupUrl = selectedProspect
    ? getSafeWebsiteUrl(selectedProspect.signup_url, selectedProspect.domain)
    : null;
  const selectedIdRef = useRef<string | null>(null);

  // ── Pitch & Article state ──────────────────────────────────────────────────
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [article, setArticle] = useState<GeneratedArticle | null>(null);

  // ── Article Submission & Follow-Up State ─────────────────────────────────
  const [sendingDraft, setSendingDraft] = useState(false);
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const [sendingProspectOutreach, setSendingProspectOutreach] = useState(false);
  const [reverifyingAll, setReverifyingAll] = useState(false);

  // ── Verification & Logs ───────────────────────────────────────────────────
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<
    { id: string; subject: string; sent_at: string; body?: string }[]
  >([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [gmailConnection, setGmailConnection] = useState<{
    email: string;
    lastCheckedAt: string | null;
  } | null>(null);
  const [gmailReplies, setGmailReplies] = useState<
    {
      id: string;
      sender: string;
      subject: string;
      body_text: string;
      classification: "positive" | "negative" | "neutral";
      received_at: string;
    }[]
  >([]);
  const [gmailChecking, setGmailChecking] = useState(false);
  const [gmailDisconnecting, setGmailDisconnecting] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [guidedBrowserBusy, setGuidedBrowserBusy] = useState(false);
  const [guidedBrowserInspection, setGuidedBrowserInspection] =
    useState<GuidedBrowserInspection | null>(null);
  const [guidedBrowserFillResult, setGuidedBrowserFillResult] =
    useState<GuidedBrowserFillResult | null>(null);
  const [manualVerificationComplete, setManualVerificationComplete] = useState(false);

  // ── Autonomous Auto-Pilot Engine State ─────────────────────────────────────
  const [autoPilotRunning, setAutoPilotRunning] = useState(false);
  const [autoPilotProgress, setAutoPilotProgress] = useState<{
    current: number;
    total: number;
    currentDomain: string;
  } | null>(null);
  const [autoPilotLogs, setAutoPilotLogs] = useState<
    { timestamp: string; text: string; domain?: string | undefined }[]
  >([]);
  const stopAutoPilotRef = useRef(false);

  // ── Inspect Deliverables for a Prospect ───────────────────────────────────
  const handleInspectProspect = async (id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    setGuidedBrowserInspection(null);
    setGuidedBrowserFillResult(null);
    setManualVerificationComplete(false);
    setDrawerOpen(true);
    setLogsLoading(true);
    setGmailError(null);

    const cachedArticle = localStorage.getItem(`linkforge_article_${id}`);
    if (cachedArticle) {
      try {
        setArticle(JSON.parse(cachedArticle));
      } catch {
        setArticle(null);
      }
    } else {
      setArticle(null);
    }

    try {
      const [outreachResult, replyResult] = await Promise.all([
        listOutreachLogs({ data: { prospectId: id } }),
        listGmailReplies({ data: { prospectId: id } }),
      ]);
      const typedLogs = outreachResult as {
        id: string;
        subject: string;
        body?: string;
        sent_at: string;
      }[];
      setLogs(typedLogs);
      setGmailReplies(replyResult);

      if (typedLogs.length > 0) {
        const latest = typedLogs[0];
        if (latest) {
          setSubject(latest.subject ?? "");
          setBody(latest.body ?? "");
        }
      } else {
        setSubject("");
        setBody("");
      }
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleCheckEmailReplies = async () => {
    if (gmailChecking) return;
    setGmailChecking(true);
    setGmailError(null);
    try {
      const connection = await getGmailConnectionStatus();
      setGmailConnection(connection);
      if (!connection) {
        const result = await startGmailConnection({ data: { campaignId: params.id } });
        window.location.assign(result.authorizationUrl);
        return;
      }

      const result = await checkCampaignReplies({ data: { campaignId: params.id } });
      if (selectedIdRef.current) {
        setGmailReplies(await listGmailReplies({ data: { prospectId: selectedIdRef.current } }));
      }
      if (result.newReplies > 0) {
        toast.success(
          `${result.newReplies} editor reply${result.newReplies === 1 ? "" : "ies"} found. Prospect status updated; review the reply below.`,
        );
        await refreshProspects();
        await router.invalidate();
      } else {
        toast.info(
          `No new editor replies. Checked ${result.checked} pitched prospect${result.checked === 1 ? "" : "s"}.`,
        );
      }
      setGmailConnection(await getGmailConnectionStatus());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not check the Gmail inbox.";
      setGmailError(message);
      toast.error(message);
    } finally {
      setGmailChecking(false);
    }
  };

  const handleDisconnectGmail = async () => {
    if (!window.confirm("Disconnect Gmail inbox access and revoke LinkForge's Google token?")) {
      return;
    }
    setGmailDisconnecting(true);
    setGmailError(null);
    try {
      await disconnectGmailAccount();
      setGmailConnection(null);
      setGmailReplies([]);
      toast.success("Gmail inbox disconnected.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not disconnect Gmail.";
      setGmailError(message);
      setGmailConnection(null);
      toast.error(message);
    } finally {
      setGmailDisconnecting(false);
    }
  };

  useEffect(() => {
    let active = true;
    void getGmailConnectionStatus()
      .then((connection) => {
        if (active) setGmailConnection(connection);
      })
      .catch((error: unknown) => {
        if (active) {
          setGmailError(error instanceof Error ? error.message : "Could not load Gmail status.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const refreshWorkflow = async () => {
      try {
        const campaign = await getCampaign({ data: { id: params.id } });
        if (!active) return;
        setActiveCampaign(campaign);
        const prospectId = selectedIdRef.current;
        if (prospectId) {
          setGmailReplies(await listGmailReplies({ data: { prospectId } }));
        }
      } catch (error) {
        console.error(
          "Could not refresh the campaign workflow:",
          error instanceof Error ? error.message : error,
        );
      }
    };
    const interval = window.setInterval(() => void refreshWorkflow(), 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [params.id]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const mailboxResult = url.searchParams.get("mailbox");
    if (!mailboxResult) return;
    if (mailboxResult === "connected") {
      toast.success("Gmail inbox connected. Editor replies will be checked every 15 minutes.");
      void getGmailConnectionStatus().then(setGmailConnection);
    } else {
      toast.error(
        mailboxResult === "denied"
          ? "Gmail access was not approved."
          : "Could not connect Gmail. Check the OAuth setup and try again.",
      );
    }
    url.searchParams.delete("mailbox");
    window.history.replaceState({}, "", url.toString());
  }, []);

  // ── Refresh Prospects Helper ──────────────────────────────────────────────
  const refreshProspects = async () => {
    try {
      const campaign = await getCampaign({ data: { id: params.id } });
      setActiveCampaign(campaign);
    } catch (err) {
      console.error("Failed to refresh prospects:", err);
    }
  };

  // ── 100% Fully Autonomous Pipeline Engine ────────────────────────────────
  const runAutoPilot = async (customProspects?: ProspectFull[]) => {
    const listToProcess = (customProspects || prospects).filter((p) => p.status === "Discovered");

    if (listToProcess.length === 0) {
      toast.info("No new prospects are waiting for outreach.");
      return;
    }

    stopAutoPilotRef.current = false;
    setAutoPilotRunning(true);
    toast.success(`⚡ Autonomous Engine started for ${listToProcess.length} websites!`);

    const addLog = (text: string, domain?: string | undefined) => {
      setAutoPilotLogs((prev) => [
        { timestamp: new Date().toLocaleTimeString(), text, domain },
        ...prev.slice(0, 99),
      ]);
    };

    const brandName = businessProfile.businessName || campaign.name;
    addLog(
      `🤖 Autopilot launched for ${listToProcess.length} websites representing "${brandName}"...`,
    );
    let completedCount = 0;
    let failedCount = 0;
    let emailsSentCount = 0;
    let duplicateEmailsSkippedCount = 0;
    let missingContactCount = 0;

    for (let i = 0; i < listToProcess.length; i++) {
      if (stopAutoPilotRef.current) {
        addLog("⏹️ Autonomous Agent paused by user.");
        toast.info("Autonomous Agent paused.");
        break;
      }

      const p = listToProcess[i];
      if (!p) continue;

      setAutoPilotProgress({
        current: i + 1,
        total: listToProcess.length,
        currentDomain: p.domain,
      });

      addLog(
        `▶ [${i + 1}/${listToProcess.length}] Autonomously handling: ${p.domain}...`,
        p.domain,
      );

      try {
        const result = await runAutonomousProspectStep({
          data: {
            campaignId: params.id,
            prospectId: p.id,
            businessInfo: {
              businessName: businessProfile.businessName || campaign.name,
              businessDescription: businessProfile.businessDescription,
              businessWebsite: businessProfile.businessWebsite || campaign.target_url,
              contactName: businessProfile.contactName,
              uniqueValue: businessProfile.uniqueValue,
              customInstructions: businessProfile.keySellingPoints,
            },
          },
        });
        completedCount += 1;
        if (result.emailDispatch === "sent") emailsSentCount += 1;
        if (result.emailDispatch === "duplicate") duplicateEmailsSkippedCount += 1;
        if (result.emailDispatch === "missing-contact") missingContactCount += 1;

        const articleData = {
          title: result.articleTitle,
          metaDescription: `Exclusive guest contribution for ${p.domain}`,
          outline: [],
          markdownContent: result.markdownContent,
        };
        localStorage.setItem(`linkforge_article_${p.id}`, JSON.stringify(articleData));

        result.logs.forEach((l) => addLog(`  ${l}`, p.domain));

        setActiveCampaign((prev: any) => {
          if (!prev?.prospects) return prev;
          return {
            ...prev,
            prospects: prev.prospects.map((item: ProspectFull) =>
              item.id === p.id
                ? {
                    ...item,
                    status:
                      result.emailDispatch !== "missing-contact"
                        ? ("Pitched" as ProspectStatus)
                        : item.status,
                    contact_email: result.contactEmail,
                    submission_url: result.submissionUrl ?? item.submission_url,
                  }
                : item,
            ),
          };
        });

        if (selectedId === p.id) {
          setSubject(result.pitchSubject);
          setBody(result.pitchBody);
          setArticle(articleData);
        }
      } catch (err) {
        failedCount += 1;
        addLog(
          `❌ Error on ${p.domain}: ${err instanceof Error ? err.message : "failed"}`,
          p.domain,
        );
      }

      if (i < listToProcess.length - 1 && !stopAutoPilotRef.current) {
        addLog(
          `⏳ Waiting 3 seconds before the next email. Gmail delivery and inbox placement are not guaranteed.`,
        );
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    setAutoPilotRunning(false);
    setAutoPilotProgress(null);
    await refreshProspects();
    await router.invalidate();
    if (failedCount > 0) {
      const summary = `Autopilot finished: ${emailsSentCount} email(s) sent, ${duplicateEmailsSkippedCount} duplicate(s) skipped, ${missingContactCount} without a usable contact email, ${failedCount} failed.`;
      toast.error(summary);
      addLog(`⚠️ ${summary}`);
    } else {
      const summary = `Autopilot finished: ${emailsSentCount} email(s) sent, ${duplicateEmailsSkippedCount} duplicate(s) skipped, ${missingContactCount} without a usable contact email (${completedCount} website(s) processed).`;
      if (missingContactCount > 0 || duplicateEmailsSkippedCount > 0) {
        toast.info(summary);
      } else {
        toast.success(summary);
      }
      addLog(`🏁 ${summary}`);
    }
  };

  const stopAutoPilot = () => {
    stopAutoPilotRef.current = true;
    setAutoPilotRunning(false);
  };

  // ── Auto-Import and Instantly Launch Agent on File Drop ──────────────────
  const handleAutoImportAndRun = async (file: File) => {
    try {
      toast.info(`Reading ${file.name}…`);
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        toast.error("File appears to be empty");
        return;
      }
      const sheet = workbook.Sheets[firstSheetName];
      if (!sheet) {
        toast.error("Could not read sheet");
        return;
      }

      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        raw: false,
        defval: "",
      });

      if (jsonData.length === 0) {
        toast.error("No data rows found in this file");
        return;
      }

      const parsed: ProspectRow[] = jsonData
        .map((row) => {
          let domain = "";
          let email = "";
          let score = 0;

          for (const [key, rawValue] of Object.entries(row)) {
            const k = key.trim().toLowerCase();
            const val = String(rawValue ?? "").trim();

            if (
              k.includes("domain") ||
              k.includes("website") ||
              k.includes("url") ||
              k === "site"
            ) {
              if (!domain && val) domain = val;
            } else if (k.includes("email") || k.includes("contact") || k.includes("mail")) {
              if (!email && val) email = val;
            } else if (
              k.includes("da") ||
              k.includes("dr") ||
              k.includes("score") ||
              k.includes("rank") ||
              k.includes("authority")
            ) {
              const num = Number(val);
              if (!Number.isNaN(num) && num > 0) score = num;
            }
          }

          if (!domain) {
            const values = Object.values(row).map((v) => String(v ?? "").trim());
            domain = values[0] ?? "";
            email = values[1] ?? "";
            score = Number(values[2]) || 0;
          }

          const cleanDomain = domain
            .replace(/^https?:\/\//i, "")
            .replace(/\/+$/, "")
            .trim();

          return {
            domain: cleanDomain,
            contact_email: email.includes("@") ? email : null,
            da_dr_score: score > 0 ? Math.round(score) : 0,
          };
        })
        .filter((r) => r.domain.length > 0);

      if (parsed.length === 0) {
        toast.error("Could not find valid domains in the file");
        return;
      }

      const importResult = await importProspects({
        data: { campaignId: params.id, rows: parsed },
      });
      toast.success(
        `Imported ${importResult.imported} website(s); skipped ${importResult.skipped} duplicate or invalid row(s). Starting Autopilot...`,
      );

      const campaign = await getCampaign({ data: { id: params.id } });
      setActiveCampaign(campaign);
      setTimeout(() => {
        runAutoPilot(campaign.prospects as ProspectFull[]);
      }, 300);

      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to process file");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleAutoImportAndRun(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleAutoImportAndRun(file);
  };

  const handleDownloadTemplate = () => {
    const sampleData = [
      { domain: "techcrunch.com", contact_email: "editor@techcrunch.com", da_dr_score: 92 },
      {
        domain: "searchenginejournal.com",
        contact_email: "pitches@searchenginejournal.com",
        da_dr_score: 88,
      },
      { domain: "hubspot.com", contact_email: "guestpost@hubspot.com", da_dr_score: 93 },
      { domain: "medium.com", contact_email: "", da_dr_score: 96 },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Prospects");
    XLSX.writeFile(wb, "linkforge_sample_prospects.xlsx");
    toast.success("Sample Excel template downloaded");
  };

  const handleStatusChange = async (prospectId: string, status: ProspectStatus) => {
    try {
      await updateProspect({ data: { campaignId: params.id, id: prospectId, status } });
      toast.success(`Status updated to ${status}`);
      await refreshProspects();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update status");
    }
  };

  const handleDelete = async (prospectId: string) => {
    if (!confirm("Remove this prospect from campaign?")) return;
    try {
      await deleteProspect({ data: { campaignId: params.id, id: prospectId } });
      toast.success("Prospect removed");
      if (selectedId === prospectId) {
        setSelectedId(null);
        setDrawerOpen(false);
      }
      await refreshProspects();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete prospect");
    }
  };

  const handleUpdateBacklinkUrl = async (prospectId: string, url: string) => {
    try {
      await updateProspect({
        data: { campaignId: params.id, id: prospectId, live_backlink_url: url || null },
      });
      toast.success("Live article URL saved");
      await refreshProspects();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save URL");
    }
  };

  const handleSendDraftToEditor = async () => {
    if (!selectedProspect) return;
    const titleToSend = article?.title || `Guest Post Contribution for ${selectedProspect.domain}`;
    const contentToSend = article?.markdownContent || body;

    if (!contentToSend) {
      toast.error("Article draft not found. The agent will write it automatically.");
      return;
    }

    setSendingDraft(true);
    try {
      await sendArticleSubmission({
        data: {
          campaignId: params.id,
          prospectId: selectedProspect.id,
          articleTitle: titleToSend,
          articleContent: contentToSend,
        },
      });
      toast.success(
        `🎉 Full article draft dispatched to ${selectedProspect.contact_email} via Gmail!`,
      );
      await refreshProspects();
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to dispatch draft");
    } finally {
      setSendingDraft(false);
    }
  };

  const handleSaveSubmissionApproval = async () => {
    if (!selectedProspect) return;
    const submissionInput = document.getElementById("submissionPageUrl");
    if (!(submissionInput instanceof HTMLInputElement)) {
      toast.error("Submission page field is unavailable.");
      return;
    }

    try {
      const result = await saveSubmissionApproval({
        data: {
          campaignId: params.id,
          prospectId: selectedProspect.id,
          submissionUrl: submissionInput.value,
          approved: !selectedProspect.submission_approved,
        },
      });
      submissionInput.value = result.submissionUrl;
      toast.success(
        result.approved
          ? "Submission page approved. You can now open it and submit manually."
          : "Submission approval withdrawn.",
      );
      await refreshProspects();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update submission approval");
    }
  };

  const handleRejectSubmissionCandidate = async () => {
    if (
      !selectedProspect ||
      !window.confirm(`Reject the guest-post candidate for ${selectedProspect.domain}?`)
    )
      return;
    try {
      await rejectSubmissionCandidate({
        data: { campaignId: params.id, prospectId: selectedProspect.id },
      });
      toast.success("Candidate rejected.");
      await refreshProspects();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reject the candidate");
    }
  };

  const handleOpenAccountPage = async (accountType: "login" | "signup") => {
    if (!selectedProspect?.submission_approved) {
      toast.error("Approve this website before opening its account page.");
      return;
    }
    const authUrl =
      accountType === "signup" ? selectedProspect.signup_url : selectedProspect.login_url;
    if (!authUrl) {
      toast.error(`No discovered ${accountType} page is available for this website.`);
      return;
    }

    setGuidedBrowserBusy(true);
    try {
      const result = await launchGuidedBrowser({
        data: {
          campaignId: params.id,
          prospectId: selectedProspect.id,
          target: accountType,
        },
      });
      setGuidedBrowserInspection(null);
      setGuidedBrowserFillResult(null);
      setManualVerificationComplete(false);
      toast.info(
        result.restoredSession
          ? "Opened the site in its isolated browser and restored its encrypted session. Complete any sign-in directly there."
          : "Opened the site in an isolated browser. Sign in directly there; the app never receives your password.",
      );
      await refreshProspects();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the guided browser");
    } finally {
      setGuidedBrowserBusy(false);
    }
  };

  const handleOpenSubmissionPage = async () => {
    if (!selectedProspect?.submission_approved || !selectedProspect.submission_url) {
      toast.error("Review and approve this site's submission page first.");
      return;
    }

    setGuidedBrowserBusy(true);
    try {
      const result = await launchGuidedBrowser({
        data: {
          campaignId: params.id,
          prospectId: selectedProspect.id,
          target: "submission",
        },
      });
      setGuidedBrowserInspection(null);
      setGuidedBrowserFillResult(null);
      setManualVerificationComplete(false);
      toast.success(
        result.restoredSession
          ? "Opened the submission page with this site's encrypted saved session."
          : "Opened the submission page in an isolated browser window.",
      );
      await refreshProspects();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the submission page");
    } finally {
      setGuidedBrowserBusy(false);
    }
  };

  const handleInspectGuidedBrowser = async () => {
    if (!selectedProspect) return;
    setGuidedBrowserBusy(true);
    try {
      const result = await inspectProspectBrowser({
        data: { campaignId: params.id, prospectId: selectedProspect.id },
      });
      setGuidedBrowserInspection(result);
      setGuidedBrowserFillResult(null);
      setManualVerificationComplete(false);
      toast.success(
        result.submissionFormDetected
          ? `Detected ${result.fields.length} form fields and saved the encrypted browser session.`
          : "Session saved. No recognizable article submission form was detected; manual submission or email outreach may be needed.",
      );
      await refreshProspects();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not inspect the guided browser");
    } finally {
      setGuidedBrowserBusy(false);
    }
  };

  const handleFillGuidedBrowserForm = async () => {
    if (!selectedProspect || !article) return;
    setGuidedBrowserBusy(true);
    try {
      const result = await fillGuidedSubmissionForm({
        data: {
          campaignId: params.id,
          prospectId: selectedProspect.id,
          article: {
            title: article.title,
            content: article.markdownContent,
            authorName: businessProfile.contactName || businessProfile.businessName,
            authorEmail: businessProfile.contactEmail,
            authorBio: businessProfile.businessDescription,
            backlinkUrl: businessProfile.businessWebsite || campaign.target_url,
          },
        },
      });
      setGuidedBrowserFillResult(result);
      toast.success(
        result.filledFields.length
          ? `Filled ${result.filledFields.length} confidently matched field(s). Review the browser form; nothing was submitted.`
          : "No fields could be filled confidently. Complete the form manually in the browser.",
      );
      await refreshProspects();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not fill the submission form");
    } finally {
      setGuidedBrowserBusy(false);
    }
  };

  const handleApproveAndSubmitGuidedForm = async () => {
    if (!selectedProspect || !article || !guidedBrowserInspection?.submissionFormDetected) {
      toast.error("Open and prepare the detected submission form before submitting.");
      return;
    }
    if (guidedBrowserInspection.manualVerificationRequired && !manualVerificationComplete) {
      toast.error("Complete the security check in the browser and confirm it here first.");
      return;
    }
    if (
      !window.confirm(
        `Final approval required: submit “${article.title}” to ${selectedProspect.domain}?`,
      )
    ) {
      return;
    }

    setGuidedBrowserBusy(true);
    try {
      const result = await submitProspectBrowserForm({
        data: {
          campaignId: params.id,
          prospectId: selectedProspect.id,
          finalApproval: true,
          manualVerificationCompleted:
            !guidedBrowserInspection.manualVerificationRequired || manualVerificationComplete,
        },
      });
      if (result.confirmationDetected) {
        toast.success(
          "Submission confirmation detected. It is marked pending editorial review, not published.",
        );
      } else {
        toast.info(
          "The form was submitted, but no confirmation was detected. Check the browser before taking another action; duplicate automatic submission is disabled.",
        );
      }
      await refreshProspects();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit the article");
    } finally {
      setGuidedBrowserBusy(false);
    }
  };

  const handleConfirmManualSubmission = async () => {
    if (
      !selectedProspect ||
      !window.confirm("Have you submitted the article on the approved site?")
    )
      return;
    try {
      await confirmManualSubmission({
        data: { campaignId: params.id, prospectId: selectedProspect.id },
      });
      toast.success("Manual submission recorded. Add the published URL below when available.");
      await refreshProspects();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record the submission");
    }
  };

  const handleSendProspectOutreachInstead = async () => {
    if (!selectedProspect) return;
    setSendingProspectOutreach(true);
    try {
      const pitch = await sendProspectOutreachInstead({
        data: {
          campaignId: params.id,
          prospectId: selectedProspect.id,
          businessInfo: {
            businessName: businessProfile.businessName || campaign.name,
            businessDescription: businessProfile.businessDescription,
            businessWebsite: businessProfile.businessWebsite || campaign.target_url,
            contactName: businessProfile.contactName,
            uniqueValue: businessProfile.uniqueValue,
            customInstructions: businessProfile.keySellingPoints,
          },
        },
      });
      setSubject(pitch.subject);
      setBody(pitch.body);
      toast.success(`Outreach sent to ${selectedProspect.contact_email || "the editor"}.`);
      await refreshProspects();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send outreach");
    } finally {
      setSendingProspectOutreach(false);
    }
  };

  const handleSendFollowUp = async (prospectId?: string) => {
    const targetId = prospectId || selectedProspect?.id;
    if (!targetId) return;
    const pros = prospects.find((p) => p.id === targetId);
    if (!pros?.contact_email) {
      toast.error("Prospect has no contact email to follow up.");
      return;
    }

    setSendingFollowUp(true);
    try {
      await sendFollowUp({
        data: {
          campaignId: params.id,
          prospectId: targetId,
        },
      });
      toast.success(`📨 Follow-up bump dispatched to ${pros.contact_email} via Gmail!`);
      await refreshProspects();
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send follow-up");
    } finally {
      setSendingFollowUp(false);
    }
  };

  const handleExportExcel = () => {
    if (prospects.length === 0) {
      toast.info("No prospects to export yet.");
      return;
    }

    const exportRows = prospects.map((p) => ({
      Domain: p.domain,
      "Contact Email": p.contact_email || "Auto-routed",
      "DA/DR Score": p.da_dr_score || 0,
      Status: p.status,
      "Live Backlink URL": p.live_backlink_url || "",
      "Dofollow Link Equity": p.is_dofollow
        ? "Yes (Dofollow)"
        : p.live_backlink_url
          ? "No (Nofollow)"
          : "Pending",
      "Target Brand": campaign.name,
      "Target URL": campaign.target_url,
      "Anchor Text": campaign.target_anchor,
      "Last Checked": p.last_checked_at ? new Date(p.last_checked_at).toLocaleDateString() : "",
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Outreach Pipeline");
    XLSX.writeFile(
      wb,
      `${campaign.name.toLowerCase().replace(/\s+/g, "_")}_seo_outreach_report.xlsx`,
    );
    toast.success("Executive outreach report exported successfully!");
  };

  const handleReverifyAllLiveLinks = async () => {
    const liveProspects = prospects.filter((p) => p.status === "Live" && p.live_backlink_url);
    if (liveProspects.length === 0) {
      toast.info("No live backlinks to verify yet.");
      return;
    }

    setReverifyingAll(true);
    toast.info(`Scanning ${liveProspects.length} live backlinks for dofollow equity...`);

    let verifiedCount = 0;
    for (const p of liveProspects) {
      try {
        const res = await verifyBacklink({
          data: { campaignId: params.id, prospectId: p.id },
        });
        if (res.linkFound) verifiedCount++;
      } catch {
        // Continue
      }
    }

    await refreshProspects();
    await router.invalidate();
    setReverifyingAll(false);
    toast.success(
      `🛡️ Re-verification complete! ${verifiedCount}/${liveProspects.length} links verified active and dofollow.`,
    );
  };

  const handleVerify = async (prospectId: string) => {
    setVerifyBusy(prospectId);
    try {
      const result = await verifyBacklink({
        data: { campaignId: params.id, prospectId },
      });
      toast.success(result.detail);
      await refreshProspects();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Verification failed");
    } finally {
      setVerifyBusy(null);
    }
  };

  const copyToClipboard = (text: string, label = "Content") => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard!`);
  };

  const pendingCount = prospects.filter((p) => p.status === "Discovered").length;
  const pitchedCount = prospects.filter((p) => p.status === "Pitched").length;
  const repliedCount = prospects.filter((p) => p.status === "Replied").length;
  const liveCount = prospects.filter((p) => p.status === "Live").length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 md:space-y-8 md:p-8">
      {/* ── Top Executive Header ── */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-border pb-6">
        <div>
          <div className="mb-2 text-xs text-muted-foreground flex items-center gap-2">
            <Link
              to="/campaigns"
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              <span>←</span> Campaigns
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">{campaign.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="max-w-full break-words text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {campaign.name}
            </h1>
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-500 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Autonomous Engine Active
            </span>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Globe className="h-3.5 w-3.5 text-primary" />
              Target URL:{" "}
              <a
                href={campaign.target_url}
                target="_blank"
                rel="noreferrer"
                className="break-all font-mono text-primary hover:underline"
              >
                {campaign.target_url}
              </a>
            </span>
            <span>•</span>
            <span>
              Anchor:{" "}
              <strong className="text-foreground bg-primary/10 px-2 py-0.5 rounded font-mono">
                {campaign.target_anchor}
              </strong>
            </span>
            <span>•</span>
            <span>
              Niche: <strong className="text-foreground">{campaign.niche}</strong>
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:items-stretch md:flex-row md:items-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBusinessProfileOpen(!businessProfileOpen)}
            className="h-9 w-full gap-1.5 text-xs md:w-auto"
          >
            <Building2 className="h-4 w-4 text-primary" />
            <span>
              {businessProfileOpen ? "Close Business Context ▲" : "Business Info & Prompt Box ▼"}
            </span>
          </Button>
          <div className="flex flex-col items-stretch gap-1 md:items-end">
            <Button
              size="sm"
              onClick={() => runAutoPilot()}
              disabled={pendingCount === 0 || autoPilotRunning}
              className="h-9 w-full gap-1.5 bg-primary text-xs font-semibold text-primary-foreground shadow-md hover:bg-primary/90 md:w-auto"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Email All Pending Editors ({pendingCount})</span>
            </Button>
            <span className="max-w-72 text-center text-[11px] text-muted-foreground md:text-right">
              Sends without per-email confirmation; contacted and rejected prospects are skipped.
            </span>
          </div>
        </div>
      </div>

      {/* ── Executive Metrics Row ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Card className="border-border/60 bg-card/60 backdrop-blur shadow-sm">
          <CardContent className="flex items-center justify-between p-3 sm:p-4">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Pipeline</p>
              <p className="text-2xl font-bold text-foreground mt-0.5">{prospects.length}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary">
              <Layers className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur shadow-sm">
          <CardContent className="flex items-center justify-between p-3 sm:p-4">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Auto-Pitched</p>
              <p className="text-2xl font-bold text-blue-500 mt-0.5">{pitchedCount}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
              <Send className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur shadow-sm">
          <CardContent className="flex items-center justify-between p-3 sm:p-4">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Replied / In Discussion</p>
              <p className="text-2xl font-bold text-amber-500 mt-0.5">{repliedCount}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
              <Mail className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur shadow-sm">
          <CardContent className="flex items-center justify-between p-3 sm:p-4">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Live Backlinks</p>
              <p className="text-2xl font-bold text-emerald-500 mt-0.5">{liveCount}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Business Profile / Context Collapsible Drawer ── */}
      {businessProfileOpen && (
        <Card className="border-primary/40 bg-card shadow-md animate-in fade-in-50 duration-200">
          <CardHeader className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold">
                  Business Profile & AI Knowledge Box
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The Autonomous Agent uses these details to write high-value guest post articles
                  and personalized outreach pitches.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={handleSaveBusinessProfile}
              className="h-8 w-full text-xs font-semibold sm:w-auto"
            >
              💾 Save Context
            </Button>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="bpName" className="text-xs">
                  Business / Brand Name
                </Label>
                <Input
                  id="bpName"
                  placeholder="e.g. Afimah Clothing Store"
                  value={businessProfile.businessName}
                  onChange={(e) =>
                    setBusinessProfile({ ...businessProfile, businessName: e.target.value })
                  }
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bpSite" className="text-xs">
                  Website URL
                </Label>
                <Input
                  id="bpSite"
                  placeholder="https://example.com"
                  value={businessProfile.businessWebsite}
                  onChange={(e) =>
                    setBusinessProfile({ ...businessProfile, businessWebsite: e.target.value })
                  }
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bpContact" className="text-xs">
                  Sender / Founder Name
                </Label>
                <Input
                  id="bpContact"
                  placeholder="e.g. Aiza Khan"
                  value={businessProfile.contactName}
                  onChange={(e) =>
                    setBusinessProfile({ ...businessProfile, contactName: e.target.value })
                  }
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bpDesc" className="text-xs">
                Business Overview & Services (AI Context Prompt)
              </Label>
              <textarea
                id="bpDesc"
                rows={3}
                placeholder="Explain what your business does, your key products, audience, and strengths..."
                value={businessProfile.businessDescription}
                onChange={(e) =>
                  setBusinessProfile({ ...businessProfile, businessDescription: e.target.value })
                }
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bpUsp" className="text-xs">
                  Unique Selling Propositions (USPs)
                </Label>
                <Input
                  id="bpUsp"
                  placeholder="e.g. 100% organic cotton, zero-waste packaging, 15k+ happy customers"
                  value={businessProfile.uniqueValue}
                  onChange={(e) =>
                    setBusinessProfile({ ...businessProfile, uniqueValue: e.target.value })
                  }
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bpCustom" className="text-xs">
                  Special Guidance for AI
                </Label>
                <Input
                  id="bpCustom"
                  placeholder="e.g. Warm friendly tone, propose 3 trending angles, highlight 2026 industry shifts"
                  value={businessProfile.keySellingPoints}
                  onChange={(e) =>
                    setBusinessProfile({ ...businessProfile, keySellingPoints: e.target.value })
                  }
                  className="text-xs"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Autonomous Live Console ── */}
      {(autoPilotRunning || autoPilotLogs.length > 0) && (
        <Card className="border-primary/40 bg-card shadow-sm overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-border/60 bg-secondary/40 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              <span className="font-semibold text-foreground">
                Autonomous Agent Execution Terminal
              </span>
              <span className="text-[11px] text-muted-foreground">
                ({autoPilotLogs.length} events logged)
              </span>
            </div>
            <div className="flex items-center gap-2">
              {autoPilotRunning ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={stopAutoPilot}
                  className="h-7 text-xs font-semibold"
                >
                  <Pause className="h-3 w-3 mr-1" /> Pause Agent
                </Button>
              ) : (
                <span className="text-xs font-mono text-muted-foreground">⚪ IDLE</span>
              )}
            </div>
          </div>

          {autoPilotProgress && (
            <div className="px-5 py-3 bg-primary/5 border-b border-primary/20 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground flex items-center gap-1.5">
                  <span className="inline-block animate-spin">⚙️</span>
                  <span>Currently Processing:</span>
                  <span className="break-all font-mono font-bold text-primary">
                    {autoPilotProgress.currentDomain}
                  </span>
                </span>
                <span className="text-muted-foreground font-mono">
                  {autoPilotProgress.current} / {autoPilotProgress.total} (
                  {Math.round((autoPilotProgress.current / autoPilotProgress.total) * 100)}%)
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{
                    width: `${Math.round((autoPilotProgress.current / autoPilotProgress.total) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="max-h-48 overflow-y-auto font-mono text-xs bg-secondary/30 p-3 space-y-1">
            {autoPilotLogs.map((log, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="shrink-0 select-none text-muted-foreground/60">
                  [{log.timestamp}]
                </span>
                <span
                  className={`min-w-0 break-words ${
                    log.text.includes("❌")
                      ? "text-destructive font-semibold"
                      : log.text.includes("✅") ||
                          log.text.includes("🚀") ||
                          log.text.includes("Initiating")
                        ? "text-primary font-semibold"
                        : "text-foreground"
                  }`}
                >
                  {log.text}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── BROAD PIPELINE INTERFACE (FULL WIDTH) ── */}
      <div className="min-w-0 space-y-3">
        {/* Pipeline Control Header & Filters */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-secondary/30 p-3 rounded-xl border border-border">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-foreground mr-2 flex items-center gap-1">
              <Layers className="h-3.5 w-3.5 text-primary" />
              <span>Pipeline Stage:</span>
            </span>
            {[
              { id: "all", label: `All Targets (${prospects.length})` },
              {
                id: "Discovered",
                label: `Discovered (${prospects.filter((p) => p.status === "Discovered").length})`,
              },
              { id: "Pitched", label: `Auto-Pitched (${pitchedCount})` },
              { id: "Replied", label: `Replied (${repliedCount})` },
              { id: "Live", label: `Live Links (${liveCount})` },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setFilterStatus(s.id)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  filterStatus === s.id
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "text-muted-foreground border-transparent hover:bg-secondary hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap xl:justify-end">
            <Input
              placeholder="Search domain or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs h-9 w-full sm:w-52"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportExcel}
              className="text-xs h-9 gap-1.5 font-semibold text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 border-emerald-500/30"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export Report</span>
            </Button>
            {liveCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleReverifyAllLiveLinks}
                disabled={reverifyingAll}
                className="text-xs h-9 gap-1.5 font-semibold text-primary hover:text-primary/90 hover:bg-primary/10"
              >
                <RotateCw className={`h-3.5 w-3.5 ${reverifyingAll ? "animate-spin" : ""}`} />
                <span>Re-Verify Live</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs h-9 gap-1.5 font-semibold hover:bg-secondary"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              <span>Import Excel</span>
            </Button>
          </div>
        </div>

        {/* ── Visual Autonomous Pipeline Stage Flow Map ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-secondary/20 p-3 rounded-xl border border-border/80 text-xs">
          <div className="flex items-center gap-2.5 p-2 rounded-lg bg-card/50 border border-border/50">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground font-bold text-xs">
              1
            </div>
            <div>
              <p className="font-semibold text-foreground">1. Queued / Discovered</p>
              <p className="text-[11px] text-muted-foreground">Imported from Excel</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 p-2 rounded-lg bg-card/50 border border-border/50">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-500 font-bold text-xs">
              2
            </div>
            <div>
              <p className="font-semibold text-foreground">2. Auto-Pitched</p>
              <p className="text-[11px] text-muted-foreground">Email scraped & pitch sent</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 p-2 rounded-lg bg-card/50 border border-border/50">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500 font-bold text-xs">
              3
            </div>
            <div>
              <p className="font-semibold text-foreground">3. Replied / Approved</p>
              <p className="text-[11px] text-muted-foreground">Editor accepted guest post</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 p-2 rounded-lg bg-card/50 border border-border/50">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500 font-bold text-xs">
              4
            </div>
            <div>
              <p className="font-semibold text-foreground">4. Live & Verified</p>
              <p className="text-[11px] text-muted-foreground">Article published + backlink</p>
            </div>
          </div>
        </div>

        {/* Broad Drag and Drop Zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition-all ${
            dragActive
              ? "border-primary bg-primary/10 shadow-lg"
              : "border-border/70 hover:border-primary/50 hover:bg-secondary/20"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="flex items-center justify-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <UploadCloud className="h-4 w-4" />
            </div>
            <div className="text-left">
              <p className="text-[11px] font-semibold text-foreground">
                Drop your Prospect Excel spreadsheet (`.xlsx`, `.xls`, `.csv`) anywhere here
              </p>
              <p className="text-[10px] text-muted-foreground">
                ⚡ Auto-Runs immediately: Automatically scrapes editor email ➔ writes customized
                pitch & guest post ➔ sends outreach
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadTemplate();
              }}
              className="ml-auto shrink-0 rounded-lg px-3 py-2 text-[11px] font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              📥 Download Sample Template
            </button>
          </div>
        </div>

        {/* ── BROAD PIPELINE TABLE ── */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {filteredProspects.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                <Layers className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                No prospects found in this view
              </p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Drag and drop your Excel prospect list above to populate target websites and trigger
                the autonomous outreach agent.
              </p>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <p className="px-3 py-2 text-[11px] text-muted-foreground md:hidden">
                Swipe horizontally to view all prospect details.
              </p>
              <table className="w-full min-w-[960px] table-fixed text-left text-xs">
                <colgroup>
                  <col className="w-[19%]" />
                  <col className="w-[17%]" />
                  <col className="w-[8%]" />
                  <col className="w-[13%]" />
                  <col className="w-[20%]" />
                  <col className="w-[10%]" />
                  <col className="w-[13%]" />
                </colgroup>
                <thead className="bg-secondary/60 text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Target Domain</th>
                    <th className="px-3 py-2.5 font-semibold">Contact Email</th>
                    <th className="px-2 py-2.5 font-semibold">Domain Authority</th>
                    <th className="px-2 py-2.5 font-semibold">Pipeline Stage</th>
                    <th className="px-2 py-2.5 font-semibold">Opportunity & Info</th>
                    <th className="px-2 py-2.5 font-semibold">Live Link Equity</th>
                    <th className="px-2 py-2.5 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredProspects.map((p) => (
                    <tr
                      key={p.id}
                      className="transition-colors hover:bg-secondary/30 cursor-pointer group"
                      onClick={() => handleInspectProspect(p.id)}
                    >
                      {/* Target Domain */}
                      <td className="px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground font-semibold text-xs border border-border/80">
                            {p.domain.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="flex min-w-0 items-center gap-1 font-semibold text-foreground group-hover:text-primary transition-colors">
                              <span className="truncate" title={p.domain}>
                                {p.domain}
                              </span>
                              <a
                                href={`https://${p.domain}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Open ${p.domain} in a new tab`}
                                className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:bg-secondary hover:text-foreground"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              Added {new Date(p.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Contact Email */}
                      <td className="px-3 py-2.5">
                        {p.contact_email ? (
                          <div className="flex min-w-0 items-center gap-1">
                            <span
                              className="min-w-0 truncate font-mono text-[11px] text-foreground"
                              title={p.contact_email}
                            >
                              {p.contact_email}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(p.contact_email!, "Email");
                              }}
                              aria-label={`Copy ${p.contact_email}`}
                              title="Copy email"
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground italic">
                            Auto-extracting...
                          </span>
                        )}
                      </td>

                      {/* DA Score */}
                      <td className="px-2 py-2.5">
                        <span className="inline-flex rounded-md bg-secondary px-2 py-1 font-mono text-[11px] text-foreground font-semibold">
                          {p.da_dr_score}
                        </span>
                      </td>

                      {/* Pipeline Stage — Autonomous Smart Badge (No Manual Dropdown) */}
                      <td className="px-2 py-2.5">
                        {p.status === "Live" ? (
                          <span
                            title="Live & Backlink Verified"
                            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-[10px] font-semibold text-emerald-500"
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
                            <span>Live & Verified</span>
                          </span>
                        ) : p.status === "Pitched" ? (
                          <span
                            title="Auto-Pitched & Dispatched"
                            className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-1 text-[10px] font-semibold text-blue-500"
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                            <span>Pitched</span>
                          </span>
                        ) : p.status === "Replied" ? (
                          <span
                            title="Editor Replied / In Progress"
                            className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-[10px] font-semibold text-amber-500"
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                            <span>Replied</span>
                          </span>
                        ) : p.status === "Rejected" ? (
                          <span
                            title="Restricted / Skipped"
                            className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/20 px-2 py-1 text-[10px] font-semibold text-red-500"
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                            <span>Skipped</span>
                          </span>
                        ) : (
                          <span
                            title="Queued in Pipeline"
                            className="inline-flex items-center gap-1.5 rounded-full bg-secondary border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground"
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />
                            <span>Queued</span>
                          </span>
                        )}
                      </td>

                      {/* Opportunity & Info — All Information at a Glance */}
                      <td className="px-2 py-2.5">
                        <div className="flex flex-col gap-1 min-w-0">
                          {p.submission_url ? (
                            <a
                              href={p.submission_url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-primary hover:underline font-medium text-[11px] truncate max-w-[180px]"
                              title={p.submission_url}
                            >
                              <FileText className="h-3 w-3 shrink-0" />
                              <span className="truncate">Write For Us Form</span>
                              <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground/80 flex items-center gap-1 text-[11px]">
                              <Globe className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                              <span>Direct Outreach</span>
                            </span>
                          )}

                          <div className="flex flex-wrap items-center gap-1">
                            <span
                              className="inline-flex items-center rounded bg-secondary/80 border border-border/50 px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono"
                              title={`Workflow status: ${p.workflow_status}`}
                            >
                              {p.workflow_status || "Discovered"}
                            </span>

                            {getDiscoveryPageViews(p.submission_details).length > 0 && (
                              <span className="inline-flex items-center rounded bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[9px] text-primary font-semibold">
                                {getDiscoveryPageViews(p.submission_details)[0]?.eligibility === "free" ? "Free Post" : "Editorial"}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Live Link */}
                      <td className="px-2 py-2.5">
                        {p.status === "Live" ? (
                          <div className="flex min-w-0 items-center gap-1.5">
                            <ToneBadge tone={p.is_dofollow ? "positive" : "warning"}>
                              {p.is_dofollow ? "Dofollow" : "Live"}
                            </ToneBadge>
                            {p.live_backlink_url && (
                              <a
                                href={p.live_backlink_url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                aria-label="Open published article"
                                title="Open published article"
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-primary hover:bg-primary/10"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {p.status === "Pitched" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSendFollowUp(p.id)}
                              disabled={sendingFollowUp}
                              className="h-7 gap-1 px-2 text-[10px] font-semibold text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
                              title="Send follow-up via Gmail"
                            >
                              <RotateCw
                                className={`h-3 w-3 ${sendingFollowUp ? "animate-spin" : ""}`}
                              />
                              <span>Bump</span>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleInspectProspect(p.id)}
                            className="h-7 gap-1 px-2 text-[10px] font-semibold"
                            title="View deliverables"
                          >
                            <span>View</span>
                            <ChevronRight className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(p.id)}
                            className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="Delete target"
                            aria-label={`Delete ${p.domain}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── SPACIOUS SLIDE-OVER SHEET FOR DELIVERABLES (CLEAN & WIDE) ── */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="right"
          className="w-full space-y-6 overflow-y-auto p-4 sm:max-w-2xl sm:p-6"
        >
          {selectedProspect && (
            <>
              <SheetHeader className="border-b border-border/70 pb-4 text-left">
                <div className="flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary font-bold text-xs">
                      {selectedProspect.domain.charAt(0).toUpperCase()}
                    </div>
                    <SheetTitle className="break-all text-lg font-bold">
                      {selectedProspect.domain}
                    </SheetTitle>
                  </div>
                  <ToneBadge tone={selectedProspect.status === "Live" ? "positive" : "neutral"}>
                    {selectedProspect.status}
                  </ToneBadge>
                </div>
                <SheetDescription className="text-xs text-muted-foreground mt-1">
                  Contact:{" "}
                  <strong className="text-foreground">
                    {selectedProspect.contact_email ?? "Auto-extracting"}
                  </strong>
                </SheetDescription>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                  <div className="text-xs text-muted-foreground">
                    Workflow:{" "}
                    <strong className="text-foreground">{selectedProspect.workflow_status}</strong>
                    {gmailConnection && (
                      <span className="ml-2">· Inbox: {gmailConnection.email}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCheckEmailReplies}
                      disabled={gmailChecking}
                      className="h-8 gap-1.5 text-xs"
                    >
                      {gmailConnection ? (
                        <RefreshMailbox
                          className={`h-3.5 w-3.5 ${gmailChecking ? "animate-spin" : ""}`}
                        />
                      ) : (
                        <Inbox className="h-3.5 w-3.5" />
                      )}
                      {gmailChecking
                        ? "Checking editor replies…"
                        : gmailConnection
                          ? "Check for editor replies"
                          : "Connect Gmail & check replies"}
                    </Button>
                    {gmailConnection && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleDisconnectGmail}
                        disabled={gmailDisconnecting}
                        className="h-8 text-xs text-muted-foreground"
                      >
                        {gmailDisconnecting ? "Disconnecting…" : "Disconnect Gmail"}
                      </Button>
                    )}
                  </div>
                </div>
              </SheetHeader>

              {gmailError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  Gmail status: {gmailError}
                </div>
              )}

              {gmailConnection?.lastCheckedAt && (
                <p className="text-[11px] text-muted-foreground">
                  Last inbox check: {new Date(gmailConnection.lastCheckedAt).toLocaleString()}
                  {" · "}The local app checks connected inboxes every 15 minutes while the server is
                  running.
                </p>
              )}

              <section className="space-y-4 rounded-xl border border-border/70 p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  1. Outreach and editor replies
                </h3>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Mail className="h-4 w-4 text-primary" />
                    <span>Outreach Pitch Proposal</span>
                  </span>
                  <div className="flex items-center gap-2">
                    {selectedProspect.status === "Pitched" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSendFollowUp(selectedProspect.id)}
                        disabled={sendingFollowUp}
                        className="h-7 text-xs gap-1 text-blue-500 border-blue-500/30 hover:bg-blue-500/10"
                      >
                        <RotateCw className={`h-3 w-3 ${sendingFollowUp ? "animate-spin" : ""}`} />
                        <span>{sendingFollowUp ? "Sending Bump…" : "Send Follow-Up Bump"}</span>
                      </Button>
                    )}
                    {body && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard(`Subject: ${subject}\n\n${body}`, "Pitch")}
                        className="h-7 text-xs gap-1"
                      >
                        <Copy className="h-3 w-3" />
                        <span>Copy Pitch</span>
                      </Button>
                    )}
                  </div>
                </div>

                {subject ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border bg-secondary/30 p-3">
                      <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                        Email Subject
                      </p>
                      <p className="text-xs font-semibold text-foreground mt-1">{subject}</p>
                    </div>

                    <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-1.5">
                      <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                        Email Body
                      </p>
                      <div className="text-xs leading-relaxed text-foreground whitespace-pre-wrap font-sans">
                        {body}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground bg-primary/5 border border-primary/20 rounded-lg p-3">
                      <span>
                        Recipient: <strong>{selectedProspect.contact_email || "editor"}</strong>
                      </span>
                      <span className="text-emerald-500 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Dispatched</span>
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-lg space-y-2">
                    <p>Pitch not yet drafted for this prospect.</p>
                    <p className="text-[11px]">
                      The autonomous agent drafts and dispatches this automatically during the
                      Autopilot cycle.
                    </p>
                  </div>
                )}
                <div className="space-y-2 border-t border-border pt-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-foreground">Editor email replies</p>
                    <span className="text-[11px] text-muted-foreground">
                      {gmailConnection
                        ? `Checking ${gmailConnection.email}`
                        : "Connect Gmail to detect replies"}
                    </span>
                  </div>
                  {gmailReplies.length === 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        No matching replies found yet. Use “Check for editor replies” above to sync
                        now; the local app also checks connected campaigns every 15 minutes while
                        the server is running.
                      </p>
                      {selectedProspect.status === "Replied" && (
                        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
                          This prospect is marked “Replied”, but no incoming editor reply has been
                          synced. Sending an article draft does not count as a reply; connect Gmail
                          and check the inbox to confirm the status.
                        </p>
                      )}
                    </div>
                  ) : (
                    gmailReplies.map((reply) => (
                      <div
                        key={reply.id}
                        className="rounded-lg border border-border bg-secondary/30 p-3 text-xs space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong className="text-foreground">{reply.subject}</strong>
                          <ToneBadge
                            tone={reply.classification === "positive" ? "positive" : "neutral"}
                          >
                            {reply.classification === "positive"
                              ? "Editor accepted"
                              : reply.classification === "negative"
                                ? "Editor declined"
                                : "Reply received"}
                          </ToneBadge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          From {reply.sender} · {new Date(reply.received_at).toLocaleString()}
                        </p>
                        <p className="whitespace-pre-wrap leading-relaxed text-foreground/90">
                          {reply.body_text}
                        </p>
                        {reply.classification === "positive" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            onClick={() =>
                              document.getElementById("guest-post-article")?.scrollIntoView({
                                behavior: "smooth",
                              })
                            }
                          >
                            Review article before submission
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section
                id="guest-post-article"
                className="space-y-4 rounded-xl border border-border/70 p-4"
              >
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  2. Article draft
                </h3>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-primary" />
                    <span>Auto-Generated SEO Guest Post</span>
                  </span>
                  {article && (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => copyToClipboard(article.markdownContent, "Article Markdown")}
                        className="h-7 text-xs gap-1"
                      >
                        <Copy className="h-3 w-3" />
                        <span>Copy Markdown</span>
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          document.getElementById("guest-post-submission")?.scrollIntoView({
                            behavior: "smooth",
                          })
                        }
                        className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                      >
                        Review Submission →
                      </Button>
                    </div>
                  )}
                </div>

                <div className="p-3 bg-primary/5 rounded-lg border border-primary/20 text-xs flex items-center justify-between">
                  <span>
                    Contextual Anchor:{" "}
                    <strong className="text-primary font-mono font-semibold">
                      [{campaign.target_anchor}](
                      {businessProfile.businessWebsite || campaign.target_url})
                    </strong>
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    100% Unique Draft
                  </span>
                </div>

                {article ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border bg-secondary/30 p-3">
                      <p className="text-sm font-bold text-foreground">{article.title}</p>
                      {article.metaDescription && (
                        <p className="text-xs text-muted-foreground mt-1 italic">
                          {article.metaDescription}
                        </p>
                      )}
                    </div>

                    <div className="p-4 bg-secondary/40 rounded-lg max-h-96 overflow-y-auto text-xs font-mono whitespace-pre-wrap text-foreground/90 border border-border leading-relaxed">
                      {article.markdownContent}
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-lg space-y-2">
                    <p>Article not yet written for this prospect.</p>
                    <p className="text-[11px]">
                      The autonomous agent writes the tailored article with your backlink
                      automatically.
                    </p>
                  </div>
                )}
              </section>

              <section
                id="guest-post-submission"
                className="space-y-6 rounded-xl border border-border/70 p-4"
              >
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  3. Website submission and verification
                </h3>
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                      Website guest-post submission
                    </h4>
                    <ToneBadge
                      tone={
                        selectedProspect.workflow_status === "Rejected"
                          ? "danger"
                          : selectedProspect.workflow_status === "Email Outreach"
                            ? "neutral"
                            : "positive"
                      }
                    >
                      {selectedProspect.workflow_status}
                    </ToneBadge>
                    {selectedProspect.submission_completed_at && (
                      <ToneBadge tone="positive">✓ Submission confirmed</ToneBadge>
                    )}
                    {selectedProspect.submission_approved &&
                      !selectedProspect.submission_completed_at && (
                        <ToneBadge tone="positive">✓ Site approved</ToneBadge>
                      )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {selectedProspect.submission_url
                      ? "A possible guest-post page was found. Check its current rules yourself before approving it. Your login stays on that website; this app never asks for or stores its password."
                      : "If you have a guest-post submission page for this site, add it here. The app will only open it after you explicitly approve it."}
                  </p>
                  {safeSubmissionUrl && (
                    <p className="text-xs break-all">
                      Suggested page:{" "}
                      <a
                        className="text-primary underline underline-offset-2"
                        href={safeSubmissionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {selectedProspect.submission_url}
                      </a>
                    </p>
                  )}
                  {getDiscoveryPageViews(selectedProspect.submission_details).map((page) => (
                    <div
                      key={page.url}
                      className="rounded-lg border border-border bg-card/70 p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-xs">
                          {page.title || page.kind} · {page.eligibility} submission ·{" "}
                          {page.authentication} authentication
                        </strong>
                        <span className="text-[11px] text-muted-foreground">
                          External links: {page.externalLinks}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground break-all">{page.url}</p>
                      {page.instructions && (
                        <details className="text-xs">
                          <summary className="cursor-pointer font-medium">
                            Review extracted guidelines
                          </summary>
                          <p className="mt-2 leading-relaxed">{page.instructions}</p>
                        </details>
                      )}
                      {page.fields.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          Detected fields:{" "}
                          {page.fields
                            .map((field) => `${field.label}${field.required ? " (required)" : ""}`)
                            .join(", ")}
                        </p>
                      )}
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <Label htmlFor="submissionPageUrl" className="text-xs">
                      Guest-post page on {selectedProspect.domain}
                    </Label>
                    <Input
                      key={selectedProspect.id}
                      id="submissionPageUrl"
                      type="url"
                      placeholder={`https://${selectedProspect.domain}/write-for-us`}
                      defaultValue={selectedProspect.submission_url ?? ""}
                      className="text-xs h-8"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      variant={selectedProspect.submission_approved ? "secondary" : "default"}
                      className="w-full text-xs h-9"
                      onClick={handleSaveSubmissionApproval}
                    >
                      {selectedProspect.submission_approved
                        ? "Withdraw site approval"
                        : "I confirm this site accepts guest posts"}
                    </Button>
                    <Button
                      variant="secondary"
                      className="w-full text-xs h-9"
                      onClick={handleOpenSubmissionPage}
                      disabled={!selectedProspect.submission_approved || guidedBrowserBusy}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Open in guided browser
                    </Button>
                  </div>
                  {selectedProspect.submission_approved && safeSubmissionUrl && (
                    <a
                      className="inline-flex text-xs text-primary underline underline-offset-2"
                      href={safeSubmissionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open submission page in your browser
                    </a>
                  )}
                  {selectedProspect.submission_approved && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        variant="outline"
                        className="w-full text-xs h-8"
                        onClick={() => handleOpenAccountPage("signup")}
                        disabled={!selectedProspect.signup_url || guidedBrowserBusy}
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        Open signup in guided browser
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full text-xs h-8"
                        onClick={() => handleOpenAccountPage("login")}
                        disabled={!selectedProspect.login_url || guidedBrowserBusy}
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        Open login in guided browser
                      </Button>
                    </div>
                  )}
                  {selectedProspect.submission_approved && (
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                      {safeSignupUrl && (
                        <a
                          className="text-primary underline underline-offset-2"
                          href={safeSignupUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open signup page in your browser
                        </a>
                      )}
                      {safeLoginUrl && (
                        <a
                          className="text-primary underline underline-offset-2"
                          href={safeLoginUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open login page in your browser
                        </a>
                      )}
                    </div>
                  )}
                  {selectedProspect.submission_approved && (
                    <div className="space-y-3 rounded-lg border border-border/70 bg-card/60 p-3">
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        The guided browser is available when LinkForge runs locally on a desktop. On
                        Vercel, open the website links above in your own browser. Sign-in details
                        stay on the website; CAPTCHA, MFA and security checks remain manual.
                      </p>
                      <Button
                        variant="outline"
                        className="h-8 w-full text-xs"
                        onClick={handleInspectGuidedBrowser}
                        disabled={guidedBrowserBusy}
                      >
                        {guidedBrowserBusy
                          ? "Saving session & opening submission page…"
                          : "I’m signed in — continue to submission form"}
                      </Button>
                      {guidedBrowserInspection && (
                        <div className="space-y-2 text-[11px]">
                          <p className="font-semibold text-foreground">
                            {guidedBrowserInspection.submissionFormDetected
                              ? "Article submission form detected"
                              : "No recognizable article form detected"}
                            {" · "}
                            {guidedBrowserInspection.title || guidedBrowserInspection.url}
                          </p>
                          {guidedBrowserInspection.fields.length > 0 && (
                            <p className="text-muted-foreground">
                              Fields:{" "}
                              {guidedBrowserInspection.fields
                                .map(
                                  (field) =>
                                    `${field.label}${field.required ? " (required)" : ""}${field.manualOnly ? " (manual)" : ""}`,
                                )
                                .join(", ")}
                            </p>
                          )}
                          {guidedBrowserInspection?.manualVerificationRequired && (
                            <p className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-amber-700 dark:text-amber-300">
                              This page has a security or verification field. Complete it yourself
                              in the browser; the app will not fill or bypass it.
                            </p>
                          )}
                          {guidedBrowserInspection.submissionFormDetected && article && (
                            <Button
                              className="h-8 w-full text-xs"
                              onClick={handleFillGuidedBrowserForm}
                              disabled={guidedBrowserBusy}
                            >
                              {guidedBrowserBusy
                                ? "Filling supported fields…"
                                : "Fill confidently matched article fields"}
                            </Button>
                          )}
                        </div>
                      )}
                      {guidedBrowserFillResult && (
                        <div className="space-y-1 text-[11px]">
                          <p className="text-foreground">
                            Filled: {guidedBrowserFillResult.filledFields.join(", ") || "none"}
                          </p>
                          {guidedBrowserFillResult.requiredFieldsToComplete.length > 0 && (
                            <p className="text-amber-700 dark:text-amber-300">
                              Complete manually:{" "}
                              {guidedBrowserFillResult.requiredFieldsToComplete.join(", ")}
                            </p>
                          )}
                          <p className="font-medium text-muted-foreground">
                            Review the full article in this campaign and every field in the browser.
                            “Approve & Submit” below will only proceed after your explicit
                            confirmation.
                          </p>
                          {guidedBrowserInspection?.manualVerificationRequired && (
                            <label className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-amber-700 dark:text-amber-300">
                              <input
                                type="checkbox"
                                checked={manualVerificationComplete}
                                onChange={(event) =>
                                  setManualVerificationComplete(event.target.checked)
                                }
                                className="mt-0.5"
                              />
                              I completed the CAPTCHA/security check myself in the browser.
                            </label>
                          )}
                          <Button
                            className="h-9 w-full text-xs"
                            onClick={handleApproveAndSubmitGuidedForm}
                            disabled={
                              guidedBrowserBusy ||
                              Boolean(
                                selectedProspect.submission_attempted_at ||
                                selectedProspect.submission_completed_at,
                              ) ||
                              (guidedBrowserInspection?.manualVerificationRequired &&
                                !manualVerificationComplete)
                            }
                          >
                            {selectedProspect.submission_completed_at
                              ? "Submission recorded"
                              : selectedProspect.submission_attempted_at
                                ? "Check browser — retry disabled"
                                : "Approve & Submit Article"}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  {selectedProspect.workflow_status === "Awaiting Approval" && (
                    <Button
                      variant="outline"
                      className="w-full text-xs h-8"
                      onClick={handleRejectSubmissionCandidate}
                    >
                      Reject this candidate
                    </Button>
                  )}
                  {selectedProspect.submission_approved && article && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        variant="outline"
                        className="w-full text-xs h-8"
                        onClick={() => copyToClipboard(article.title, "Article title")}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                        Copy article title
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full text-xs h-8"
                        onClick={() => copyToClipboard(article.markdownContent, "Article")}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                        Copy article
                      </Button>
                    </div>
                  )}
                  {selectedProspect.submission_approved &&
                    !selectedProspect.submission_completed_at && (
                      <Button
                        variant="secondary"
                        className="w-full text-xs h-8"
                        onClick={handleConfirmManualSubmission}
                      >
                        I submitted the article on the website
                      </Button>
                    )}
                  {selectedProspect.submission_completed_at && (
                    <p className="text-[11px] text-muted-foreground">
                      Submission confirmation saved{" "}
                      {new Date(selectedProspect.submission_completed_at).toLocaleString()}. This
                      does not mean the article is published; add its live URL after editorial
                      approval.
                    </p>
                  )}
                  {selectedProspect.submission_attempted_at &&
                    !selectedProspect.submission_completed_at && (
                      <p className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                        A submit attempt was recorded on{" "}
                        {new Date(selectedProspect.submission_attempted_at).toLocaleString()}, but
                        no confirmation was detected. Check the browser before retrying; automatic
                        duplicate submission is blocked.
                      </p>
                    )}
                  {selectedProspect.submission_reference && (
                    <p className="text-[11px] text-muted-foreground">
                      Submission reference: {selectedProspect.submission_reference}
                    </p>
                  )}
                  {selectedProspect.submission_result_url && (
                    <a
                      href={selectedProspect.submission_result_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-primary underline"
                    >
                      Open submission confirmation page
                    </a>
                  )}
                  {selectedProspect.submission_url &&
                    selectedProspect.workflow_status !== "Email Outreach" &&
                    selectedProspect.workflow_status !== "Submitted" &&
                    selectedProspect.workflow_status !== "Submission Verified" && (
                      <Button
                        variant="outline"
                        className="w-full text-xs h-8"
                        onClick={handleSendProspectOutreachInstead}
                        disabled={sendingProspectOutreach}
                      >
                        <Mail className="h-3.5 w-3.5 mr-1.5" />
                        {sendingProspectOutreach
                          ? "Sending email outreach…"
                          : "This page does not allow free submissions — use email outreach"}
                      </Button>
                    )}
                </div>

                {/* Email-based editor submission remains available as a fallback. */}
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-primary font-bold text-xs">
                        <Send className="h-3 w-3" />
                      </span>
                      <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                        1. Email Article Draft to Editor
                      </h4>
                    </div>
                    {selectedProspect.status === "Replied" && (
                      <ToneBadge tone="positive">✓ Draft Dispatched</ToneBadge>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    The autonomous agent has written the full SEO guest post with your embedded
                    backlink (<strong>{campaign.target_anchor}</strong> →{" "}
                    <strong>{campaign.target_url}</strong>). Dispatch the complete draft directly to
                    the editor's inbox via your Gmail.
                  </p>

                  <div className="rounded-lg bg-card/70 border border-border p-3 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Editor Recipient:</span>
                      <strong className="text-foreground">
                        {selectedProspect.contact_email || "editor@" + selectedProspect.domain}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Article Title:</span>
                      <strong className="text-foreground truncate max-w-[280px]">
                        {article?.title || `Tailored SEO Guest Post for ${selectedProspect.domain}`}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Embedded Backlink:</span>
                      <span className="text-primary font-medium">
                        {campaign.target_url} ({campaign.target_anchor})
                      </span>
                    </div>
                  </div>

                  <Button
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs h-9 gap-2 shadow-sm"
                    onClick={handleSendDraftToEditor}
                    disabled={sendingDraft || !selectedProspect.contact_email}
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>
                      {sendingDraft
                        ? "Dispatching Full Draft via Gmail…"
                        : selectedProspect.status === "Replied"
                          ? "📧 Re-Send Article Draft to Editor via Gmail"
                          : "📧 Dispatch Full Article Draft to Editor via Gmail"}
                    </span>
                  </Button>
                </div>

                {/* Live Verification Card (For Both Scenarios) */}
                <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <span>Live Backlink Verification</span>
                    </h4>
                    {selectedProspect.status === "Live" && (
                      <ToneBadge tone="positive">✓ Live Verified</ToneBadge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Once the article is published on their website, enter their live URL below and
                    verify dofollow link equity.
                  </p>

                  <div className="space-y-1.5">
                    <Label htmlFor="liveUrlVerify" className="text-xs">
                      Published Article URL
                    </Label>
                    <Input
                      id="liveUrlVerify"
                      type="url"
                      placeholder="https://targetsite.com/blog/published-post"
                      defaultValue={selectedProspect.live_backlink_url ?? ""}
                      onBlur={(e) => {
                        const current = selectedProspect.live_backlink_url ?? "";
                        if (e.target.value !== current) {
                          handleUpdateBacklinkUrl(selectedProspect.id, e.target.value);
                        }
                      }}
                      className="text-xs h-8"
                    />
                  </div>

                  <Button
                    variant="secondary"
                    className="w-full text-xs font-semibold h-8"
                    onClick={() => handleVerify(selectedProspect.id)}
                    disabled={verifyBusy === selectedProspect.id}
                  >
                    {verifyBusy === selectedProspect.id
                      ? "Scanning HTML for link equity…"
                      : "🔍 Scan & Verify Dofollow Backlink"}
                  </Button>
                </div>
              </section>

              <section className="space-y-4 rounded-xl border border-border/70 p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  4. Email and delivery history
                </h3>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Outreach Records
                  </p>
                  {logsLoading ? (
                    <p className="text-xs text-muted-foreground">Loading log records…</p>
                  ) : logs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No email records found yet.</p>
                  ) : (
                    logs.map((log) => (
                      <div
                        key={log.id}
                        className="p-3 rounded-lg bg-secondary/30 border border-border text-xs space-y-1"
                      >
                        <p className="font-semibold text-foreground truncate">{log.subject}</p>
                        <p className="text-muted-foreground text-[11px]">
                          Dispatched on {new Date(log.sent_at).toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

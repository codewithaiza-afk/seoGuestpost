import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Globe,
  Mail,
  Send,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  TrendingUp,
  Plus,
  ArrowRight,
  Sparkles,
  Zap,
  Layers,
  Activity,
  FileText,
  Clock,
  ChevronRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, ToneBadge } from "@/components/ui/card";
import { getCurrentUser } from "@/functions/auth.functions";
import { getDashboardStats, listCampaigns } from "@/functions/data.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Command Center — LinkForge" },
      {
        name: "description",
        content:
          "Autonomous guest post outreach pipeline, real Gmail dispatch, and live backlink monitoring.",
      },
      { property: "og:title", content: "Command Center — LinkForge" },
      {
        property: "og:description",
        content: "Autonomous guest post outreach and live backlink dashboard.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async () => {
    try {
      return { stats: await getDashboardStats(), campaigns: await listCampaigns() };
    } catch (err) {
      console.error("[dashboard loader error]:", err);
      return {
        stats: {
          campaigns: 0,
          prospects: 0,
          pitched: 0,
          replied: 0,
          live: 0,
          rejected: 0,
          dofollow: 0,
        },
        campaigns: [],
      };
    }
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { stats, campaigns } = Route.useLoaderData();
  const [fullName, setFullName] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string>("");

  useEffect(() => {
    getCurrentUser().then((user) => {
      setFullName(user?.fullName ?? "");
      setUserEmail(user?.email ?? "");
    });
  }, []);

  const dofollowRate = stats.live > 0 ? Math.round((stats.dofollow / stats.live) * 100) : 100;
  const pitchRate = stats.prospects > 0 ? Math.round((stats.pitched / stats.prospects) * 100) : 0;
  const replyRate = stats.pitched > 0 ? Math.round((stats.replied / stats.pitched) * 100) : 0;
  const primaryCampaign = campaigns[0] ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 md:space-y-8 md:p-10">
      {/* ── TOP HERO HEADER & SYSTEM STATUS ── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card/90 to-secondary/30 p-4 shadow-sm sm:p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-0.5 text-xs font-semibold text-emerald-500 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Autonomous Agent Online</span>
              </span>
              <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                <Mail className="h-3 w-3 text-primary" />
                <span className="truncate">Email account: {userEmail || "not loaded"}</span>
              </span>
            </div>

            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
              {fullName ? `Welcome back, ${fullName}` : "Autonomous SEO Command Center"}
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              LinkForge continuously extracts high-authority editor contacts, writes hyper-tailored
              guest post articles, dispatches outreach emails, and verifies dofollow backlink
              equity.
            </p>
          </div>

          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
            {primaryCampaign && (
              <Link
                to="/campaigns/$id"
                params={{ id: primaryCampaign.id }}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
              >
                <Zap className="h-4 w-4" />
                <span>Open Active Studio</span>
                <ArrowRight className="h-4 w-4 ml-0.5" />
              </Link>
            )}
            <Link
              to="/campaigns"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-all hover:bg-secondary"
            >
              <Plus className="h-4 w-4" />
              <span>New Campaign</span>
            </Link>
          </div>
        </div>

        {/* Subtle Decorative Background Light */}
        <div className="absolute top-0 right-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
      </div>

      {/* ── 5 EXECUTIVE KPI METRICS ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Metric 1: Total Prospects */}
        <Card className="border-border/80 bg-card hover:border-border transition-all shadow-sm">
          <CardContent className="p-5 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Targets Scraped
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-foreground">
                <Globe className="h-4 w-4" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-foreground">{stats.prospects}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Across {stats.campaigns} active campaigns
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Metric 2: Pitched via Gmail */}
        <Card className="border-border/80 bg-card hover:border-blue-500/30 transition-all shadow-sm">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
                Dispatched Pitches
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15 text-blue-500">
                <Send className="h-4 w-4" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-blue-500">{stats.pitched}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {pitchRate}% of pipeline pitched
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Metric 3: Editor Approvals */}
        <Card className="border-border/80 bg-card hover:border-amber-500/30 transition-all shadow-sm">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                Editor Replies
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
                <Activity className="h-4 w-4" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-amber-500">{stats.replied}</p>
              <p className="text-[11px] text-muted-foreground mt-1">In progress & drafts sent</p>
            </div>
          </CardContent>
        </Card>

        {/* Metric 4: Live Backlinks */}
        <Card className="border-border/80 bg-card hover:border-emerald-500/30 transition-all shadow-sm">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                Live Published
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500">
                <ExternalLink className="h-4 w-4" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-emerald-500">{stats.live}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Verified on live domains</p>
            </div>
          </CardContent>
        </Card>

        {/* Metric 5: Dofollow Rate */}
        <Card className="border-border/80 bg-card hover:border-emerald-500/30 transition-all shadow-sm col-span-2 md:col-span-1">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                Dofollow Equity
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500">
                <ShieldCheck className="h-4 w-4" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-foreground">{dofollowRate}%</p>
              <p className="text-[11px] text-emerald-500 font-medium mt-1">
                {stats.dofollow} dofollow link{stats.dofollow === 1 ? "" : "s"} passing equity
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── AUTONOMOUS CONVERSION FUNNEL (JOURNEY MAP) ── */}
      <Card className="border-border/80 bg-card shadow-sm">
        <CardHeader className="pb-3 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-foreground">
                Autonomous Outreach Pipeline Funnel
              </CardTitle>
            </div>
            <span className="text-xs text-muted-foreground">Real-time status conversion</span>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative">
            {/* Step 1: Discovered */}
            <div className="p-4 rounded-xl border border-border/70 bg-secondary/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-muted-foreground uppercase">
                  1. Import & Crawl
                </span>
                <span className="text-xs font-semibold text-foreground">
                  {stats.prospects} Sites
                </span>
              </div>
              <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                <div className="bg-muted-foreground/60 h-full w-full rounded-full" />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Auto-scanned /write-for-us, contacts, & Cloudflare decoders.
              </p>
            </div>

            {/* Step 2: Auto-Pitched */}
            <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-400 uppercase">2. Real Outreach</span>
                <span className="text-xs font-semibold text-blue-500">{stats.pitched} Pitched</span>
              </div>
              <div className="w-full bg-blue-500/20 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${pitchRate}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Dispatched directly via your Gmail with tailored topics.
              </p>
            </div>

            {/* Step 3: Replied / In Progress */}
            <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-400 uppercase">3. Editor Review</span>
                <span className="text-xs font-semibold text-amber-500">
                  {stats.replied} Approvals
                </span>
              </div>
              <div className="w-full bg-amber-500/20 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-amber-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${replyRate}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Editor requested full draft; dispatched via 1-click submission.
              </p>
            </div>

            {/* Step 4: Live Verified */}
            <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400 uppercase">
                  4. Live Backlinks
                </span>
                <span className="text-xs font-semibold text-emerald-500">{stats.live} Live</span>
              </div>
              <div className="w-full bg-emerald-500/20 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${stats.live > 0 ? 100 : 0}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Live URL verified with active dofollow equity pass.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── CAMPAIGNS PORTFOLIO ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Active Campaigns Portfolio</h2>
            <p className="text-xs text-muted-foreground">
              Each campaign targets custom anchors, target URLs, and tailored articles.
            </p>
          </div>
          <Link
            to="/campaigns"
            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
          >
            <span>Manage All Campaigns</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {campaigns.length === 0 ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>No campaigns created yet</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                Create your first campaign to define your brand name, target backlink URL, and
                anchor text.
              </p>
              <Link
                to="/campaigns"
                className="inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Create First Campaign
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((c) => {
              const counts = (c.prospects as { status: string }[] | null) ?? [];
              const totalProspects = counts.length;
              const pitched = counts.filter((p) => p.status === "Pitched").length;
              const replied = counts.filter((p) => p.status === "Replied").length;
              const live = counts.filter((p) => p.status === "Live").length;
              const progressPct =
                totalProspects > 0 ? Math.round((live / totalProspects) * 100) : 0;

              return (
                <Link key={c.id} to="/campaigns/$id" params={{ id: c.id }} className="group">
                  <Card className="h-full border-border/80 bg-card hover:border-primary/50 hover:shadow-md transition-all">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base font-bold text-foreground group-hover:text-primary transition-colors truncate">
                          {c.name}
                        </CardTitle>
                        <span className="rounded-full bg-secondary border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase">
                          {c.niche || "SEO"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate font-mono mt-1">
                        🔗 {c.target_url}
                      </p>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between text-xs rounded-lg bg-secondary/40 p-2.5">
                        <span className="text-muted-foreground">Anchor Text:</span>
                        <span className="font-semibold text-foreground">"{c.target_anchor}"</span>
                      </div>

                      {/* Mini metric pills */}
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="p-2 rounded-lg bg-secondary/30">
                          <p className="text-foreground font-bold">{totalProspects}</p>
                          <p className="text-[10px] text-muted-foreground">Sites</p>
                        </div>
                        <div className="p-2 rounded-lg bg-blue-500/10">
                          <p className="text-blue-500 font-bold">{pitched}</p>
                          <p className="text-[10px] text-muted-foreground">Pitched</p>
                        </div>
                        <div className="p-2 rounded-lg bg-emerald-500/10">
                          <p className="text-emerald-500 font-bold">{live}</p>
                          <p className="text-[10px] text-muted-foreground">Live Links</p>
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between text-xs font-semibold text-primary group-hover:translate-x-0.5 transition-transform">
                        <span>Open Autonomous Studio</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── 3 SYSTEM CAPABILITIES HIGHLIGHTS ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        <div className="rounded-xl border border-border/70 bg-secondary/20 p-4 space-y-2">
          <div className="flex items-center gap-2 text-primary font-semibold text-xs">
            <Globe className="h-4 w-4" />
            <span>Multi-Strategy Email Crawler</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Crawls target sites, scrapes `/write-for-us` guidelines, contacts, and decodes
            obfuscated Cloudflare email tokens automatically.
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-secondary/20 p-4 space-y-2">
          <div className="flex items-center gap-2 text-primary font-semibold text-xs">
            <FileText className="h-4 w-4" />
            <span>AI Guest Post Architect</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Generates 100% unique, human-quality guest post articles with your designated anchor
            text and backlink naturally embedded.
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-secondary/20 p-4 space-y-2">
          <div className="flex items-center gap-2 text-primary font-semibold text-xs">
            <ShieldCheck className="h-4 w-4" />
            <span>Dofollow Equity Watchdog</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Regularly inspects published URLs HTML to confirm your anchor text remains active and
            continues passing full dofollow link juice.
          </p>
        </div>
      </div>
    </div>
  );
}

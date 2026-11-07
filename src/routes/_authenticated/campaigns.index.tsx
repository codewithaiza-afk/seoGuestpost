import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, ToneBadge } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import { createCampaign, deleteCampaign, listCampaigns } from "@/functions/data.functions";

export const Route = createFileRoute("/_authenticated/campaigns/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Campaigns — LinkForge" },
      {
        name: "description",
        content: "Manage your guest post outreach campaigns.",
      },
      { property: "og:title", content: "Campaigns — LinkForge" },
      { property: "og:type", content: "website" },
    ],
  }),
  loader: async () => {
    try {
      return { campaigns: await listCampaigns() };
    } catch (err) {
      console.error("[campaigns loader error]:", err);
      return { campaigns: [] };
    }
  },
  component: CampaignsListPage,
});

const NICHES = [
  "SaaS / Tech",
  "Health & Wellness",
  "Finance & Fintech",
  "Travel",
  "E-commerce",
  "Marketing",
  "Education",
  "Real Estate",
  "Legal",
  "Other",
];

function CampaignsListPage() {
  const { campaigns } = Route.useLoaderData();
  const router = useRouter();

  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [targetAnchor, setTargetAnchor] = useState("");
  const [niche, setNiche] = useState(NICHES[0] ?? "");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createCampaign({
        data: { name, target_url: targetUrl, target_anchor: targetAnchor, niche },
      });
      toast.success("Campaign created");
      setShowForm(false);
      setName("");
      setTargetUrl("");
      setTargetAnchor("");
      setNiche(NICHES[0] ?? "");
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create campaign");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this campaign and all its prospects?")) return;
    setDeletingId(id);
    try {
      await deleteCampaign({ data: { id } });
      toast.success("Campaign deleted");
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete campaign");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 md:p-10">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each campaign targets one URL with a specific anchor text.
          </p>
        </div>
        <Button className="w-full sm:w-auto" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New campaign"}
        </Button>
      </header>

      {showForm && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>New campaign</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Campaign name</Label>
                <Input
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My SaaS Blog Outreach"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="niche">Niche</Label>
                <Select id="niche" value={niche} onChange={(e) => setNiche(e.target.value)}>
                  {NICHES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="targetUrl">Target URL</Label>
                <Input
                  id="targetUrl"
                  type="url"
                  required
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="https://example.com/your-page"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="targetAnchor">Anchor text</Label>
                <Input
                  id="targetAnchor"
                  required
                  value={targetAnchor}
                  onChange={(e) => setTargetAnchor(e.target.value)}
                  placeholder="best project management tools"
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Creating…" : "Create campaign"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {campaigns.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No campaigns yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Create your first campaign to start prospecting and pitching guest posts.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => {
            const counts = (c.prospects as { status: string }[] | null) ?? [];
            const live = counts.filter((p) => p.status === "Live").length;
            const total = counts.length;
            return (
              <Card key={c.id} className="card-hover flex flex-col">
                <Link to="/campaigns/$id" params={{ id: c.id }} className="flex-1">
                  <CardHeader>
                    <CardTitle className="truncate">{c.name}</CardTitle>
                    <p className="truncate text-xs text-muted-foreground">{c.target_url}</p>
                  </CardHeader>
                  <CardContent className="flex items-center gap-2">
                    <ToneBadge tone={live > 0 ? "positive" : "neutral"}>
                      {live} live link{live === 1 ? "" : "s"}
                    </ToneBadge>
                    <ToneBadge tone="neutral">
                      {total} prospect{total === 1 ? "" : "s"}
                    </ToneBadge>
                  </CardContent>
                </Link>
                <div className="border-t border-border px-5 py-3">
                  <button
                    onClick={() => handleDelete(c.id)}
                    disabled={deletingId === c.id}
                    className="text-xs text-destructive hover:underline disabled:opacity-50"
                  >
                    {deletingId === c.id ? "Deleting…" : "Delete campaign"}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProjects } from "@/lib/projects.functions";
import { getUsageTotals } from "@/lib/settings.functions";
import { getAssetDashboardSummary } from "@/lib/assets.functions";
import { getRenderDashboardSummary } from "@/lib/render-jobs.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Film, CheckCircle2, ClipboardList, Image as ImageIcon, Activity, Hourglass, CheckCheck, XCircle, Timer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Dashboard — MedVideo AI" }] }),
});

function Dashboard() {
  const listFn = useServerFn(listProjects);
  const usageFn = useServerFn(getUsageTotals);
  const summaryFn = useServerFn(getAssetDashboardSummary);
  const renderSummaryFn = useServerFn(getRenderDashboardSummary);
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => listFn() });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => usageFn() });
  const summary = useQuery({ queryKey: ["asset-summary"], queryFn: () => summaryFn() });
  const renderSummary = useQuery({ queryKey: ["render-summary"], queryFn: () => renderSummaryFn() });

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {usage.data ? `$${usage.data.totalCost.toFixed(4)} total AI spend · ${usage.data.totalTokens.toLocaleString()} tokens` : "Loading usage…"}
          </p>
        </div>
        <Button asChild><Link to="/projects/new"><Plus className="h-4 w-4 mr-1" />New project</Link></Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Ready For Render</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.data?.readyForRender ?? "—"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><ClipboardList className="h-3.5 w-3.5" /> Awaiting Review</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.data?.pendingReview ?? "—"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> Approved Assets</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.data?.approved ?? "—"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Avg Readiness</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.data ? `${summary.data.avgReadiness}%` : "—"}</CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><Hourglass className="h-3.5 w-3.5" /> Queued Renders</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{renderSummary.data?.queued ?? "—"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><CheckCheck className="h-3.5 w-3.5" /> Completed Renders</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{renderSummary.data?.completed ?? "—"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5" /> Failed Renders</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{renderSummary.data?.failed ?? "—"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" /> Avg Render Time</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{renderSummary.data ? `${renderSummary.data.avgRenderSeconds}s` : "—"}</CardContent>
        </Card>
      </div>

      {projects.isLoading && <div className="text-muted-foreground">Loading…</div>}
      {projects.data && projects.data.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Film className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">No projects yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first medical video project.</p>
            <Button asChild className="mt-4"><Link to="/projects/new">Start a project</Link></Button>
          </CardContent>
        </Card>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(projects.data ?? []).map((p) => (
          <Link key={p.id} to="/projects/$id" params={{ id: p.id }}>
            <Card className="hover:border-primary/60 transition">
              <CardHeader>
                <CardTitle className="text-base">{p.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <Badge variant="outline">{p.status}</Badge>
                <span className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

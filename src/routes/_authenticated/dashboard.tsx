import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProjects } from "@/lib/projects.functions";
import { getUsageTotals } from "@/lib/settings.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Film } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Dashboard — OncoVideo" }] }),
});

function Dashboard() {
  const listFn = useServerFn(listProjects);
  const usageFn = useServerFn(getUsageTotals);
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => listFn() });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => usageFn() });

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

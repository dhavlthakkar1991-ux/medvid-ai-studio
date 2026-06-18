import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSystemHealth } from "@/lib/render-debug.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/system-health")({
  component: SystemHealthPage,
  head: () => ({ meta: [{ title: "System health — MedVideo AI" }] }),
});

function SystemHealthPage() {
  const fn = useServerFn(getSystemHealth);
  const q = useQuery({ queryKey: ["system-health"], queryFn: () => fn(), refetchInterval: 15_000 });
  const d = q.data;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cross-project visibility into pipelines, renders, providers, and the webhook receiver.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${q.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <HealthCard title="Pipeline health" desc="Pipeline runs in the last 24h">
          {d && <Stats rows={[
            ["Total", d.pipeline.total], ["Running", d.pipeline.running],
            ["Completed", d.pipeline.completed], ["Failed", d.pipeline.failed],
          ]} accent={d.pipeline.failed > 0 ? "fail" : d.pipeline.running > 0 ? "warn" : "ok"} />}
        </HealthCard>

        <HealthCard title="Render health" desc="Lifetime render jobs across all your projects">
          {d && (
            <>
              <Stats rows={[
                ["Total", d.render.total], ["In-flight", d.render.inFlight],
                ["Completed", d.render.completed], ["Failed", d.render.failed],
              ]} accent={d.render.failed > 0 ? "fail" : d.render.inFlight > 0 ? "warn" : "ok"} />
              {d.render.lastError && (
                <div className="mt-3 text-xs rounded border border-destructive/40 bg-destructive/5 p-2">
                  <span className="font-semibold text-destructive">Last error:</span> {d.render.lastError}
                </div>
              )}
            </>
          )}
        </HealthCard>

        <HealthCard title="Provider health" desc="Render provider jobs (last 24h)">
          {d && d.providerHealth.length === 0 && <p className="text-sm text-muted-foreground">No providers registered.</p>}
          {d && d.providerHealth.length > 0 && (
            <div className="space-y-2">
              {d.providerHealth.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between text-xs border border-border rounded p-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <Badge variant="outline" className="capitalize">{p.type}</Badge>
                    {p.isDefault && <Badge>Default</Badge>}
                    {!p.enabled && <Badge variant="secondary">Disabled</Badge>}
                  </div>
                  <div className="text-muted-foreground">
                    {p.jobs24h} jobs · {p.failed24h > 0 ? <span className="text-destructive">{p.failed24h} failed</span> : "no failures"}
                  </div>
                </div>
              ))}
              <Link to="/settings/render-providers" className="text-xs text-primary underline-offset-2 hover:underline">Manage providers →</Link>
            </div>
          )}
        </HealthCard>

        <HealthCard title="Webhook health" desc="Provider callbacks received by /api/public/render-callback">
          {d && (
            <>
              <Stats rows={[
                ["Callbacks (24h)", d.webhook.callbacks24h],
                ["Recent (15m)", d.webhook.recent ? "Yes" : "No"],
                ["Last callback", d.webhook.lastCallbackAt ? new Date(d.webhook.lastCallbackAt).toLocaleString() : "—"],
              ]} accent={d.webhook.recent ? "ok" : d.webhook.callbacks24h > 0 ? "warn" : "warn"} />
              <p className="text-xs text-muted-foreground mt-2">
                The receiver is mounted at <code>/api/public/render-callback</code>. Run a provider's diagnostics from{" "}
                <Link to="/settings/render-providers" className="text-primary underline-offset-2 hover:underline">Render providers</Link>{" "}
                to verify it externally.
              </p>
            </>
          )}
        </HealthCard>
      </div>

      {!d && q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.error && <p className="text-sm text-destructive">{(q.error as any)?.message ?? "Failed to load"}</p>}
    </div>
  );
}

function HealthCard({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />{title}
        </CardTitle>
        <CardDescription>{desc}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Stats({ rows, accent }: { rows: Array<[string, any]>; accent: "ok" | "warn" | "fail" }) {
  const color = accent === "fail" ? "text-destructive" : accent === "warn" ? "text-amber-600" : "text-green-600";
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="rounded border border-border p-2">
          <div className="text-muted-foreground">{k}</div>
          <div className={`font-semibold ${typeof v === "number" ? color : ""}`}>{String(v)}</div>
        </div>
      ))}
    </div>
  );
}
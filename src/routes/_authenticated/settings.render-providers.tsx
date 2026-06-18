import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listRenderProviders,
  setRenderProviderEnabled,
  setDefaultRenderProvider,
  updateRenderProviderConfiguration,
} from "@/lib/render-providers.functions";
import { runProviderDiagnostics } from "@/lib/render-debug.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Settings as SettingsIcon, CheckCircle2, Circle, Activity } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/render-providers")({
  component: RenderProvidersPage,
  head: () => ({ meta: [{ title: "Render providers — MedVideo AI" }] }),
});

function RenderProvidersPage() {
  const listFn = useServerFn(listRenderProviders);
  const toggleFn = useServerFn(setRenderProviderEnabled);
  const defaultFn = useServerFn(setDefaultRenderProvider);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["render-providers"], queryFn: () => listFn() });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["render-providers"] });
  const toggleMut = useMutation({
    mutationFn: (v: { providerId: string; enabled: boolean }) => toggleFn({ data: v }),
    onSuccess: () => { toast.success("Updated."); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const defaultMut = useMutation({
    mutationFn: (providerId: string) => defaultFn({ data: { providerId } }),
    onSuccess: () => { toast.success("Default provider updated."); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const providers = q.data?.providers ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Render providers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          All rendering flows through the provider-based adapter. Manifest V6 → Render Specification → Provider Transformer → Provider.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Available providers</CardTitle>
          <CardDescription>Enable a provider and set it as default to route new renders to it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {providers.length === 0 && <p className="text-sm text-muted-foreground">No providers registered.</p>}
          {providers.map((p: any) => (
            <div key={p.id} className="flex items-start justify-between rounded-md border border-border p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge variant="outline" className="capitalize">{p.provider_type}</Badge>
                  {p.is_default && <Badge>Default</Badge>}
                  {p.enabled
                    ? <span className="inline-flex items-center text-xs text-green-600"><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Enabled</span>
                    : <span className="inline-flex items-center text-xs text-muted-foreground"><Circle className="h-3.5 w-3.5 mr-1" />Disabled</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {p.provider_type === "mock"
                    ? "Simulated lifecycle. No external service. Always available for testing."
                    : p.provider_type === "custom_worker"
                    ? "Send FFmpeg jobs to your own worker. Set worker_url + CUSTOM_WORKER_SECRET, or simulate_worker=true for testing."
                    : `Stub provider — implement the integration before enabling.`}
                </p>
              </div>
              <div className="flex items-center gap-2 pl-3">
                <Switch
                  checked={!!p.enabled}
                  disabled={toggleMut.isPending}
                  onCheckedChange={(v) => toggleMut.mutate({ providerId: p.id, enabled: v })}
                />
                <Button size="sm" variant={p.is_default ? "secondary" : "outline"}
                  disabled={defaultMut.isPending || p.is_default}
                  onClick={() => defaultMut.mutate(p.id)}>
                  Set default
                </Button>
                <ProviderConfigDialog provider={p} onSaved={invalidate} />
                <ProviderDiagnosticsDialog providerId={p.id} providerName={p.name} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How rendering works</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
{`Manifest V6
   ↓
Render Specification (internal canonical format)
   ↓
Render Adapter
   ↓
Provider Transformer
   ↓
Provider  →  MP4  →  Supabase Storage  →  Download`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

function ProviderConfigDialog({ provider, onSaved }: { provider: any; onSaved: () => void }) {
  const fn = useServerFn(updateRenderProviderConfiguration);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(provider.configuration ?? {}, null, 2));
  const mut = useMutation({
    mutationFn: (configuration: Record<string, unknown>) =>
      fn({ data: { providerId: provider.id, configuration } }),
    onSuccess: () => { toast.success("Configuration saved."); setOpen(false); onSaved(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost"><SettingsIcon className="h-3.5 w-3.5" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{provider.name} — configuration</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Label className="text-xs text-muted-foreground">JSON configuration</Label>
          <textarea
            className="w-full h-48 rounded-md border border-border bg-background p-2 font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {provider.provider_type === "custom_worker" && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Supported configuration keys:</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li><code>worker_url</code> — base URL of your render worker. Adapter POSTs to <code>{`{worker_url}/render`}</code>, <code>{`{worker_url}/cancel`}</code>, and optionally <code>{`{worker_url}/status/:id`}</code>.</li>
                <li><code>callback_url</code> — optional. Full URL the worker calls when finished. Defaults to <code>/api/public/render-callback</code> on this app.</li>
                <li><code>timeout_ms</code> — request timeout for the initial dispatch (default 30000).</li>
                <li><code>api_token</code> — optional bearer token sent to the worker.</li>
                <li><code>simulate_worker</code> — <code>true</code> to skip the HTTP call and advance the render lifecycle locally for testing.</li>
              </ul>
              <p>
                HMAC secret <code>CUSTOM_WORKER_SECRET</code> is stored as a Lovable Cloud secret.
                The worker must sign callbacks using header <code>x-render-signature</code> = HMAC-SHA256(secret, raw_body).
              </p>
            </div>
          )}
          {provider.provider_type === "creatomate" && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                Supported configuration keys:
              </p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li><code>webhook_url</code> — full URL Creatomate calls when a render finishes. Use
                  <code> https://&lt;your-domain&gt;/api/public/render-callback/creatomate</code>.</li>
                <li><code>default_template_id</code> — optional Creatomate template id (reserved for template-based renders).</li>
                <li><code>environment</code> — <code>"production"</code> or <code>"staging"</code> tag stored on jobs.</li>
              </ul>
              <p>
                API key (<code>CREATOMATE_API_KEY</code>) and webhook secret (<code>CREATOMATE_WEBHOOK_SECRET</code>) are
                stored as Lovable Cloud secrets, not in this JSON.
              </p>
            </div>
          )}
          {provider.provider_type === "shotstack" && (
            <p className="text-xs text-muted-foreground">
              API keys for external providers are stored as Lovable Cloud secrets, not in this JSON.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              try { mut.mutate(JSON.parse(text)); }
              catch { toast.error("Invalid JSON"); }
            }} disabled={mut.isPending}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function ProviderDiagnosticsDialog({ providerId, providerName }: { providerId: string; providerName: string }) {
  const fn = useServerFn(runProviderDiagnostics);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<any>(null);

  async function run() {
    setRunning(true);
    try {
      const r = await fn({ data: { providerId } });
      setReport(r);
    } catch (e: any) {
      toast.error(e?.message ?? "Diagnostics failed");
    } finally { setRunning(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o && !report) run(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title="Test connection">
          <Activity className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{providerName} — diagnostics</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Validates configuration, secret presence, worker reachability, and the webhook receiver.
            </p>
            <Button size="sm" variant="outline" onClick={run} disabled={running}>
              {running ? "Running…" : "Re-run"}
            </Button>
          </div>
          {report && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span>Overall:</span>
                <Badge variant={report.overall === "ok" ? "outline" : report.overall === "warn" ? "secondary" : "destructive"}
                  className="capitalize">
                  {report.overall}
                </Badge>
              </div>
              <div className="rounded-md border border-border divide-y divide-border">
                {(report.checks as any[]).map((c, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 text-xs">
                    <Badge
                      variant={c.status === "ok" ? "outline" : c.status === "warn" ? "secondary" : "destructive"}
                      className="uppercase shrink-0"
                    >
                      {c.status}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-muted-foreground break-all">{c.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

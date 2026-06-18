import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fixRenderSpec, getRenderBundle } from "@/lib/render-providers.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Download, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Wrench } from "lucide-react";
import { toast } from "sonner";

/** Phase 2B-5 RenderSpec Inspector — visualise the canonical render contract. */
export function RenderSpecInspector({ projectId }: { projectId: string }) {
  const fn = useServerFn(getRenderBundle);
  const fixFn = useServerFn(fixRenderSpec);
  const qc = useQueryClient();
  const [quality, setQuality] = useState<"preview" | "full">("full");
  const q = useQuery({
    queryKey: ["render-bundle", projectId, quality],
    queryFn: () => fn({ data: { projectId, quality } }),
  });
  const fixMut = useMutation({
    mutationFn: () => fixFn({ data: { projectId, quality } }),
    onSuccess: (r: any) => {
      const count = r?.fixes?.length ?? 0;
      const remaining = Number(r?.remaining ?? 0);
      const toastFn = remaining > 0 ? toast.warning : toast.success;
      toastFn(`Applied ${count} fix${count === 1 ? "" : "es"}`, {
        description: remaining > 0
          ? `${remaining} issue${remaining === 1 ? "" : "s"} still need manual review`
          : (r?.fixes?.slice(0, 3).join(" · ") || "No issues remaining"),
      });
      qc.invalidateQueries({ queryKey: ["render-bundle", projectId] });
      qc.invalidateQueries({ queryKey: ["readiness", projectId] });
      qc.invalidateQueries({ queryKey: ["preview-canonical", projectId] });
      qc.invalidateQueries({ queryKey: ["preview-timeline", projectId] });
      q.refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Fix failed"),
  });
  const specJson = q.data?.specJson ?? "";
  const spec = (() => { try { return specJson ? JSON.parse(specJson) : null; } catch { return null; } })();
  const validation = (() => { try { return q.data?.validationJson ? JSON.parse(q.data.validationJson) : null; } catch { return null; } })();

  function copy() {
    if (!specJson) return;
    navigator.clipboard.writeText(specJson).then(
      () => toast.success("RenderSpec copied to clipboard"),
      () => toast.error("Copy failed"),
    );
  }
  function download() {
    if (!specJson) return;
    const blob = new Blob([specJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `render-spec-${projectId}-${quality}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">RenderSpec</CardTitle>
            <CardDescription>
              Canonical, provider-agnostic description of the final video.
              Manifest V6 → RenderSpec → Provider Transformer → Provider.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="text-xs rounded border border-border bg-background px-2 py-1"
              value={quality}
              onChange={(e) => setQuality(e.target.value as "preview" | "full")}
            >
              <option value="full">Full (1080p)</option>
              <option value="preview">Preview (720p)</option>
            </select>
            <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${q.isFetching ? "animate-spin" : ""}`} />Rebuild
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => fixMut.mutate()}
              disabled={fixMut.isPending || !validation || (validation.errorCount === 0 && validation.warningCount === 0)}
            >
              <Wrench className={`h-3.5 w-3.5 mr-1 ${fixMut.isPending ? "animate-pulse" : ""}`} />
              {fixMut.isPending ? "Fixing…" : "Fix issues"}
            </Button>
            <Button size="sm" variant="outline" onClick={copy} disabled={!specJson}>
              <Copy className="h-3.5 w-3.5 mr-1" />Copy JSON
            </Button>
            <Button size="sm" onClick={download} disabled={!specJson}>
              <Download className="h-3.5 w-3.5 mr-1" />Download JSON
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {q.isLoading && <p className="text-sm text-muted-foreground">Building RenderSpec…</p>}
          {q.error && <p className="text-sm text-destructive">{(q.error as any)?.message ?? "Failed to build spec"}</p>}
          {spec && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                <Stat label="Canvas" value={`${spec.canvas.width}×${spec.canvas.height}@${spec.canvas.fps}`} />
                <Stat label="Duration" value={`${Number(spec.canvas.duration_seconds ?? 0).toFixed(1)}s`} />
                <Stat label="Tracks" value={spec.tracks?.length ?? 0} />
                <Stat label="Assets" value={spec.assets?.length ?? 0} />
                <Stat label="Graphics" value={spec.graphics?.length ?? 0} />
                <Stat label="Captions" value={spec.captions?.length ?? 0} />
              </div>

              {validation && (
                <Section title="Render readiness">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <ReadinessTile
                      label="Worker compatible"
                      ok={validation.summary.workerCompatible}
                      detail={`${validation.errorCount} errors · ${validation.warningCount} warnings`}
                    />
                    <ReadinessTile
                      label="Asset readiness"
                      ok={validation.summary.assets.missingUrl === 0 && validation.summary.assets.orphan === 0}
                      detail={`${validation.summary.assets.total} total · ${validation.summary.assets.missingUrl} missing url · ${validation.summary.assets.unused} unused`}
                    />
                    <ReadinessTile
                      label="Graphics readiness"
                      ok={validation.summary.graphics.missingPayload === 0}
                      detail={`${validation.summary.graphics.total} total · ${validation.summary.graphics.missingPayload} empty`}
                    />
                    <ReadinessTile
                      label="Timeline integrity"
                      ok={validation.summary.timeline.outOfBounds === 0 && validation.summary.timeline.items > 0}
                      detail={`${validation.summary.timeline.items} items · ${validation.summary.timeline.overlaps} overlaps · ${validation.summary.timeline.outOfBounds} oob · ${validation.summary.timeline.gaps} gaps`}
                    />
                    <ReadinessTile
                      label="Video metadata"
                      ok={validation.summary.canvas.hasDuration && validation.summary.canvas.hasDimensions && validation.summary.canvas.hasFps}
                      detail={`duration:${validation.summary.canvas.hasDuration ? "✓" : "✗"} dims:${validation.summary.canvas.hasDimensions ? "✓" : "✗"} fps:${validation.summary.canvas.hasFps ? "✓" : "✗"}`}
                    />
                    <ReadinessTile
                      label="Orphan references"
                      ok={validation.summary.assets.orphan === 0}
                      detail={`${validation.summary.assets.orphan} orphan`}
                    />
                  </div>
                  {validation.issues.length > 0 && (
                    <div className="mt-2 max-h-40 overflow-y-auto rounded border border-border divide-y divide-border">
                      {validation.issues.slice(0, 50).map((iss: any, idx: number) => (
                        <div key={idx} className="flex items-start gap-2 px-2 py-1 text-xs">
                          {iss.level === "error" ? <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" /> :
                            iss.level === "warning" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" /> :
                            <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />}
                          <span className="font-mono text-[10px] text-muted-foreground w-32 shrink-0">{iss.code}</span>
                          <span className="flex-1">{iss.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              <Section title="Tracks">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground"><tr><th className="text-left py-1">id</th><th className="text-left">kind</th><th className="text-left">z-index</th><th className="text-left">label</th></tr></thead>
                  <tbody>
                    {(spec.tracks ?? []).map((t: any) => (
                      <tr key={t.id} className="border-t border-border">
                        <td className="py-1 font-mono">{t.id}</td>
                        <td><Badge variant="outline" className="capitalize">{t.kind}</Badge></td>
                        <td>{t.z_index}</td>
                        <td className="text-muted-foreground">{t.label ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              <Section title={`Assets (${spec.assets?.length ?? 0})`}>
                <div className="max-h-56 overflow-y-auto space-y-1">
                  {(spec.assets ?? []).map((a: any) => (
                    <div key={a.id} className="text-xs flex items-center gap-2 border-b border-border py-1">
                      <Badge variant="outline" className="capitalize">{a.kind}</Badge>
                      <span className="font-mono truncate flex-1">{a.id}</span>
                      <span className="text-muted-foreground truncate max-w-[40%]">{a.source_url ?? (a.inline?.text ?? "—")}</span>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title={`Items (${spec.items?.length ?? 0})`}>
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground"><tr><th className="text-left">start</th><th className="text-left">end</th><th className="text-left">track</th><th className="text-left">asset</th><th className="text-left">layout</th><th className="text-left">in/out</th></tr></thead>
                    <tbody>
                      {(spec.items ?? []).map((it: any) => (
                        <tr key={it.id} className="border-t border-border">
                          <td>{Number(it.start_time).toFixed(2)}</td>
                          <td>{Number(it.end_time).toFixed(2)}</td>
                          <td className="font-mono">{it.track_id}</td>
                          <td className="font-mono truncate max-w-[180px]">{it.asset_id}</td>
                          <td><Badge variant="outline" className="capitalize">{it.layout}</Badge></td>
                          <td className="text-muted-foreground">{it.transition_in}/{it.transition_out}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section title={`Captions (${spec.captions?.length ?? 0})`}>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {(spec.captions ?? []).map((c: any) => (
                    <div key={c.id} className="text-xs flex gap-2">
                      <span className="text-muted-foreground font-mono w-24">{c.start_time.toFixed(2)}-{c.end_time.toFixed(2)}</span>
                      <span className="flex-1">{c.text}</span>
                    </div>
                  ))}
                  {(spec.captions ?? []).length === 0 && <p className="text-xs text-muted-foreground">No captions.</p>}
                </div>
              </Section>

              <Section title="Raw JSON">
                <pre className="text-[11px] font-mono bg-muted/30 rounded p-2 max-h-72 overflow-auto whitespace-pre">
                  {JSON.stringify(spec, null, 2)}
                </pre>
              </Section>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold">{title}</div>
      {children}
    </div>
  );
}
function ReadinessTile({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className={`rounded border p-2 ${ok ? "border-emerald-500/40" : "border-destructive/40"}`}>
      <div className="flex items-center gap-1 text-muted-foreground">
        {ok ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-destructive" />}
        {label}
      </div>
      <div className="font-semibold text-[11px] mt-0.5">{detail}</div>
    </div>
  );
}
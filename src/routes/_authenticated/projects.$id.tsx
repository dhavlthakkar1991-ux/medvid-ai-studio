import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { getProject } from "@/lib/projects.functions";
import { regenerateTask } from "@/lib/analysis.functions";
import { runQueuedJob } from "@/lib/jobs.functions";
import { getExportBundle } from "@/lib/exports.functions";
import { getCanonicalProject, rebuildRenderManifest, validateTimeline, exportRenderManifestJson, regenerateEditorialDecisions } from "@/lib/render.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Download, FileJson, FileText, Captions } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  component: ProjectView,
  head: () => ({ meta: [{ title: "Project — OncoVideo" }] }),
});

const TASK_LABELS: Record<string, string> = {
  chapters: "Chapters",
  scene_plan: "Scene Plan",
  visual_storyboard: "Visual Storyboard",
  broll: "B-Roll",
  infographics: "Infographics",
  thumbnails: "Thumbnails",
  seo: "SEO",
  shorts: "Shorts",
};

function ProjectView() {
  const { id } = useParams({ from: "/_authenticated/projects/$id" });
  const getFn = useServerFn(getProject);
  const regenFn = useServerFn(regenerateTask);
  const runJobFn = useServerFn(runQueuedJob);
  const exportFn = useServerFn(getExportBundle);
  const canonFn = useServerFn(getCanonicalProject);
  const rebuildFn = useServerFn(rebuildRenderManifest);
  const validateFn = useServerFn(validateTimeline);
  const exportManifestFn = useServerFn(exportRenderManifestJson);
  const regenEditorialFn = useServerFn(regenerateEditorialDecisions);
  const qc = useQueryClient();
  const launchedJobs = useRef(new Set<string>());

  const q = useQuery({
    queryKey: ["project", id],
    queryFn: () => getFn({ data: { id } }),
    refetchInterval: (query) => {
      const d = query.state.data as any;
      if (!d) return 3000;
      const s = d.latestJob?.state;
      return s && s !== "completed" && s !== "failed" ? 3000 : false;
    },
  });

  const canonQ = useQuery({
    queryKey: ["project-canonical", id],
    queryFn: () => canonFn({ data: { projectId: id } }),
    refetchInterval: (query) => {
      const parent = qc.getQueryData(["project", id]) as any;
      const s = parent?.latestJob?.state;
      return s && s !== "completed" && s !== "failed" ? 5000 : false;
    },
  });

  const latestJobForLaunch = q.data?.latestJob;

  useEffect(() => {
    const updatedAt = latestJobForLaunch?.updated_at ? new Date(latestJobForLaunch.updated_at).getTime() : 0;
    const staleTranscribing = latestJobForLaunch?.state === "transcribing" && updatedAt > 0 && Date.now() - updatedAt > 2 * 60 * 1000;
    if (
      !latestJobForLaunch ||
      (latestJobForLaunch.state !== "queued" && latestJobForLaunch.state !== "failed" && !staleTranscribing) ||
      launchedJobs.current.has(latestJobForLaunch.id)
    ) return;
    launchedJobs.current.add(latestJobForLaunch.id);
    runJobFn({ data: { jobId: latestJobForLaunch.id } })
      .then((job) => {
        if (job.runnerUrl) return fetch(job.runnerUrl, { method: "POST" });
      })
      .catch(() => undefined)
      .finally(() => qc.invalidateQueries({ queryKey: ["project", id] }));
  }, [latestJobForLaunch, qc, id, runJobFn]);

  const regen = useMutation({
    mutationFn: (task: string) => regenFn({ data: { projectId: id, task: task as any } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", id] }); toast.success("Regenerated."); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  if (q.isLoading) return <div className="p-10 text-muted-foreground">Loading…</div>;
  if (!q.data) return null;

  const { project, transcript, versions, latestJob, usage } = q.data;
  const latest = (task: string) => versions.find((v: any) => v.task === task);
  const totalCost = (usage as any[]).reduce((s, r) => s + Number(r.estimated_cost), 0);

  const downloadBlob = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const onExport = async (kind: "json" | "txt" | "srt") => {
    const bundle = await exportFn({ data: { projectId: id } });
    if (kind === "json") downloadBlob(`${project.title}.json`, JSON.stringify(bundle, null, 2), "application/json");
    if (kind === "txt") downloadBlob(`${project.title}.txt`, bundle.transcript?.full_text ?? "", "text/plain");
    if (kind === "srt") downloadBlob(`${project.title}.srt`, bundle.srt ?? "", "application/x-subrip");
  };

  const onExportManifest = async () => {
    const bundle = await exportManifestFn({ data: { projectId: id } });
    downloadBlob(`${project.title}.render-manifest.json`, JSON.stringify(bundle, null, 2), "application/json");
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.title}</h1>
          <div className="text-sm text-muted-foreground mt-1">{project.topic}</div>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="outline">{project.status}</Badge>
            <span className="text-xs text-muted-foreground">AI spend: ${totalCost.toFixed(4)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onExport("json")}><FileJson className="h-3 w-3 mr-1" />JSON</Button>
          <Button size="sm" variant="outline" onClick={() => onExport("txt")}><FileText className="h-3 w-3 mr-1" />TXT</Button>
          <Button size="sm" variant="outline" onClick={() => onExport("srt")}><Captions className="h-3 w-3 mr-1" />SRT</Button>
          <Button size="sm" variant="outline" onClick={onExportManifest}><FileJson className="h-3 w-3 mr-1" />Manifest</Button>
        </div>
      </div>

      {latestJob && latestJob.state !== "completed" && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium capitalize">{latestJob.state}…</div>
              <div className="text-xs text-muted-foreground">{latestJob.progress}%</div>
            </div>
            <Progress value={latestJob.progress} />
            {latestJob.error && <p className="text-xs text-destructive mt-2">{latestJob.error}</p>}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="visual_storyboard">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          {Object.keys(TASK_LABELS).map((t) => (
            <TabsTrigger key={t} value={t}>{TASK_LABELS[t]}</TabsTrigger>
          ))}
          <TabsTrigger value="render_manifest">Render Manifest</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="editorial">Editorial</TabsTrigger>
          <TabsTrigger value="cost">Cost</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript">
          <Card><CardContent className="py-4">
            {transcript ? (
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">{transcript.full_text}</pre>
            ) : <p className="text-muted-foreground text-sm">Transcript not ready yet.</p>}
          </CardContent></Card>
        </TabsContent>

        {Object.keys(TASK_LABELS).map((t) => {
          const v = latest(t);
          return (
            <TabsContent key={t} value={t}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">{TASK_LABELS[t]} {v && <Badge variant="outline" className="ml-2">v{v.version}</Badge>}</CardTitle>
                  <Button size="sm" variant="outline" onClick={() => regen.mutate(t)} disabled={regen.isPending || !transcript}>
                    <RefreshCw className="h-3 w-3 mr-1" />Regenerate
                  </Button>
                </CardHeader>
                <CardContent>
                  {!v ? <p className="text-sm text-muted-foreground">Not generated yet.</p> :
                    <pre className="text-xs overflow-auto max-h-[60vh] bg-muted/30 rounded-md p-3">{JSON.stringify(v.analysis_data, null, 2)}</pre>}
                  {v && <div className="text-xs text-muted-foreground mt-2">{v.provider} · {v.model} · {new Date(v.created_at).toLocaleString()}</div>}
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}

        <TabsContent value="cost">
          <Card>
            <CardHeader><CardTitle className="text-base">AI usage</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">${totalCost.toFixed(4)}</div>
              <p className="text-xs text-muted-foreground mb-3">Total estimated cost for this project.</p>
              <div className="space-y-1 text-sm">
                {(usage as any[]).map((u, i) => (
                  <div key={i} className="flex justify-between border-b border-border py-1">
                    <span>{u.task} · {u.model}</span>
                    <span>${Number(u.estimated_cost).toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="render_manifest">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Render Manifest {canonQ.data && <Badge variant="outline" className="ml-2">{canonQ.data.manifest.length} steps · {canonQ.data.scenes.length} scenes</Badge>}
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await rebuildFn({ data: { projectId: id } });
                    qc.invalidateQueries({ queryKey: ["project-canonical", id] });
                    toast.success("Render manifest rebuilt.");
                  } catch (e: any) {
                    toast.error(e?.message ?? "Failed");
                  }
                }}
              >
                <RefreshCw className="h-3 w-3 mr-1" />Rebuild
              </Button>
            </CardHeader>
            <CardContent>
              {!canonQ.data || canonQ.data.manifest.length === 0 ? (
                <p className="text-sm text-muted-foreground">No manifest yet. Generate Scene Plan + Storyboard, then rebuild.</p>
              ) : (
                <div className="overflow-auto max-h-[60vh]">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground border-b border-border">
                      <tr>
                        <th className="text-left py-1 pr-3">#</th>
                        <th className="text-left py-1 pr-3">Start</th>
                        <th className="text-left py-1 pr-3">End</th>
                        <th className="text-left py-1 pr-3">Type</th>
                        <th className="text-left py-1 pr-3">Source</th>
                        <th className="text-left py-1 pr-3">Query</th>
                        <th className="text-left py-1 pr-3">Status</th>
                        <th className="text-left py-1 pr-3">Scene</th>
                      </tr>
                    </thead>
                    <tbody>
                      {canonQ.data.manifest.map((m: any) => (
                        <tr key={m.id} className="border-b border-border/50 align-top">
                          <td className="py-1 pr-3">{m.render_order}</td>
                          <td className="py-1 pr-3 tabular-nums">{Number(m.timeline_start).toFixed(2)}s</td>
                          <td className="py-1 pr-3 tabular-nums">{Number(m.timeline_end).toFixed(2)}s</td>
                          <td className="py-1 pr-3">{m.asset_type}</td>
                          <td className="py-1 pr-3">{m.asset_source}</td>
                          <td className="py-1 pr-3 max-w-md truncate" title={m.asset_query}>{m.asset_query}</td>
                          <td className="py-1 pr-3"><Badge variant="outline">{m.status}</Badge></td>
                          <td className="py-1 pr-3 font-mono text-[10px] text-muted-foreground">{m.scene_id?.slice(0, 8)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assets">
          <Card>
            <CardHeader><CardTitle className="text-base">
              Asset Library {canonQ.data && <Badge variant="outline" className="ml-2">{canonQ.data.assetCandidates.length} candidates · {canonQ.data.assets.length} assets</Badge>}
            </CardTitle></CardHeader>
            <CardContent>
              {!canonQ.data || canonQ.data.assetCandidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No asset candidates yet. Generate Storyboard or B-Roll to populate.</p>
              ) : (
                <div className="space-y-4 max-h-[60vh] overflow-auto">
                  {canonQ.data.scenes.map((s: any) => {
                    const cands = canonQ.data.assetCandidates.filter((c: any) => c.scene_id === s.id);
                    if (cands.length === 0) return null;
                    return (
                      <div key={s.id}>
                        <div className="text-sm font-medium mb-1">Scene {s.scene_number} — {s.title}</div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          {cands.map((c: any) => (
                            <div key={c.id} className="border border-border rounded-md p-2 text-xs">
                              <div className="flex items-center justify-between mb-1">
                                <Badge variant="outline" className="text-[10px]">{c.asset_type}</Badge>
                                <span className="text-muted-foreground">p{c.priority}</span>
                              </div>
                              <div className="truncate" title={c.search_query}>{c.search_query}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {(() => {
                    const orphan = canonQ.data.assetCandidates.filter((c: any) => !c.scene_id);
                    if (orphan.length === 0) return null;
                    return (
                      <div>
                        <div className="text-sm font-medium mb-1 text-muted-foreground">Unscened candidates</div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          {orphan.map((c: any) => (
                            <div key={c.id} className="border border-border rounded-md p-2 text-xs">
                              <Badge variant="outline" className="text-[10px]">{c.asset_type}</Badge>
                              <div className="mt-1 truncate" title={c.search_query}>{c.search_query}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Timeline {canonQ.data && <Badge variant="outline" className="ml-2">{canonQ.data.timelineInstructions.length} instructions</Badge>}
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const report = await validateFn({ data: { projectId: id } });
                    if (report.ok && report.issues.length === 0) toast.success("Timeline valid.");
                    else if (report.ok) toast.warning(`${report.issues.length} warning(s)`);
                    else toast.error(`${report.issues.filter((i: any) => i.severity === "error").length} error(s)`);
                    console.log("timeline validation", report);
                  } catch (e: any) { toast.error(e?.message ?? "Failed"); }
                }}
              >
                Validate
              </Button>
            </CardHeader>
            <CardContent>
              {!canonQ.data || canonQ.data.timelineInstructions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No timeline yet. Rebuild from the Render Manifest tab.</p>
              ) : (
                <div className="overflow-auto max-h-[60vh]">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground border-b border-border">
                      <tr>
                        <th className="text-left py-1 pr-3">#</th>
                        <th className="text-left py-1 pr-3">Scene</th>
                        <th className="text-left py-1 pr-3">Asset</th>
                        <th className="text-left py-1 pr-3">Start</th>
                        <th className="text-left py-1 pr-3">End</th>
                        <th className="text-left py-1 pr-3">Duration</th>
                        <th className="text-left py-1 pr-3">Layer</th>
                        <th className="text-left py-1 pr-3">Transition</th>
                      </tr>
                    </thead>
                    <tbody>
                      {canonQ.data.timelineInstructions.map((t: any) => (
                        <tr key={t.id} className="border-b border-border/50">
                          <td className="py-1 pr-3">{t.render_order}</td>
                          <td className="py-1 pr-3 font-mono text-[10px] text-muted-foreground">{t.scene_id?.slice(0, 8) ?? "—"}</td>
                          <td className="py-1 pr-3 font-mono text-[10px] text-muted-foreground">{t.asset_id?.slice(0, 8) ?? "—"}</td>
                          <td className="py-1 pr-3 tabular-nums">{Number(t.timeline_start).toFixed(2)}s</td>
                          <td className="py-1 pr-3 tabular-nums">{Number(t.timeline_end).toFixed(2)}s</td>
                          <td className="py-1 pr-3 tabular-nums">{Number(t.duration).toFixed(2)}s</td>
                          <td className="py-1 pr-3">{t.layer}</td>
                          <td className="py-1 pr-3">{t.transition}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="editorial">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Editorial Decisions {canonQ.data && <Badge variant="outline" className="ml-2">{canonQ.data.editActions.length} actions</Badge>}
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                disabled={!transcript}
                onClick={async () => {
                  try {
                    toast.info("Generating editorial decisions…");
                    await regenEditorialFn({ data: { projectId: id } });
                    qc.invalidateQueries({ queryKey: ["project-canonical", id] });
                    qc.invalidateQueries({ queryKey: ["project", id] });
                    toast.success("Editorial decisions regenerated.");
                  } catch (e: any) {
                    toast.error(e?.message ?? "Failed");
                  }
                }}
              >
                <RefreshCw className="h-3 w-3 mr-1" />Regenerate Editorial Decisions
              </Button>
            </CardHeader>
            <CardContent>
              {!canonQ.data || canonQ.data.editActions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No editorial decisions yet. Storyboard/B-roll will be auto-backfilled, or click Regenerate to run the AI editor.</p>
              ) : (() => {
                const layoutById = new Map<string, string>(((canonQ.data.layoutTemplates as any[]) ?? []).map((l: any) => [l.id, l.name]));
                const transitionById = new Map<string, string>(((canonQ.data.transitionTemplates as any[]) ?? []).map((t: any) => [t.id, t.name]));
                const sceneById = new Map<string, any>((canonQ.data.scenes as any[]).map((s: any) => [s.id, s]));
                return (
                  <div className="overflow-auto max-h-[60vh]">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground border-b border-border">
                        <tr>
                          <th className="text-left py-1 pr-3">Scene</th>
                          <th className="text-left py-1 pr-3">Action</th>
                          <th className="text-left py-1 pr-3">Layer</th>
                          <th className="text-left py-1 pr-3">Layout</th>
                          <th className="text-left py-1 pr-3">Transition</th>
                          <th className="text-left py-1 pr-3">Start</th>
                          <th className="text-left py-1 pr-3">End</th>
                          <th className="text-left py-1 pr-3">Duration</th>
                          <th className="text-left py-1 pr-3">Asset Query</th>
                          <th className="text-left py-1 pr-3">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(canonQ.data.editActions as any[]).map((a: any) => {
                          const s = a.scene_id ? sceneById.get(a.scene_id) : null;
                          return (
                            <tr key={a.id} className="border-b border-border/50 align-top">
                              <td className="py-1 pr-3">{s ? `${s.scene_number}` : "—"}</td>
                              <td className="py-1 pr-3"><Badge variant="outline" className="text-[10px]">{a.action_type}</Badge></td>
                              <td className="py-1 pr-3 tabular-nums">{a.layer}</td>
                              <td className="py-1 pr-3">{layoutById.get(a.layout_id) ?? "—"}</td>
                              <td className="py-1 pr-3">{transitionById.get(a.transition_in_id) ?? "—"} → {transitionById.get(a.transition_out_id) ?? "—"}</td>
                              <td className="py-1 pr-3 tabular-nums">{Number(a.start_time).toFixed(2)}s</td>
                              <td className="py-1 pr-3 tabular-nums">{Number(a.end_time).toFixed(2)}s</td>
                              <td className="py-1 pr-3 tabular-nums">{Number(a.duration).toFixed(2)}s</td>
                              <td className="py-1 pr-3 max-w-xs truncate" title={a.asset_query}>{a.asset_query}</td>
                              <td className="py-1 pr-3"><Badge variant="outline" className="text-[10px]">{a.source}</Badge></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

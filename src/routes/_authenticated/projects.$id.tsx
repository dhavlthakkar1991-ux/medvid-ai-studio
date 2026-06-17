import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { getProject } from "@/lib/projects.functions";
import { regenerateTask } from "@/lib/analysis.functions";
import { runQueuedJob } from "@/lib/jobs.functions";
import { getExportBundle } from "@/lib/exports.functions";
import { getCanonicalProject, rebuildRenderManifest, validateTimeline, exportRenderManifestJson, regenerateEditorialDecisions, regenerateLayoutDecisions } from "@/lib/render.functions";
import { getPipelineHealth } from "@/lib/qa.functions";
import { resetProject, deleteProject, type ResetStage } from "@/lib/project-admin.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, FileJson, FileText, Captions, Trash2, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const OUTCOME_LABEL: Record<string, string> = {
  primary: "Primary Prompt",
  retry_1: "Retry 1",
  retry_2: "Retry 2",
  fallback_prompt: "Fallback Prompt",
  fallback_generator: "Fallback Generator",
};

function outcomeStage(t: { retry_count?: number; fallback_used?: boolean; fallback_stage?: string | null }): string {
  if (t.fallback_used && t.fallback_stage) return OUTCOME_LABEL[t.fallback_stage] ?? t.fallback_stage;
  const r = Number(t.retry_count) || 0;
  if (r === 0) return OUTCOME_LABEL.primary;
  if (r === 1) return OUTCOME_LABEL.retry_1;
  return OUTCOME_LABEL.retry_2;
}

function recoverySource(t: { fallback_used?: boolean }): "AI" | "Recovery" {
  return t.fallback_used ? "Recovery" : "AI";
}

const QUALITY_SUMMARY_TASKS: Array<{ key: string; label: string }> = [
  { key: "scene_plan", label: "Scene Plan" },
  { key: "visual_storyboard", label: "Storyboard" },
  { key: "broll", label: "B-Roll" },
  { key: "editorial_decisions", label: "Editorial" },
  { key: "seo", label: "SEO" },
];

const TRACK_LABELS: Record<number, string> = {
  0: "Track 0 — Talking Head",
  1: "Track 1 — B-roll",
  2: "Track 2 — Infographics",
  3: "Track 3 — Lower Thirds",
  4: "Track 4 — Kinetic Typography",
  5: "Track 5 — Keyword Highlights",
  6: "Track 6 — CTA / End Cards",
};
const trackLabel = (n: unknown) => {
  const v = typeof n === "number" ? n : Number(n);
  return TRACK_LABELS[v] ?? `Track ${Number.isFinite(v) ? v : "?"}`;
};

const ACTIVE_JOB_STATES = new Set(["queued", "transcribing", "analyzing"]);

function ProjectView() {
  const { id } = useParams({ from: "/_authenticated/projects/$id" });
  const navigate = useNavigate();
  const getFn = useServerFn(getProject);
  const regenFn = useServerFn(regenerateTask);
  const runJobFn = useServerFn(runQueuedJob);
  const exportFn = useServerFn(getExportBundle);
  const canonFn = useServerFn(getCanonicalProject);
  const rebuildFn = useServerFn(rebuildRenderManifest);
  const validateFn = useServerFn(validateTimeline);
  const exportManifestFn = useServerFn(exportRenderManifestJson);
  const regenEditorialFn = useServerFn(regenerateEditorialDecisions);
  const regenLayoutFn = useServerFn(regenerateLayoutDecisions);
  const healthFn = useServerFn(getPipelineHealth);
  const resetFn = useServerFn(resetProject);
  const deleteFn = useServerFn(deleteProject);
  const qc = useQueryClient();
  const launchedJobs = useRef(new Set<string>());
  const [resetStage, setResetStage] = useState<ResetStage>("complete");
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["project", id],
    queryFn: () => getFn({ data: { id } }),
    refetchInterval: (query) => {
      const d = query.state.data as any;
      if (!d) return 3000;
      const s = d.latestJob?.state;
      return s && ACTIVE_JOB_STATES.has(s) ? 3000 : false;
    },
  });

  const canonQ = useQuery({
    queryKey: ["project-canonical", id],
    queryFn: () => canonFn({ data: { projectId: id } }),
    refetchInterval: (query) => {
      const parent = qc.getQueryData(["project", id]) as any;
      const s = parent?.latestJob?.state;
      return s && ACTIVE_JOB_STATES.has(s) ? 5000 : false;
    },
  });

  const healthQ = useQuery({
    queryKey: ["project-health", id],
    queryFn: () => healthFn({ data: { projectId: id } }),
    refetchInterval: (query) => {
      const parent = qc.getQueryData(["project", id]) as any;
      const s = parent?.latestJob?.state;
      return s && ACTIVE_JOB_STATES.has(s) ? 4000 : false;
    },
  });

  const latestJobForLaunch = q.data?.latestJob;

  // The runner is step-based: each HTTP call advances one stage (transcribe →
  // one analysis task → … → finalize). Re-fire whenever the job isn't done.
  // We key on `${id}:${updated_at}` so each progress tick triggers the next step.
  useEffect(() => {
    if (!latestJobForLaunch) return;
    const state = latestJobForLaunch.state;
    if (!ACTIVE_JOB_STATES.has(state)) return;
    const updatedAt = latestJobForLaunch.updated_at ?? "";
    const key = `${latestJobForLaunch.id}:${state}:${updatedAt}`;
    if (launchedJobs.current.has(key)) return;
    launchedJobs.current.add(key);
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
  if (!project) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold">Project not found</h1>
        <p className="text-muted-foreground">This project may have been deleted.</p>
        <Button onClick={() => navigate({ to: "/dashboard" })}>Back to dashboard</Button>
      </div>
    );
  }
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
          <Button size="sm" variant="outline" onClick={() => setResetOpen(true)}>
            <RotateCcw className="h-3 w-3 mr-1" />Reset
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-3 w-3 mr-1" />Delete
          </Button>
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

      {healthQ.data && healthQ.data.taskExecutions.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Quality Summary</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {QUALITY_SUMMARY_TASKS.map(({ key, label }) => {
                const t = (healthQ.data!.taskExecutions as any[]).find((x) => x.task_name === key);
                if (!t) {
                  return (
                    <div key={key} className="rounded-md border border-border p-3">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="text-sm font-medium mt-1">Not generated</div>
                    </div>
                  );
                }
                const passed = !!t.validation_passed;
                const errs = Array.isArray(t.validation_errors) ? t.validation_errors.length : 0;
                const warns = Array.isArray(t.validation_warnings) ? t.validation_warnings.length : 0;
                return (
                  <div key={key} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <Badge
                        variant={passed ? "outline" : "destructive"}
                        className="text-[10px]"
                      >
                        {passed ? "Valid" : `${errs} err`}
                      </Badge>
                    </div>
                    <div className="text-sm font-medium mt-1">{outcomeStage(t)}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {recoverySource(t)}{warns > 0 ? ` · ${warns} warn` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
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
          <TabsTrigger value="layout">Layout Decisions</TabsTrigger>
          <TabsTrigger value="health">Pipeline Health</TabsTrigger>
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

        <TabsContent value="health">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Pipeline Health
                {healthQ.data?.latestRun && (
                  <Badge variant="outline" className="ml-2 capitalize">{healthQ.data.latestRun.status.replace(/_/g, " ")}</Badge>
                )}
              </CardTitle>
              {healthQ.data?.latestRun?.duration_ms != null && (
                <span className="text-xs text-muted-foreground">
                  Last run {(healthQ.data.latestRun.duration_ms / 1000).toFixed(1)}s ·
                  {" "}{healthQ.data.latestRun.failures_count} failures · {healthQ.data.latestRun.warnings_count} warnings
                </span>
              )}
            </CardHeader>
            <CardContent>
              {!healthQ.data || healthQ.data.taskExecutions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pipeline runs recorded yet.</p>
              ) : (
                <>
                  {healthQ.data.editorial && (
                    <div className="mb-4 space-y-3">
                      <div className="rounded-md border border-border p-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-xs text-muted-foreground">Editorial Coverage</div>
                          <Badge
                            variant={healthQ.data.editorial.coverage >= 0.7 ? "outline" : "destructive"}
                            className="text-[10px]"
                          >
                            {(healthQ.data.editorial.coverage * 100).toFixed(0)}% · target 70%
                          </Badge>
                        </div>
                        <Progress value={Math.min(100, healthQ.data.editorial.coverage * 100)} />
                        <div className="text-[11px] text-muted-foreground mt-1">
                          {healthQ.data.editorial.coveredSeconds.toFixed(1)}s of {healthQ.data.editorial.durationSeconds.toFixed(1)}s ·{" "}
                          {healthQ.data.editorial.actionCount} actions ({healthQ.data.editorial.aiCount} AI, {healthQ.data.editorial.backfillCount} backfill)
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Action Type Summary</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                          {Object.entries(healthQ.data.editorial.actionTypeSummary).map(([label, count]) => (
                            <div key={label} className="rounded-md border border-border px-2 py-1.5">
                              <div className="text-[10px] text-muted-foreground">{label}</div>
                              <div className="text-sm font-semibold tabular-nums">{count as number}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                      {healthQ.data.presence && healthQ.data.presence.totalLayoutDecisions > 0 && (
                        <div className="space-y-2 pt-2">
                          <div className="rounded-md border border-border p-3">
                            <div className="flex items-center justify-between mb-1">
                              <div className="text-xs text-muted-foreground">Doctor Presence</div>
                              <Badge
                                variant={healthQ.data.presence.doctorPresencePct >= 0.6 ? "outline" : "destructive"}
                                className="text-[10px]"
                              >
                                {(healthQ.data.presence.doctorPresencePct * 100).toFixed(0)}% · target 60%
                              </Badge>
                            </div>
                            <Progress value={Math.min(100, healthQ.data.presence.doctorPresencePct * 100)} />
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Composition Mix</div>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                              {([
                                ["Layout Diversity", healthQ.data.presence.layoutDiversityPct],
                                ["Full Screen", healthQ.data.presence.fullScreenPct],
                                ["PiP", healthQ.data.presence.pipPct],
                                ["Split Screen", healthQ.data.presence.splitScreenPct],
                                ["Infographic", healthQ.data.presence.infographicPct],
                                ["Clinical Image", healthQ.data.presence.clinicalImagePct],
                              ] as Array<[string, number]>).map(([label, v]) => (
                                <div key={label} className="rounded-md border border-border px-2 py-1.5">
                                  <div className="text-[10px] text-muted-foreground">{label}</div>
                                  <div className="text-sm font-semibold tabular-nums">{(v * 100).toFixed(0)}%</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground border-b border-border">
                      <tr>
                        <th className="text-left py-1 pr-3">Task</th>
                        <th className="text-left py-1 pr-3">Status</th>
                        <th className="text-left py-1 pr-3">Outcome</th>
                        <th className="text-left py-1 pr-3">Source</th>
                        <th className="text-left py-1 pr-3">Validation</th>
                        <th className="text-left py-1 pr-3">Retries</th>
                        <th className="text-left py-1 pr-3">Fallback</th>
                        <th className="text-left py-1 pr-3">Duration</th>
                        <th className="text-left py-1 pr-3">Provider</th>
                        <th className="text-left py-1 pr-3">Model</th>
                      </tr>
                    </thead>
                    <tbody>
                      {healthQ.data.taskExecutions.map((t: any) => (
                        <tr key={t.id} className="border-b border-border/50 align-top">
                          <td className="py-1 pr-3 font-medium">{t.task_name}</td>
                          <td className="py-1 pr-3">
                            <Badge variant="outline" className="capitalize">{String(t.status).replace(/_/g, " ")}</Badge>
                          </td>
                          <td className="py-1 pr-3">{outcomeStage(t)}</td>
                          <td className="py-1 pr-3">
                            <Badge variant={recoverySource(t) === "AI" ? "outline" : "secondary"} className="text-[10px]">
                              {recoverySource(t)}
                            </Badge>
                          </td>
                          <td className="py-1 pr-3">
                            {t.validation_passed ? (
                              <span className="text-emerald-600">Passed</span>
                            ) : (
                              <span className="text-amber-600" title={(t.validation_errors ?? []).join("; ")}>
                                {(t.validation_errors ?? []).length} error(s)
                              </span>
                            )}
                            {Array.isArray(t.validation_warnings) && t.validation_warnings.length > 0 && (
                              <span className="ml-2 text-muted-foreground" title={t.validation_warnings.join("; ")}>
                                · {t.validation_warnings.length} warn
                              </span>
                            )}
                          </td>
                          <td className="py-1 pr-3 tabular-nums">{t.retry_count}</td>
                          <td className="py-1 pr-3">{t.fallback_used ? (t.fallback_stage ?? "yes") : "—"}</td>
                          <td className="py-1 pr-3 tabular-nums">{t.duration_ms != null ? `${(t.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                          <td className="py-1 pr-3">{t.provider}</td>
                          <td className="py-1 pr-3 font-mono text-[10px]">{t.model}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

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
                        <th className="text-left py-1 pr-3">Layer</th>
                        <th className="text-left py-1 pr-3">Action</th>
                        <th className="text-left py-1 pr-3">Type</th>
                        <th className="text-left py-1 pr-3">Layout</th>
                        <th className="text-left py-1 pr-3">Doctor</th>
                        <th className="text-left py-1 pr-3">Size</th>
                        <th className="text-left py-1 pr-3">Focus</th>
                        <th className="text-left py-1 pr-3">Source</th>
                        <th className="text-left py-1 pr-3">Priority</th>
                        <th className="text-left py-1 pr-3">Query</th>
                        <th className="text-left py-1 pr-3">Reason</th>
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
                          <td className="py-1 pr-3 tabular-nums">{m.layer ?? "—"}</td>
                          <td className="py-1 pr-3">{m.action_type ? <Badge variant="outline" className="text-[10px]">{m.action_type}</Badge> : "—"}</td>
                          <td className="py-1 pr-3">{m.asset_type}</td>
                          <td className="py-1 pr-3">{m.layout_name ?? "—"}</td>
                          <td className="py-1 pr-3">{m.doctor_visibility ?? "—"}</td>
                          <td className="py-1 pr-3">{m.doctor_size ?? "—"}</td>
                          <td className="py-1 pr-3">{m.attention_focus ?? "—"}</td>
                          <td className="py-1 pr-3">{m.asset_source}</td>
                          <td className="py-1 pr-3 tabular-nums">{m.priority ?? "—"}</td>
                          <td className="py-1 pr-3 max-w-md truncate" title={m.asset_query}>{m.asset_query}</td>
                          <td className="py-1 pr-3 max-w-xs truncate" title={m.rationale ?? ""}>{m.rationale ?? "—"}</td>
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
              ) : (() => {
                // Visually group manifest entries by layer (Track 0–6).
                const rows = (canonQ.data.manifest as any[]).length > 0
                  ? (canonQ.data.manifest as any[]).map((m) => ({
                      id: m.id,
                      layer: typeof m.layer === "number" ? m.layer : 0,
                      action_type: m.action_type,
                      timeline_start: m.timeline_start,
                      timeline_end: m.timeline_end,
                      scene_id: m.scene_id,
                      transition: m.transition,
                      priority: m.priority,
                      source: m.asset_source,
                      query: m.asset_query,
                    }))
                  : (canonQ.data.timelineInstructions as any[]).map((t) => ({
                      id: t.id, layer: t.layer ?? 0, action_type: null,
                      timeline_start: t.timeline_start, timeline_end: t.timeline_end,
                      scene_id: t.scene_id, transition: t.transition, priority: null,
                      source: t.asset_id ? "registry" : "—", query: "",
                    }));
                const layers = Array.from(new Set(rows.map((r) => r.layer))).sort((a, b) => a - b);
                return (
                  <div className="space-y-4 max-h-[60vh] overflow-auto">
                    {layers.map((layer) => {
                      const items = rows.filter((r) => r.layer === layer).sort((a, b) => a.timeline_start - b.timeline_start);
                      return (
                        <div key={layer}>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="secondary" className="text-[10px]">{trackLabel(layer)}</Badge>
                            <span className="text-xs text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</span>
                          </div>
                          <table className="w-full text-xs">
                            <thead className="text-muted-foreground border-b border-border">
                              <tr>
                                <th className="text-left py-1 pr-3">Action</th>
                                <th className="text-left py-1 pr-3">Start</th>
                                <th className="text-left py-1 pr-3">End</th>
                                <th className="text-left py-1 pr-3">Duration</th>
                                <th className="text-left py-1 pr-3">Priority</th>
                                <th className="text-left py-1 pr-3">Transition</th>
                                <th className="text-left py-1 pr-3">Source</th>
                                <th className="text-left py-1 pr-3">Query</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((r) => (
                                <tr key={r.id} className="border-b border-border/50">
                                  <td className="py-1 pr-3">{r.action_type ?? "—"}</td>
                                  <td className="py-1 pr-3 tabular-nums">{Number(r.timeline_start).toFixed(2)}s</td>
                                  <td className="py-1 pr-3 tabular-nums">{Number(r.timeline_end).toFixed(2)}s</td>
                                  <td className="py-1 pr-3 tabular-nums">{(Number(r.timeline_end) - Number(r.timeline_start)).toFixed(2)}s</td>
                                  <td className="py-1 pr-3 tabular-nums">{r.priority ?? "—"}</td>
                                  <td className="py-1 pr-3">{r.transition ?? "—"}</td>
                                  <td className="py-1 pr-3">{r.source ?? "—"}</td>
                                  <td className="py-1 pr-3 max-w-xs truncate" title={r.query}>{r.query}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
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

        <TabsContent value="layout">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Layout Decisions {canonQ.data && <Badge variant="outline" className="ml-2">{(canonQ.data as any).layoutDecisions?.length ?? 0} decisions</Badge>}
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                disabled={!canonQ.data || (canonQ.data.editActions?.length ?? 0) === 0}
                onClick={async () => {
                  try {
                    toast.info("Generating layout decisions…");
                    await regenLayoutFn({ data: { projectId: id } });
                    qc.invalidateQueries({ queryKey: ["project-canonical", id] });
                    qc.invalidateQueries({ queryKey: ["project-health", id] });
                    toast.success("Layout decisions regenerated.");
                  } catch (e: any) {
                    toast.error(e?.message ?? "Failed");
                  }
                }}
              >
                <RefreshCw className="h-3 w-3 mr-1" />Regenerate
              </Button>
            </CardHeader>
            <CardContent>
              {!canonQ.data || ((canonQ.data as any).layoutDecisions?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No layout decisions yet. Generate Editorial Decisions, then click Regenerate.</p>
              ) : (() => {
                const sceneById = new Map<string, any>((canonQ.data.scenes as any[]).map((s: any) => [s.id, s]));
                const actById = new Map<string, any>((canonQ.data.editActions as any[]).map((a: any) => [a.id, a]));
                const lds = (canonQ.data as any).layoutDecisions as any[];
                return (
                  <div className="overflow-auto max-h-[60vh]">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground border-b border-border">
                        <tr>
                          <th className="text-left py-1 pr-3">Scene</th>
                          <th className="text-left py-1 pr-3">Action</th>
                          <th className="text-left py-1 pr-3">Start</th>
                          <th className="text-left py-1 pr-3">End</th>
                          <th className="text-left py-1 pr-3">Layout</th>
                          <th className="text-left py-1 pr-3">Doctor</th>
                          <th className="text-left py-1 pr-3">Size</th>
                          <th className="text-left py-1 pr-3">Focus</th>
                          <th className="text-left py-1 pr-3">Rationale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lds
                          .slice()
                          .sort((a, b) => Number(a.start_time) - Number(b.start_time))
                          .map((l: any) => {
                            const a = l.action_id ? actById.get(l.action_id) : null;
                            const s = l.scene_id ? sceneById.get(l.scene_id) : null;
                            return (
                              <tr key={l.id} className="border-b border-border/50 align-top">
                                <td className="py-1 pr-3">{s ? s.scene_number : "—"}</td>
                                <td className="py-1 pr-3">
                                  {a?.action_type
                                    ? <Badge variant="outline" className="text-[10px]">{a.action_type}</Badge>
                                    : "—"}
                                </td>
                                <td className="py-1 pr-3 tabular-nums">{Number(l.start_time).toFixed(2)}s</td>
                                <td className="py-1 pr-3 tabular-nums">{Number(l.end_time).toFixed(2)}s</td>
                                <td className="py-1 pr-3">{l.layout_name}</td>
                                <td className="py-1 pr-3">
                                  <Badge
                                    variant={l.doctor_visibility === "hidden" ? "secondary" : "outline"}
                                    className="text-[10px]"
                                  >{l.doctor_visibility}</Badge>
                                </td>
                                <td className="py-1 pr-3 tabular-nums">{l.doctor_size}</td>
                                <td className="py-1 pr-3">{l.attention_focus}</td>
                                <td className="py-1 pr-3 max-w-md truncate" title={l.rationale ?? ""}>{l.rationale ?? "—"}</td>
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

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset project</DialogTitle>
            <DialogDescription>
              Choose how far back to reset. The uploaded video, project settings, and specialty configuration are always preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-sm font-medium">Reset from</label>
            <Select value={resetStage} onValueChange={(v) => setResetStage(v as ResetStage)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="transcript">Transcript — delete everything after transcript</SelectItem>
                <SelectItem value="scene_plan">Scene Plan — delete scenes and downstream</SelectItem>
                <SelectItem value="storyboard">Storyboard — delete storyboard, b-roll, infographics, manifest</SelectItem>
                <SelectItem value="editorial_decisions">Editorial Decisions — delete edit actions + manifest</SelectItem>
                <SelectItem value="complete">Complete Reset — wipe all generated outputs</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await resetFn({ data: { projectId: id, stage: resetStage } });
                  toast.success(`Reset (${resetStage}) complete.`);
                  setResetOpen(false);
                  qc.invalidateQueries({ queryKey: ["project", id] });
                  qc.invalidateQueries({ queryKey: ["project-canonical", id] });
                  qc.invalidateQueries({ queryKey: ["project-health", id] });
                } catch (e: any) {
                  toast.error(e?.message ?? "Reset failed");
                } finally {
                  setBusy(false);
                }
              }}
            >Reset project</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) setDeleteText(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
            <DialogDescription>
              This permanently deletes the project, the uploaded video, and every related record. This cannot be undone. Type <span className="font-mono font-semibold">DELETE</span> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="DELETE" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy || deleteText !== "DELETE"}
              onClick={async () => {
                setBusy(true);
                try {
                  await deleteFn({ data: { projectId: id, confirm: "DELETE" } });
                  toast.success("Project deleted.");
                  navigate({ to: "/dashboard" });
                } catch (e: any) {
                  toast.error(e?.message ?? "Delete failed");
                } finally {
                  setBusy(false);
                }
              }}
            >Delete forever</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { getProject, updateTranscript } from "@/lib/projects.functions";
import { regenerateTask } from "@/lib/analysis.functions";
import { runQueuedJob, startFullPipeline } from "@/lib/jobs.functions";
import { getExportBundle } from "@/lib/exports.functions";
import { getCanonicalProject, rebuildRenderManifest, validateTimeline, exportRenderManifestJson, regenerateEditorialDecisions, regenerateLayoutDecisions } from "@/lib/render.functions";
import { getPipelineHealth } from "@/lib/qa.functions";
import { resetProject, deleteProject, type ResetStage } from "@/lib/project-admin.functions";
import { listAssetReview, reviewAssetCandidate, getProjectReadiness, acceptAllPendingCandidates } from "@/lib/assets.functions";
import { getProjectTimeline, recomposeTimeline } from "@/lib/timeline.functions";
import { createRenderJob, getRenderStatus, cancelRenderJob, listRenderOutputs, validateRenderReadiness } from "@/lib/render-jobs.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, FileJson, FileText, Captions, Trash2, RotateCcw, Play } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

function whyFallback(t: { attempts?: any[] }): string[] {
  const lines: string[] = [];
  const atts = Array.isArray(t.attempts) ? t.attempts : [];
  for (const a of atts) {
    const label = OUTCOME_LABEL[a.stage] ?? a.stage;
    if (a.valid) {
      lines.push(`${label}: ✓ passed`);
      break;
    }
    const errs = Array.isArray(a.errors) ? a.errors.slice(0, 3).join(", ") : (a.error_message ?? "failed");
    lines.push(`${label}: ✗ ${errs}`);
  }
  return lines;
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
  const startPipelineFn = useServerFn(startFullPipeline);
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
  const reviewListFn = useServerFn(listAssetReview);
  const reviewActFn = useServerFn(reviewAssetCandidate);
  const acceptAllFn = useServerFn(acceptAllPendingCandidates);
  const updateTranscriptFn = useServerFn(updateTranscript);
  const readinessFn = useServerFn(getProjectReadiness);
  const timelineFn = useServerFn(getProjectTimeline);
  const recomposeFn = useServerFn(recomposeTimeline);
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

  const reviewQ = useQuery({
    queryKey: ["asset-review", id],
    queryFn: () => reviewListFn({ data: { projectId: id } }),
  });
  const readinessQ = useQuery({
    queryKey: ["readiness", id],
    queryFn: () => readinessFn({ data: { projectId: id } }),
  });
  const reviewMut = useMutation({
    mutationFn: (v: { candidateId: string; action: "accept" | "reject" | "lock" | "replace"; replacementQuery?: string }) =>
      reviewActFn({ data: v }),
    onSuccess: () => {
      toast.success("Review saved");
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Review failed"),
  });
  const acceptAllMut = useMutation({
    mutationFn: () => acceptAllFn({ data: { projectId: id } }),
    onSuccess: (res: any) => {
      toast.success(`Accepted ${res?.accepted ?? 0} candidate(s)`);
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Accept-all failed"),
  });
  const [transcriptDraft, setTranscriptDraft] = useState<string | null>(null);
  const [transcriptDirty, setTranscriptDirty] = useState(false);
  const updateTxMut = useMutation({
    mutationFn: (fullText: string) => updateTranscriptFn({ data: { projectId: id, fullText } }),
    onSuccess: () => {
      toast.success("Transcript saved");
      setTranscriptDirty(true);
      qc.invalidateQueries({ queryKey: ["project", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });
  const rerunFromTranscriptMut = useMutation({
    mutationFn: async () => {
      await resetFn({ data: { projectId: id, stage: "transcript" } });
      const r = await startPipelineFn({ data: { projectId: id } });
      return r;
    },
    onSuccess: (r: any) => {
      toast.success("Pipeline restarted from transcript");
      setTranscriptDirty(false);
      if (r?.runnerUrl) {
        try { fetch(r.runnerUrl, { method: "POST" }); } catch {}
      }
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Rerun failed"),
  });
  const composerQ = useQuery({
    queryKey: ["timeline-composer", id],
    queryFn: () => timelineFn({ data: { projectId: id } }),
  });
  const recomposeMut = useMutation({
    mutationFn: () => recomposeFn({ data: { projectId: id } }),
    onSuccess: () => {
      toast.success("Timeline recomposed");
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Recompose failed"),
  });
  const [composerZoom, setComposerZoom] = useState(8); // pixels per second

  // ---------- Render Queue ----------
  const renderCreateFn = useServerFn(createRenderJob);
  const renderStatusFn = useServerFn(getRenderStatus);
  const renderCancelFn = useServerFn(cancelRenderJob);
  const renderOutputsFn = useServerFn(listRenderOutputs);
  const renderReadyFn = useServerFn(validateRenderReadiness);
  const renderStatusQ = useQuery({
    queryKey: ["render-status", id],
    queryFn: () => renderStatusFn({ data: { projectId: id } }),
    refetchInterval: (q) => {
      const d = q.state.data as any;
      const s = d?.latest?.status;
      return s && ["queued", "preparing", "rendering"].includes(s) ? 1500 : false;
    },
  });
  const renderOutputsQ = useQuery({
    queryKey: ["render-outputs", id],
    queryFn: () => renderOutputsFn({ data: { projectId: id } }),
  });
  const renderReadyQ = useQuery({
    queryKey: ["render-ready", id],
    queryFn: () => renderReadyFn({ data: { projectId: id } }),
  });
  const createRenderMut = useMutation({
    mutationFn: (v: { renderType: "preview" | "full" }) =>
      renderCreateFn({ data: { projectId: id, renderType: v.renderType } }),
    onSuccess: (res: any) => {
      if (!res?.ok) toast.error((res?.blockers ?? ["Unable to queue render"]).join(" · "));
      else toast.success("Render queued");
      qc.invalidateQueries({ queryKey: ["render-status", id] });
      qc.invalidateQueries({ queryKey: ["render-outputs", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to queue render"),
  });
  const cancelRenderMut = useMutation({
    mutationFn: (jobId: string) => renderCancelFn({ data: { jobId } }),
    onSuccess: () => {
      toast.success("Render cancelled");
      qc.invalidateQueries({ queryKey: ["render-status", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Cancel failed"),
  });
  // When a render flips to completed, refresh outputs.
  useEffect(() => {
    const s = (renderStatusQ.data as any)?.latest?.status;
    if (s === "completed") qc.invalidateQueries({ queryKey: ["render-outputs", id] });
  }, [renderStatusQ.data, qc, id]);

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

      {latestJob && ACTIVE_JOB_STATES.has(latestJob.state) && (
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

      {project.video_path && (!latestJob || !ACTIVE_JOB_STATES.has(latestJob.state)) && (
        <Card>
          <CardContent className="py-4 flex items-center justify-between gap-4">
            <div className="text-sm">
              <div className="font-medium">
                {latestJob ? `Last run: ${latestJob.state}` : "Pipeline not started"}
              </div>
              {latestJob?.error && (
                <div className="text-xs text-destructive mt-1 break-all">{latestJob.error}</div>
              )}
            </div>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await startPipelineFn({ data: { projectId: id } });
                  if (res.runnerUrl) fetch(res.runnerUrl, { method: "POST" }).catch(() => undefined);
                  toast.success("Pipeline started.");
                  qc.invalidateQueries({ queryKey: ["project", id] });
                } catch (e: any) {
                  toast.error(e?.message ?? "Failed to start pipeline.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Play className="h-3 w-3 mr-1" />
              {latestJob ? "Restart Pipeline" : "Start Pipeline"}
            </Button>
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
          <TabsTrigger value="review">Review Assets</TabsTrigger>
          <TabsTrigger value="readiness">Readiness</TabsTrigger>
          <TabsTrigger value="render">Render</TabsTrigger>
          <TabsTrigger value="composer">Timeline Composer</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="editorial">Editorial</TabsTrigger>
          <TabsTrigger value="layout">Layout Decisions</TabsTrigger>
          <TabsTrigger value="health">Pipeline Health</TabsTrigger>
          <TabsTrigger value="cost">Cost</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Transcript</CardTitle>
              {transcript && (
                <div className="flex items-center gap-2">
                  {transcriptDraft === null ? (
                    <Button size="sm" variant="outline" onClick={() => setTranscriptDraft(transcript.full_text ?? "")}>
                      Edit
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setTranscriptDraft(null)} disabled={updateTxMut.isPending}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          const text = transcriptDraft ?? "";
                          if (!text.trim()) { toast.error("Transcript cannot be empty"); return; }
                          updateTxMut.mutate(text, {
                            onSuccess: () => setTranscriptDraft(null),
                          });
                        }}
                        disabled={updateTxMut.isPending || transcriptDraft === transcript.full_text}
                      >
                        {updateTxMut.isPending ? "Saving…" : "Save"}
                      </Button>
                    </>
                  )}
                  {transcriptDirty && transcriptDraft === null && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => rerunFromTranscriptMut.mutate()}
                      disabled={rerunFromTranscriptMut.isPending}
                    >
                      <Play className="h-3 w-3 mr-1" />
                      {rerunFromTranscriptMut.isPending ? "Restarting…" : "Rerun pipeline from transcript"}
                    </Button>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="py-4">
              {!transcript ? (
                <p className="text-muted-foreground text-sm">Transcript not ready yet.</p>
              ) : transcriptDraft !== null ? (
                <>
                  <Textarea
                    value={transcriptDraft}
                    onChange={(e) => setTranscriptDraft(e.target.value)}
                    className="min-h-[60vh] text-sm leading-relaxed font-mono"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    After saving, click "Rerun pipeline from transcript" to regenerate every downstream stage
                    (scenes, storyboard, editorial, assets, manifest) using the corrected text.
                  </p>
                </>
              ) : (
                <>
                  {transcriptDirty && (
                    <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                      Transcript edited. Downstream stages are stale until you rerun the pipeline.
                    </div>
                  )}
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed">{transcript.full_text}</pre>
                </>
              )}
            </CardContent>
          </Card>
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
                        <th className="text-left py-1 pr-3">AI Success</th>
                      </tr>
                    </thead>
                    <tbody>
                      {healthQ.data.taskExecutions.map((t: any) => {
                        const m = (healthQ.data!.taskMetrics ?? {})[t.task_name];
                        const atts = Array.isArray(t.attempts) ? t.attempts : [];
                        const reasons = whyFallback(t);
                        return [
                        (<tr key={t.id} className="border-b border-border/50 align-top">
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
                          <td className="py-1 pr-3 tabular-nums">
                            {m ? `${Math.round(m.aiSuccessRate * 100)}% (${m.aiSuccess}/${m.total})` : "—"}
                          </td>
                        </tr>),
                        (<tr key={`${t.id}-diag`} className="border-b border-border/50">
                          <td colSpan={11} className="py-1 pr-3">
                            <details className="group">
                              <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground select-none">
                                Diagnostics · {atts.length} attempt{atts.length === 1 ? "" : "s"}
                                {m ? ` · retry ${Math.round(m.retryRate * 100)}% · fallback ${Math.round(m.fallbackRate * 100)}%` : ""}
                              </summary>
                              <div className="mt-2 space-y-3 pl-2 border-l-2 border-border">
                                {reasons.length > 0 && (
                                  <div>
                                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Why Fallback Was Used</div>
                                    <ol className="text-[11px] space-y-0.5">
                                      {reasons.map((r, i) => <li key={i}>{r}</li>)}
                                    </ol>
                                  </div>
                                )}
                                {Array.isArray(t.validation_errors) && t.validation_errors.length > 0 && (
                                  <div>
                                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Validation Errors (final)</div>
                                    <ul className="text-[11px] text-amber-600 list-disc pl-4">
                                      {t.validation_errors.slice(0, 12).map((e: string, i: number) => <li key={i}>{e}</li>)}
                                    </ul>
                                  </div>
                                )}
                                {atts.map((a: any, i: number) => (
                                  <div key={i} className="rounded border border-border p-2">
                                    <div className="flex items-center gap-2 text-[11px]">
                                      <Badge variant={a.valid ? "outline" : "secondary"} className="text-[10px]">
                                        {OUTCOME_LABEL[a.stage] ?? a.stage}
                                      </Badge>
                                      <span className={a.valid ? "text-emerald-600" : "text-amber-600"}>
                                        {a.valid ? "valid" : "invalid"}
                                      </span>
                                      {a.provider && <span className="text-muted-foreground">· {a.provider}</span>}
                                      {a.model && <span className="text-muted-foreground font-mono">· {a.model}</span>}
                                      {a.duration_ms != null && <span className="text-muted-foreground">· {(a.duration_ms / 1000).toFixed(1)}s</span>}
                                    </div>
                                    {Array.isArray(a.errors) && a.errors.length > 0 && (
                                      <ul className="mt-1 text-[10px] text-amber-600 list-disc pl-4">
                                        {a.errors.slice(0, 8).map((e: string, j: number) => <li key={j}>{e}</li>)}
                                      </ul>
                                    )}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
                                      {a.raw_text && (
                                        <details>
                                          <summary className="cursor-pointer text-[10px] text-muted-foreground">Raw AI text</summary>
                                          <pre className="mt-1 text-[10px] overflow-auto max-h-48 bg-muted/30 rounded p-2 whitespace-pre-wrap">{a.raw_text}</pre>
                                        </details>
                                      )}
                                      {a.raw_parsed !== undefined && (
                                        <details>
                                          <summary className="cursor-pointer text-[10px] text-muted-foreground">Raw parsed</summary>
                                          <pre className="mt-1 text-[10px] overflow-auto max-h-48 bg-muted/30 rounded p-2">{JSON.stringify(a.raw_parsed, null, 2)}</pre>
                                        </details>
                                      )}
                                      {a.normalized !== undefined && (
                                        <details>
                                          <summary className="cursor-pointer text-[10px] text-muted-foreground">Normalized</summary>
                                          <pre className="mt-1 text-[10px] overflow-auto max-h-48 bg-muted/30 rounded p-2">{JSON.stringify(a.normalized, null, 2)}</pre>
                                        </details>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </details>
                          </td>
                        </tr>),
                        ];
                      })}
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
              Asset Library {reviewQ.data && <Badge variant="outline" className="ml-2">{reviewQ.data.candidates.length} candidates · {reviewQ.data.assets.length} assets</Badge>}
            </CardTitle></CardHeader>
            <CardContent>
              {!reviewQ.data || reviewQ.data.candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No asset candidates yet. Generate Storyboard, B-Roll, Infographics, or Editorial Decisions to populate.</p>
              ) : (
                <div className="space-y-6 max-h-[65vh] overflow-auto">
                  {Object.entries(reviewQ.data.grouped).map(([role, items]: [string, any[]]) => (
                    <div key={role}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-semibold">{role}</div>
                        <Badge variant="outline" className="text-[10px]">
                          {items.filter((i) => i.status === "approved" || i.status === "locked" || i.status === "replaced").length} approved · {items.length} total
                        </Badge>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {items.map((c: any) => (
                          <div key={c.id} className="border border-border rounded-md p-2 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <Badge variant="outline" className="text-[10px]">{c.asset_type}</Badge>
                              <Badge
                                variant={c.status === "approved" || c.status === "locked" ? "default" : "secondary"}
                                className="text-[10px]"
                              >{c.status}</Badge>
                            </div>
                            {c.title && <div className="font-medium truncate" title={c.title}>{c.title}</div>}
                            <div className="text-muted-foreground truncate" title={c.search_query}>{c.search_query}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="review">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Review Workspace {reviewQ.data && (
                  <Badge variant="outline" className="ml-2">
                    {reviewQ.data.candidates.filter((c: any) => c.status === "pending" || c.status === "searched").length} pending
                  </Badge>
                )}
              </CardTitle>
              {(() => {
                const pending = (reviewQ.data?.candidates ?? []).filter(
                  (c: any) => c.status === "pending" || c.status === "searched",
                ).length;
                return (
                  <Button
                    size="sm"
                    variant="default"
                    disabled={pending === 0 || acceptAllMut.isPending || reviewMut.isPending}
                    onClick={() => {
                      if (window.confirm(`Accept all ${pending} pending candidate(s)?`)) {
                        acceptAllMut.mutate();
                      }
                    }}
                  >
                    {acceptAllMut.isPending ? "Accepting…" : `Accept all (${pending})`}
                  </Button>
                );
              })()}
            </CardHeader>
            <CardContent>
              {!reviewQ.data || reviewQ.data.candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No candidates to review.</p>
              ) : (
                <div className="space-y-2 max-h-[65vh] overflow-auto">
                  {reviewQ.data.candidates.map((c: any) => (
                    <div key={c.id} className="border border-border rounded-md p-3 text-xs flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">{c.asset_type}</Badge>
                          <Badge
                            variant={c.status === "approved" || c.status === "locked" ? "default" : "secondary"}
                            className="text-[10px]"
                          >{c.status}</Badge>
                          {c.title && <span className="font-medium">{c.title}</span>}
                        </div>
                        <div className="text-muted-foreground truncate" title={c.search_query}>{c.search_query}</div>
                        {c.description && <div className="text-muted-foreground/80 mt-1 line-clamp-2">{c.description}</div>}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button size="sm" variant="default" disabled={reviewMut.isPending}
                          onClick={() => reviewMut.mutate({ candidateId: c.id, action: "accept" })}>Accept</Button>
                        <Button size="sm" variant="outline" disabled={reviewMut.isPending}
                          onClick={() => reviewMut.mutate({ candidateId: c.id, action: "reject" })}>Reject</Button>
                        <Button size="sm" variant="outline" disabled={reviewMut.isPending}
                          onClick={() => {
                            const q = window.prompt("Replacement query", c.search_query ?? "");
                            if (q && q.trim()) reviewMut.mutate({ candidateId: c.id, action: "replace", replacementQuery: q.trim() });
                          }}>Replace</Button>
                        <Button size="sm" variant="secondary" disabled={reviewMut.isPending}
                          onClick={() => reviewMut.mutate({ candidateId: c.id, action: "lock" })}>Lock</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="readiness">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Project Readiness {readinessQ.data && (
                  <Badge variant={readinessQ.data.readyForRender ? "default" : "secondary"} className="ml-2">
                    {readinessQ.data.percent}% {readinessQ.data.readyForRender ? "Ready For Render" : "In Progress"}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!readinessQ.data ? (
                <p className="text-sm text-muted-foreground">Calculating…</p>
              ) : (
                <div className="space-y-3">
                  <Progress value={readinessQ.data.percent} />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    {readinessQ.data.gates.map((g: any) => (
                      <div key={g.key} className="flex items-center justify-between border border-border rounded-md p-2">
                        <div>
                          <div className="font-medium">{g.label}</div>
                          <div className="text-muted-foreground">weight {Math.round(g.weight * 100)}%</div>
                        </div>
                        <Badge variant={g.score >= 1 ? "default" : g.score > 0 ? "secondary" : "outline"}>
                          {Math.round(g.score * 100)}%
                        </Badge>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {readinessQ.data.approvedAssets} of {readinessQ.data.totalCandidates} asset candidates approved.
                  </div>
                  {readinessQ.data.blockers && readinessQ.data.blockers.length > 0 ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                      <div className="font-semibold text-destructive mb-1">BLOCKED · {readinessQ.data.blockers.length} reason{readinessQ.data.blockers.length === 1 ? "" : "s"}</div>
                      <ul className="list-disc list-inside space-y-0.5">
                        {readinessQ.data.blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}
                      </ul>
                    </div>
                  ) : readinessQ.data.readyForRender ? (
                    <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs font-semibold text-emerald-600">
                      ✓ READY TO RENDER
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="render">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Render
                {renderStatusQ.data?.latest && (
                  <Badge variant="outline" className="ml-2 capitalize">{renderStatusQ.data.latest.status}</Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline"
                  disabled={createRenderMut.isPending || !renderReadyQ.data?.ok}
                  onClick={() => createRenderMut.mutate({ renderType: "preview" })}>
                  <Play className="h-3.5 w-3.5 mr-1" />Generate Preview Render
                </Button>
                <Button size="sm"
                  disabled={createRenderMut.isPending || !renderReadyQ.data?.ok}
                  onClick={() => createRenderMut.mutate({ renderType: "full" })}>
                  <Play className="h-3.5 w-3.5 mr-1" />Generate Full Render
                </Button>
                {renderStatusQ.data?.latest && ["queued","preparing","rendering"].includes(renderStatusQ.data.latest.status) && (
                  <Button size="sm" variant="destructive" disabled={cancelRenderMut.isPending}
                    onClick={() => cancelRenderMut.mutate(renderStatusQ.data!.latest!.id)}>
                    Cancel Render
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Pre-flight summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="rounded border border-border p-2">
                  <div className="text-muted-foreground">Readiness</div>
                  <div className="font-semibold">{readinessQ.data ? `${readinessQ.data.percent}%` : "—"}</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-muted-foreground">Timeline</div>
                  <div className="font-semibold">{renderReadyQ.data?.checks.timelineValid ? "Valid" : "Invalid / missing"}</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-muted-foreground">Manifest</div>
                  <div className="font-semibold">{renderReadyQ.data?.checks.manifestExists ? "Ready" : "Missing"}</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-muted-foreground">Duration</div>
                  <div className="font-semibold">{renderReadyQ.data?.checks.durationSeconds?.toFixed(1) ?? "—"}s</div>
                </div>
              </div>

              {renderReadyQ.data && !renderReadyQ.data.ok && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                  <div className="font-semibold text-destructive mb-1">BLOCKED</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {renderReadyQ.data.blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}
                  </ul>
                </div>
              )}

              {/* Latest job */}
              {renderStatusQ.data?.latest ? (
                <div className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium capitalize">{renderStatusQ.data.latest.render_type}</span>
                      <span className="text-muted-foreground"> · {new Date(renderStatusQ.data.latest.created_at).toLocaleString()}</span>
                    </div>
                    <Badge variant="outline" className="capitalize">{renderStatusQ.data.latest.status}</Badge>
                  </div>
                  <Progress value={renderStatusQ.data.latest.progress_percent ?? 0} />
                  <div className="text-xs text-muted-foreground">
                    {renderStatusQ.data.latest.progress_percent ?? 0}%
                    {renderStatusQ.data.latest.error_message ? ` · ${renderStatusQ.data.latest.error_message}` : ""}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No render jobs yet. Approve assets, compose timeline, then queue a render.</p>
              )}

              {/* Outputs */}
              <div>
                <div className="text-sm font-semibold mb-2">Render Outputs</div>
                {(renderOutputsQ.data?.outputs ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No outputs yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {(renderOutputsQ.data?.outputs ?? []).map((o: any) => (
                      <div key={o.id} className="flex items-center justify-between border border-border rounded-md p-2 text-xs">
                        <div className="flex flex-col">
                          <span className="font-medium capitalize">{o.output_type} · {o.resolution}</span>
                          <span className="text-muted-foreground">{new Date(o.created_at).toLocaleString()} · {Math.round((o.file_size ?? 0)/1_000_000)}MB · {Number(o.duration_seconds ?? 0).toFixed(1)}s</span>
                        </div>
                        <Button size="sm" variant="outline" asChild={!!o.file_url} disabled={!o.file_url}>
                          {o.file_url ? <a href={o.file_url} target="_blank" rel="noreferrer">Download</a> : <span>Pending</span>}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* History */}
              {renderStatusQ.data?.history && renderStatusQ.data.history.length > 1 && (
                <div>
                  <div className="text-sm font-semibold mb-2">History</div>
                  <div className="space-y-1">
                    {renderStatusQ.data.history.slice(1).map((j: any) => (
                      <div key={j.id} className="flex items-center justify-between text-xs border border-border rounded-md p-2">
                        <span className="capitalize">{j.render_type} · <span className="text-muted-foreground">{new Date(j.created_at).toLocaleString()}</span></span>
                        <Badge variant="outline" className="capitalize">{j.status}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="composer">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Timeline Composer {composerQ.data && (
                  <Badge variant="outline" className="ml-2">
                    {composerQ.data.items.length} items · {composerQ.data.tracks.length} tracks
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setComposerZoom((z) => Math.max(2, z - 2))}>−</Button>
                <span className="text-xs text-muted-foreground tabular-nums w-14 text-center">{composerZoom} px/s</span>
                <Button size="sm" variant="outline" onClick={() => setComposerZoom((z) => Math.min(40, z + 2))}>+</Button>
                <Button size="sm" onClick={() => recomposeMut.mutate()} disabled={recomposeMut.isPending}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />Recompose
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!composerQ.data ? (
                <p className="text-sm text-muted-foreground">Loading timeline…</p>
              ) : composerQ.data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No timeline items yet. Run Editorial Decisions, then click Recompose.</p>
              ) : (
                <div className="space-y-3">
                  {/* Validation summary */}
                  <div className="flex items-center gap-2 text-xs">
                    {composerQ.data.validation.valid ? (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">✓ Valid</Badge>
                    ) : (
                      <Badge variant="destructive">{composerQ.data.validation.errorCount} error{composerQ.data.validation.errorCount === 1 ? "" : "s"}</Badge>
                    )}
                    {composerQ.data.validation.warningCount > 0 && (
                      <Badge variant="secondary">{composerQ.data.validation.warningCount} warning{composerQ.data.validation.warningCount === 1 ? "" : "s"}</Badge>
                    )}
                    <span className="text-muted-foreground">Duration: {composerQ.data.duration.toFixed(1)}s</span>
                  </div>

                  {/* Timeline grid */}
                  {(() => {
                    const duration = Math.max(composerQ.data.duration, ...composerQ.data.items.map((i: any) => Number(i.end_time)));
                    const totalWidth = Math.max(600, Math.ceil(duration) * composerZoom);
                    const ticks: number[] = [];
                    const tickEvery = composerZoom < 6 ? 30 : composerZoom < 14 ? 10 : 5;
                    for (let t = 0; t <= duration; t += tickEvery) ticks.push(t);
                    const itemsByTrack: Record<string, any[]> = {};
                    for (const it of composerQ.data.items) (itemsByTrack[it.track_id] ??= []).push(it);
                    return (
                      <div className="border border-border rounded-md overflow-auto max-h-[60vh]">
                        {/* Ruler */}
                        <div className="flex border-b border-border bg-muted/40 sticky top-0 z-10">
                          <div className="w-32 shrink-0 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground border-r border-border">Track</div>
                          <div className="relative" style={{ width: totalWidth, height: 24 }}>
                            {ticks.map((t) => (
                              <div key={t} className="absolute top-0 bottom-0 border-l border-border/60" style={{ left: t * composerZoom }}>
                                <span className="absolute top-0.5 left-1 text-[10px] text-muted-foreground tabular-nums">{t}s</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* Tracks */}
                        {composerQ.data.tracks.map((tr: any) => {
                          const its = itemsByTrack[tr.id] ?? [];
                          return (
                            <div key={tr.id} className="flex border-b border-border last:border-b-0 hover:bg-muted/20">
                              <div className="w-32 shrink-0 px-2 py-2 border-r border-border flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tr.color }} />
                                <span className="text-xs truncate" title={tr.name}>{tr.name}</span>
                              </div>
                              <div className="relative" style={{ width: totalWidth, height: 36 }}>
                                {ticks.map((t) => (
                                  <div key={t} className="absolute top-0 bottom-0 border-l border-border/30" style={{ left: t * composerZoom }} />
                                ))}
                                {its.map((it: any) => {
                                  const left = Number(it.start_time) * composerZoom;
                                  const width = Math.max(2, (Number(it.end_time) - Number(it.start_time)) * composerZoom);
                                  const missing = it.status === "missing_asset";
                                  return (
                                    <div
                                      key={it.id}
                                      className="absolute top-1 bottom-1 rounded px-1.5 text-[10px] font-medium text-white truncate cursor-default border"
                                      style={{
                                        left, width,
                                        background: missing ? "transparent" : tr.color,
                                        borderColor: tr.color,
                                        color: missing ? tr.color : "white",
                                      }}
                                      title={`${it.asset_type} ${Number(it.start_time).toFixed(1)}-${Number(it.end_time).toFixed(1)}s · ${it.status}${it.title ? `\n${it.title}` : ""}`}
                                    >
                                      {it.title || it.asset_type}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Issues list */}
                  {composerQ.data.validation.issues.length > 0 && (
                    <div className="border border-border rounded-md p-2 max-h-48 overflow-auto">
                      <div className="text-xs font-semibold mb-1">Validation issues</div>
                      <ul className="space-y-1 text-[11px]">
                        {composerQ.data.validation.issues.map((iss: any, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <Badge variant={iss.level === "error" ? "destructive" : "secondary"} className="text-[9px] uppercase">{iss.level}</Badge>
                            <span>{iss.message}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
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

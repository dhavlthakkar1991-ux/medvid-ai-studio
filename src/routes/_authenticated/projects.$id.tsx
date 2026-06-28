import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getProject, updateTranscript, setProjectDuration, getProjectVideoUrl } from "@/lib/projects.functions";
import { regenerateTask } from "@/lib/analysis.functions";
import { startFullPipeline, runQueuedJob, retryPipeline } from "@/lib/jobs.functions";
import { getExportBundle } from "@/lib/exports.functions";
import { getCanonicalProject, rebuildRenderManifest, validateTimeline, exportRenderManifestJson, regenerateEditorialDecisions, regenerateLayoutDecisions } from "@/lib/render.functions";
import { getPipelineHealth } from "@/lib/qa.functions";
import { resetProject, deleteProject, type ResetStage } from "@/lib/project-admin.functions";
import {
  listAssetReview,
  reviewAssetCandidate,
  getProjectReadiness,
  acceptAllPendingCandidates,
  approveHighConfidenceCandidates,
  rejectLowConfidenceCandidates,
  exportAssetReviewArtifacts,
  fulfillAssetCandidate,
  searchAssetCandidate,
  approveAssetSearchResult,
  createAssetUploadUrl,
  approveUploadedAsset,
  approveManualAssetUrl,
  fulfillProjectAssetsWithWorker,
  approveSceneAssetCandidates,
  reconcileSceneManifestCoverage,
} from "@/lib/assets.functions";
import { getProjectTimeline, recomposeTimeline, aiFixTimelineIssues, addCtaToTimeline } from "@/lib/timeline.functions";
import { createRenderJob, getRenderStatus, cancelRenderJob, listRenderOutputs, validateRenderReadiness } from "@/lib/render-jobs.functions";
import { getProviderJobForRender } from "@/lib/render-providers.functions";
import { compileProjectGraphics } from "@/lib/graphics/graphics.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, FileJson, FileText, Captions, Trash2, RotateCcw, Play } from "lucide-react";
import { AiToolPrompt } from "@/components/AiToolPrompt";
import { TimelinePreview } from "@/components/TimelinePreview";
import { ProductionPackageExport } from "@/components/ProductionPackageExport";
import { RenderSpecInspector } from "@/components/RenderSpecInspector";
import { RenderWorkerStatusCard } from "@/components/RenderWorkerStatusCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  component: ProjectView,
  head: () => ({ meta: [{ title: "Project - MedVideo AI" }] }),
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

function isActionableTimelineIssue(issue: any): boolean {
  const message = String(issue?.message ?? "").toLowerCase();
  const isEmptyOptionalTrack = (issue?.code === "empty_track" || message.includes("track has no items")) && issue?.track_kind !== "cta";
  return !isEmptyOptionalTrack;
}

function whyFallback(t: { attempts?: any[] }): string[] {
  const lines: string[] = [];
  const atts = Array.isArray(t.attempts) ? t.attempts : [];
  for (const a of atts) {
    const label = OUTCOME_LABEL[a.stage] ?? a.stage;
    if (a.valid) {
      lines.push(`${label}: PASS passed`);
      break;
    }
    const errs = Array.isArray(a.errors) ? a.errors.slice(0, 3).join(", ") : (a.error_message ?? "failed");
    lines.push(`${label}: FAIL ${errs}`);
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
  0: "Track 0 - Talking Head",
  1: "Track 1 - B-roll",
  2: "Track 2 - Infographics",
  3: "Track 3 - Lower Thirds",
  4: "Track 4 - Kinetic Typography",
  5: "Track 5 - Keyword Highlights",
  6: "Track 6 - CTA / End Cards",
};
const trackLabel = (n: unknown) => {
  const v = typeof n === "number" ? n : Number(n);
  return TRACK_LABELS[v] ?? `Track ${Number.isFinite(v) ? v : "?"}`;
};

function assetReadinessLabel(c: any) {
  if (c.candidate_data?.asset_status === "missing_required" || c.candidate_data?.selected_asset_status === "missing_required") return "Missing required";
  if (c.render_classification === "REAL_RENDERABLE_MEDIA" || c.has_usable_url) return "Renderable";
  if (String(c.status ?? "").includes("placeholder")) return "Placeholder only";
  if (String(c.status ?? "") === "needs_asset") return "Needs asset";
  return "Needs asset";
}

function assetReadinessVariant(c: any): "default" | "secondary" | "outline" | "destructive" {
  if (c.candidate_data?.asset_status === "missing_required" || c.candidate_data?.selected_asset_status === "missing_required") return "destructive";
  if (c.render_classification === "REAL_RENDERABLE_MEDIA" || c.has_usable_url) return "default";
  if (String(c.status ?? "") === "needs_asset") return "destructive";
  return "secondary";
}

function reviewBucket(c: any) {
  const status = String(c.status ?? "");
  if (status === "rejected") return "Rejected";
  if (status === "approved" || status === "locked" || status === "replaced") return "Approved";
  if (c.has_usable_url || c.render_classification === "REAL_RENDERABLE_MEDIA") return "Render Ready";
  if (status.includes("placeholder") || c.render_classification === "PLACEHOLDER_PLAN") return "Placeholder Plans";
  return "Needs Asset";
}

function professionalReviewBuckets(c: any): string[] {
  const buckets = [reviewBucket(c)];
  const status = String(c.status ?? "");
  if (status === "pending" || status === "searched") buckets.push("Needs Review");
  if (c.confidence_tier === "A") buckets.push("High Confidence");
  if (c.is_clinical) buckets.push("Clinical Images");
  const type = String(c.asset_type ?? "").toLowerCase();
  const taxonomy = String(c.medical_asset_taxonomy ?? "").toLowerCase();
  if (type.includes("infographic") || taxonomy.includes("infographic")) buckets.push("Infographics");
  if (type.includes("broll") || type.includes("video")) buckets.push("B-roll");
  if (type.includes("diagram") || taxonomy.includes("illustration") || taxonomy.includes("diagram")) buckets.push("Medical Illustrations");
  if (["known_open", "public_domain", "attribution_required"].includes(String(c.license_status))) buckets.push("Open License");
  if (!c.license_status || String(c.license_status) === "unknown") buckets.push("Unknown License");
  return Array.from(new Set(buckets));
}

function canGenerateInternalGraphic(c: any) {
  const t = String(c.asset_type ?? "").toLowerCase();
  return t.includes("infographic") || t.includes("diagram") || t.includes("overlay") || t.includes("cta");
}

function mediaKindForCandidate(c: any) {
  const t = String(c.asset_type ?? "").toLowerCase();
  if (t.includes("video") || t.includes("broll")) return "video";
  return "image";
}

function sceneSelectionKey(sceneId?: string | null, sceneIndex?: number | null) {
  return sceneId ? `scene:${sceneId}` : `index:${sceneIndex ?? "unknown"}`;
}

function stableRequirementKey(value: unknown, fallback: string) {
  const raw = String(value ?? "").trim();
  return raw && raw !== "undefined" && raw !== "null" ? raw : fallback;
}

async function probeUploadMedia(file: File): Promise<{ width?: number; height?: number; duration_seconds?: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("video/") || /\.(mp4|mov)$/i.test(file.name)) {
      return await new Promise((resolve, reject) => {
        const video = document.createElement("video");
        const timer = window.setTimeout(() => reject(new Error("Video probe timed out")), 15_000);
        video.preload = "metadata";
        video.onloadedmetadata = () => {
          window.clearTimeout(timer);
          resolve({
            width: video.videoWidth || undefined,
            height: video.videoHeight || undefined,
            duration_seconds: Number.isFinite(video.duration) ? video.duration : undefined,
          });
        };
        video.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error("Could not read video metadata"));
        };
        video.src = url;
      });
    }
    if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|svg)$/i.test(file.name)) {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        const timer = window.setTimeout(() => reject(new Error("Image probe timed out")), 15_000);
        image.onload = () => {
          window.clearTimeout(timer);
          resolve({ width: image.naturalWidth || undefined, height: image.naturalHeight || undefined });
        };
        image.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error("Could not read image metadata"));
        };
        image.src = url;
      });
    }
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

const ACTIVE_JOB_STATES = new Set(["queued", "transcribing", "analyzing"]);

function ProjectView() {
  const { id } = useParams({ from: "/_authenticated/projects/$id" });
  const navigate = useNavigate();
  const getFn = useServerFn(getProject);
  const regenFn = useServerFn(regenerateTask);
  const startPipelineFn = useServerFn(startFullPipeline);
  const runQueuedJobFn = useServerFn(runQueuedJob);
  const retryPipelineFn = useServerFn(retryPipeline);
  const exportFn = useServerFn(getExportBundle);
  const canonFn = useServerFn(getCanonicalProject);
  const rebuildFn = useServerFn(rebuildRenderManifest);
  const validateFn = useServerFn(validateTimeline);
  const exportManifestFn = useServerFn(exportRenderManifestJson);
  const compileGraphicsFn = useServerFn(compileProjectGraphics);
  const regenEditorialFn = useServerFn(regenerateEditorialDecisions);
  const regenLayoutFn = useServerFn(regenerateLayoutDecisions);
  const healthFn = useServerFn(getPipelineHealth);
  const resetFn = useServerFn(resetProject);
  const deleteFn = useServerFn(deleteProject);
  const reviewListFn = useServerFn(listAssetReview);
  const reviewActFn = useServerFn(reviewAssetCandidate);
  const acceptAllFn = useServerFn(acceptAllPendingCandidates);
  const approveHighConfidenceFn = useServerFn(approveHighConfidenceCandidates);
  const rejectLowConfidenceFn = useServerFn(rejectLowConfidenceCandidates);
  const exportAssetReviewArtifactsFn = useServerFn(exportAssetReviewArtifacts);
  const fulfillAssetFn = useServerFn(fulfillAssetCandidate);
  const searchAssetFn = useServerFn(searchAssetCandidate);
  const approveSearchResultFn = useServerFn(approveAssetSearchResult);
  const createAssetUploadUrlFn = useServerFn(createAssetUploadUrl);
  const approveUploadedAssetFn = useServerFn(approveUploadedAsset);
  const approveManualAssetUrlFn = useServerFn(approveManualAssetUrl);
  const fulfillProjectAssetsWithWorkerFn = useServerFn(fulfillProjectAssetsWithWorker);
  const approveSceneAssetCandidatesFn = useServerFn(approveSceneAssetCandidates);
  const reconcileSceneManifestCoverageFn = useServerFn(reconcileSceneManifestCoverage);
  const updateTranscriptFn = useServerFn(updateTranscript);
  const readinessFn = useServerFn(getProjectReadiness);
  const timelineFn = useServerFn(getProjectTimeline);
  const recomposeFn = useServerFn(recomposeTimeline);
  const aiFixTimelineFn = useServerFn(aiFixTimelineIssues);
  const addCtaFn = useServerFn(addCtaToTimeline);
  const setDurationFn = useServerFn(setProjectDuration);
  const getVideoUrlFn = useServerFn(getProjectVideoUrl);
  const qc = useQueryClient();
  const [resetStage, setResetStage] = useState<ResetStage>("complete");
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [ctaFixOpen, setCtaFixOpen] = useState(false);
  const [ctaFixText, setCtaFixText] = useState("Subscribe for more medical updates");
  const [reviewFilter, setReviewFilter] = useState("Needs Review");
  const [assetSearches, setAssetSearches] = useState<Record<string, any>>({});
  const [sceneSelections, setSceneSelections] = useState<Record<string, string[]>>({});
  const [showRawAssetDebug, setShowRawAssetDebug] = useState(false);
  const [uploadingCandidateId, setUploadingCandidateId] = useState<string | null>(null);
  const [assetPromptTodo, setAssetPromptTodo] = useState<any | null>(null);
  const [manualUrlCandidate, setManualUrlCandidate] = useState<any | null>(null);
  const [manualUrlDraft, setManualUrlDraft] = useState({
    source_url: "",
    title: "",
    attribution: "",
    specialty: "",
    diagnosis_topic: "",
    anatomy: "",
    visual_concept: "",
    sensitivity_level: "safe",
    provenance_notes: "",
  });
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
    enabled: Boolean(id),
    refetchOnMount: "always",
    staleTime: 0,
  });
  useEffect(() => {
    if (typeof window !== "undefined") void reviewQ.refetch();
    // The asset review payload depends on the browser Supabase session; force a
    // client refetch so SSR/empty hydration state cannot hide review rows.
  }, [id, reviewQ.refetch]);
  const readinessQ = useQuery({
    queryKey: ["readiness", id],
    queryFn: () => readinessFn({ data: { projectId: id } }),
  });
  const reviewMut = useMutation({
    mutationFn: (v: { candidateId: string; action: "accept" | "reject" | "lock" | "unlock" | "preferred" | "replace" | "mark_missing"; replacementQuery?: string; note?: string }) =>
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
      toast.success(`Approved ${res?.accepted ?? 0} renderable candidate(s)`, {
        description: `${res?.placeholders ?? 0} placeholder plan(s) marked as needs asset`,
      });
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Accept-all failed"),
  });
  const approveHighConfidenceMut = useMutation({
    mutationFn: () => approveHighConfidenceFn({ data: { projectId: id } }),
    onSuccess: (res: any) => {
      toast.success(`Approved ${res?.accepted ?? 0} high-confidence candidate(s)`, {
        description: `${res?.skipped ?? 0} candidate(s) kept for manual review`,
      });
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
      qc.invalidateQueries({ queryKey: ["render-readiness", id] });
      qc.invalidateQueries({ queryKey: ["render-bundle", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "High-confidence approval failed"),
  });
  const rejectLowConfidenceMut = useMutation({
    mutationFn: () => rejectLowConfidenceFn({ data: { projectId: id } }),
    onSuccess: (res: any) => {
      toast.success(`Rejected ${res?.rejected ?? 0} low-confidence candidate(s)`, {
        description: `${res?.skipped ?? 0} candidate(s) kept for review`,
      });
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Low-confidence rejection failed"),
  });
  const exportReviewArtifactsMut = useMutation({
    mutationFn: () => exportAssetReviewArtifactsFn({ data: { projectId: id } }),
    onSuccess: (res: any) => {
      toast.success("Review artifacts exported", {
        description: res?.directory ?? "Artifact JSON files written",
      });
    },
    onError: (e: any) => toast.error(e?.message ?? "Artifact export failed"),
  });
  const fulfillProjectAssetsMut = useMutation({
    mutationFn: () => fulfillProjectAssetsWithWorkerFn({ data: { projectId: id } }),
    onSuccess: (res: any) => {
      toast.success(`AI worker stored ${res?.inserted ?? 0} candidate(s)`, {
        description: `${res?.autoApproved ?? 0} auto-approved, ${res?.needsReview ?? 0} need review, ${res?.rejected ?? 0} rejected`,
      });
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
      qc.invalidateQueries({ queryKey: ["render-readiness", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "AI worker asset fulfillment failed"),
  });
  const fulfillAssetMut = useMutation({
    mutationFn: (candidateId: string) => fulfillAssetFn({ data: { candidateId } }),
    onSuccess: (res: any) => {
      if (res?.ok) toast.success(`Asset fulfilled via ${res.provider}`);
      else toast.warning(res?.reason ?? "Needs asset provider key");
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
      qc.invalidateQueries({ queryKey: ["render-readiness", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Asset fulfillment failed"),
  });
  const searchAssetMut = useMutation({
    mutationFn: (v: { candidateId: string; provider: "any" | "pexels" | "pixabay" | "unsplash" | "internal" }) =>
      searchAssetFn({ data: v }),
    onSuccess: (res: any, vars) => {
      setAssetSearches((prev) => ({ ...prev, [vars.candidateId]: res }));
      if (res?.results?.length) toast.success(`Found ${res.results.length} asset result(s)`);
      else toast.warning(res?.reason ?? res?.status?.message ?? "No asset results found");
    },
    onError: (e: any) => toast.error(e?.message ?? "Asset search failed"),
  });
  const approveSceneMut = useMutation({
    mutationFn: (v: { projectId: string; sceneId?: string | null; sceneIndex?: number | null; candidateIds: string[]; repairLayout?: boolean }) =>
      approveSceneAssetCandidatesFn({ data: v }),
    onSuccess: (res: any, vars) => {
      toast.success(vars.repairLayout ? "Scene assets approved and layout repair recorded" : "Scene assets approved", {
        description: `${res?.approved?.length ?? 0} approved, ${res?.failed?.length ?? 0} failed`,
      });
      setSceneSelections((prev) => ({ ...prev, [sceneSelectionKey(vars.sceneId, vars.sceneIndex)]: [] }));
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
      qc.invalidateQueries({ queryKey: ["render-readiness", id] });
      qc.invalidateQueries({ queryKey: ["render-bundle", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Scene approval failed"),
  });
  const reconcileSceneMut = useMutation({
    mutationFn: (v: { projectId: string; sceneId?: string | null; sceneIndex?: number | null }) =>
      reconcileSceneManifestCoverageFn({ data: v }),
    onSuccess: (res: any) => {
      toast.success("Scene manifest coverage reconciled", {
        description: `${res?.linked ?? 0} linked`,
      });
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
      qc.invalidateQueries({ queryKey: ["render-readiness", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Scene manifest repair failed"),
  });
  const approveSearchMut = useMutation({
    mutationFn: (v: { candidateId: string; result: any }) => approveSearchResultFn({ data: v }),
    onSuccess: () => {
      toast.success("Selected asset approved");
      setAssetSearches({});
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
      qc.invalidateQueries({ queryKey: ["render-readiness", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Approve result failed"),
  });
  const approveManualUrlMut = useMutation({
    mutationFn: (v: {
      candidateId: string;
      source_url: string;
      title?: string;
      attribution?: string;
      specialty?: string;
      diagnosis_topic?: string;
      anatomy?: string;
      visual_concept?: string;
      sensitivity_level?: "safe" | "mild clinical" | "graphic";
      provenance_notes?: string;
    }) =>
      approveManualAssetUrlFn({ data: v }),
    onSuccess: () => {
      toast.success("Manual media URL approved");
      setManualUrlCandidate(null);
      setManualUrlDraft({ source_url: "", title: "", attribution: "", specialty: "", diagnosis_topic: "", anatomy: "", visual_concept: "", sensitivity_level: "safe", provenance_notes: "" });
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
      qc.invalidateQueries({ queryKey: ["render-readiness", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Manual URL approval failed"),
  });
  const uploadAssetFile = async (candidateId: string, file: File) => {
    setUploadingCandidateId(candidateId);
    try {
      const media: { width?: number; height?: number; duration_seconds?: number } = await probeUploadMedia(file).catch(() => ({}));
      const { path, token } = await createAssetUploadUrlFn({
        data: { candidateId, filename: file.name, contentType: file.type || undefined },
      });
      const { error: upErr } = await supabase.storage.from("videos").uploadToSignedUrl(path, token, file);
      if (upErr) throw upErr;
      await approveUploadedAssetFn({
        data: {
          candidateId,
          path,
          filename: file.name,
          contentType: file.type || undefined,
          width: media.width ?? null,
          height: media.height ?? null,
          duration_seconds: media.duration_seconds ?? null,
        },
      });
      toast.success("Manual asset uploaded and approved");
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
      qc.invalidateQueries({ queryKey: ["render-readiness", id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Manual upload failed");
    } finally {
      setUploadingCandidateId(null);
    }
  };
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
      if ((r as any)?.runnerUnavailable) {
        toast.warning((r as any).message ?? "Automatic background runner is not configured.");
      } else if (r?.runnerUrl) {
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
  const aiFixTimelineMut = useMutation({
    mutationFn: () => aiFixTimelineFn({ data: { projectId: id } }),
    onSuccess: (res: any) => {
      const fixes = res?.fixesApplied?.length ? res.fixesApplied.join(" - ") : "No repairs needed";
      const remainingIssues = res?.validation?.issues ?? [];
      const needsCta = remainingIssues.some((iss: any) => iss.code === "empty_track" && iss.track_kind === "cta");
      if (needsCta) {
        toast.info("CTA text is needed to finish this fix.");
        setCtaFixOpen(true);
      } else if (res?.ok) toast.success(`Timeline fixed - ${fixes}`);
      else toast.warning(`Partial fix - ${fixes}. ${res?.validation?.errorCount ?? 0} error(s) remain.`);
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "AI fix failed"),
  });
  const addCtaMut = useMutation({
    mutationFn: () => addCtaFn({ data: { projectId: id, text: ctaFixText.trim() } }),
    onSuccess: () => {
      toast.success("CTA added and timeline rebuilt");
      setCtaFixOpen(false);
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
      qc.invalidateQueries({ queryKey: ["preview-timeline", id] });
      qc.invalidateQueries({ queryKey: ["preview-canonical", id] });
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "CTA fix failed"),
  });
  const fixBlockerMut = useMutation({
    mutationFn: async (fix: any) => {
      if (fix.kind === "task") return regenFn({ data: { projectId: id, task: fix.task } });
      if (fix.kind === "timeline") return aiFixTimelineFn({ data: { projectId: id } });
      if (fix.kind === "manifest") return rebuildFn({ data: { projectId: id } });
      if (fix.kind === "approve_assets") return acceptAllFn({ data: { projectId: id } });
      return null;
    },
    onSuccess: () => {
      toast.success("Fix applied");
      qc.invalidateQueries({ queryKey: ["readiness", id] });
      qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
      qc.invalidateQueries({ queryKey: ["asset-review", id] });
      qc.invalidateQueries({ queryKey: ["project-canonical", id] });
      qc.invalidateQueries({ queryKey: ["project", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Fix failed"),
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
  const providerJobFn = useServerFn(getProviderJobForRender);
  const latestJobId = (renderStatusQ.data as any)?.latest?.id as string | undefined;
  const providerJobQ = useQuery({
    queryKey: ["provider-job", latestJobId],
    enabled: !!latestJobId,
    queryFn: () => providerJobFn({ data: { renderJobId: latestJobId! } }),
    refetchInterval: (q) => {
      const status = (q.state.data as any)?.providerJob?.status;
      return status && ["queued","preparing","rendering"].includes(status) ? 2000 : false;
    },
  });
  const createRenderMut = useMutation({
    mutationFn: (v: { renderType: "preview" | "full" }) =>
      renderCreateFn({ data: { projectId: id, renderType: v.renderType } }),
    onSuccess: (res: any) => {
      if (!res?.ok) toast.error((res?.blockers ?? ["Unable to queue render"]).join(" - "));
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

  // Keep active jobs warm. The server runner is still the only place that
  // advances the pipeline; this client nudge is throttled and only refires
  // when progress has not changed for a while, so users do not need to keep
  // pressing Retry after a dropped background invocation.
  useEffect(() => {
    if (!latestJobForLaunch || !ACTIVE_JOB_STATES.has(latestJobForLaunch.state)) return;
    let cancelled = false;
    let lastProgress = Number(latestJobForLaunch.progress) || 0;
    let lastChangeAt = Date.now();
    const timer = window.setInterval(async () => {
      const current = qc.getQueryData(["project", id]) as any;
      const job = current?.latestJob;
      if (!job || !ACTIVE_JOB_STATES.has(job.state)) return;
      const progress = Number(job.progress) || 0;
      if (progress !== lastProgress) {
        lastProgress = progress;
        lastChangeAt = Date.now();
        return;
      }
      if (Date.now() - lastChangeAt < 45_000) return;
      lastChangeAt = Date.now();
      try {
        const res = await runQueuedJobFn({ data: { jobId: job.id } });
        if (!cancelled && (res as any).runnerUnavailable) {
          toast.warning((res as any).message ?? "Automatic background runner is not configured.");
          qc.invalidateQueries({ queryKey: ["project", id] });
        }
        if (!cancelled && res.runnerUrl) fetch(res.runnerUrl, { method: "POST" }).catch(() => undefined);
      } catch {}
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, latestJobForLaunch?.id, latestJobForLaunch?.state, qc, runQueuedJobFn]);

  const regen = useMutation({
    mutationFn: (task: string) => regenFn({ data: { projectId: id, task: task as any } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", id] }); toast.success("Regenerated."); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  if (q.isLoading) return <div className="p-10 text-muted-foreground">Loading...</div>;
  if (!q.data) return null;

  const { project, transcript, versions, latestJob, usage } = q.data;
  const renderReadiness = renderReadyQ.data as any;
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

      <DurationCard
        projectId={id}
        currentDuration={Number(project.duration_seconds) || 0}
        getVideoUrl={async () => (await getVideoUrlFn({ data: { projectId: id } })).url}
        setDuration={async (d: number) => setDurationFn({ data: { projectId: id, durationSeconds: d } })}
        onUpdated={() => {
          qc.invalidateQueries({ queryKey: ["project", id] });
          qc.invalidateQueries({ queryKey: ["timeline-composer", id] });
          qc.invalidateQueries({ queryKey: ["project-canonical", id] });
          qc.invalidateQueries({ queryKey: ["readiness", id] });
        }}
      />

      {latestJob && ACTIVE_JOB_STATES.has(latestJob.state) && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium capitalize">{latestJob.state}...</div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground">{latestJob.progress}%</div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const res = await retryPipelineFn({ data: { projectId: id } });
                      if ((res as any).runnerUnavailable) {
                        toast.warning((res as any).message ?? "Automatic background runner is not configured.");
                      } else if (res.runnerUrl) {
                        fetch(res.runnerUrl, { method: "POST" }).catch(() => undefined);
                      }
                      if (!(res as any).runnerUnavailable) {
                        const parts: string[] = [];
                        if (res.clearedRunning) parts.push(`${res.clearedRunning} stuck`);
                        if (res.clearedFailed) parts.push(`${res.clearedFailed} failed`);
                      toast.success(parts.length ? `Retrying - cleared ${parts.join(" + ")} task(s).` : "Pipeline re-fired.");
                      }
                      qc.invalidateQueries({ queryKey: ["project", id] });
                      qc.invalidateQueries({ queryKey: ["pipeline-health", id] });
                    } catch (e: any) {
                      toast.error(e?.message ?? "Retry failed.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Retry stuck tasks
                </Button>
              </div>
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
            <div className="flex items-center gap-2">
            {latestJob && (latestJob.state === "failed" || latestJob.state === "needs_review") && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await retryPipelineFn({ data: { projectId: id } });
                    if ((res as any).runnerUnavailable) {
                      toast.warning((res as any).message ?? "Automatic background runner is not configured.");
                    } else if (res.runnerUrl) {
                      fetch(res.runnerUrl, { method: "POST" }).catch(() => undefined);
                    }
                    if (!(res as any).runnerUnavailable) toast.success("Retrying failed tasks...");
                    qc.invalidateQueries({ queryKey: ["project", id] });
                    qc.invalidateQueries({ queryKey: ["pipeline-health", id] });
                  } catch (e: any) {
                    toast.error(e?.message ?? "Retry failed.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Retry failed tasks
              </Button>
            )}
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await startPipelineFn({ data: { projectId: id } });
                  if ((res as any).runnerUnavailable) {
                    toast.warning((res as any).message ?? "Automatic background runner is not configured.");
                  } else {
                    if (res.runnerUrl) fetch(res.runnerUrl, { method: "POST" }).catch(() => undefined);
                    toast.success("Pipeline started.");
                  }
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
            </div>
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
                      {recoverySource(t)}{warns > 0 ? ` - ${warns} warn` : ""}
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
          <TabsTrigger value="renderspec">RenderSpec</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
          <TabsTrigger value="composer">Timeline Composer</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
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
                        {updateTxMut.isPending ? "Saving..." : "Save"}
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
                      {rerunFromTranscriptMut.isPending ? "Restarting..." : "Rerun pipeline from transcript"}
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
                  <div className="flex items-center gap-2">
                    <AiToolPrompt projectId={id} task={t as any} disabled={!v} />
                    <Button size="sm" variant="outline" onClick={() => regen.mutate(t)} disabled={regen.isPending || !transcript}>
                      <RefreshCw className="h-3 w-3 mr-1" />Regenerate
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {!v ? <p className="text-sm text-muted-foreground">Not generated yet.</p> :
                    <pre className="text-xs overflow-auto max-h-[60vh] bg-muted/30 rounded-md p-3">{JSON.stringify(v.analysis_data, null, 2)}</pre>}
                  {v && <div className="text-xs text-muted-foreground mt-2">{v.provider} - {v.model} - {new Date(v.created_at).toLocaleString()}</div>}
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
                  Last run {(healthQ.data.latestRun.duration_ms / 1000).toFixed(1)}s -
                  {" "}{healthQ.data.latestRun.failures_count} failures - {healthQ.data.latestRun.warnings_count} warnings
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
                            {(healthQ.data.editorial.coverage * 100).toFixed(0)}% - target 70%
                          </Badge>
                        </div>
                        <Progress value={Math.min(100, healthQ.data.editorial.coverage * 100)} />
                        <div className="text-[11px] text-muted-foreground mt-1">
                          {healthQ.data.editorial.coveredSeconds.toFixed(1)}s of {healthQ.data.editorial.durationSeconds.toFixed(1)}s -{" "}
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
                                {(healthQ.data.presence.doctorPresencePct * 100).toFixed(0)}% - target 60%
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
                                - {t.validation_warnings.length} warn
                              </span>
                            )}
                          </td>
                          <td className="py-1 pr-3 tabular-nums">{t.retry_count}</td>
                          <td className="py-1 pr-3">{t.fallback_used ? (t.fallback_stage ?? "yes") : "-"}</td>
                          <td className="py-1 pr-3 tabular-nums">{t.duration_ms != null ? `${(t.duration_ms / 1000).toFixed(1)}s` : "-"}</td>
                          <td className="py-1 pr-3">{t.provider}</td>
                          <td className="py-1 pr-3 font-mono text-[10px]">{t.model}</td>
                          <td className="py-1 pr-3 tabular-nums">
                            {m ? `${Math.round(m.aiSuccessRate * 100)}% (${m.aiSuccess}/${m.total})` : "-"}
                          </td>
                        </tr>),
                        (<tr key={`${t.id}-diag`} className="border-b border-border/50">
                          <td colSpan={11} className="py-1 pr-3">
                            <details className="group">
                              <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground select-none">
                                Diagnostics - {atts.length} attempt{atts.length === 1 ? "" : "s"}
                                {m ? ` - retry ${Math.round(m.retryRate * 100)}% - fallback ${Math.round(m.fallbackRate * 100)}%` : ""}
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
                                      {a.provider && <span className="text-muted-foreground">- {a.provider}</span>}
                                      {a.model && <span className="text-muted-foreground font-mono">- {a.model}</span>}
                                      {a.duration_ms != null && <span className="text-muted-foreground">- {(a.duration_ms / 1000).toFixed(1)}s</span>}
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
                    <span>{u.task} - {u.model}</span>
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
                Render Manifest {canonQ.data && <Badge variant="outline" className="ml-2">{canonQ.data.manifest.length} steps - {canonQ.data.scenes.length} scenes</Badge>}
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
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const r = await compileGraphicsFn({ data: { projectId: id } });
                    qc.invalidateQueries({ queryKey: ["project-canonical", id] });
                    qc.invalidateQueries({ queryKey: ["preview-canonical", id] });
                    toast.success(`Compiled ${r.compiled}/${r.graphicActions} graphics (V${r.manifestVersion}, ${r.virtualItemsRemaining} virtual left)`);
                  } catch (e: any) { toast.error(e?.message ?? "Failed"); }
                }}
              >
                Compile Graphics
              </Button>
              <AiToolPrompt
                projectId={id}
                task="editorial_decisions"
                headerLabel="render manifest"
                invalidateKeys={[["project-canonical", id], ["timeline-composer", id], ["render-readiness", id]]}
              />
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
                          <td className="py-1 pr-3 tabular-nums">{m.layer ?? "-"}</td>
                          <td className="py-1 pr-3">{m.action_type ? <Badge variant="outline" className="text-[10px]">{m.action_type}</Badge> : "-"}</td>
                          <td className="py-1 pr-3">{m.asset_type}</td>
                          <td className="py-1 pr-3">{m.layout_name ?? "-"}</td>
                          <td className="py-1 pr-3">{m.doctor_visibility ?? "-"}</td>
                          <td className="py-1 pr-3">{m.doctor_size ?? "-"}</td>
                          <td className="py-1 pr-3">{m.attention_focus ?? "-"}</td>
                          <td className="py-1 pr-3">{m.asset_source}</td>
                          <td className="py-1 pr-3 tabular-nums">{m.priority ?? "-"}</td>
                          <td className="py-1 pr-3 max-w-md truncate" title={m.asset_query}>{m.asset_query}</td>
                          <td className="py-1 pr-3 max-w-xs truncate" title={m.rationale ?? ""}>{m.rationale ?? "-"}</td>
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
          {canonQ.data?.compiledGraphics && canonQ.data.compiledGraphics.length > 0 && (
            <Card className="mt-3">
              <CardHeader>
                <CardTitle className="text-base">
                  Compiled Graphics
                  <Badge variant="outline" className="ml-2">{canonQ.data.compiledGraphics.length} assets</Badge>
                  <Badge variant="outline" className="ml-1">Manifest V6</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {canonQ.data.compiledGraphics.map((g: any) => (
                    <div key={g.id} className="border border-border rounded overflow-hidden bg-muted/30">
                      <img src={g.thumbnail_url ?? g.preview_url} alt={g.template_name} className="w-full h-32 object-contain bg-black/40" />
                      <div className="p-2 text-xs">
                        <div className="font-semibold truncate">{g.graphic_type}</div>
                        <div className="text-muted-foreground truncate">{g.template_name}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="assets">
          <Card>
            <CardHeader><CardTitle className="text-base">
              Asset Library {reviewQ.data && (
                <Badge variant="outline" className="ml-2">
                  {reviewQ.data.candidates.length} shown / {reviewQ.data.rawCandidateTotal ?? reviewQ.data.candidates.length} raw candidates - {reviewQ.data.assets.length} assets
                </Badge>
              )}
            </CardTitle></CardHeader>
            <CardContent>
              {!reviewQ.data || reviewQ.data.candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No asset candidates yet. Generate Storyboard, B-Roll, Infographics, or Editorial Decisions to populate.</p>
              ) : (
                <div className="space-y-6 max-h-[65vh] overflow-auto">
                  {Object.entries(reviewQ.data.grouped as Record<string, any[]>).map(([role, items]) => (
                    <div key={role}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-semibold">{role}</div>
                        <Badge variant="outline" className="text-[10px]">
                          {items.filter((i) => i.has_usable_url).length} renderable - {items.filter((i) => !i.has_usable_url).length} needs asset
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
                              <Badge variant={assetReadinessVariant(c)} className="text-[10px]">
                                {assetReadinessLabel(c)}
                              </Badge>
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
                const renderablePending = (reviewQ.data?.candidates ?? []).filter(
                  (c: any) => (c.status === "pending" || c.status === "searched") && c.has_usable_url,
                ).length;
                const highConfidence = (reviewQ.data?.candidates ?? []).filter(
                  (c: any) => (c.status === "pending" || c.status === "searched") && c.bulk_eligible,
                ).length;
                const lowConfidence = (reviewQ.data?.candidates ?? []).filter(
                  (c: any) =>
                    (c.status === "pending" || c.status === "searched") &&
                    (Number(c.overall_asset_score ?? 0) < 70 ||
                      c.usage_recommendation === "do_not_use" ||
                      ["restricted", "unsafe"].includes(String(c.license_status))),
                ).length;
                const placeholderPending = pending - renderablePending;
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{renderablePending} renderable</Badge>
                    <Badge variant="secondary" className="text-[10px]">{placeholderPending} placeholders</Badge>
                    <Badge variant="outline" className="text-[10px]">{highConfidence} bulk safe</Badge>
                    <Badge variant="destructive" className="text-[10px]">{lowConfidence} low confidence</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={fulfillProjectAssetsMut.isPending}
                      onClick={() => fulfillProjectAssetsMut.mutate()}
                    >
                      {fulfillProjectAssetsMut.isPending ? "Fulfilling..." : "Fulfill Assets with AI Worker"}
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={pending === 0 || acceptAllMut.isPending || reviewMut.isPending}
                      onClick={() => {
                        if (window.confirm(`Approve ${renderablePending} renderable candidate(s) and mark ${placeholderPending} placeholder(s) as needs asset?`)) {
                          acceptAllMut.mutate();
                        }
                      }}
                    >
                      {acceptAllMut.isPending ? "Reviewing..." : `Approve renderable only (${renderablePending})`}
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={highConfidence === 0 || approveHighConfidenceMut.isPending}
                      onClick={() => {
                        if (window.confirm(`Approve ${highConfidence} tier-A, non-clinical, safe-license candidate(s)?`)) {
                          approveHighConfidenceMut.mutate();
                        }
                      }}
                    >
                      {approveHighConfidenceMut.isPending ? "Approving..." : `Approve high confidence (${highConfidence})`}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={lowConfidence === 0 || rejectLowConfidenceMut.isPending}
                      onClick={() => {
                        if (window.confirm(`Reject ${lowConfidence} low-confidence or unsafe candidate(s)?`)) {
                          rejectLowConfidenceMut.mutate();
                        }
                      }}
                    >
                      {rejectLowConfidenceMut.isPending ? "Rejecting..." : `Reject low confidence (${lowConfidence})`}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={exportReviewArtifactsMut.isPending}
                      onClick={() => exportReviewArtifactsMut.mutate()}
                    >
                      {exportReviewArtifactsMut.isPending ? "Exporting..." : "Export review artifacts"}
                    </Button>
                  </div>
                );
              })()}
            </CardHeader>
            <CardContent>
              {reviewQ.isError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  Asset review failed to load: {(reviewQ.error as any)?.message ?? "Unknown error"}
                </div>
              ) : reviewQ.isLoading || reviewQ.isFetching ? (
                <p className="text-sm text-muted-foreground">Loading asset review requirements...</p>
              ) : !reviewQ.data ||
              (((reviewQ.data.candidates ?? []).length === 0) &&
                ((reviewQ.data.assetTodoList ?? []).length === 0) &&
                ((reviewQ.data.sceneAssetGroups ?? []).length === 0)) ? (
                <p className="text-sm text-muted-foreground">No asset review requirements found.</p>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-xs flex flex-wrap items-center gap-2">
                    <span className="font-semibold">Providers</span>
                    <Badge variant={reviewQ.data.providerStatus?.configured?.pexels ? "default" : "outline"}>Pexels</Badge>
                    <Badge variant={reviewQ.data.providerStatus?.configured?.pixabay ? "default" : "outline"}>Pixabay</Badge>
                    <Badge variant={reviewQ.data.providerStatus?.configured?.unsplash ? "default" : "outline"}>Unsplash</Badge>
                    <span className="text-muted-foreground">{reviewQ.data.providerStatus?.message}</span>
                  </div>
                  <div className="rounded-md border border-border bg-background p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-sm">Scene Asset Review</div>
                        <div className="text-xs text-muted-foreground">
                          Review each scene as a bundle: requirements, candidates, approved assets, manifest coverage, and layout repair.
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 text-[10px]">
                        <Badge variant="outline">Scenes {(reviewQ.data.sceneAssetGroups ?? []).length}</Badge>
                        <Badge variant="default">Ready {(reviewQ.data.sceneAssetGroups ?? []).filter((g: any) => g.renderReady).length}</Badge>
                        <Badge variant="destructive">Blocked {(reviewQ.data.sceneAssetGroups ?? []).filter((g: any) => !g.renderReady).length}</Badge>
                      </div>
                    </div>
                    {(reviewQ.data.sceneAssetGroups ?? []).length === 0 ? (
                      <div className="text-xs text-muted-foreground">No scene-level asset groups found.</div>
                    ) : (
                      <div className="space-y-3 max-h-[70vh] overflow-auto pr-1">
                        {(reviewQ.data.sceneAssetGroups ?? []).map((scene: any, sceneArrayIndex: number) => {
                          const key = sceneSelectionKey(scene.sceneId, scene.sceneIndex);
                          const sceneKey = `${key}:${sceneArrayIndex}`;
                          const selected = sceneSelections[key] ?? [];
                          const visibleCandidates = scene.candidates ?? [];
                          const sceneRequirements = (scene.requirements ?? []).slice(0, 8);
                          const sceneCandidateMatchesRequirement = (candidate: any, req: any) =>
                            candidate.id === req.primary_candidate_id ||
                            candidate.normalized_asset_type === req.suggested_type ||
                            String(candidate.search_query ?? candidate.title ?? "").toLowerCase().includes(String(req.suggested_type ?? "").replace("_", " "));
                          const matchedSceneCandidateIds = new Set<string>();
                          for (const req of sceneRequirements) {
                            for (const candidate of visibleCandidates) {
                              if (sceneCandidateMatchesRequirement(candidate, req)) matchedSceneCandidateIds.add(candidate.id);
                            }
                          }
                          const unmatchedSceneCandidates = visibleCandidates.filter((candidate: any) => !matchedSceneCandidateIds.has(candidate.id));
                          const selectedCount = selected.length;
                          const missingManifest = Number(scene.manifestCoverage?.missing_from_manifest ?? 0);
                          return (
                            <div key={sceneKey} className="rounded-md border border-border bg-muted/10 p-3 space-y-3" data-scene-asset-group={key}>
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-semibold">
                                    Scene {scene.sceneIndex ?? "-"} · {scene.title ?? "Untitled scene"}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {Number(scene.start ?? 0).toFixed(1)}-{Number(scene.end ?? scene.start ?? 0).toFixed(1)}s · {scene.layoutTarget ?? "layout pending"}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1 text-[10px]">
                                  <Badge variant={scene.renderReady ? "default" : "secondary"}>{scene.renderReady ? "render ready" : "needs work"}</Badge>
                                  <Badge variant="outline">Manifest {scene.manifestCoverage?.ready ?? 0}/{scene.manifestCoverage?.total ?? 0}</Badge>
                                  {missingManifest > 0 && <Badge variant="destructive">manifest mismatch {missingManifest}</Badge>}
                                  <Badge variant="outline">Approved {(scene.approvedAssets ?? []).length}</Badge>
                                  <Badge variant="outline">Candidates {visibleCandidates.length}</Badge>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 text-xs">
                                <div className="rounded border border-border bg-background/70 p-2 lg:col-span-2">
                                  <div className="font-medium">Narration excerpt</div>
                                  <div className="text-muted-foreground line-clamp-3">{scene.narration || "No narration mapped"}</div>
                                </div>
                                <div className="rounded border border-border bg-background/70 p-2">
                                  <div className="font-medium">Scene prompt</div>
                                  <div className="text-muted-foreground line-clamp-3">{scene.scenePrompt}</div>
                                </div>
                              </div>
                              {(scene.warnings ?? []).length > 0 && (
                                <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700">
                                  {(scene.warnings ?? []).slice(0, 3).join(" ")}
                                </div>
                              )}
                              <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                                {sceneRequirements.map((req: any, reqIndex: number) => {
                                  const reqCandidates = visibleCandidates.filter((c: any) => sceneCandidateMatchesRequirement(c, req));
                                  const reqKey = stableRequirementKey(req.requirement_id, `${sceneKey}:requirement:${reqIndex}`);
                                  return (
                                    <div key={reqKey} className="rounded border border-border bg-background p-2 space-y-2 text-xs">
                                      <div className="flex items-start justify-between gap-2">
                                        <div>
                                          <div className="font-medium">{req.suggested_type}</div>
                                          <div className="text-muted-foreground">{req.required_or_optional} · {req.status}</div>
                                        </div>
                                        <Badge variant={String(req.status).includes("missing") ? "destructive" : String(req.status).includes("ready") || String(req.status).includes("resolved") ? "default" : "secondary"} className="text-[10px]">
                                          {req.timeline_fit_status ?? req.status}
                                        </Badge>
                                      </div>
                                      <div className="text-muted-foreground line-clamp-2">{req.prompt ?? req.failure_reason ?? "No prompt mapped"}</div>
                                      <div className="flex flex-wrap gap-1">
                                        <Button size="sm" variant="outline" disabled={searchAssetMut.isPending}
                                          onClick={() => req.primary_candidate_id && searchAssetMut.mutate({ candidateId: req.primary_candidate_id, provider: "internal" })}>
                                          Generate with AI
                                        </Button>
                                        <Button size="sm" variant="outline" disabled={searchAssetMut.isPending}
                                          onClick={() => req.primary_candidate_id && searchAssetMut.mutate({ candidateId: req.primary_candidate_id, provider: "any" })}>
                                          Search providers
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => {
                                          setAssetPromptTodo({
                                            ...req,
                                            visual_intent: req.suggested_type,
                                            prompt_for_ai_generation: req.prompt,
                                            external_generation_prompt: req.external_generation_prompt ?? req.prompt,
                                            negative_prompt: req.negative_prompt,
                                            start_time: req.start,
                                            end_time: req.end,
                                            required_asset_type: req.suggested_type,
                                            layout_name: req.layout_target,
                                            narration_excerpt: scene.narration,
                                            primary_candidate_id: req.primary_candidate_id,
                                          });
                                        }}>
                                          Show prompt
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={async () => {
                                          await navigator.clipboard.writeText(req.external_generation_prompt ?? req.prompt ?? "");
                                          toast.success("Requirement prompt copied");
                                        }}>
                                          Copy prompt
                                        </Button>
                                        {req.primary_candidate_id && (
                                          <>
                                            <label className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-accent">
                                              {req.primary_candidate_id && uploadingCandidateId === req.primary_candidate_id ? "Uploading..." : "Upload / Replace"}
                                              <input
                                                type="file"
                                                accept=".png,.jpg,.jpeg,.webp,.svg,.mp4,.mov,image/png,image/jpeg,image/webp,image/svg+xml,video/mp4,video/quicktime"
                                                className="hidden"
                                                disabled={uploadingCandidateId === req.primary_candidate_id}
                                                onChange={(e) => {
                                                  const file = e.currentTarget.files?.[0];
                                                  e.currentTarget.value = "";
                                                  if (file) void uploadAssetFile(req.primary_candidate_id, file);
                                                }}
                                              />
                                            </label>
                                            <Button size="sm" variant="outline"
                                              onClick={() => {
                                                setManualUrlCandidate({
                                                  id: req.primary_candidate_id,
                                                  title: req.suggested_type,
                                                  search_query: req.prompt,
                                                  asset_type: req.suggested_type,
                                                });
                                                setManualUrlDraft({
                                                  source_url: "",
                                                  title: req.suggested_type ?? "",
                                                  attribution: "",
                                                  specialty: "Head & Neck",
                                                  diagnosis_topic: "Oral cancer",
                                                  anatomy: "",
                                                  visual_concept: req.prompt ?? req.suggested_type ?? "",
                                                  sensitivity_level: "safe",
                                                  provenance_notes: "",
                                                });
                                              }}>
                                              Paste URL
                                            </Button>
                                            <Button size="sm" variant="outline" disabled={reviewMut.isPending}
                                              onClick={() => reviewMut.mutate({ candidateId: req.primary_candidate_id, action: "reject", note: "Rejected from scene requirement review." })}>
                                              Reject selected
                                            </Button>
                                            <Button size="sm" variant="destructive" disabled={reviewMut.isPending}
                                              onClick={() => reviewMut.mutate({ candidateId: req.primary_candidate_id, action: "mark_missing", note: "Scene requirement still needs a render-ready asset." })}>
                                              Mark missing
                                            </Button>
                                          </>
                                        )}
                                        <Button size="sm" variant="outline" disabled={reconcileSceneMut.isPending}
                                          onClick={() => reconcileSceneMut.mutate({ projectId: id, sceneId: scene.sceneId, sceneIndex: scene.sceneIndex })}>
                                          Fix timing
                                        </Button>
                                        <Button size="sm" variant="outline" disabled={reconcileSceneMut.isPending}
                                          onClick={() => reconcileSceneMut.mutate({ projectId: id, sceneId: scene.sceneId, sceneIndex: scene.sceneIndex })}>
                                          Send to layout repair
                                        </Button>
                                      </div>
                                      {reqCandidates.length > 0 && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                          {reqCandidates.slice(0, 4).map((c: any) => (
                                            <label key={c.id} className="rounded border border-border bg-muted/20 p-2 space-y-1 cursor-pointer">
                                              <div className="flex items-center gap-2">
                                                <input
                                                  type="checkbox"
                                                  checked={selected.includes(c.id)}
                                                  onChange={(e) => {
                                                    const checked = e.currentTarget.checked;
                                                    setSceneSelections((prev) => {
                                                      const current = new Set(prev[key] ?? []);
                                                      if (checked) current.add(c.id);
                                                      else current.delete(c.id);
                                                      return { ...prev, [key]: Array.from(current) };
                                                    });
                                                  }}
                                                />
                                                <span className="font-medium line-clamp-1">{c.title ?? c.search_query}</span>
                                              </div>
                                              {c.preview_url ? (
                                                mediaKindForCandidate(c) === "video" ? (
                                                  <video src={c.preview_url} className="h-24 w-full rounded bg-black object-cover" muted controls />
                                                ) : (
                                                  <img src={c.preview_url} alt={c.title ?? "candidate preview"} className="h-24 w-full rounded bg-black/20 object-cover" />
                                                )
                                              ) : (
                                                <div className="h-24 rounded bg-muted flex items-center justify-center text-muted-foreground">
                                                  Preview unavailable: {c.preview_unavailable_reason ?? "no source_url"}
                                                </div>
                                              )}
                                              <div className="flex flex-wrap gap-1">
                                                <Badge variant="outline" className="text-[10px]">{c.normalized_asset_type}</Badge>
                                                <Badge variant={c.auto_pick_safe ? "default" : "secondary"} className="text-[10px]">score {c.overall_asset_score ?? 0}</Badge>
                                                <Badge variant="outline" className="text-[10px]">{c.license_status ?? "unknown license"}</Badge>
                                              </div>
                                            </label>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              {unmatchedSceneCandidates.length > 0 && (
                                <div className="rounded border border-border bg-background p-2 space-y-2 text-xs">
                                  <div className="flex items-center justify-between gap-2">
                                    <div>
                                      <div className="font-medium">Other scene candidates</div>
                                      <div className="text-muted-foreground">Visible candidates mapped to this scene but not confidently matched to a specific requirement.</div>
                                    </div>
                                    <Badge variant="outline" className="text-[10px]">{unmatchedSceneCandidates.length}</Badge>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {unmatchedSceneCandidates.slice(0, 6).map((c: any) => (
                                      <label key={c.id} className="rounded border border-border bg-muted/20 p-2 space-y-1 cursor-pointer">
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={selected.includes(c.id)}
                                            onChange={(e) => {
                                              const checked = e.currentTarget.checked;
                                              setSceneSelections((prev) => {
                                                const current = new Set(prev[key] ?? []);
                                                if (checked) current.add(c.id);
                                                else current.delete(c.id);
                                                return { ...prev, [key]: Array.from(current) };
                                              });
                                            }}
                                          />
                                          <span className="font-medium line-clamp-1">{c.title ?? c.search_query}</span>
                                        </div>
                                        {c.preview_url ? (
                                          mediaKindForCandidate(c) === "video" ? (
                                            <video src={c.preview_url} className="h-24 w-full rounded bg-black object-cover" muted controls />
                                          ) : (
                                            <img src={c.preview_url} alt={c.title ?? "candidate preview"} className="h-24 w-full rounded bg-black/20 object-cover" />
                                          )
                                        ) : (
                                          <div className="h-24 rounded bg-muted flex items-center justify-center text-muted-foreground">
                                            Preview unavailable: {c.preview_unavailable_reason ?? "no source_url"}
                                          </div>
                                        )}
                                        <div className="flex flex-wrap gap-1">
                                          <Badge variant="outline" className="text-[10px]">{c.normalized_asset_type}</Badge>
                                          <Badge variant={c.auto_pick_safe ? "default" : "secondary"} className="text-[10px]">score {c.overall_asset_score ?? 0}</Badge>
                                          <Badge variant="outline" className="text-[10px]">{c.license_status ?? "unknown license"}</Badge>
                                        </div>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {(scene.approvedAssets ?? []).length > 0 && (
                                <div className="rounded border border-border bg-background p-2">
                                  <div className="font-medium text-xs mb-2">Approved assets</div>
                                  <div className="flex gap-2 overflow-auto">
                                    {(scene.approvedAssets ?? []).slice(0, 10).map((asset: any) => (
                                      <div key={asset.id} className="w-40 shrink-0 text-[11px]">
                                        {asset.thumbnail_url || asset.preview_url || asset.source_url ? (
                                          <img src={asset.thumbnail_url ?? asset.preview_url ?? asset.source_url} alt={asset.title ?? "approved asset"} className="h-20 w-full rounded object-cover bg-black/20" />
                                        ) : (
                                          <div className="h-20 rounded bg-muted flex items-center justify-center text-muted-foreground">Preview unavailable: no source_url</div>
                                        )}
                                        <div className="mt-1 line-clamp-2">{asset.title ?? asset.asset_type}</div>
                                        <div className="text-muted-foreground">{asset.normalized_asset_type ?? asset.asset_type}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" disabled={(scene.missingRequirements ?? []).length === 0}
                                  onClick={() => {
                                    const first = (scene.missingRequirements ?? [])[0]?.primary_candidate_id;
                                    if (first) searchAssetMut.mutate({ candidateId: first, provider: "internal" });
                                  }}>
                                  Generate missing for scene
                                </Button>
                                <Button size="sm" variant="default" disabled={selectedCount === 0 || approveSceneMut.isPending}
                                  onClick={() => approveSceneMut.mutate({ projectId: id, sceneId: scene.sceneId, sceneIndex: scene.sceneIndex, candidateIds: selected })}>
                                  Approve selected for this scene ({selectedCount})
                                </Button>
                                <Button size="sm" variant="default" disabled={selectedCount === 0 || approveSceneMut.isPending}
                                  onClick={() => approveSceneMut.mutate({ projectId: id, sceneId: scene.sceneId, sceneIndex: scene.sceneIndex, candidateIds: selected, repairLayout: true })}>
                                  Approve + Fix Scene Layout
                                </Button>
                                <Button size="sm" variant="outline" disabled={selectedCount === 0 || reviewMut.isPending}
                                  onClick={() => {
                                    selected.forEach((candidateId) => reviewMut.mutate({ candidateId, action: "reject", note: "Rejected from scene-level multi-select review." }));
                                    setSceneSelections((prev) => ({ ...prev, [key]: [] }));
                                  }}>
                                  Reject selected ({selectedCount})
                                </Button>
                                <Button size="sm" variant="destructive" disabled={selectedCount === 0 || reviewMut.isPending}
                                  onClick={() => {
                                    selected.forEach((candidateId) => reviewMut.mutate({ candidateId, action: "mark_missing", note: "Selected scene asset does not satisfy professional render readiness." }));
                                    setSceneSelections((prev) => ({ ...prev, [key]: [] }));
                                  }}>
                                  Mark selected missing
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => toast.info(`Preview around ${Number(scene.start ?? 0).toFixed(1)}s in the Timeline tab.`)}>
                                  Preview scene timestamp
                                </Button>
                                <Button size="sm" variant="outline" onClick={async () => {
                                  await navigator.clipboard.writeText((scene.requirements ?? []).map((req: any) => req.external_generation_prompt ?? req.prompt).filter(Boolean).join("\n\n"));
                                  toast.success("All scene prompts copied");
                                }}>
                                  Copy all prompts for scene
                                </Button>
                                <Button size="sm" variant="outline" onClick={async () => {
                                  await navigator.clipboard.writeText(JSON.stringify(scene, null, 2));
                                  toast.success("Scene asset brief JSON copied");
                                }}>
                                  Export scene brief
                                </Button>
                              </div>
                              {(scene.debugCandidates ?? []).length > 0 && (
                                <details className="rounded border border-border bg-muted/20 p-2 text-xs">
                                  <summary className="cursor-pointer font-medium">Rejected / Debug candidates ({scene.debugCandidates.length})</summary>
                                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {(scene.debugCandidates ?? []).slice(0, 8).map((c: any) => (
                                      <div key={c.id} className="rounded border border-border bg-background p-2">
                                        <div className="font-medium line-clamp-1">{c.title ?? c.search_query}</div>
                                        <div className="text-muted-foreground">{c.quality_grade ?? "-"} · {c.preview_unavailable_reason ?? c.rejection_reason ?? "debug only"}</div>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="rounded-md border border-border bg-background p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-sm">Asset To-Do List</div>
                        <div className="text-xs text-muted-foreground">
                          Deduped clinical requirements first. Raw/debug candidates remain below.
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 text-[10px]">
                        <Badge variant="outline">Required {reviewQ.data.assetTodoSummary?.required_total ?? 0}</Badge>
                        <Badge variant="default">Resolved {reviewQ.data.assetTodoSummary?.required_resolved ?? 0}</Badge>
                        <Badge variant="destructive">Missing {reviewQ.data.assetTodoSummary?.required_missing ?? 0}</Badge>
                        <Badge variant="secondary">Mismatch {reviewQ.data.assetTodoSummary?.required_mismatch ?? 0}</Badge>
                        <Badge variant="outline">Timing {reviewQ.data.assetTodoSummary?.timing_problems ?? 0}</Badge>
                        <Badge variant="outline">Optional {reviewQ.data.assetTodoSummary?.optional_enhancements ?? 0}</Badge>
                      </div>
                    </div>
                    {(reviewQ.data.assetTodoList ?? []).length === 0 ? (
                      <div className="text-xs text-muted-foreground">No actionable asset requirements found.</div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 max-h-[52vh] overflow-auto pr-1">
                        {(reviewQ.data.assetTodoList ?? []).slice(0, 20).map((todo: any, todoIndex: number) => {
                          const todoKey = stableRequirementKey(todo.requirement_id, `todo:${todoIndex}`);
                          return (
                          <div
                            key={todoKey}
                            data-asset-todo-id={todoKey}
                            data-asset-todo-status={todo.current_status}
                            data-asset-todo-type={todo.required_asset_type}
                            className="rounded-md border border-border p-3 text-xs space-y-2 bg-muted/10"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-semibold truncate" title={todo.visual_intent}>{todo.visual_intent}</div>
                                <div className="text-muted-foreground">
                                  Scene {todo.scene_number ?? "-"} · {Number(todo.start_time ?? 0).toFixed(1)}-{Number(todo.end_time ?? 0).toFixed(1)}s · {todo.layout_name ?? "layout pending"}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1 justify-end">
                                <Badge variant={todo.required_or_optional === "required" ? "destructive" : "outline"} className="text-[10px]">{todo.required_or_optional}</Badge>
                                <Badge variant={todo.current_status === "resolved" ? "default" : todo.current_status === "approved_asset_mismatch" ? "destructive" : "secondary"} className="text-[10px]">
                                  {todo.current_status}
                                </Badge>
                              </div>
                            </div>
                            <div className="rounded border border-border bg-background/60 p-2">
                              <div className="font-medium">Narration</div>
                              <div className="text-muted-foreground line-clamp-2">{todo.narration_excerpt ?? "No narration mapped"}</div>
                            </div>
                            {todo.approved_asset_mismatch && (
                              <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                                Approved asset exists but does not satisfy this requirement: {todo.approved_asset_mismatch.title ?? todo.approved_asset_mismatch.id}. {todo.approved_asset_mismatch.reason}
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded border border-border p-2">
                                <div className="text-muted-foreground">Suggested type</div>
                                <div className="font-medium">{todo.required_asset_type}</div>
                              </div>
                              <div className="rounded border border-border p-2">
                                <div className="text-muted-foreground">Timeline fit</div>
                                <div className="font-medium">{todo.timeline_fit_status}</div>
                              </div>
                            </div>
                            <div className="text-muted-foreground line-clamp-2">{todo.failure_reason}</div>
                            <div className="flex flex-wrap gap-1">
                              <Button size="sm" variant="outline" disabled={searchAssetMut.isPending || !todo.primary_candidate_id}
                                onClick={() => todo.primary_candidate_id && searchAssetMut.mutate({ candidateId: todo.primary_candidate_id, provider: "any" })}>
                                Search providers
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setAssetPromptTodo(todo)}>
                                Generate with AI
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setAssetPromptTodo(todo)}>
                                Show prompt
                              </Button>
                              <Button size="sm" variant="outline"
                                onClick={async () => {
                                  await navigator.clipboard.writeText(todo.external_generation_prompt ?? todo.prompt_for_ai_generation ?? "");
                                  toast.success("Generation prompt copied");
                                }}>
                                Copy prompt
                              </Button>
                              <label className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-accent">
                                {todo.primary_candidate_id && uploadingCandidateId === todo.primary_candidate_id ? "Uploading..." : "Upload / Replace"}
                                <input
                                  type="file"
                                  accept=".png,.jpg,.jpeg,.webp,.svg,.mp4,.mov,image/png,image/jpeg,image/webp,image/svg+xml,video/mp4,video/quicktime"
                                  className="hidden"
                                  disabled={!todo.primary_candidate_id || uploadingCandidateId === todo.primary_candidate_id}
                                  onChange={(e) => {
                                    const file = e.currentTarget.files?.[0];
                                    e.currentTarget.value = "";
                                    if (file && todo.primary_candidate_id) void uploadAssetFile(todo.primary_candidate_id, file);
                                  }}
                                />
                              </label>
                              <Button size="sm" variant="outline"
                                disabled={!todo.primary_candidate_id}
                                onClick={() => {
                                  if (!todo.primary_candidate_id) return;
                                  setManualUrlCandidate({ id: todo.primary_candidate_id, title: todo.visual_intent, search_query: todo.visual_intent, asset_type: todo.required_asset_type });
                                  setManualUrlDraft({
                                    source_url: "",
                                    title: todo.visual_intent ?? "",
                                    attribution: "",
                                    specialty: "Head & Neck",
                                    diagnosis_topic: "Oral cancer",
                                    anatomy: "",
                                    visual_concept: todo.visual_intent ?? "",
                                    sensitivity_level: "safe",
                                    provenance_notes: "",
                                  });
                                }}>
                                Paste URL
                              </Button>
                              <Button size="sm" variant="outline" disabled={!todo.matched_approved_asset_id}>
                                Use existing approved asset
                              </Button>
                              <Button size="sm" variant="outline" disabled={fixBlockerMut.isPending}
                                onClick={() => fixBlockerMut.mutate({ kind: "manifest", label: "Rebuild Manifest" })}>
                                Fix timing
                              </Button>
                              <Button size="sm" variant="outline"
                                onClick={() => toast.info(`Preview around ${Number(todo.start_time ?? 0).toFixed(1)}s in the Timeline tab.`)}>
                                Preview at timestamp
                              </Button>
                              {todo.required_or_optional === "optional" && (
                                <Button size="sm" variant="outline" disabled={reviewMut.isPending || !todo.primary_candidate_id}
                                  onClick={() => todo.primary_candidate_id && reviewMut.mutate({ candidateId: todo.primary_candidate_id, action: "reject", note: "Optional enhancement skipped." })}>
                                  Mark optional
                                </Button>
                              )}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-muted-foreground">
                        Raw/debug candidates
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setShowRawAssetDebug((v) => !v)}>
                        {showRawAssetDebug ? "Hide raw/debug list" : "Show raw/debug list"}
                      </Button>
                    </div>
                    {showRawAssetDebug && (
                      <>
                  <div className="mt-3 text-xs font-medium text-muted-foreground">Raw/debug list</div>
                  <Tabs value={reviewFilter} onValueChange={setReviewFilter}>
                    <TabsList className="flex flex-wrap h-auto">
                      {[
                        "Needs Review",
                        "Approved",
                        "Rejected",
                        "High Confidence",
                        "Clinical Images",
                        "Infographics",
                        "B-roll",
                        "Medical Illustrations",
                        "Open License",
                        "Unknown License",
                        "Needs Asset",
                        "Render Ready",
                        "Placeholder Plans",
                        "Compiled Graphics",
                      ].map((bucket) => (
                        <TabsTrigger key={bucket} value={bucket}>
                          {bucket}
                          <Badge variant="outline" className="ml-1 text-[10px]">
                            {bucket === "Compiled Graphics"
                              ? (canonQ.data?.compiledGraphics?.length ?? 0)
                              : reviewQ.data.candidates.filter((c: any) => professionalReviewBuckets(c).includes(bucket)).length}
                          </Badge>
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  {reviewFilter === "Compiled Graphics" ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-h-[65vh] overflow-auto">
                      {(canonQ.data?.compiledGraphics ?? []).map((g: any) => (
                        <div key={g.id} className="border border-border rounded-md overflow-hidden bg-muted/30">
                          <img src={g.thumbnail_url ?? g.preview_url} alt={g.template_name} className="w-full h-36 object-contain bg-black/50" />
                          <div className="p-2 text-xs">
                            <div className="font-semibold">{g.graphic_type}</div>
                            <div className="text-muted-foreground">{g.template_name}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[65vh] overflow-auto">
                      {reviewQ.data.candidates
                        .filter((c: any) => professionalReviewBuckets(c).includes(reviewFilter))
                        .map((c: any) => {
                          const search = assetSearches[c.id];
                          const previewUrl = c.thumbnail_url ?? c.preview_url ?? c.source_url;
                          const currentApproved = c.review_context?.current_approved_asset;
                          return (
                            <div key={c.id} className="border border-border rounded-md p-3 text-xs space-y-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <Badge variant="outline" className="text-[10px]">{c.asset_type}</Badge>
                                    <Badge
                                      variant={c.status === "approved" || c.status === "locked" ? "default" : "secondary"}
                                      className="text-[10px]"
                                    >{c.status}</Badge>
                                    {c.preferred && <Badge variant="default" className="text-[10px]">Preferred</Badge>}
                                    <Badge variant={assetReadinessVariant(c)} className="text-[10px]">
                                      {assetReadinessLabel(c)}
                                    </Badge>
                                    <Badge variant={c.bulk_eligible ? "default" : c.confidence_tier === "D" ? "destructive" : "outline"} className="text-[10px]">
                                      {c.confidence_label ?? `Tier ${c.confidence_tier ?? "-"}`}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px]">
                                      URL {c.has_usable_url ? "yes" : "no"}
                                    </Badge>
                                    {c.medical_asset_taxonomy && (
                                      <Badge variant="outline" className="text-[10px]">{c.medical_asset_taxonomy}</Badge>
                                    )}
                                    {c.routing_status && (
                                      <Badge variant={c.routing_status === "stock_search_allowed" || c.routing_status === "internal_template_available" ? "secondary" : "destructive"} className="text-[10px]">
                                        {c.routing_status}
                                      </Badge>
                                    )}
                                    {c.quality_grade && (
                                      <Badge variant="outline" className="text-[10px]">Grade {c.quality_grade}</Badge>
                                    )}
                                    {c.license_status && (
                                      <Badge variant={c.usage_recommendation === "safe_to_use" ? "secondary" : "outline"} className="text-[10px]">
                                        {c.license_status}
                                      </Badge>
                                    )}
                                    {c.source_domain && <Badge variant="outline" className="text-[10px]">{c.source_domain}</Badge>}
                                    {c.title && <span className="font-medium">{c.title}</span>}
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-3">
                                    <div className="space-y-2">
                                      {previewUrl ? (
                                        <img src={previewUrl} alt={c.title ?? c.search_query} className="h-28 w-full rounded border border-border object-cover bg-black/40" />
                                      ) : (
                                        <div className="h-28 rounded border border-dashed border-border bg-muted/30 flex items-center justify-center text-muted-foreground">No preview</div>
                                      )}
                                      {currentApproved && (
                                        <div className="rounded border border-border bg-muted/20 p-2">
                                          <div className="text-[10px] font-semibold mb-1">Current approved</div>
                                          {currentApproved.thumbnail_url || currentApproved.url ? (
                                            <img src={currentApproved.thumbnail_url ?? currentApproved.url} alt={currentApproved.title ?? "approved asset"} className="h-20 w-full rounded object-cover bg-black/40" />
                                          ) : null}
                                          <div className="mt-1 truncate text-muted-foreground" title={currentApproved.title ?? currentApproved.id}>{currentApproved.title ?? currentApproved.id}</div>
                                        </div>
                                      )}
                                    </div>
                                    <div className="min-w-0">
                                  <div className="font-medium truncate" title={c.search_query}>{c.search_query}</div>
                                  {c.description && <div className="text-muted-foreground/80 mt-1 line-clamp-2">{c.description}</div>}
                                  <div className="text-muted-foreground mt-1">
                                    {c.routing_reason ?? `Needed because this planned ${c.asset_type} has no renderable URL yet.`}
                                  </div>
                                  <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                                    <div className="rounded border border-border p-2">
                                      <div className="text-muted-foreground">Overall</div>
                                      <div className="font-semibold">{c.overall_asset_score ?? "-"}</div>
                                    </div>
                                    <div className="rounded border border-border p-2">
                                      <div className="text-muted-foreground">Intent</div>
                                      <div className="font-semibold">{c.intent_match_score ?? "-"}</div>
                                    </div>
                                    <div className="rounded border border-border p-2">
                                      <div className="text-muted-foreground">Medical</div>
                                      <div className="font-semibold">{c.medical_relevance_score ?? "-"}</div>
                                    </div>
                                    <div className="rounded border border-border p-2">
                                      <div className="text-muted-foreground">Source safety</div>
                                      <div className="font-semibold">{c.source_safety_score ?? "-"}</div>
                                    </div>
                                  </div>
                                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                                    <div className="rounded border border-border bg-muted/20 p-2">
                                      <div className="font-semibold">Timeline mapping</div>
                                      <div>Scene {c.review_context?.scene?.scene_number ?? "-"} {c.review_context?.scene?.title ?? ""}</div>
                                      <div>
                                        {c.review_context?.timeline_item
                                          ? `${Number(c.review_context.timeline_item.start_time ?? 0).toFixed(1)}-${Number(c.review_context.timeline_item.end_time ?? 0).toFixed(1)}s · ${c.review_context.timeline_item.layout ?? "-"}`
                                          : "No timeline item mapped"}
                                      </div>
                                      <div className="text-muted-foreground line-clamp-2">{c.review_context?.storyboard_item?.asset_prompt ?? "No storyboard prompt"}</div>
                                    </div>
                                    <div className="rounded border border-border bg-muted/20 p-2">
                                      <div className="font-semibold">Narration excerpt</div>
                                      <div className="text-muted-foreground line-clamp-3">{c.review_context?.narration_excerpt ?? "No narration mapped"}</div>
                                    </div>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                    {c.source_url && <a className="underline" href={c.source_url} target="_blank" rel="noreferrer">Open source</a>}
                                    <span>Usage: {c.usage_recommendation ?? "review_required"}</span>
                                    <span>Audit entries: {c.audit_count ?? 0}</span>
                                    {c.replacement_history_count ? <span>Replacements: {c.replacement_history_count}</span> : null}
                                  </div>
                                  {c.selection_reason && <div className="mt-1 text-muted-foreground">Selection: {c.selection_reason}</div>}
                                  {c.rejection_reason && <div className="mt-1 text-destructive">Rejection: {c.rejection_reason}</div>}
                                  {c.candidate_data?.worker_score && (
                                    <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                                      <Badge variant="outline">Worker {c.candidate_data.worker_score.overall_asset_score ?? "-"}%</Badge>
                                      <Badge variant="outline">Intent {c.candidate_data.worker_score.intent_match_score ?? "-"}%</Badge>
                                      <Badge variant="outline">Medical {c.candidate_data.worker_score.medical_relevance_score ?? "-"}%</Badge>
                                      {c.candidate_data.mismatch_reason && (
                                        <span className="text-muted-foreground">{c.candidate_data.mismatch_reason}</span>
                                      )}
                                    </div>
                                  )}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex flex-col gap-1 shrink-0 min-w-36">
                                  {c.has_usable_url ? (
                                    <>
                                      <Button size="sm" variant="default" disabled={reviewMut.isPending}
                                        onClick={() => reviewMut.mutate({ candidateId: c.id, action: "accept" })}>
                                        Approve
                                      </Button>
                                      {currentApproved && (
                                        <Button size="sm" variant="secondary" disabled={reviewMut.isPending}
                                          onClick={() => reviewMut.mutate({
                                            candidateId: c.id,
                                            action: "replace",
                                            note: `Replaced ${currentApproved.id} with reviewed candidate.`,
                                          })}>
                                          Replace current
                                        </Button>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <Button size="sm" variant="outline" disabled={searchAssetMut.isPending}
                                        onClick={() => searchAssetMut.mutate({ candidateId: c.id, provider: "pexels" })}>
                                        Search Pexels
                                      </Button>
                                      <Button size="sm" variant="outline" disabled={searchAssetMut.isPending}
                                        onClick={() => searchAssetMut.mutate({ candidateId: c.id, provider: "pixabay" })}>
                                        Search Pixabay
                                      </Button>
                                      {canGenerateInternalGraphic(c) && (
                                        <Button size="sm" variant="outline" disabled={searchAssetMut.isPending}
                                          onClick={() => searchAssetMut.mutate({ candidateId: c.id, provider: "internal" })}>
                                          Generate Internal Graphic
                                        </Button>
                                      )}
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={fulfillAssetMut.isPending || !c.auto_pick_safe}
                                        title={c.auto_pick_safe ? "Use the highest-ranked safe fulfillment result." : "Disabled until a safe, licensed, source-backed candidate is available."}
                                        onClick={() => fulfillAssetMut.mutate(c.id)}>
                                        Auto-pick best safe candidate
                                      </Button>
                                      <Button size="sm" variant="outline"
                                        onClick={() => {
                                          setManualUrlCandidate(c);
                                          setManualUrlDraft({
                                            source_url: "",
                                            title: c.title ?? c.search_query ?? "",
                                            attribution: "",
                                            specialty: "Head & Neck",
                                            diagnosis_topic: "Oral cancer",
                                            anatomy: "",
                                            visual_concept: c.asset_type ?? "",
                                            sensitivity_level: "safe",
                                            provenance_notes: "",
                                          });
                                        }}>
                                        Paste URL
                                      </Button>
                                    </>
                                  )}
                                  <label className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-accent">
                                    {uploadingCandidateId === c.id
                                      ? "Uploading..."
                                      : currentApproved || c.has_usable_url ? "Upload / Replace" : "Upload Manually"}
                                    <input
                                      type="file"
                                      accept=".png,.jpg,.jpeg,.webp,.svg,.mp4,.mov,image/png,image/jpeg,image/webp,image/svg+xml,video/mp4,video/quicktime"
                                      className="hidden"
                                      disabled={uploadingCandidateId === c.id}
                                      onChange={(e) => {
                                        const file = e.currentTarget.files?.[0];
                                        e.currentTarget.value = "";
                                        if (file) void uploadAssetFile(c.id, file);
                                      }}
                                    />
                                  </label>
                                  <Button size="sm" variant="outline" disabled={reviewMut.isPending}
                                    onClick={() => reviewMut.mutate({ candidateId: c.id, action: "preferred", note: "Marked preferred during review." })}>
                                    Mark preferred
                                  </Button>
                                  {c.status === "locked" ? (
                                    <Button size="sm" variant="outline" disabled={reviewMut.isPending}
                                      onClick={() => reviewMut.mutate({ candidateId: c.id, action: "unlock" })}>Unlock</Button>
                                  ) : (
                                    <Button size="sm" variant="outline" disabled={reviewMut.isPending}
                                      onClick={() => reviewMut.mutate({ candidateId: c.id, action: "lock" })}>Lock</Button>
                                  )}
                                  <Button size="sm" variant="outline" disabled={reviewMut.isPending}
                                    onClick={() => reviewMut.mutate({ candidateId: c.id, action: "reject" })}>Reject / skip</Button>
                                  <Button size="sm" variant="destructive" disabled={reviewMut.isPending}
                                    onClick={() => reviewMut.mutate({ candidateId: c.id, action: "mark_missing", note: "Real medical asset required before professional render." })}>
                                    Mark missing
                                  </Button>
                                  <Button size="sm" variant="outline" disabled={reviewMut.isPending}
                                    onClick={() => {
                                      const q = window.prompt("Replacement query", c.search_query ?? "");
                                      if (q && q.trim()) reviewMut.mutate({ candidateId: c.id, action: "replace", replacementQuery: q.trim() });
                                    }}>Replace query</Button>
                                </div>
                              </div>
                              {search?.warnings?.length > 0 && (
                                <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-amber-700">
                                  {search.warnings.join(" ")}
                                </div>
                              )}
                              {search?.results?.length > 0 && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                  {search.results.map((r: any) => (
                                    <div key={r.result_id} className="border border-border rounded-md overflow-hidden bg-muted/20">
                                      {r.thumbnail_url || r.preview_url ? (
                                        <img src={r.thumbnail_url ?? r.preview_url} alt={r.title} className="w-full h-28 object-cover bg-black/40" />
                                      ) : null}
                                      <div className="p-2 space-y-1">
                                        <div className="flex items-center gap-1">
                                          <Badge variant="outline" className="text-[10px]">{r.provider}</Badge>
                                          {r.duration_seconds ? <Badge variant="outline" className="text-[10px]">{r.duration_seconds}s</Badge> : null}
                                        </div>
                                        <div className="font-medium line-clamp-2">{r.title}</div>
                                        <div className="text-muted-foreground line-clamp-2">{r.description ?? r.attribution?.author ?? r.attribution?.provider_url}</div>
                                        <Button size="sm" className="w-full" disabled={approveSearchMut.isPending}
                                          onClick={() => approveSearchMut.mutate({ candidateId: c.id, result: r })}>
                                          Approve selected result
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                      </>
                    )}
                </div>
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
                <p className="text-sm text-muted-foreground">Calculating...</p>
              ) : (
                <div className="space-y-3">
                  <Progress value={readinessQ.data.percent} />
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-xs">
                    <div className="rounded border border-border p-2">
                      <div className="text-muted-foreground">Technical Readiness</div>
                      <div className="text-lg font-semibold">{readinessQ.data.technicalReadiness ?? readinessQ.data.percent}%</div>
                    </div>
                    <div className="rounded border border-border p-2">
                      <div className="text-muted-foreground">Asset Coverage</div>
                      <div className="text-lg font-semibold">{readinessQ.data.assetCoverage ?? "-"}%</div>
                    </div>
                    <div className="rounded border border-border p-2">
                      <div className="text-muted-foreground">Medical Visual</div>
                      <div className="text-lg font-semibold">{readinessQ.data.medicalVisualReadiness ?? "-"}%</div>
                    </div>
                    <div className="rounded border border-border p-2">
                      <div className="text-muted-foreground">Editorial Readiness</div>
                      <div className="text-lg font-semibold">{readinessQ.data.editorialReadiness ?? "-"}%</div>
                    </div>
                    <div className="rounded border border-border p-2">
                      <div className="text-muted-foreground">Professional Readiness</div>
                      <div className="text-lg font-semibold">{readinessQ.data.professionalReadinessScore ?? "-"}%</div>
                    </div>
                  </div>
                  {readinessQ.data.editorialGates?.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs">
                      {readinessQ.data.editorialGates.map((g: any) => (
                        <div key={g.key} className="rounded border border-border p-2">
                          <div className="font-medium">{g.label}</div>
                          <div className="text-muted-foreground">weight {Math.round(g.weight * 100)}%</div>
                          <Badge variant={g.score >= 0.85 ? "default" : g.score >= 0.6 ? "secondary" : "outline"}>
                            {Math.round(g.score * 100)}%
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                  {readinessQ.data.assetQuality && (
                    <div className="text-xs text-muted-foreground">
                      Asset quality average {readinessQ.data.assetQuality.average ?? 0}/100.
                      {" "}Grades: {Object.entries(readinessQ.data.assetQuality.counts ?? {}).map(([grade, count]) => `${grade} ${count}`).join(", ") || "none"}.
                    </div>
                  )}
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
                  {readinessQ.data.blockerActions && readinessQ.data.blockerActions.length > 0 ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                      <div className="font-semibold text-destructive mb-2">BLOCKED - {readinessQ.data.blockerActions.length} reason{readinessQ.data.blockerActions.length === 1 ? "" : "s"}</div>
                      <ul className="space-y-1.5">
                        {readinessQ.data.blockerActions.map((b: any, i: number) => (
                          <li key={i} className="flex items-center justify-between gap-2">
                            <span>- {b.message}</span>
                            {b.fix && b.fix.kind !== "navigate" ? (
                              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                                disabled={fixBlockerMut.isPending}
                                onClick={() => fixBlockerMut.mutate(b.fix)}>
                                {b.fix.label}
                              </Button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : readinessQ.data.readyForRender ? (
                    <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs font-semibold text-emerald-600">
                      PASS READY TO RENDER
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="render">
          <div className="mb-4">
            <RenderWorkerStatusCard />
          </div>
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
                  disabled={createRenderMut.isPending || !renderReadyQ.data?.ok || (renderReadiness?.professionalBlockers?.length ?? 0) > 0}
                  onClick={() => createRenderMut.mutate({ renderType: "full" })}>
                  <Play className="h-3.5 w-3.5 mr-1" />Generate Full Render
                </Button>
                {renderStatusQ.data?.latest && ["queued","preparing","rendering"].includes(renderStatusQ.data.latest.status) && (
                  <Button size="sm" variant="destructive" disabled={cancelRenderMut.isPending}
                    onClick={() => cancelRenderMut.mutate(renderStatusQ.data!.latest!.id)}>
                    Cancel Render
                  </Button>
                )}
                <AiToolPrompt
                  projectId={id}
                  task="editorial_decisions"
                  label="Repair Render Readiness"
                  headerLabel="render pipeline"
                  mode="render_fix"
                  invalidateKeys={[["project-canonical", id], ["timeline-composer", id], ["render-readiness", id]]}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Pre-flight summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="rounded border border-border p-2">
                  <div className="text-muted-foreground">Technical</div>
                  <div className="font-semibold">{renderReadiness?.technicalReadiness ?? "-"}</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-muted-foreground">Professional</div>
                  <div className="font-semibold">{renderReadiness?.professionalReadiness ?? (readinessQ.data as any)?.professionalReadiness ?? "-"}</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-muted-foreground">Timeline</div>
                  <div className="font-semibold">{renderReadyQ.data?.checks.timelineValid ? "Valid" : "Invalid / missing"}</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-muted-foreground">Manifest</div>
                  <div className="font-semibold">{renderReadyQ.data?.checks.manifestExists ? "Ready" : "Missing"}</div>
                </div>
              </div>

              {(renderReadiness?.professionalWarnings?.length ?? 0) > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                  <div className="font-semibold text-amber-600 mb-1">Technically renderable preview, professional render blocked until resolved</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {(renderReadiness?.professionalWarnings ?? []).map((b: string, i: number) => <li key={i}>{b}</li>)}
                  </ul>
                </div>
              )}

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
                      <span className="text-muted-foreground"> - {new Date(renderStatusQ.data.latest.created_at).toLocaleString()}</span>
                    </div>
                    <Badge variant="outline" className="capitalize">{renderStatusQ.data.latest.status}</Badge>
                  </div>
                  <Progress value={renderStatusQ.data.latest.progress_percent ?? 0} />
                  <div className="text-xs text-muted-foreground">
                    {renderStatusQ.data.latest.progress_percent ?? 0}%
                    {renderStatusQ.data.latest.error_message ? ` - ${renderStatusQ.data.latest.error_message}` : ""}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No render jobs yet. Approve assets, compose timeline, then queue a render.</p>
              )}

              {/* Provider details (Render Adapter layer) */}
              {providerJobQ.data?.providerJob && (
                <div className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Provider</span>
                      <Badge variant="outline">{providerJobQ.data.providerJob.render_providers?.name ?? "-"}</Badge>
                      <Badge variant="outline" className="capitalize">{providerJobQ.data.providerJob.render_providers?.provider_type ?? "-"}</Badge>
                    </div>
                    <Badge variant="outline" className="capitalize">{providerJobQ.data.providerJob.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono break-all">
                    Provider job ID: {providerJobQ.data.providerJob.provider_job_id ?? "-"}
                  </div>
                  {Array.isArray(providerJobQ.data.providerJob.logs) && providerJobQ.data.providerJob.logs.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Render logs ({providerJobQ.data.providerJob.logs.length})</summary>
                      <div className="mt-2 max-h-40 overflow-y-auto space-y-1 font-mono text-[11px]">
                        {(providerJobQ.data.providerJob.logs as any[]).slice(-20).map((l: any, i: number) => (
                          <div key={i} className={l.level === "error" ? "text-destructive" : ""}>
                            <span className="text-muted-foreground">[{new Date(l.at).toLocaleTimeString()}]</span> {l.msg}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Request payload</summary>
                    <pre className="mt-2 text-[10px] font-mono bg-background border border-border rounded p-2 max-h-56 overflow-auto whitespace-pre">{JSON.stringify(providerJobQ.data.providerJob.request_payload ?? {}, null, 2)}</pre>
                  </details>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Response payload / last callback</summary>
                    <pre className="mt-2 text-[10px] font-mono bg-background border border-border rounded p-2 max-h-56 overflow-auto whitespace-pre">{JSON.stringify(providerJobQ.data.providerJob.response_payload ?? {}, null, 2)}</pre>
                  </details>
                </div>
              )}

              {/* Outputs */}
              <div>
                <div className="text-sm font-semibold mb-2">Render Outputs</div>
                {(renderOutputsQ.data?.outputs ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No outputs yet.</p>
                ) : (
                  <div className="space-y-3">
                    {(renderOutputsQ.data?.outputs ?? []).map((o: any) => {
                      const isPlayable = !!o.file_url && !String(o.file_url).startsWith("mock://");
                      return (
                        <div key={o.id} className="border border-border rounded-md p-2 space-y-2">
                          {isPlayable && (
                            <video
                              src={o.file_url}
                              poster={o.thumbnail_url ?? undefined}
                              controls
                              preload="metadata"
                              className="w-full rounded bg-black aspect-video"
                            />
                          )}
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex flex-col">
                              <span className="font-medium capitalize">{o.output_type} - {o.resolution}</span>
                              <span className="text-muted-foreground">
                                {new Date(o.created_at).toLocaleString()} - {Math.round((o.file_size ?? 0)/1_000_000)}MB - {Number(o.duration_seconds ?? 0).toFixed(1)}s
                              </span>
                            </div>
                            <Button size="sm" variant="outline" asChild={!!o.file_url} disabled={!o.file_url}>
                              {o.file_url ? <a href={o.file_url} target="_blank" rel="noreferrer" download>Download</a> : <span>Pending</span>}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
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
                        <span className="capitalize">{j.render_type} - <span className="text-muted-foreground">{new Date(j.created_at).toLocaleString()}</span></span>
                        <Badge variant="outline" className="capitalize">{j.status}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preview">
          <TimelinePreview projectId={id} />
        </TabsContent>

        <TabsContent value="export">
          <ProductionPackageExport projectId={id} />
        </TabsContent>

        <TabsContent value="renderspec">
          <RenderSpecInspector projectId={id} />
        </TabsContent>

        <TabsContent value="composer">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Timeline Composer {composerQ.data && (
                  <Badge variant="outline" className="ml-2">
                    {composerQ.data.items.length} items - {composerQ.data.tracks.length} tracks
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setComposerZoom((z) => Math.max(2, z - 2))}>-</Button>
                <span className="text-xs text-muted-foreground tabular-nums w-14 text-center">{composerZoom} px/s</span>
                <Button size="sm" variant="outline" onClick={() => setComposerZoom((z) => Math.min(40, z + 2))}>+</Button>
                <Button size="sm" onClick={() => recomposeMut.mutate()} disabled={recomposeMut.isPending}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />Recompose
                </Button>
                <AiToolPrompt
                  projectId={id}
                  task="editorial_decisions"
                  headerLabel="timeline composer"
                  invalidateKeys={[["timeline-composer", id], ["project-canonical", id], ["render-readiness", id]]}
                />
              </div>
            </CardHeader>
            <CardContent>
              {!composerQ.data ? (
                <p className="text-sm text-muted-foreground">Loading timeline...</p>
              ) : composerQ.data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No timeline items yet. Run Editorial Decisions, then click Recompose.</p>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const actionableIssues = composerQ.data.validation.issues.filter(isActionableTimelineIssue);
                    const actionableErrors = actionableIssues.filter((iss: any) => iss.level === "error");
                    const actionableWarnings = actionableIssues.filter((iss: any) => iss.level === "warning");
                    return <>
                  {/* Validation summary */}
                  <div className="flex items-center gap-2 text-xs">
                    {actionableErrors.length === 0 ? (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">PASS Valid</Badge>
                    ) : (
                      <Badge variant="destructive">{actionableErrors.length} error{actionableErrors.length === 1 ? "" : "s"}</Badge>
                    )}
                    {actionableWarnings.length > 0 && (
                      <Badge variant="secondary">{actionableWarnings.length} warning{actionableWarnings.length === 1 ? "" : "s"}</Badge>
                    )}
                    <span className="text-muted-foreground">Duration: {composerQ.data.duration.toFixed(1)}s</span>
                  </div>
                    </>;
                  })()}

                  {/* Timeline grid */}
                  {(() => {
                    const duration = Math.max(composerQ.data.duration, ...composerQ.data.items.map((i: any) => Number(i.end_time)));
                    const totalWidth = Math.max(600, Math.ceil(duration) * composerZoom);
                    const ticks: number[] = [];
                    const tickEvery = composerZoom < 6 ? 30 : composerZoom < 14 ? 10 : 5;
                    for (let t = 0; t <= duration; t += tickEvery) ticks.push(t);
                    const itemsByTrack: Record<string, any[]> = {};
                    for (const it of composerQ.data.items) {
                      (itemsByTrack[it.track_id] ??= []).push(it);
                    }
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
                                      title={`${it.asset_type} ${Number(it.start_time).toFixed(1)}-${Number(it.end_time).toFixed(1)}s - ${it.status}${it.title ? `\n${it.title}` : ""}`}
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
                  {composerQ.data.validation.issues.filter(isActionableTimelineIssue).length > 0 && (
                    <div className="border border-border rounded-md p-2 max-h-48 overflow-auto">
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <div className="text-xs font-semibold">Validation issues</div>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                            disabled={recomposeMut.isPending || aiFixTimelineMut.isPending}
                            onClick={() => recomposeMut.mutate()}>
                            <RefreshCw className="h-3 w-3 mr-1" />Recompose
                          </Button>
                          <Button size="sm" className="h-6 px-2 text-[11px]"
                            disabled={aiFixTimelineMut.isPending || recomposeMut.isPending}
                            onClick={() => aiFixTimelineMut.mutate()}>
                            {aiFixTimelineMut.isPending ? "Fixing..." : "AI Fix"}
                          </Button>
                        </div>
                      </div>
                      <ul className="space-y-1 text-[11px]">
                        {composerQ.data.validation.issues.filter(isActionableTimelineIssue).map((iss: any, i: number) => (
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
              <AiToolPrompt
                projectId={id}
                task="editorial_decisions"
                headerLabel="timeline"
                invalidateKeys={[["project-canonical", id], ["timeline-composer", id], ["render-readiness", id]]}
              />
            </CardHeader>
            <CardContent>
              {!canonQ.data || canonQ.data.timelineInstructions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No timeline yet. Rebuild from the Render Manifest tab.</p>
              ) : (() => {
                // Visually group manifest entries by layer (Track 0-6).
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
                      source: t.asset_id ? "registry" : "-", query: "",
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
                                  <td className="py-1 pr-3">{r.action_type ?? "-"}</td>
                                  <td className="py-1 pr-3 tabular-nums">{Number(r.timeline_start).toFixed(2)}s</td>
                                  <td className="py-1 pr-3 tabular-nums">{Number(r.timeline_end).toFixed(2)}s</td>
                                  <td className="py-1 pr-3 tabular-nums">{(Number(r.timeline_end) - Number(r.timeline_start)).toFixed(2)}s</td>
                                  <td className="py-1 pr-3 tabular-nums">{r.priority ?? "-"}</td>
                                  <td className="py-1 pr-3">{r.transition ?? "-"}</td>
                                  <td className="py-1 pr-3">{r.source ?? "-"}</td>
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
              <div className="flex items-center gap-2">
              <AiToolPrompt projectId={id} task="editorial_decisions" invalidateKeys={[["project-canonical", id]]} />
              <Button
                size="sm"
                variant="outline"
                disabled={!transcript}
                onClick={async () => {
                  try {
                    toast.info("Generating editorial decisions...");
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
              </div>
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
                              <td className="py-1 pr-3">{s ? `${s.scene_number}` : "-"}</td>
                              <td className="py-1 pr-3"><Badge variant="outline" className="text-[10px]">{a.action_type}</Badge></td>
                              <td className="py-1 pr-3 tabular-nums">{a.layer}</td>
                              <td className="py-1 pr-3">{layoutById.get(a.layout_id) ?? "-"}</td>
                              <td className="py-1 pr-3">{transitionById.get(a.transition_in_id) ?? "-"} to {transitionById.get(a.transition_out_id) ?? "-"}</td>
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
                disabled={!canonQ.data}
                onClick={async () => {
                  try {
                    toast.info("Generating layout decisions...");
                    const res: any = await regenLayoutFn({ data: { projectId: id } });
                    qc.invalidateQueries({ queryKey: ["project-canonical", id] });
                    qc.invalidateQueries({ queryKey: ["project-health", id] });
                    const summary = Array.isArray(res?.steps) && res.steps.length > 0
                      ? res.steps.join(" - ")
                      : `Wrote ${res?.count ?? 0} layout decision(s)`;
                    toast.success(summary);
                  } catch (e: any) {
                    toast.error(e?.message ?? "Failed");
                  }
                }}
              >
                <RefreshCw className="h-3 w-3 mr-1" />Regenerate
              </Button>
              <AiToolPrompt
                projectId={id}
                task="editorial_decisions"
                headerLabel="layout decisions"
                invalidateKeys={[["project-canonical", id], ["timeline-composer", id], ["render-readiness", id]]}
              />
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
                                <td className="py-1 pr-3">{s ? s.scene_number : "-"}</td>
                                <td className="py-1 pr-3">
                                  {a?.action_type
                                    ? <Badge variant="outline" className="text-[10px]">{a.action_type}</Badge>
                                    : "-"}
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
                                <td className="py-1 pr-3 max-w-md truncate" title={l.rationale ?? ""}>{l.rationale ?? "-"}</td>
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

      <Dialog open={ctaFixOpen} onOpenChange={setCtaFixOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add CTA text</DialogTitle>
            <DialogDescription>
              This warning needs your call-to-action copy. It will be added to the end of the timeline and the manifest will be rebuilt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Input
              value={ctaFixText}
              onChange={(e) => setCtaFixText(e.target.value)}
              placeholder="e.g. Book a consultation today"
              maxLength={300}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCtaFixOpen(false)} disabled={addCtaMut.isPending}>Cancel</Button>
            <Button
              disabled={addCtaMut.isPending || ctaFixText.trim().length === 0}
              onClick={() => addCtaMut.mutate()}
            >
              {addCtaMut.isPending ? "Adding..." : "Add CTA & Fix"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(assetPromptTodo)} onOpenChange={(open) => {
        if (!open) setAssetPromptTodo(null);
      }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Generate asset for this requirement</DialogTitle>
            <DialogDescription>
              Use this exact prompt with an external image tool, or generate/search a single reviewed asset for this requirement. Studio remains the approval gate.
            </DialogDescription>
          </DialogHeader>
          {assetPromptTodo && (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                <div className="rounded border border-border p-2">
                  <div className="text-muted-foreground">Requirement</div>
                  <div className="font-medium">{assetPromptTodo.visual_intent}</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-muted-foreground">Timestamp</div>
                  <div className="font-medium">{Number(assetPromptTodo.start_time ?? 0).toFixed(1)}-{Number(assetPromptTodo.end_time ?? 0).toFixed(1)}s</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-muted-foreground">Target</div>
                  <div className="font-medium">{assetPromptTodo.required_asset_type}</div>
                </div>
              </div>
              <div className="rounded border border-border bg-muted/20 p-2 text-xs">
                <div className="font-semibold">Narration excerpt</div>
                <div className="text-muted-foreground">{assetPromptTodo.narration_excerpt ?? "No narration mapped"}</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <div className="rounded border border-border p-2">
                  <div className="text-muted-foreground">Layout target</div>
                  <div className="font-medium">{assetPromptTodo.layout_name ?? "-"}</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-muted-foreground">Output</div>
                  <div className="font-medium">{assetPromptTodo.recommended_dimensions} · {assetPromptTodo.recommended_aspect_ratio}</div>
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold mb-1">Prompt</div>
                <Textarea readOnly className="min-h-32 text-xs" value={assetPromptTodo.prompt_for_ai_generation ?? ""} />
              </div>
              <div>
                <div className="text-xs font-semibold mb-1">Negative prompt</div>
                <Textarea readOnly className="min-h-20 text-xs" value={assetPromptTodo.negative_prompt ?? ""} />
              </div>
              <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700">
                Clinical lesion imagery should be reviewed as clinical image or medical illustration. AI-generated lesion visuals must not be labeled as real clinical photos.
              </div>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setAssetPromptTodo(null)}>Close</Button>
            <Button
              variant="outline"
              disabled={!assetPromptTodo}
              onClick={async () => {
                await navigator.clipboard.writeText(assetPromptTodo?.external_generation_prompt ?? assetPromptTodo?.prompt_for_ai_generation ?? "");
                toast.success("Generation prompt copied");
              }}
            >
              Copy prompt
            </Button>
            <Button
              variant="outline"
              disabled={!assetPromptTodo || searchAssetMut.isPending}
              onClick={() => assetPromptTodo && searchAssetMut.mutate({ candidateId: assetPromptTodo.primary_candidate_id, provider: "internal" })}
            >
              Generate internal graphic
            </Button>
            <label className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium cursor-pointer hover:bg-accent">
              Upload generated result
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.svg,.mp4,.mov,image/png,image/jpeg,image/webp,image/svg+xml,video/mp4,video/quicktime"
                className="hidden"
                disabled={!assetPromptTodo}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (file && assetPromptTodo) void uploadAssetFile(assetPromptTodo.primary_candidate_id, file);
                }}
              />
            </label>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(manualUrlCandidate)} onOpenChange={(open) => {
        if (!open) setManualUrlCandidate(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve manual media URL</DialogTitle>
            <DialogDescription>
              Paste a licensed image or video URL for this planned asset. The URL will be stored as render-ready media and linked into the manifest.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="text-xs text-muted-foreground">
              {manualUrlCandidate?.asset_type} - {manualUrlCandidate?.search_query}
            </div>
            <Input
              placeholder="https://..."
              value={manualUrlDraft.source_url}
              onChange={(e) => setManualUrlDraft((prev) => ({ ...prev, source_url: e.target.value }))}
            />
            <Input
              placeholder="Title"
              value={manualUrlDraft.title}
              onChange={(e) => setManualUrlDraft((prev) => ({ ...prev, title: e.target.value }))}
            />
            <Input
              placeholder="Attribution / source note"
              value={manualUrlDraft.attribution}
              onChange={(e) => setManualUrlDraft((prev) => ({ ...prev, attribution: e.target.value }))}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input
                placeholder="Specialty"
                value={manualUrlDraft.specialty}
                onChange={(e) => setManualUrlDraft((prev) => ({ ...prev, specialty: e.target.value }))}
              />
              <Input
                placeholder="Diagnosis / topic"
                value={manualUrlDraft.diagnosis_topic}
                onChange={(e) => setManualUrlDraft((prev) => ({ ...prev, diagnosis_topic: e.target.value }))}
              />
              <Input
                placeholder="Anatomy"
                value={manualUrlDraft.anatomy}
                onChange={(e) => setManualUrlDraft((prev) => ({ ...prev, anatomy: e.target.value }))}
              />
              <Input
                placeholder="Visual concept"
                value={manualUrlDraft.visual_concept}
                onChange={(e) => setManualUrlDraft((prev) => ({ ...prev, visual_concept: e.target.value }))}
              />
            </div>
            <Select
              value={manualUrlDraft.sensitivity_level}
              onValueChange={(v) => setManualUrlDraft((prev) => ({ ...prev, sensitivity_level: v }))}
            >
              <SelectTrigger><SelectValue placeholder="Sensitivity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="safe">Safe</SelectItem>
                <SelectItem value="mild clinical">Mild clinical</SelectItem>
                <SelectItem value="graphic">Graphic</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Provenance / reuse notes"
              value={manualUrlDraft.provenance_notes}
              onChange={(e) => setManualUrlDraft((prev) => ({ ...prev, provenance_notes: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualUrlCandidate(null)}>Cancel</Button>
            <Button
              disabled={!manualUrlCandidate || !manualUrlDraft.source_url || approveManualUrlMut.isPending}
              onClick={() => {
                if (!manualUrlCandidate) return;
                approveManualUrlMut.mutate({
                  candidateId: manualUrlCandidate.id,
                  source_url: manualUrlDraft.source_url.trim(),
                  title: manualUrlDraft.title.trim() || undefined,
                  attribution: manualUrlDraft.attribution.trim() || undefined,
                  specialty: manualUrlDraft.specialty.trim() || undefined,
                  diagnosis_topic: manualUrlDraft.diagnosis_topic.trim() || undefined,
                  anatomy: manualUrlDraft.anatomy.trim() || undefined,
                  visual_concept: manualUrlDraft.visual_concept.trim() || undefined,
                  sensitivity_level: manualUrlDraft.sensitivity_level as "safe" | "mild clinical" | "graphic",
                  provenance_notes: manualUrlDraft.provenance_notes.trim() || undefined,
                });
              }}
            >
              {approveManualUrlMut.isPending ? "Approving..." : "Approve URL"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                <SelectItem value="transcript">Transcript - delete everything after transcript</SelectItem>
                <SelectItem value="scene_plan">Scene Plan - delete scenes and downstream</SelectItem>
                <SelectItem value="storyboard">Storyboard - delete storyboard, b-roll, infographics, manifest</SelectItem>
                <SelectItem value="editorial_decisions">Editorial Decisions - delete edit actions + manifest</SelectItem>
                <SelectItem value="complete">Complete Reset - wipe all generated outputs</SelectItem>
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

function DurationCard(props: {
  projectId: string;
  currentDuration: number;
  getVideoUrl: () => Promise<string>;
  setDuration: (d: number) => Promise<any>;
  onUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<string>("");

  const apply = async (seconds: number, label: string) => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      toast.error("Invalid duration");
      return;
    }
    setBusy(true);
    try {
      await props.setDuration(seconds);
      toast.success(`Duration set to ${seconds.toFixed(2)}s (${label}). Timeline + manifest rebuilt.`);
      props.onUpdated();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update duration");
    } finally {
      setBusy(false);
    }
  };

  const autoDetect = async () => {
    setBusy(true);
    try {
      const url = await props.getVideoUrl();
      const seconds = await new Promise<number>((resolve, reject) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.muted = true;
        v.crossOrigin = "anonymous";
        const timer = setTimeout(() => reject(new Error("Probe timed out")), 30_000);
        v.onloadedmetadata = () => {
          // Some MP4s report Infinity until we seek to the end.
          if (v.duration === Infinity || Number.isNaN(v.duration)) {
            v.currentTime = 1e9;
            v.ontimeupdate = () => {
              v.ontimeupdate = null;
              clearTimeout(timer);
              resolve(v.duration);
            };
          } else {
            clearTimeout(timer);
            resolve(v.duration);
          }
        };
        v.onerror = () => { clearTimeout(timer); reject(new Error("Failed to load video metadata")); };
        v.src = url;
      });
      await apply(Math.round(seconds * 1000) / 1000, "auto-detected");
    } catch (e: any) {
      toast.error(e?.message ?? "Auto-detect failed");
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="py-3 flex flex-wrap items-center gap-3">
        <div className="text-sm">
          <span className="font-medium">Video duration:</span>{" "}
          <span className="tabular-nums">{props.currentDuration.toFixed(2)}s</span>
          <span className="text-xs text-muted-foreground ml-2">
            If the presenter video is longer than this, the timeline will be too short.
          </span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Button size="sm" variant="outline" disabled={busy} onClick={autoDetect}>
            Auto-detect from file
          </Button>
          <Input
            type="number"
            step="0.01"
            min="1"
            placeholder="seconds"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            className="w-28 h-8"
            disabled={busy}
          />
          <Button
            size="sm"
            disabled={busy || !override}
            onClick={() => apply(Number(override), "manual")}
          >
            Override
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

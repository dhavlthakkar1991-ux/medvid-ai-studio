import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { createProject, createUploadUrl } from "@/lib/projects.functions";
import { startFullPipeline } from "@/lib/jobs.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  MEDICAL_TEMPLATES,
  MEDICAL_SPECIALTIES,
  findMedicalTemplate,
  findMedicalSpecialty,
} from "@/lib/templates/catalog";

export const Route = createFileRoute("/_authenticated/projects/new")({
  component: NewProject,
  head: () => ({ meta: [{ title: "New project — MedVideo AI" }] }),
});

function NewProject() {
  const router = useRouter();
  const createFn = useServerFn(createProject);
  const uploadFn = useServerFn(createUploadUrl);
  const startFn = useServerFn(startFullPipeline);

  const [templateId, setTemplateId] = useState<string>("");
  const [specialtyId, setSpecialtyId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [presenterName, setPresenterName] = useState("");
  const [groundingMode, setGroundingMode] = useState<"strict" | "open">("strict");
  const [overrides, setOverrides] = useState({
    audience: "", brand_voice: "", visual_style: "",
    target_platform: "YouTube", content_type: "Educational",
    render_intent: "youtube_education", visual_density: "medium", retention_priority: "high",
  });
  const [busy, setBusy] = useState(false);

  const tpl = useMemo(() => findMedicalTemplate(templateId), [templateId]);
  const specialty = useMemo(() => findMedicalSpecialty(specialtyId), [specialtyId]);

  // Smart auto-fill: when a template is chosen, prefill the override defaults.
  // Already-edited fields are preserved (only empty / default values change).
  const onTemplateChange = (id: string) => {
    setTemplateId(id);
    const t = findMedicalTemplate(id);
    if (!t) return;
    setOverrides((prev) => ({
      ...prev,
      audience: prev.audience || t.audience,
      brand_voice: prev.brand_voice || t.brand_voice,
      visual_density: t.visual_density,
      retention_priority: t.retention_priority,
      render_intent: t.render_intent,
    }));
  };

  // Extract duration + dimensions from the chosen video file (client-side).
  const extractVideoMeta = (f: File): Promise<{ duration: number | null; width: number | null; height: number | null }> =>
    new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(f);
        const v = document.createElement("video");
        v.preload = "metadata";
        v.src = url;
        const done = (val: { duration: number | null; width: number | null; height: number | null }) => {
          URL.revokeObjectURL(url);
          resolve(val);
        };
        v.onloadedmetadata = () => done({
          duration: Number.isFinite(v.duration) ? Math.round(v.duration) : null,
          width: v.videoWidth || null,
          height: v.videoHeight || null,
        });
        v.onerror = () => done({ duration: null, width: null, height: null });
      } catch {
        resolve({ duration: null, width: null, height: null });
      }
    });

  const onSubmit = async () => {
    if (!title || !file || !templateId) {
      return toast.error("Title, Medical Template, and video are required.");
    }
    setBusy(true);
    try {
      const meta = await extractVideoMeta(file);
      const { path, token } = await uploadFn({ data: { filename: file.name } });
      const { error: upErr } = await supabase.storage.from("videos").uploadToSignedUrl(path, token, file);
      if (upErr) throw upErr;
      const ctx = {
        audience: overrides.audience || tpl?.audience || null,
        specialty: specialty?.name ?? null,
        brand_voice: overrides.brand_voice || tpl?.brand_voice || null,
        target_platform: overrides.target_platform,
        content_type: overrides.content_type,
        visual_style: overrides.visual_style || null,
        scene_patterns: [],
        infographic_types: [],
        broll_types: [],
        thumbnail_style: {},
        render_intent: overrides.render_intent,
        visual_density: overrides.visual_density,
        retention_priority: overrides.retention_priority,
        presenter_name: presenterName.trim() || null,
        grounding_mode: groundingMode,
        template_id: templateId,
        specialty_id: specialtyId || null,
      };
      const { id } = await createFn({
        data: {
          title, topic,
          specialty_template_id: null,
          video_path: path,
          duration_seconds: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: null,
          file_size: file.size,
          context: ctx,
        },
      });
      const job = await startFn({ data: { projectId: id } });
      if (job.runnerUrl) void fetch(job.runnerUrl, { method: "POST" }).catch(() => undefined);
      toast.success("Project created. Analysis started.");
      router.navigate({ to: "/projects/$id", params: { id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New project</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Pick a Medical Template and Specialty, upload your video, and we'll handle the rest.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Medical Template</CardTitle>
          <CardDescription>
            Choose a content template optimized for your video goal. Templates preconfigure
            audience, visual style, editorial strategy, asset patterns, SEO behavior and
            retention strategy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={templateId} onValueChange={onTemplateChange}>
            <SelectTrigger><SelectValue placeholder="Choose a template…" /></SelectTrigger>
            <SelectContent>
              {MEDICAL_TEMPLATES.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tpl && (
            <div className="mt-3 text-xs text-muted-foreground space-y-1">
              <div><b>Audience:</b> {tpl.audience}</div>
              <div><b>Voice:</b> {tpl.brand_voice}</div>
              <div><b>Focus:</b> {tpl.focus}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Medical Specialty</CardTitle>
          <CardDescription>
            Adds specialty-specific terminology, visual patterns, SEO keywords, and content intelligence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={specialtyId} onValueChange={setSpecialtyId}>
            <SelectTrigger><SelectValue placeholder="Choose a specialty…" /></SelectTrigger>
            <SelectContent>
              {MEDICAL_SPECIALTIES.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Project details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Early warning signs you should never ignore" /></div>
          <div><Label>Topic / brief</Label><Textarea value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What this video covers, the key message, and the call-to-action." /></div>
          <div>
            <Label>Presenter name</Label>
            <Input
              value={presenterName}
              onChange={(e) => setPresenterName(e.target.value)}
              placeholder="Dr. Jane Doe"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Authoritative spelling. Overrides whatever transcription hears, and is used in every AI output (SEO, lower-thirds, thumbnails).
            </p>
          </div>
          <div>
            <Label>Grounding mode</Label>
            <Select value={groundingMode} onValueChange={(v) => setGroundingMode(v as "strict" | "open")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="strict">Strict — only facts mentioned in the transcript</SelectItem>
                <SelectItem value="open">Open — AI may add adjacent medical concepts</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Strict prevents the AI from introducing topics the speaker didn't actually mention.
            </p>
          </div>
          <div><Label>Video file</Label><Input type="file" accept="video/*,audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Knowledge overrides <span className="text-muted-foreground text-xs">(optional)</span></CardTitle>
          <CardDescription>Override template defaults for this project only.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-3">
          <div><Label>Audience</Label><Input value={overrides.audience} placeholder={tpl?.audience ?? ""} onChange={(e) => setOverrides({ ...overrides, audience: e.target.value })} /></div>
          <div><Label>Brand voice</Label><Input value={overrides.brand_voice} placeholder={tpl?.brand_voice ?? ""} onChange={(e) => setOverrides({ ...overrides, brand_voice: e.target.value })} /></div>
          <div><Label>Visual style</Label><Input value={overrides.visual_style} placeholder="" onChange={(e) => setOverrides({ ...overrides, visual_style: e.target.value })} /></div>
          <div><Label>Target platform</Label><Input value={overrides.target_platform} onChange={(e) => setOverrides({ ...overrides, target_platform: e.target.value })} /></div>
          <div><Label>Render intent</Label>
            <Select value={overrides.render_intent} onValueChange={(v) => setOverrides({ ...overrides, render_intent: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="youtube_education">YouTube Education</SelectItem>
                <SelectItem value="patient_education">Patient Education</SelectItem>
                <SelectItem value="hospital_branding">Hospital Branding</SelectItem>
                <SelectItem value="ted_talk">TED Talk Mode</SelectItem>
                <SelectItem value="netflix_doc">Netflix Documentary</SelectItem>
                <SelectItem value="maximum_retention">Maximum Retention</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Visual density</Label>
            <Select value={overrides.visual_density} onValueChange={(v) => setOverrides({ ...overrides, visual_density: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Retention priority</Label>
            <Select value={overrides.retention_priority} onValueChange={(v) => setOverrides({ ...overrides, retention_priority: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="maximum">Maximum</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Button size="lg" onClick={onSubmit} disabled={busy} className="w-full">
        {busy ? "Uploading…" : "Create project & start AI pipeline"}
      </Button>
    </div>
  );
}

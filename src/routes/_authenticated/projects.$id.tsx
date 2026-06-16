import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProject } from "@/lib/projects.functions";
import { regenerateTask } from "@/lib/analysis.functions";
import { getExportBundle } from "@/lib/exports.functions";
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
  const exportFn = useServerFn(getExportBundle);
  const qc = useQueryClient();

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
                  <Button size="sm" variant="outline" onClick={() => regen.mutate(t)} disabled={regen.isPending}>
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
      </Tabs>
    </div>
  );
}

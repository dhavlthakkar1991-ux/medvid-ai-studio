import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTemplates, upsertTemplate, deleteTemplate } from "@/lib/templates.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Trash2, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/templates")({
  component: TemplatesPage,
  head: () => ({ meta: [{ title: "Specialty templates — MedVideo AI" }] }),
});

function TemplatesPage() {
  const listFn = useServerFn(listTemplates);
  const saveFn = useServerFn(upsertTemplate);
  const delFn = useServerFn(deleteTemplate);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["templates"], queryFn: () => listFn() });
  const [editing, setEditing] = useState<any | null>(null);

  const startEdit = (t: any) => setEditing({
    id: t.is_builtin ? undefined : t.id,
    specialty: t.specialty,
    template_name: t.is_builtin ? `${t.template_name} (copy)` : t.template_name,
    default_audience: t.default_audience ?? "",
    default_brand_voice: t.default_brand_voice ?? "",
    default_visual_style: t.default_visual_style ?? "",
    default_scene_patterns: (t.default_scene_patterns ?? []).join(", "),
    default_infographic_types: (t.default_infographic_types ?? []).join(", "),
    default_broll_types: (t.default_broll_types ?? []).join(", "),
    default_thumbnail_style: JSON.stringify(t.default_thumbnail_style ?? {}, null, 2),
  });

  const save = async () => {
    if (!editing) return;
    try {
      await saveFn({ data: {
        id: editing.id,
        specialty: editing.specialty,
        template_name: editing.template_name,
        default_audience: editing.default_audience || null,
        default_brand_voice: editing.default_brand_voice || null,
        default_visual_style: editing.default_visual_style || null,
        default_scene_patterns: editing.default_scene_patterns.split(",").map((s: string) => s.trim()).filter(Boolean),
        default_infographic_types: editing.default_infographic_types.split(",").map((s: string) => s.trim()).filter(Boolean),
        default_broll_types: editing.default_broll_types.split(",").map((s: string) => s.trim()).filter(Boolean),
        default_thumbnail_style: JSON.parse(editing.default_thumbnail_style || "{}"),
      }});
      toast.success("Saved.");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["templates"] });
    } catch (e: any) { toast.error(e?.message); }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Legacy templates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The Medical Template + Medical Specialty selectors on the new-project
          page have replaced these. Custom entries here remain available for
          backwards compatibility.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {(q.data ?? []).map((t) => (
          <Card key={t.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{t.template_name}</CardTitle>
              {t.is_builtin ? <Badge variant="secondary">Built-in</Badge> : <Badge>Custom</Badge>}
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>{t.default_audience}</div>
                <div>{t.default_brand_voice}</div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" onClick={() => startEdit(t)}>
                  <Copy className="h-3 w-3 mr-1" />{t.is_builtin ? "Clone & edit" : "Edit"}
                </Button>
                {!t.is_builtin && (
                  <Button size="sm" variant="ghost" onClick={async () => { await delFn({ data: { id: t.id } }); qc.invalidateQueries({ queryKey: ["templates"] }); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {editing && (
        <Card>
          <CardHeader><CardTitle>{editing.id ? "Edit template" : "New template"}</CardTitle></CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3">
            <div><Label>Name</Label><Input value={editing.template_name} onChange={(e) => setEditing({ ...editing, template_name: e.target.value })} /></div>
            <div><Label>Specialty</Label><Input value={editing.specialty} onChange={(e) => setEditing({ ...editing, specialty: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Audience</Label><Input value={editing.default_audience} onChange={(e) => setEditing({ ...editing, default_audience: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Brand voice</Label><Input value={editing.default_brand_voice} onChange={(e) => setEditing({ ...editing, default_brand_voice: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Visual style</Label><Input value={editing.default_visual_style} onChange={(e) => setEditing({ ...editing, default_visual_style: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Scene patterns (comma separated)</Label><Input value={editing.default_scene_patterns} onChange={(e) => setEditing({ ...editing, default_scene_patterns: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Infographic types</Label><Input value={editing.default_infographic_types} onChange={(e) => setEditing({ ...editing, default_infographic_types: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>B-roll types</Label><Input value={editing.default_broll_types} onChange={(e) => setEditing({ ...editing, default_broll_types: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Thumbnail style (JSON)</Label><Textarea rows={5} value={editing.default_thumbnail_style} onChange={(e) => setEditing({ ...editing, default_thumbnail_style: e.target.value })} /></div>
            <div className="sm:col-span-2 flex gap-2">
              <Button onClick={save}><Save className="h-3 w-3 mr-1" />Save</Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

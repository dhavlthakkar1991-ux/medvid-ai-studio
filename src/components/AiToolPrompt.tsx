import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { aiModifyTaskOutput } from "@/lib/ai-modify.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

type Props = {
  projectId: string;
  task:
    | "chapters"
    | "scene_plan"
    | "visual_storyboard"
    | "broll"
    | "infographics"
    | "thumbnails"
    | "seo"
    | "shorts"
    | "editorial_decisions";
  label?: string;
  /** Override the title/description noun shown in the dialog. Defaults to the task name. */
  headerLabel?: string;
  disabled?: boolean;
  /** Query keys to invalidate after a successful modification. */
  invalidateKeys?: ReadonlyArray<ReadonlyArray<unknown>>;
};

export function AiToolPrompt({ projectId, task, label = "AI Prompt", headerLabel, disabled, invalidateKeys }: Props) {
  const noun = headerLabel ?? task;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const qc = useQueryClient();
  const modifyFn = useServerFn(aiModifyTaskOutput);
  const mut = useMutation({
    mutationFn: (prompt: string) => modifyFn({ data: { projectId, task, prompt } }),
    onSuccess: (res: any) => {
      toast.success(`AI modified ${noun} → v${res?.version ?? "?"}`);
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["versions", projectId] });
      qc.invalidateQueries({ queryKey: ["readiness", projectId] });
      qc.invalidateQueries({ queryKey: ["timeline", projectId] });
      for (const k of invalidateKeys ?? []) qc.invalidateQueries({ queryKey: k as any });
      setOpen(false);
      setText("");
    },
    onError: (e: any) => toast.error(e?.message ?? "AI modification failed"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!mut.isPending) setOpen(o); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <Sparkles className="h-3 w-3 mr-1" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modify {noun} with AI</DialogTitle>
          <DialogDescription>
            Describe what you want changed. The AI will edit the current output and propagate downstream stages.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={`e.g. "Make chapter 2 shorter and rename to 'Treatment Options'", "Fix the spelling of my name to Dr. Patel", "Add a callout at 1:30 explaining the side effects"`}
          disabled={mut.isPending}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={mut.isPending}>Cancel</Button>
          <Button
            onClick={() => {
              const v = text.trim();
              if (v.length < 3) { toast.error("Describe the change you want"); return; }
              mut.mutate(v);
            }}
            disabled={mut.isPending || text.trim().length < 3}
          >
            {mut.isPending ? "Applying…" : "Apply with AI"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
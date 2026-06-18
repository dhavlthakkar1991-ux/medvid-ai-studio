import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getAISettings, updateAISettings, getUsageTotals } from "@/lib/settings.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TASK_DEFAULT_MODELS, LLM_PROVIDERS, TRANSCRIPTION_PROVIDERS } from "@/lib/ai/types";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/ai")({
  component: AISettings,
  head: () => ({ meta: [{ title: "AI settings — MedVideo AI" }] }),
});

const TASK_LIST = Object.keys(TASK_DEFAULT_MODELS) as Array<keyof typeof TASK_DEFAULT_MODELS>;
const KEY_FIELDS = ["openai", "groq", "gemini", "openrouter", "anthropic", "deepseek"];

function AISettings() {
  const getFn = useServerFn(getAISettings);
  const saveFn = useServerFn(updateAISettings);
  const usageFn = useServerFn(getUsageTotals);
  const q = useQuery({ queryKey: ["ai_settings"], queryFn: () => getFn() });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => usageFn() });
  const [s, setS] = useState<any>(null);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);

  if (!s) return <div className="p-10 text-muted-foreground">Loading…</div>;
  const setKey = (k: string, v: string) => setS({ ...s, provider_keys: { ...(s.provider_keys ?? {}), [k]: v } });
  const setOverride = (t: string, v: string) => setS({ ...s, model_overrides: { ...(s.model_overrides ?? {}), [t]: v } });

  const save = async () => {
    try {
      await saveFn({ data: {
        default_llm_provider: s.default_llm_provider,
        default_transcription_provider: s.default_transcription_provider,
        model_overrides: s.model_overrides ?? {},
        provider_keys: s.provider_keys ?? {},
        budget_mode: !!s.budget_mode,
      }});
      toast.success("Saved.");
    } catch (e: any) { toast.error(e?.message); }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Total spend: ${usage.data?.totalCost.toFixed(4) ?? "0"}</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Providers</CardTitle><CardDescription>Lovable AI is the default; add your own keys for OpenAI/Groq/Gemini/OpenRouter.</CardDescription></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-3">
          <div><Label>Default LLM provider</Label>
            <Select value={s.default_llm_provider} onValueChange={(v) => setS({ ...s, default_llm_provider: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LLM_PROVIDERS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Default transcription provider</Label>
            <Select value={s.default_transcription_provider} onValueChange={(v) => setS({ ...s, default_transcription_provider: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TRANSCRIPTION_PROVIDERS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label>Budget mode</Label>
              <p className="text-xs text-muted-foreground">Override every task with the cheapest model.</p>
            </div>
            <Switch checked={!!s.budget_mode} onCheckedChange={(v) => setS({ ...s, budget_mode: v })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Provider API keys</CardTitle><CardDescription>Stored on your account. Used only when you select that provider.</CardDescription></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-3">
          {KEY_FIELDS.map((k) => (
            <div key={k}>
              <Label className="capitalize">{k}</Label>
              <Input type="password" placeholder={`${k} API key`} value={(s.provider_keys?.[k] ?? "")} onChange={(e) => setKey(k, e.target.value)} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Per-task model overrides</CardTitle><CardDescription>Leave blank to use the recommended default.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {TASK_LIST.map((t) => (
            <div key={t} className="grid grid-cols-3 gap-3 items-center">
              <Label className="capitalize">{t.replace("_", " ")}</Label>
              <Input placeholder={TASK_DEFAULT_MODELS[t]} value={s.model_overrides?.[t] ?? ""} onChange={(e) => setOverride(t, e.target.value)} className="col-span-2" />
            </div>
          ))}
        </CardContent>
      </Card>

      <Button size="lg" onClick={save}>Save settings</Button>
    </div>
  );
}

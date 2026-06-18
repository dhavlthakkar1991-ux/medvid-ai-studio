import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRenderWorkerStatus } from "@/lib/render-providers.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Server } from "lucide-react";

/** Render Worker status card — phase: studio v1 freeze. */
export function RenderWorkerStatusCard() {
  const fn = useServerFn(getRenderWorkerStatus);
  const q = useQuery({ queryKey: ["render-worker-status"], queryFn: () => fn(), refetchInterval: 30_000 });
  const s = q.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Server className="h-4 w-4" /> Render Worker
          {s && (
            <Badge variant={s.configured ? "default" : "secondary"} className="ml-2">
              {s.configured ? (s.simulate ? "Simulated" : "Configured") : "Not configured"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          External FFmpeg / Docker worker (medvideo-render-worker). Actual video rendering happens off-platform.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Tile label="Worker URL" value={s?.workerUrl ?? "—"} mono />
        <Tile label="Version" value={s?.version ?? "unknown"} />
        <Tile label="Last contact" value={s?.lastContactAt ? new Date(s.lastContactAt).toLocaleString() : "—"} />
        <Tile label="Last status" value={s?.lastStatus ?? "—"} />
      </CardContent>
    </Card>
  );
}

function Tile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className={`font-semibold truncate ${mono ? "font-mono text-[11px]" : ""}`} title={value}>{value}</div>
    </div>
  );
}
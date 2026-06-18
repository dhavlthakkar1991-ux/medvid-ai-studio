import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProjectTimeline, addCtaToTimeline } from "@/lib/timeline.functions";
import { getCanonicalProject } from "@/lib/render.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, SkipBack, Bug } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Item = any;
type Track = any;
type Asset = any;
type ManifestRow = any;

const TRACK_COLORS: Record<string, string> = {
  presenter_video: "#0ea5e9",
  broll: "#22c55e",
  clinical_images: "#f97316",
  medical_diagrams: "#ef4444",
  infographics: "#a855f7",
  text_overlays: "#eab308",
  captions: "#94a3b8",
  cta: "#ec4899",
};

function fmt(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 10);
  return `${m}:${sec.toString().padStart(2, "0")}.${ms}`;
}

function assetUrl(asset?: Asset | null): string | null {
  if (!asset) return null;
  return asset.url ?? asset.preview_url ?? asset.thumbnail_url ?? null;
}

function AssetVisual({
  item,
  asset,
  compiledGraphic,
  className = "",
}: { item: Item; asset?: Asset | null; compiledGraphic?: any | null; className?: string }) {
  const url = assetUrl(asset);
  const kind = String(item.asset_type ?? "");
  // Compiled graphic takes precedence — manifest V6 makes every text/CTA
  // item a real renderable image.
  if (compiledGraphic?.preview_url) {
    return (
      <img
        src={compiledGraphic.preview_url}
        alt={item.title ?? kind}
        className={`object-contain w-full h-full ${className}`}
      />
    );
  }
  if (url) {
    return (
      <img
        src={url}
        alt={item.title ?? kind}
        className={`object-cover w-full h-full ${className}`}
      />
    );
  }
  // Placeholder: render different look per kind
  const isText = kind.includes("text") || kind === "show_lower_third" || kind === "kinetic_typography" || kind === "highlight_keyword" || kind === "show_statistic" || kind === "show_callout";
  const isCta = kind === "show_cta" || kind === "show_thumbnail_frame" || kind === "show_logo";
  if (isText) {
    return (
      <div className={`w-full h-full flex items-center justify-center bg-yellow-500/20 border-2 border-yellow-500/60 ${className}`}>
        <div className="text-yellow-100 text-center px-3 font-semibold text-sm drop-shadow">
          {item.title || kind}
        </div>
      </div>
    );
  }
  if (isCta) {
    return (
      <div className={`w-full h-full flex items-center justify-center bg-pink-500/20 border-2 border-pink-500/60 rounded ${className}`}>
        <div className="text-pink-100 text-center px-3 font-bold text-base">{item.title || "CTA"}</div>
      </div>
    );
  }
  return (
    <div className={`w-full h-full flex items-center justify-center bg-muted/60 border border-dashed border-border ${className}`}>
      <div className="text-muted-foreground text-xs text-center px-2">
        <div className="font-semibold">{kind || "asset"}</div>
        <div className="opacity-70 truncate">{item.title}</div>
      </div>
    </div>
  );
}

function PresenterPlaceholder({ size = "full" }: { size?: "full" | "pip" | "half" }) {
  return (
    <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br from-sky-900 to-slate-900 text-sky-100 ${size === "pip" ? "rounded-lg ring-2 ring-sky-400/60" : ""}`}>
      <div className="text-center">
        <div className="text-3xl">🎤</div>
        <div className="text-xs mt-1 opacity-80">Presenter</div>
      </div>
    </div>
  );
}

function Stage({
  active,
  trackById,
  assetById,
  compiledById,
  onSelect,
}: {
  active: Item[];
  trackById: Map<string, Track>;
  assetById: Map<string, Asset>;
  compiledById: Map<string, any>;
  onSelect: (it: Item) => void;
}) {
  const byKind: Record<string, Item[]> = {};
  for (const it of active) {
    const k = trackById.get(it.track_id)?.kind ?? "unknown";
    (byKind[k] ??= []).push(it);
  }
  const presenter = byKind.presenter_video?.[0];
  const overlays = [
    ...(byKind.broll ?? []),
    ...(byKind.clinical_images ?? []),
    ...(byKind.medical_diagrams ?? []),
    ...(byKind.infographics ?? []),
  ];
  const primary = overlays[0]; // visual overlay that drives the layout
  const layout = primary?.layout ?? (overlays.length === 0 ? "full_screen" : "doctor_with_infographic");

  // Decide presenter + main asset placement
  let mainEl: React.ReactNode = null;
  let presenterEl: React.ReactNode = null;
  if (presenter && !primary) {
    mainEl = <PresenterPlaceholder size="full" />;
  } else if (primary && !presenter) {
    mainEl = (
      <button
        type="button"
        onClick={() => onSelect(primary)}
        className="w-full h-full text-left"
      >
        <AssetVisual item={primary} asset={primary.asset_id ? assetById.get(primary.asset_id) : null} compiledGraphic={primary.compiled_graphic_id ? compiledById.get(primary.compiled_graphic_id) : null} />
      </button>
    );
  } else if (primary && presenter) {
    const presenterNode = <PresenterPlaceholder size={layout === "split_screen" ? "half" : "pip"} />;
    const assetNode = (
      <button type="button" onClick={() => onSelect(primary)} className="w-full h-full text-left">
        <AssetVisual item={primary} asset={primary.asset_id ? assetById.get(primary.asset_id) : null} compiledGraphic={primary.compiled_graphic_id ? compiledById.get(primary.compiled_graphic_id) : null} />
      </button>
    );
    if (layout === "pip_left") {
      mainEl = assetNode;
      presenterEl = (
        <div className="absolute left-3 bottom-3 w-1/4 h-1/4 z-30">{presenterNode}</div>
      );
    } else if (layout === "pip_right") {
      mainEl = assetNode;
      presenterEl = (
        <div className="absolute right-3 bottom-3 w-1/4 h-1/4 z-30">{presenterNode}</div>
      );
    } else if (layout === "split_screen") {
      mainEl = (
        <div className="w-full h-full grid grid-cols-2 gap-1">
          <div className="relative">{presenterNode}</div>
          <div className="relative">{assetNode}</div>
        </div>
      );
    } else if (layout === "full_screen_broll" || layout === "full_screen") {
      mainEl = assetNode;
    } else {
      // doctor_with_infographic / doctor_with_clinical_image — asset main, presenter pip-right
      mainEl = assetNode;
      presenterEl = (
        <div className="absolute right-3 bottom-3 w-1/4 h-1/4 z-30">{presenterNode}</div>
      );
    }
  } else {
    mainEl = (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        (no active video element)
      </div>
    );
  }

  const textOverlays = byKind.text_overlays ?? [];
  const ctas = byKind.cta ?? [];
  const captions = byKind.captions ?? [];

  return (
    <div className="relative w-full aspect-video bg-black rounded-md overflow-hidden border border-border">
      <div className="absolute inset-0">{mainEl}</div>
      {presenterEl}

      {/* Text overlays — top stack */}
      <div className="absolute top-3 left-3 right-3 flex flex-col gap-1 z-20">
        {textOverlays.slice(0, 3).map((it) => (
          (() => {
            const cg = it.compiled_graphic_id ? compiledById.get(it.compiled_graphic_id) : null;
            if (cg?.preview_url) {
              return (
                <button key={it.id} type="button" onClick={() => onSelect(it)} className="block">
                  <img src={cg.preview_url} alt={it.title ?? it.asset_type} className="w-full max-h-32 object-contain drop-shadow-xl" />
                </button>
              );
            }
            return <button
            key={it.id}
            type="button"
            onClick={() => onSelect(it)}
            className={`text-left px-3 py-1.5 rounded backdrop-blur bg-yellow-500/30 border ${it.status === "missing_asset" ? "border-red-500" : "border-yellow-300/60"} text-yellow-50 text-sm font-semibold drop-shadow`}
          >
            {it.title || it.asset_type}
          </button>;
          })()
        ))}
      </div>

      {/* CTA — center card */}
      {ctas.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          {(() => {
            const ctaCg = ctas[0].compiled_graphic_id ? compiledById.get(ctas[0].compiled_graphic_id) : null;
            if (ctaCg?.preview_url) {
              return (
                <button type="button" onClick={() => onSelect(ctas[0])} className="pointer-events-auto max-w-[70%] max-h-[70%]">
                  <img src={ctaCg.preview_url} alt="CTA" className="w-full h-full object-contain drop-shadow-2xl" />
                </button>
              );
            }
            return <button
            type="button"
            onClick={() => onSelect(ctas[0])}
            className="pointer-events-auto px-6 py-3 rounded-lg bg-pink-500/90 text-white font-bold shadow-2xl"
          >
            {ctas[0].title || "Call to Action"}
          </button>;
          })()}
        </div>
      )}

      {/* Captions — bottom band */}
      {captions.length > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[80%] z-20">
          <div className="px-3 py-1 rounded bg-black/70 text-white text-sm text-center">
            {captions[0].title || "[caption]"}
          </div>
        </div>
      )}

      {/* Layout label */}
      <div className="absolute top-2 right-2 z-30">
        <Badge variant="outline" className="bg-black/60 text-white border-white/30 text-[10px]">
          {layout}
        </Badge>
      </div>
    </div>
  );
}

export function TimelinePreview({ projectId }: { projectId: string }) {
  const getTimelineFn = useServerFn(getProjectTimeline);
  const getCanonicalFn = useServerFn(getCanonicalProject);

  const timelineQ = useQuery({
    queryKey: ["preview-timeline", projectId],
    queryFn: () => getTimelineFn({ data: { projectId } }),
  });
  const canonicalQ = useQuery({
    queryKey: ["preview-canonical", projectId],
    queryFn: () => getCanonicalFn({ data: { projectId } }),
  });

  const tracks: Track[] = timelineQ.data?.tracks ?? [];
  const items: Item[] = timelineQ.data?.items ?? [];
  const validation = timelineQ.data?.validation;
  const assets: Asset[] = (canonicalQ.data?.assets ?? []) as Asset[];
  const manifest: ManifestRow[] = (canonicalQ.data?.manifest ?? []) as ManifestRow[];
  const duration = Math.max(
    Number(timelineQ.data?.duration) || 0,
    items.reduce((m, it) => Math.max(m, Number(it.end_time) || 0), 0),
  );

  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const compiledGraphics: any[] = (canonicalQ.data as any)?.compiledGraphics ?? [];
  const compiledById = useMemo(() => new Map<string, any>(compiledGraphics.map((g) => [g.id, g])), [compiledGraphics]);
  const itemIssuesById = useMemo(() => {
    const m = new Map<string, { level: string; code: string; message: string }[]>();
    for (const iss of validation?.issues ?? []) {
      if (!iss.item_id) continue;
      const arr = m.get(iss.item_id) ?? [];
      arr.push(iss);
      m.set(iss.item_id, arr);
    }
    return m;
  }, [validation]);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showManifest, setShowManifest] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setTime((t) => {
        const nt = t + dt * speed;
        if (duration > 0 && nt >= duration) {
          setPlaying(false);
          return duration;
        }
        return nt;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, speed, duration]);

  const active = useMemo(
    () => items.filter((it) => Number(it.start_time) <= time + 0.001 && Number(it.end_time) >= time - 0.001),
    [items, time],
  );
  const activeManifest = useMemo(
    () => manifest.filter((r) => Number(r.timeline_start) <= time + 0.001 && Number(r.timeline_end) >= time - 0.001),
    [manifest, time],
  );
  const selected = selectedId ? items.find((i) => i.id === selectedId) ?? null : null;

  const errors = (validation?.issues ?? []).filter((i: any) => i.level === "error");
  const warnings = (validation?.issues ?? []).filter((i: any) => i.level === "warning");

  const qc = useQueryClient();
  const addCtaFn = useServerFn(addCtaToTimeline);

  if (timelineQ.isLoading || canonicalQ.isLoading) {
    return <Card><CardContent className="py-12 text-sm text-muted-foreground text-center">Loading preview…</CardContent></Card>;
  }
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-sm text-muted-foreground text-center">
          Timeline is empty. Compose the timeline first, then return here to preview.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Preview Player</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{items.length} items · {tracks.length} tracks</Badge>
            {errors.length > 0 && <Badge variant="destructive">{errors.length} errors</Badge>}
            {warnings.length > 0 && <Badge variant="outline" className="border-yellow-500 text-yellow-600">{warnings.length} warnings</Badge>}
            <Button size="sm" variant={showManifest ? "default" : "outline"} onClick={() => setShowManifest((v) => !v)}>
              <Bug className="h-3.5 w-3.5 mr-1" /> Manifest
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Stage active={active} trackById={trackById} assetById={assetById} compiledById={compiledById} onSelect={(it) => setSelectedId(it.id)} />

          {/* Transport */}
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" onClick={() => { setPlaying(false); setTime(0); }}>
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button size="icon" onClick={() => setPlaying((p) => !p)} disabled={duration <= 0}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <div className="text-xs tabular-nums w-24">{fmt(time)} / {fmt(duration)}</div>
            <div className="flex-1">
              <Slider
                min={0}
                max={Math.max(duration, 0.01)}
                step={0.05}
                value={[Math.min(time, duration || 0)]}
                onValueChange={(v) => setTime(v[0] ?? 0)}
              />
            </div>
            <select
              className="text-xs border border-border bg-background rounded px-1.5 py-1"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[0.25, 0.5, 1, 1.5, 2, 4].map((s) => (
                <option key={s} value={s}>{s}×</option>
              ))}
            </select>
          </div>

          {/* Track strip */}
          <div className="space-y-1">
            {tracks.map((tr) => {
              const trItems = items.filter((it) => it.track_id === tr.id);
              return (
                <div key={tr.id} className="flex items-center gap-2">
                  <div className="w-32 shrink-0 text-[11px] font-medium truncate" style={{ color: TRACK_COLORS[tr.kind] ?? "#888" }}>
                    {tr.name}
                  </div>
                  <div className="relative flex-1 h-6 bg-muted/40 rounded">
                    {trItems.map((it) => {
                      const left = duration > 0 ? (Number(it.start_time) / duration) * 100 : 0;
                      const width = duration > 0 ? Math.max(0.4, ((Number(it.end_time) - Number(it.start_time)) / duration) * 100) : 0;
                      const isActive = active.some((a) => a.id === it.id);
                      const hasIssue = (itemIssuesById.get(it.id) ?? []).length > 0 || it.status === "missing_asset";
                      return (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => setSelectedId(it.id)}
                          title={`${it.title ?? it.asset_type} (${Number(it.start_time).toFixed(1)}–${Number(it.end_time).toFixed(1)}s)`}
                          className={`absolute top-0 bottom-0 rounded text-[10px] text-white truncate px-1 text-left ${isActive ? "ring-2 ring-white" : ""} ${hasIssue ? "outline outline-1 outline-red-500" : ""}`}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            background: TRACK_COLORS[tr.kind] ?? "#666",
                            opacity: isActive ? 1 : 0.7,
                          }}
                        >
                          {it.title ?? it.asset_type}
                        </button>
                      );
                    })}
                    {/* playhead */}
                    {duration > 0 && (
                      <div
                        className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-white shadow"
                        style={{ left: `${(time / duration) * 100}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-sm">Inspector</CardTitle></CardHeader>
          <CardContent>
            {!selected ? (
              <p className="text-xs text-muted-foreground">Click a timeline item or stage element to inspect.</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-muted-foreground">Title</div><div className="font-medium">{selected.title || "—"}</div>
                <div className="text-muted-foreground">Track</div><div>{trackById.get(selected.track_id)?.name ?? "—"}</div>
                <div className="text-muted-foreground">Asset Type</div><div>{selected.asset_type}</div>
                <div className="text-muted-foreground">Timing</div><div>{Number(selected.start_time).toFixed(2)}s → {Number(selected.end_time).toFixed(2)}s ({Number(selected.duration).toFixed(2)}s)</div>
                <div className="text-muted-foreground">Layout</div><div>{selected.layout ?? "—"}</div>
                <div className="text-muted-foreground">Status</div><div><Badge variant={selected.status === "approved" ? "outline" : selected.status === "missing_asset" ? "destructive" : "secondary"}>{selected.status}</Badge></div>
                <div className="text-muted-foreground">Asset ID</div><div className="font-mono truncate">{selected.asset_id ?? "—"}</div>
                <div className="text-muted-foreground">Source Action</div><div className="font-mono truncate">{selected.edit_action_id ?? "—"}</div>
                <div className="text-muted-foreground">Source Task</div><div>{selected.source_task ?? "—"}</div>
                {Array.isArray(itemIssuesById.get(selected.id)) && (
                  <div className="col-span-2 mt-2 space-y-1">
                    {(itemIssuesById.get(selected.id) ?? []).map((iss, i) => (
                      <div key={i} className={`text-[11px] px-2 py-1 rounded ${iss.level === "error" ? "bg-destructive/10 text-destructive" : "bg-yellow-500/10 text-yellow-700"}`}>
                        [{iss.code}] {iss.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Validation</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-xs max-h-72 overflow-auto">
            {errors.length === 0 && warnings.length === 0 ? (
              <p className="text-muted-foreground">No issues.</p>
            ) : (
              <>
                {errors.map((iss: any, i: number) => (
                  <div key={`e${i}`} className="px-2 py-1 rounded bg-destructive/10 text-destructive">
                    <span className="font-semibold">[{iss.code}]</span> {iss.message}
                  </div>
                ))}
                {warnings.map((iss: any, i: number) => (
                  <ValidationRow
                    key={`w${i}`}
                    iss={iss}
                    projectId={projectId}
                    onFixed={() => {
                      qc.invalidateQueries({ queryKey: ["preview-timeline", projectId] });
                      qc.invalidateQueries({ queryKey: ["preview-canonical", projectId] });
                      qc.invalidateQueries({ queryKey: ["readiness", projectId] });
                    }}
                    addCta={async (text) => {
                      await addCtaFn({ data: { projectId, text } });
                    }}
                  />
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {showManifest && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Active Manifest Entries (debug)</CardTitle></CardHeader>
          <CardContent>
            {activeManifest.length === 0 ? (
              <p className="text-xs text-muted-foreground">No active manifest rows at {fmt(time)}.</p>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="pr-2">#</th>
                      <th className="pr-2">Layer</th>
                      <th className="pr-2">Type</th>
                      <th className="pr-2">Layout</th>
                      <th className="pr-2">Time</th>
                      <th className="pr-2">Source</th>
                      <th className="pr-2">Asset</th>
                      <th className="pr-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeManifest.map((r: any) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="pr-2">{r.render_order}</td>
                        <td className="pr-2">{r.layer ?? "—"}</td>
                        <td className="pr-2">{r.asset_type}</td>
                        <td className="pr-2">{r.layout_name ?? "—"}</td>
                        <td className="pr-2 tabular-nums">{Number(r.timeline_start).toFixed(1)}–{Number(r.timeline_end).toFixed(1)}</td>
                        <td className="pr-2">{r.asset_source}</td>
                        <td className="pr-2 font-mono truncate max-w-[120px]">{r.asset_id ?? "—"}</td>
                        <td className="pr-2">{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default TimelinePreview;
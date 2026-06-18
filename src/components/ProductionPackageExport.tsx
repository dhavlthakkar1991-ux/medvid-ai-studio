import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { zipSync, strToU8 } from "fflate";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { getProductionPackage } from "@/lib/exports.functions";
import { previewRenderSpec } from "@/lib/render-providers.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Download, FileJson, FileSpreadsheet, FileText, Package, Wrench } from "lucide-react";
import { toast } from "sonner";

type Pkg = Awaited<ReturnType<typeof getProductionPackage>>;

function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

function safeTitle(t: string | null | undefined) {
  return (t || "project").replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60);
}

function fmt(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

/** Build the editorial-report PDF and return its bytes. */
function buildSummaryPdf(pkg: Pkg): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  let y = margin;

  const title = pkg.project.title || "Untitled project";
  doc.setFont("helvetica", "bold"); doc.setFontSize(20);
  doc.text(`${title}`, margin, y); y += 24;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`OncoVideo AI Studio — Production Package`, margin, y); y += 14;
  doc.text(`Generated: ${new Date(pkg.generatedAt).toLocaleString()}`, margin, y); y += 18;
  doc.setTextColor(0);

  // Project summary block
  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("Project summary", margin, y); y += 16;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  const ctxRow = pkg.jsonFiles["project_context.json"] as any;
  const summaryRows: [string, string][] = [
    ["Topic", pkg.project.topic ?? "—"],
    ["Duration", `${fmt(pkg.project.duration_seconds, 1)} s`],
    ["Audience", ctxRow?.audience ?? "—"],
    ["Specialty", ctxRow?.specialty ?? "—"],
    ["Brand voice", ctxRow?.brand_voice ?? "—"],
    ["Platform", ctxRow?.target_platform ?? "—"],
  ];
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin },
    head: [["Field", "Value"]], body: summaryRows,
    theme: "grid", styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
  });
  // @ts-expect-error jspdf-autotable adds lastAutoTable at runtime
  y = (doc.lastAutoTable?.finalY ?? y) + 18;

  // Key messages (from scene_plan or seo)
  const seo = pkg.jsonFiles["seo_package.json"] as any;
  const keyMessages: string[] = [];
  if (seo?.key_messages) for (const m of seo.key_messages) keyMessages.push(String(m));
  if (seo?.tags) keyMessages.push(`Tags: ${(seo.tags as any[]).slice(0, 8).join(", ")}`);
  if (keyMessages.length === 0) keyMessages.push("(No SEO key messages generated yet.)");

  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("Key messages", margin, y); y += 14;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  for (const m of keyMessages.slice(0, 10)) {
    const lines = doc.splitTextToSize(`• ${m}`, 612 - margin * 2);
    doc.text(lines, margin, y); y += lines.length * 12;
    if (y > 740) { doc.addPage(); y = margin; }
  }
  y += 8;

  // Scene breakdown
  const scenes = (pkg.jsonFiles["scene_plan.json"] as any[]) ?? [];
  if (scenes.length > 0) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text("Scene breakdown", margin, y); y += 6;
    autoTable(doc, {
      startY: y + 8, margin: { left: margin, right: margin },
      head: [["#", "Title", "Start", "End", "Purpose"]],
      body: scenes.slice(0, 60).map((s: any, i: number) => [
        s.scene_number ?? i + 1,
        s.title ?? s.name ?? "—",
        fmt(s.start_time ?? s.start, 1),
        fmt(s.end_time ?? s.end, 1),
        s.purpose ?? s.summary ?? "",
      ]),
      theme: "striped", styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      columnStyles: { 0: { cellWidth: 24 }, 2: { cellWidth: 40 }, 3: { cellWidth: 40 } },
    });
    // @ts-expect-error see above
    y = (doc.lastAutoTable?.finalY ?? y) + 18;
  }

  // Timeline (Manifest V6 rows)
  const manifestRows = ((pkg.jsonFiles["manifest_v6.json"] as any)?.rows ?? []) as any[];
  if (manifestRows.length > 0) {
    if (y > 680) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text("Timeline (Manifest V6)", margin, y); y += 6;
    autoTable(doc, {
      startY: y + 8, margin: { left: margin, right: margin },
      head: [["#", "Start", "End", "Asset type", "Source", "Status"]],
      body: manifestRows.slice(0, 200).map((r: any) => [
        r.render_order, fmt(r.timeline_start, 2), fmt(r.timeline_end, 2),
        r.asset_type ?? "—", r.asset_source ?? "—", r.status ?? "—",
      ]),
      theme: "grid", styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    });
    // @ts-expect-error see above
    y = (doc.lastAutoTable?.finalY ?? y) + 18;
  }

  // Visual + Asset plans
  const storyboard = (pkg.jsonFiles["storyboard.json"] as any[]) ?? [];
  const broll = (pkg.jsonFiles["broll.json"] as any[]) ?? [];
  const infographics = (pkg.jsonFiles["infographics.json"] as any[]) ?? [];
  if (storyboard.length > 0 || broll.length > 0 || infographics.length > 0) {
    if (y > 680) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text("Visual & asset plan", margin, y); y += 6;
    autoTable(doc, {
      startY: y + 8, margin: { left: margin, right: margin },
      head: [["Kind", "Items", "Sample"]],
      body: [
        ["Storyboard shots", String(storyboard.length), storyboard.slice(0, 1).map((s: any) => s.description ?? s.title ?? "").join("")],
        ["B-roll", String(broll.length), broll.slice(0, 1).map((b: any) => b.description ?? b.search_query ?? "").join("")],
        ["Infographics", String(infographics.length), infographics.slice(0, 1).map((i: any) => i.title ?? i.description ?? "").join("")],
      ],
      theme: "grid", styles: { fontSize: 9, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    });
    // @ts-expect-error see above
    y = (doc.lastAutoTable?.finalY ?? y) + 18;
  }

  // SEO Package summary
  if (seo) {
    if (y > 680) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text("SEO package", margin, y); y += 14;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const seoFields: [string, string][] = [
      ["Title", String(seo.title ?? seo.youtube_title ?? "—")],
      ["Description", String(seo.description ?? "").slice(0, 600)],
      ["Tags", Array.isArray(seo.tags) ? seo.tags.slice(0, 20).join(", ") : "—"],
    ];
    for (const [k, v] of seoFields) {
      doc.setFont("helvetica", "bold"); doc.text(`${k}:`, margin, y);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(v || "—", 612 - margin * 2 - 60);
      doc.text(lines, margin + 60, y);
      y += Math.max(14, lines.length * 12) + 4;
      if (y > 740) { doc.addPage(); y = margin; }
    }
  }

  return new Uint8Array(doc.output("arraybuffer"));
}

function buildTimelinePdf(pkg: Pkg): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const rows = ((pkg.jsonFiles["manifest_v6.json"] as any)?.rows ?? []) as any[];
  doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text(`Timeline — ${pkg.project.title || "Untitled"}`, 36, 40);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`${rows.length} items · generated ${new Date(pkg.generatedAt).toLocaleString()}`, 36, 56);
  autoTable(doc, {
    startY: 72, margin: { left: 36, right: 36 },
    head: [["#", "Start", "End", "Duration", "Asset type", "Source", "Transition", "Status"]],
    body: rows.map((r: any) => {
      const dur = Math.max(0, Number(r.timeline_end ?? 0) - Number(r.timeline_start ?? 0));
      return [
        r.render_order, fmt(r.timeline_start, 2), fmt(r.timeline_end, 2), fmt(dur, 2),
        r.asset_type ?? "—", r.asset_source ?? "—", r.transition ?? "cut", r.status ?? "—",
      ];
    }),
    theme: "grid", styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

export function ProductionPackageExport({ projectId }: { projectId: string }) {
  const pkgFn = useServerFn(getProductionPackage);
  const specFn = useServerFn(previewRenderSpec);
  const [busy, setBusy] = useState<string | null>(null);

  async function fetchPkg(): Promise<Pkg> {
    return await pkgFn({ data: { projectId } });
  }

  async function downloadAll() {
    setBusy("package");
    try {
      const pkg = await fetchPkg();
      const title = safeTitle(pkg.project.title);
      const files: Record<string, Uint8Array> = {};
      for (const [name, value] of Object.entries(pkg.jsonFiles)) {
        files[name] = strToU8(JSON.stringify(value, null, 2));
      }
      if (pkg.srt) files["captions.srt"] = strToU8(pkg.srt);
      files["timeline.csv"] = strToU8(pkg.timelineCsv);
      files["project_summary.pdf"] = buildSummaryPdf(pkg);
      files["timeline.pdf"] = buildTimelinePdf(pkg);
      const zipped = zipSync(files, { level: 6 });
      saveBlob(`${title}_production_package.zip`,
        new Blob([new Uint8Array(zipped)], { type: "application/zip" }));
      toast.success("Production package downloaded.");
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally { setBusy(null); }
  }

  async function downloadTimeline(kind: "json" | "csv" | "pdf") {
    setBusy(`timeline-${kind}`);
    try {
      const pkg = await fetchPkg();
      const title = safeTitle(pkg.project.title);
      if (kind === "json") {
        saveBlob(`${title}_timeline.json`,
          new Blob([JSON.stringify(pkg.jsonFiles["timeline.json"], null, 2)], { type: "application/json" }));
      } else if (kind === "csv") {
        saveBlob(`${title}_timeline.csv`, new Blob([pkg.timelineCsv], { type: "text/csv" }));
      } else {
        const pdf = buildTimelinePdf(pkg);
        saveBlob(`${title}_timeline.pdf`, new Blob([new Uint8Array(pdf)], { type: "application/pdf" }));
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally { setBusy(null); }
  }

  async function downloadSummaryPdf() {
    setBusy("summary");
    try {
      const pkg = await fetchPkg();
      const title = safeTitle(pkg.project.title);
      const pdf = buildSummaryPdf(pkg);
      saveBlob(`${title}_editorial_report.pdf`,
        new Blob([new Uint8Array(pdf)], { type: "application/pdf" }));
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally { setBusy(null); }
  }

  async function downloadRenderDebugPackage() {
    setBusy("debug");
    try {
      const [pkg, specRes] = await Promise.all([
        fetchPkg(),
        specFn({ data: { projectId, quality: "full" as const } }),
      ]);
      const title = safeTitle(pkg.project.title);
      const files: Record<string, Uint8Array> = {
        "renderspec.json": strToU8(JSON.stringify(JSON.parse(specRes.specJson), null, 2)),
        "manifest_v6.json": strToU8(JSON.stringify(pkg.jsonFiles["manifest_v6.json"], null, 2)),
        "timeline.json": strToU8(JSON.stringify(pkg.jsonFiles["timeline.json"], null, 2)),
        "assets.json": strToU8(JSON.stringify(pkg.jsonFiles["assets.json"], null, 2)),
        "compiled_graphics.json": strToU8(JSON.stringify(pkg.jsonFiles["compiled_graphics.json"], null, 2)),
        "README.txt": strToU8(
          [
            "OncoVideo Render Debug Package",
            `Generated: ${new Date(pkg.generatedAt).toLocaleString()}`,
            `Project: ${pkg.project.title ?? pkg.project.id}`,
            "",
            "Contents:",
            " - renderspec.json        Canonical RenderSpec v1 (provider-agnostic)",
            " - manifest_v6.json       Manifest V6 rows (editorial source of truth)",
            " - timeline.json          Composed timeline tracks + items",
            " - assets.json            All project assets",
            " - compiled_graphics.json Compiled overlay/lower-third graphics",
            " - captions.srt           Burned-caption source",
            "",
            "Hand directly to an external render worker (FFmpeg / Node / Docker).",
          ].join("\n"),
        ),
      };
      if (pkg.srt) files["captions.srt"] = strToU8(pkg.srt);
      const zipped = zipSync(files, { level: 6 });
      saveBlob(`${title}_render_debug_package.zip`,
        new Blob([new Uint8Array(zipped)], { type: "application/zip" }));
      toast.success("Render debug package downloaded.");
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" /> Client handoff
          </CardTitle>
          <CardDescription>
            Download every editorial artifact — transcript, scene plan, storyboard, b-roll, infographics,
            editorial &amp; layout decisions, timeline, Manifest V6, SEO, shorts, captions, and a printable
            editorial report — as a single ZIP. No render required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={downloadAll} disabled={busy !== null}>
            <Download className="h-4 w-4 mr-2" />
            {busy === "package" ? "Building package…" : "Download production package (ZIP)"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Individual exports</CardTitle>
          <CardDescription>Grab a single artifact for a specific handoff.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => downloadTimeline("json")}>
            <FileJson className="h-4 w-4 mr-1.5" /> Timeline JSON
          </Button>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => downloadTimeline("csv")}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Timeline CSV
          </Button>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => downloadTimeline("pdf")}>
            <FileText className="h-4 w-4 mr-1.5" /> Timeline PDF
          </Button>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={downloadSummaryPdf}>
            <FileText className="h-4 w-4 mr-1.5" /> Editorial report PDF
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4" /> Render debug package
          </CardTitle>
          <CardDescription>
            Slim ZIP containing RenderSpec + Manifest V6 + timeline + assets + compiled graphics + captions —
            everything an external FFmpeg / Node / Docker render worker needs to reproduce the render.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" disabled={busy !== null} onClick={downloadRenderDebugPackage}>
            <Download className="h-4 w-4 mr-2" />
            {busy === "debug" ? "Building debug package…" : "Download render debug package"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
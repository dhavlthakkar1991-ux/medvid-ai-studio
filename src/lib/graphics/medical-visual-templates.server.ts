export type MedicalTemplateKind =
  | "risk_factor"
  | "comparison"
  | "symptom"
  | "workflow"
  | "timeline"
  | "statistic"
  | "warning_sign"
  | "cta"
  | "anatomy"
  | "list";

export type MedicalTemplateInput = {
  actionType?: string | null;
  assetType?: string | null;
  query?: string | null;
  title: string;
  subtitle?: string | null;
  bullets?: string[];
  width?: number;
  height?: number;
  transparent?: boolean;
};

const W = 1920;
const H = 1080;

export const ORAL_CANCER_VISUAL_PACK = [
  "oral_cavity_overview",
  "tongue",
  "inner_cheek_buccal_mucosa",
  "floor_of_mouth",
  "white_patch_leukoplakia",
  "red_patch_erythroplakia",
  "non_healing_ulcer",
  "neck_lymph_nodes",
  "enlarged_cervical_node",
  "oral_examination",
  "biopsy_workflow",
  "early_vs_late_diagnosis_comparison",
] as const;

function esc(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function wrapMedicalText(value: string, max = 34, maxLines = 3): string[] {
  const words = clean(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(" ").length > lines.join(" ").length && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\.\.\.$/, "")}...`;
  }
  return lines;
}

function textLines(lines: string[], x: number, y: number, size: number, opts: { fill?: string; weight?: number; anchor?: string; gap?: number } = {}) {
  const gap = opts.gap ?? Math.round(size * 1.24);
  return lines
    .map((line, i) => `<text x="${x}" y="${y + i * gap}" ${opts.anchor ? `text-anchor="${opts.anchor}"` : ""} fill="${opts.fill ?? "#f8fafc"}" font-size="${size}" font-weight="${opts.weight ?? 650}">${esc(line)}</text>`)
    .join("");
}

export function inferMedicalTemplateKind(input: Pick<MedicalTemplateInput, "actionType" | "assetType" | "query" | "title">): MedicalTemplateKind {
  const value = `${input.actionType ?? ""} ${input.assetType ?? ""} ${input.query ?? ""} ${input.title ?? ""}`.toLowerCase();
  if (value.includes("cta") || value.includes("share") || value.includes("subscribe")) return "cta";
  if (value.includes("stat") || /(?:\d+%|\d+\s*x|\d+\s+in\s+\d+)/.test(value)) return "statistic";
  if (value.includes("risk") || value.includes("tobacco") || value.includes("alcohol") || value.includes("hpv")) return "risk_factor";
  if (value.includes("warning") || value.includes("symptom") || value.includes("ulcer") || value.includes("red patch") || value.includes("white patch")) return "warning_sign";
  if (value.includes("compare") || value.includes("versus") || value.includes(" vs ") || value.includes("normal")) return "comparison";
  if (value.includes("timeline") || value.includes("stage")) return "timeline";
  if (value.includes("workflow") || value.includes("step") || value.includes("biopsy") || value.includes("exam") || value.includes("diagnos")) return "workflow";
  if (value.includes("anatom") || value.includes("mouth") || value.includes("tongue") || value.includes("neck") || value.includes("node")) return "anatomy";
  if (value.includes("sign")) return "symptom";
  return "list";
}

function oralCavity(x: number, y: number, w: number, h: number) {
  const cx = x + w / 2;
  return [
    `<ellipse cx="${cx}" cy="${y + h * 0.48}" rx="${w * 0.36}" ry="${h * 0.42}" fill="#f8b4b4" stroke="#7f1d1d" stroke-width="8"/>`,
    `<path d="M ${x + w * 0.28} ${y + h * 0.42} Q ${cx} ${y + h * 0.2} ${x + w * 0.72} ${y + h * 0.42}" fill="none" stroke="#fff7ed" stroke-width="24" stroke-linecap="round"/>`,
    `<path d="M ${x + w * 0.34} ${y + h * 0.68} Q ${cx} ${y + h * 0.86} ${x + w * 0.66} ${y + h * 0.68}" fill="#fb7185" stroke="#be123c" stroke-width="6"/>`,
    `<circle cx="${x + w * 0.66}" cy="${y + h * 0.43}" r="${w * 0.055}" fill="#ef4444" stroke="#fff1f2" stroke-width="6"/>`,
    `<text x="${x + w * 0.72}" y="${y + h * 0.4}" fill="#fecaca" font-size="26" font-weight="800">lesion check</text>`,
  ].join("");
}

function neckNodes(x: number, y: number, w: number, h: number) {
  const cx = x + w / 2;
  const nodes = [0.2, 0.32, 0.46, 0.6].map((p, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    return `<circle cx="${cx + side * w * 0.18}" cy="${y + h * p}" r="${w * 0.045}" fill="#38bdf8" stroke="#e0f2fe" stroke-width="5"/>`;
  }).join("");
  return [
    `<path d="M ${cx - w * 0.18} ${y + h * 0.1} Q ${cx} ${y + h * 0.02} ${cx + w * 0.18} ${y + h * 0.1} L ${cx + w * 0.26} ${y + h * 0.78} Q ${cx} ${y + h * 0.94} ${cx - w * 0.26} ${y + h * 0.78} Z" fill="#172554" stroke="#60a5fa" stroke-width="7"/>`,
    `<path d="M ${cx} ${y + h * 0.16} L ${cx} ${y + h * 0.78}" stroke="#93c5fd" stroke-width="10" stroke-linecap="round"/>`,
    nodes,
  ].join("");
}

function riskIcon(x: number, y: number, label: string, accent: string) {
  return [
    `<rect x="${x}" y="${y}" rx="24" width="230" height="170" fill="#111827" stroke="${accent}" stroke-width="5"/>`,
    `<circle cx="${x + 70}" cy="${y + 66}" r="34" fill="${accent}" opacity="0.95"/>`,
    `<path d="M ${x + 132} ${y + 54} h54 M ${x + 132} ${y + 82} h72" stroke="#f8fafc" stroke-width="12" stroke-linecap="round"/>`,
    textLines(wrapMedicalText(label, 14, 2), x + 28, y + 128, 24, { fill: "#f8fafc", weight: 750 }),
  ].join("");
}

function workflowSteps(items: string[], x: number, y: number, w: number, accent: string) {
  const cols = Math.max(1, Math.min(4, items.length || 3));
  const stepW = Math.floor(w / cols);
  return items.slice(0, cols).map((item, i) => {
    const sx = x + i * stepW;
    return [
      `<circle cx="${sx + 58}" cy="${y + 48}" r="44" fill="${accent}" opacity="0.95"/>`,
      `<text x="${sx + 58}" y="${y + 62}" text-anchor="middle" fill="#082f49" font-size="38" font-weight="900">${i + 1}</text>`,
      i < cols - 1 ? `<path d="M ${sx + 110} ${y + 48} H ${sx + stepW - 30}" stroke="#67e8f9" stroke-width="7" stroke-linecap="round"/>` : "",
      textLines(wrapMedicalText(item, 18, 3), sx + 12, y + 132, 25, { fill: "#e0f2fe", weight: 700 }),
    ].join("");
  }).join("");
}

function statNumber(text: string): string {
  return clean(text).match(/(?:\d+(?:\.\d+)?\s*%|\d+\s*x|\d+\s+in\s+\d+|\d+)/i)?.[0] ?? "";
}

export function renderMedicalVisualSvg(input: MedicalTemplateInput): { svg: string; templateKind: MedicalTemplateKind; qualityGrade: "A" | "A-" } {
  const width = input.width ?? W;
  const height = input.height ?? H;
  const kind = inferMedicalTemplateKind(input);
  const title = clean(input.title) || "Medical visual";
  const subtitle = clean(input.subtitle);
  const bullets = (input.bullets ?? []).map(clean).filter(Boolean).slice(0, 5);
  const accent =
    kind === "cta" ? "#ec4899" :
    kind === "risk_factor" ? "#f97316" :
    kind === "warning_sign" || kind === "symptom" ? "#facc15" :
    kind === "workflow" || kind === "timeline" ? "#22c55e" :
    kind === "statistic" ? "#a78bfa" :
    "#38bdf8";
  const bg = input.transparent ? `<rect width="${width}" height="${height}" fill="rgba(0,0,0,0)"/>` : `<rect width="${width}" height="${height}" fill="#07111f"/>`;
  const shell = [
    bg,
    `<rect x="84" y="82" rx="34" width="${width - 168}" height="${height - 164}" fill="#0f172a" stroke="#164e63" stroke-width="6" opacity="0.96"/>`,
    `<rect x="132" y="132" rx="12" width="132" height="16" fill="${accent}"/>`,
    `<text x="${width - 140}" y="${height - 122}" text-anchor="end" fill="#67e8f9" font-size="23" font-weight="700">MedVideo AI</text>`,
  ].join("");
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Inter, Arial, sans-serif">`;
  const tail = `</svg>`;

  let body = "";
  if (kind === "risk_factor") {
    body = [
      textLines(wrapMedicalText(title, 23, 2), 132, 250, 60, { fill: "#fff7ed", weight: 900, gap: 72 }),
      riskIcon(142, 440, bullets[0] || "Tobacco exposure", accent),
      riskIcon(420, 440, bullets[1] || "Alcohol use", "#fb7185"),
      riskIcon(698, 440, bullets[2] || "HPV risk", "#38bdf8"),
      `<path d="M 990 525 H 1160" stroke="#f97316" stroke-width="16" stroke-linecap="round"/>`,
      `<path d="M 1130 480 L 1210 525 L 1130 570" fill="none" stroke="#f97316" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`,
      oralCavity(1220, 300, 470, 430),
      textLines(wrapMedicalText(subtitle || "Risk factors increase the need for early checks", 38, 2), 1230, 810, 34, { fill: "#fed7aa", weight: 750 }),
    ].join("");
  } else if (kind === "workflow" || kind === "timeline") {
    const steps = bullets.length ? bullets : ["Screen mouth", "Document lesion", "Refer or biopsy", "Follow up"];
    body = [
      textLines(wrapMedicalText(title, 28, 2), 132, 250, 58, { fill: "#f0fdf4", weight: 900, gap: 70 }),
      workflowSteps(steps, 170, 410, 1540, accent),
      kind === "workflow" ? oralCavity(1180, 690, 360, 260) : neckNodes(1180, 650, 360, 300),
    ].join("");
  } else if (kind === "comparison") {
    body = [
      textLines(wrapMedicalText(title, 30, 2), 132, 230, 54, { fill: "#eff6ff", weight: 900, gap: 66 }),
      `<rect x="140" y="355" rx="28" width="760" height="500" fill="#111827" stroke="#22c55e" stroke-width="6"/>`,
      `<rect x="1020" y="355" rx="28" width="760" height="500" fill="#111827" stroke="#f97316" stroke-width="6"/>`,
      `<text x="520" y="430" text-anchor="middle" fill="#bbf7d0" font-size="42" font-weight="900">Earlier</text>`,
      `<text x="1400" y="430" text-anchor="middle" fill="#fed7aa" font-size="42" font-weight="900">Later</text>`,
      oralCavity(300, 475, 420, 300),
      neckNodes(1180, 455, 420, 350),
      ...bullets.slice(0, 4).map((b, i) => textLines(wrapMedicalText(b, 28, 1), i < 2 ? 210 : 1090, 790 + (i % 2) * 42, 28, { fill: i < 2 ? "#dcfce7" : "#ffedd5", weight: 650 })),
    ].join("");
  } else if (kind === "statistic") {
    const stat = statNumber(`${title} ${subtitle} ${bullets.join(" ")}`);
    body = [
      `<circle cx="520" cy="545" r="275" fill="#1e1b4b" stroke="${accent}" stroke-width="14"/>`,
      `<text x="520" y="560" text-anchor="middle" fill="#f5f3ff" font-size="${stat.length > 5 ? 96 : 150}" font-weight="950">${esc(stat || "Key")}</text>`,
      textLines(wrapMedicalText(title.replace(stat, "").trim() || "Clinical statistic", 26, 2), 980, 300, 64, { fill: "#f5f3ff", weight: 900, gap: 76 }),
      textLines(wrapMedicalText(subtitle || bullets[0] || "Use this number to guide patient awareness", 38, 3), 990, 500, 38, { fill: "#ddd6fe", weight: 650, gap: 48 }),
      ...bullets.slice(1, 4).map((b, i) => textLines(wrapMedicalText(b, 34, 1), 1025, 690 + i * 58, 30, { fill: "#e0f2fe", weight: 700 })),
    ].join("");
  } else if (kind === "warning_sign" || kind === "symptom") {
    const signs = bullets.length ? bullets : [title, "Persistent ulcer", "Red or white patch", "Neck swelling"];
    body = [
      `<path d="M 520 245 L 830 805 H 210 Z" fill="#422006" stroke="${accent}" stroke-width="14" stroke-linejoin="round"/>`,
      `<text x="520" y="650" text-anchor="middle" fill="${accent}" font-size="170" font-weight="950">!</text>`,
      textLines(wrapMedicalText(title, 30, 2), 960, 240, 58, { fill: "#fefce8", weight: 900, gap: 70 }),
      ...signs.slice(0, 4).map((b, i) => [
        `<circle cx="990" cy="${420 + i * 105}" r="28" fill="${accent}"/>`,
        textLines(wrapMedicalText(b, 38, 2), 1040, 432 + i * 105, 31, { fill: "#fef9c3", weight: 700, gap: 38 }),
      ].join("")),
    ].join("");
  } else if (kind === "cta") {
    body = [
      `<rect x="250" y="250" rx="42" width="1420" height="520" fill="#111827" stroke="${accent}" stroke-width="10"/>`,
      `<circle cx="455" cy="510" r="112" fill="#831843" stroke="#f9a8d4" stroke-width="8"/>`,
      `<path d="M 414 472 L 520 512 L 414 552 Z" fill="#fdf2f8"/>`,
      textLines(wrapMedicalText(title, 28, 2), 650, 420, 72, { fill: "#fdf2f8", weight: 950, gap: 88 }),
      textLines(wrapMedicalText(subtitle || bullets[0] || "Share this with someone who should get checked", 42, 2), 650, 615, 36, { fill: "#fbcfe8", weight: 650, gap: 48 }),
    ].join("");
  } else {
    const facts = bullets.length ? bullets : [subtitle || title, "Check persistent changes", "Document and refer when needed"];
    body = [
      textLines(wrapMedicalText(title, 30, 2), 132, 245, 60, { fill: "#f8fafc", weight: 900, gap: 72 }),
      oralCavity(180, 410, 520, 380),
      neckNodes(690, 420, 330, 360),
      ...facts.slice(0, 4).map((b, i) => [
        `<rect x="1090" y="${350 + i * 118}" rx="22" width="620" height="88" fill="#111827" stroke="${accent}" stroke-width="4"/>`,
        textLines(wrapMedicalText(b, 35, 2), 1130, 405 + i * 118, 29, { fill: "#e0f2fe", weight: 700, gap: 34 }),
      ].join("")),
    ].join("");
  }

  return {
    svg: `${head}${shell}${body}${tail}`,
    templateKind: kind,
    qualityGrade: kind === "list" ? "A-" : "A",
  };
}

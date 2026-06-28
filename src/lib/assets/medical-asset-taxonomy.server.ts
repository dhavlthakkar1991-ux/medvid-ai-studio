export type MedicalAssetTaxonomy =
  | "CONTEXTUAL_BROLL"
  | "MEDICAL_ILLUSTRATION"
  | "CLINICAL_IMAGE"
  | "INFOGRAPHIC_CARD";

export type MedicalAssetSourceClass =
  | "stock_contextual"
  | "internal_svg_library"
  | "internal_template"
  | "manual_upload"
  | "manual_url"
  | "curated_library"
  | "placeholder";

export type MedicalAssetRouting = {
  taxonomy: MedicalAssetTaxonomy;
  allowedProviders: Array<"pexels" | "pixabay" | "manual_upload" | "manual_url" | "internal">;
  status: "stock_search_allowed" | "internal_template_available" | "needs_manual_upload" | "needs_curated_asset";
  reason: string;
};

const DISEASE_VISUAL_TERMS = [
  "oral ulcer",
  "non-healing ulcer",
  "non healing ulcer",
  "leukoplakia",
  "erythroplakia",
  "white patch",
  "red patch",
  "mouth lesion",
  "lesion diagram",
  "cervical lymph",
  "lymph node",
  "neck lump",
  "enlarged cervical node",
  "cervical node",
  "staging",
  "oral cavity anatomy",
  "oral cavity overview",
  "buccal mucosa",
  "inner cheek",
  "floor of mouth",
  "tongue",
  "tongue lesion",
  "biopsy",
  "oral examination",
  "screening workflow",
];

const CONTEXTUAL_TERMS = [
  "doctor consultation",
  "hospital",
  "corridor",
  "clinic",
  "exam room",
  "patient checking neck",
  "family",
  "share",
  "smoking",
  "tobacco",
  "alcohol",
  "awareness",
  "consultation",
];

const INFOGRAPHIC_TERMS = [
  "risk factor",
  "warning sign",
  "early detection",
  "diagnosis steps",
  "cta",
  "call to action",
  "statistic",
  "infographic",
  "lower third",
];

function textFor(args: { assetType?: unknown; query?: unknown; actionType?: unknown; title?: unknown; description?: unknown }) {
  return `${args.assetType ?? ""} ${args.query ?? ""} ${args.actionType ?? ""} ${args.title ?? ""} ${args.description ?? ""}`
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function hasAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

export function classifyMedicalAssetRequest(args: {
  assetType?: unknown;
  query?: unknown;
  actionType?: unknown;
  title?: unknown;
  description?: unknown;
}): MedicalAssetRouting {
  const value = textFor(args);
  const assetType = String(args.assetType ?? "").toLowerCase();
  const actionType = String(args.actionType ?? "").toLowerCase();

  if (
    assetType.includes("clinical") ||
    actionType.includes("show_clinical_image") ||
    /(?:real|photo|photograph|clinical)\s+(?:oral|mouth|ulcer|lesion|leukoplakia|erythroplakia)/.test(value)
  ) {
    return {
      taxonomy: "CLINICAL_IMAGE",
      allowedProviders: ["manual_upload", "manual_url"],
      status: "needs_curated_asset",
      reason: "Disease-specific clinical imagery must be manually curated or owned; generic stock search is blocked.",
    };
  }

  if (assetType.includes("infographic") || actionType.includes("infographic") || actionType.includes("cta") || hasAny(value, INFOGRAPHIC_TERMS)) {
    return {
      taxonomy: "INFOGRAPHIC_CARD",
      allowedProviders: ["internal", "manual_upload", "manual_url"],
      status: "internal_template_available",
      reason: "Educational infographic/card visuals may use internal medical templates or reviewed manual assets.",
    };
  }

  if (assetType.includes("diagram") || assetType.includes("illustration") || actionType.includes("medical_diagram") || hasAny(value, DISEASE_VISUAL_TERMS)) {
    return {
      taxonomy: "MEDICAL_ILLUSTRATION",
      allowedProviders: ["internal", "manual_upload", "manual_url"],
      status: "internal_template_available",
      reason: "Disease-specific teaching visuals use the internal medical illustration library or curated manual assets.",
    };
  }

  if (assetType.includes("broll") || assetType.includes("video") || actionType.includes("broll") || hasAny(value, CONTEXTUAL_TERMS)) {
    return {
      taxonomy: "CONTEXTUAL_BROLL",
      allowedProviders: ["pexels", "pixabay", "manual_upload", "manual_url"],
      status: "stock_search_allowed",
      reason: "Contextual lifestyle or clinical-environment b-roll may use stock providers.",
    };
  }

  return {
    taxonomy: "INFOGRAPHIC_CARD",
    allowedProviders: ["internal", "manual_upload", "manual_url"],
    status: "internal_template_available",
    reason: "Unclear medical education asset defaults to an internal infographic or reviewed manual asset instead of generic stock.",
  };
}

export function sourceClassForAsset(asset: any): MedicalAssetSourceClass {
  const metadata = asset?.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  const source = String(asset?.source ?? asset?.source_type ?? metadata.source ?? "").toLowerCase();
  if (!asset || !asset.url && !asset.preview_url && !asset.thumbnail_url && !metadata.source_url) return "placeholder";
  if (source.includes("manual_upload") || source === "upload") return "manual_upload";
  if (source.includes("manual_url") || source === "manual") return "manual_url";
  if (source.includes("curated")) return "curated_library";
  if (source.includes("internal") || source.includes("generated")) {
    const generator = String(metadata.attribution?.generator ?? metadata.generator ?? "").toLowerCase();
    return generator.includes("template") ? "internal_template" : "internal_svg_library";
  }
  if (source.includes("pexels") || source.includes("pixabay") || source.includes("unsplash")) return "stock_contextual";
  return "manual_url";
}

export function isSourceAllowedForTaxonomy(taxonomy: MedicalAssetTaxonomy, sourceClass: MedicalAssetSourceClass) {
  if (taxonomy === "CONTEXTUAL_BROLL") return ["stock_contextual", "manual_upload", "manual_url", "curated_library"].includes(sourceClass);
  if (taxonomy === "MEDICAL_ILLUSTRATION") return ["internal_svg_library", "internal_template", "manual_upload", "manual_url", "curated_library"].includes(sourceClass);
  if (taxonomy === "CLINICAL_IMAGE") return ["manual_upload", "manual_url", "curated_library"].includes(sourceClass);
  if (taxonomy === "INFOGRAPHIC_CARD") return ["internal_template", "internal_svg_library", "manual_upload", "manual_url", "curated_library"].includes(sourceClass);
  return false;
}

export function qualityForTaxonomy(taxonomy: MedicalAssetTaxonomy, sourceClass: MedicalAssetSourceClass) {
  if (taxonomy === "CLINICAL_IMAGE" && sourceClass === "curated_library") return { grade: "A+" as const, score: 100, reason: "Curated clinical image" };
  if (taxonomy === "CLINICAL_IMAGE" && (sourceClass === "manual_upload" || sourceClass === "manual_url")) return { grade: "A+" as const, score: 96, reason: "Manually supplied clinical image" };
  if (taxonomy === "INFOGRAPHIC_CARD" && sourceClass === "curated_library") return { grade: "A" as const, score: 94, reason: "Curated medical infographic" };
  if (taxonomy === "INFOGRAPHIC_CARD" && (sourceClass === "manual_upload" || sourceClass === "manual_url")) return { grade: "A" as const, score: 92, reason: "Manually supplied medical infographic" };
  if (taxonomy === "MEDICAL_ILLUSTRATION" && (sourceClass === "manual_upload" || sourceClass === "manual_url")) return { grade: "A" as const, score: 92, reason: "Manually supplied medical illustration" };
  if (taxonomy === "MEDICAL_ILLUSTRATION" && (sourceClass === "internal_svg_library" || sourceClass === "internal_template")) return { grade: "A" as const, score: 92, reason: "Internal medical illustration" };
  if (taxonomy === "INFOGRAPHIC_CARD" && (sourceClass === "internal_template" || sourceClass === "internal_svg_library")) return { grade: "A-" as const, score: 86, reason: "Rich medical infographic" };
  if (taxonomy === "CONTEXTUAL_BROLL" && sourceClass === "stock_contextual") return { grade: "B" as const, score: 74, reason: "Contextual stock b-roll" };
  if (taxonomy === "CONTEXTUAL_BROLL" && (sourceClass === "manual_upload" || sourceClass === "manual_url")) return { grade: "B" as const, score: 78, reason: "Manually supplied contextual media" };
  if (!isSourceAllowedForTaxonomy(taxonomy, sourceClass)) return { grade: "F" as const, score: 0, reason: "Wrong source type for medical taxonomy" };
  return { grade: "C" as const, score: 58, reason: "Renderable but weakly classified visual" };
}

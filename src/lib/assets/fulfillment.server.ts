import { renderMedicalVisualSvg } from "../graphics/medical-visual-templates.server";
import { classifyMedicalAssetRequest } from "./medical-asset-taxonomy.server";

type MediaKind = "video" | "image";

export type FulfillmentProviderName = "pexels" | "pixabay" | "unsplash" | "internal";

export type FulfillmentResult = {
  provider: FulfillmentProviderName;
  result_id: string;
  title: string;
  description: string | null;
  source_url: string;
  preview_url: string | null;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  attribution: Record<string, unknown>;
  license: Record<string, unknown>;
  taxonomy?: string;
  routing_status?: string;
};

export function configuredFulfillmentProviders(): FulfillmentProviderName[] {
  const providers: FulfillmentProviderName[] = [];
  if (process.env.PEXELS_API_KEY) providers.push("pexels");
  if (process.env.PIXABAY_API_KEY) providers.push("pixabay");
  if (process.env.UNSPLASH_ACCESS_KEY) providers.push("unsplash");
  providers.push("internal");
  return providers;
}

export function externalProviderStatus() {
  return {
    pexels: Boolean(process.env.PEXELS_API_KEY),
    pixabay: Boolean(process.env.PIXABAY_API_KEY),
    unsplash: Boolean(process.env.UNSPLASH_ACCESS_KEY),
  };
}

export function fulfillmentStatus() {
  const external = externalProviderStatus();
  const externalProviders = Object.entries(external)
    .filter(([, configured]) => configured)
    .map(([name]) => name);
  return {
    configured: externalProviders.length > 0,
    providers: configuredFulfillmentProviders(),
    external,
    message:
      externalProviders.length > 0
        ? `Configured: ${externalProviders.join(", ")}`
        : "No asset provider configured. Add Pexels/Pixabay key or upload assets manually.",
  };
}

function assetKindForType(assetType: string): MediaKind | null {
  const t = String(assetType ?? "").toLowerCase();
  if (t.includes("broll") || t.includes("video")) return "video";
  if (t.includes("image") || t.includes("diagram") || t.includes("infographic") || t.includes("thumbnail")) return "image";
  return null;
}

function isClinicalAsset(assetType: string) {
  const t = String(assetType ?? "").toLowerCase();
  return t.includes("clinical") || t.includes("medical_diagram") || t.includes("diagram");
}

function cleanText(value: unknown, fallback = "") {
  return String(value ?? fallback)
    .replace(/^animated\s+(?:map|text|list|equation)\s*(?:of|:)?\s*/i, "")
    .replace(/^simple\s+animated\s+equation\s*:\s*/i, "")
    .replace(/^anatomical\s+illustration\s+of\s+/i, "")
    .replace(/^clinical\s+photograph\s+of\s+/i, "")
    .replace(/^comparison\s+infographic\.?\s*/i, "")
    .replace(/^end\s+screen\s+with\s+/i, "")
    .replace(/\bIcon\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function quoted(value: string) {
  const out: string[] = [];
  const re = /['"]([^'"]{2,140})['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) out.push(cleanText(m[1]));
  return out;
}

function cardTypeFor(assetType: string, query: string, context?: Record<string, unknown>) {
  const value = `${assetType} ${query} ${context?.action_type ?? ""} ${context?.title ?? ""}`.toLowerCase();
  if (value.includes("cta") || value.includes("share this") || value.includes("call to action")) return "cta";
  if (value.includes("risk") || value.includes("tobacco") || value.includes("alcohol")) return "risk_factor";
  if (value.includes("warning") || value.includes("sign") || value.includes("symptom") || value.includes("ulcer")) return "warning_signs";
  if (value.includes("step") || value.includes("process") || value.includes("biopsy") || value.includes("diagnos")) return "steps";
  if (value.includes("comparison") || value.includes("versus") || value.includes(" vs ") || value.includes("early detection")) return "comparison";
  return "list";
}

function normalizeTitle(title: string, assetType: string, cardType: string) {
  let out = cleanText(title)
    .replace(/\bIcon\b/gi, "")
    .replace(/\s*\+\s*/g, " + ")
    .replace(/\s*=\s*/g, " = ")
    .replace(/\s+/g, " ")
    .replace(/['"]?N$/i, "")
    .trim();
  if (/clearly labeled/i.test(out) || out.length < 4) {
    out = "";
  }
  if (/^early detectio$/i.test(out)) return "Early Detection";
  if (assetType.toLowerCase().includes("diagram") && out.length <= 6) return "Clinical support diagram";
  if (!out && cardType === "risk_factor") return "Risk factors";
  if (!out && cardType === "warning_signs") return "Warning sign to check";
  if (!out && cardType === "steps") return "Diagnostic step";
  if (!out && cardType === "comparison") return "Early detection";
  if (!out && cardType === "cta") return "Share this information";
  if (!out && assetType.toLowerCase().includes("clinical")) return "Clinical warning sign";
  return out || "Medical visual";
}

function internalGraphicResult(assetType: string, query: string, context?: Record<string, unknown>): FulfillmentResult | null {
  const routing = classifyMedicalAssetRequest({
    assetType,
    query,
    actionType: context?.action_type,
    title: context?.title,
    description: context?.description,
  });
  const t = String(assetType ?? "").toLowerCase();
  if (
    !t.includes("infographic") &&
    !t.includes("diagram") &&
    !t.includes("overlay") &&
    !t.includes("cta") &&
    !t.includes("clinical") &&
    routing.taxonomy !== "MEDICAL_ILLUSTRATION" &&
    routing.taxonomy !== "INFOGRAPHIC_CARD"
  ) return null;
  const q = cleanText(query);
  const quotes = quoted(query);
  const contextTitle = cleanText(context?.title);
  const candidateTitle = /^(show_|generate_|create_)/i.test(contextTitle) ? "" : contextTitle;
  const cardType = cardTypeFor(assetType, query, context);
  const title = normalizeTitle(quotes[0] || candidateTitle || q.split(/[.;]/)[0] || "", assetType, cardType);
  const bullets =
    Array.isArray(context?.bullets)
      ? (context?.bullets as unknown[]).map((b) => cleanText(b)).filter(Boolean).slice(0, 5)
      : quotes.length > 1
        ? quotes.slice(1, 6)
        : cleanText(context?.description, "")
          .split(/[.;]/)
          .map((b) => cleanText(b))
          .filter((b) => b.length > 4)
          .slice(0, 5);
  const W = 1920;
  const H = 1080;
  const { svg, templateKind, qualityGrade } = renderMedicalVisualSvg({
    actionType: String(context?.action_type ?? ""),
    assetType,
    query,
    title: title || q || "Medical visual",
    subtitle: cleanText(context?.description, ""),
    bullets,
    width: W,
    height: H,
  });
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  return {
    provider: "internal",
    result_id: `internal:${Buffer.from(`${assetType}:${query}`).toString("base64url").slice(0, 24)}`,
    title: title || "Internal medical graphic",
    description: bullets.join("; ") || q || null,
    source_url: dataUrl,
    preview_url: dataUrl,
    thumbnail_url: dataUrl,
    width: W,
    height: H,
    duration_seconds: null,
    attribution: {
      provider: "internal",
      generator: "medvideo_medical_visual_template",
      card_type: cardType,
      template_kind: templateKind,
      quality_grade: qualityGrade,
      taxonomy: routing.taxonomy,
      routing_status: routing.status,
    },
    license: { type: "internal_generated", requires_review: false },
    taxonomy: routing.taxonomy,
    routing_status: routing.status,
  };
}

async function pexelsSearch(query: string, kind: MediaKind, perPage: number): Promise<FulfillmentResult[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const endpoint = kind === "video"
    ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`
    : `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const res = await fetch(endpoint, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels search failed: HTTP ${res.status}`);
  const json: any = await res.json();
  if (kind === "video") {
    return (json.videos ?? []).map((video: any) => {
      const file = video?.video_files?.find((f: any) => String(f.quality).includes("hd")) ?? video?.video_files?.[0];
      if (!file?.link) return null;
      return {
        provider: "pexels" as const,
        result_id: `pexels:video:${video.id}`,
        title: video.user?.name ? `Pexels video by ${video.user.name}` : `Pexels video ${video.id}`,
        description: null,
        source_url: file.link,
        preview_url: video.url ?? null,
        thumbnail_url: video.image ?? null,
        width: Number(file.width ?? video.width) || null,
        height: Number(file.height ?? video.height) || null,
        duration_seconds: Number(video.duration) || null,
        attribution: { provider: "pexels", id: video.id, author: video.user?.name, provider_url: video.url },
        license: { provider: "pexels", type: "pexels_license", provider_url: "https://www.pexels.com/license/" },
      };
    }).filter(Boolean) as FulfillmentResult[];
  }
  return (json.photos ?? []).map((photo: any) => ({
    provider: "pexels" as const,
    result_id: `pexels:photo:${photo.id}`,
    title: photo.alt || `Pexels photo by ${photo.photographer}`,
    description: photo.alt ?? null,
    source_url: photo.src?.large2x ?? photo.src?.large ?? photo.src?.original,
    preview_url: photo.src?.large ?? photo.src?.medium ?? null,
    thumbnail_url: photo.src?.medium ?? photo.src?.small ?? null,
    width: Number(photo.width) || null,
    height: Number(photo.height) || null,
    duration_seconds: null,
    attribution: { provider: "pexels", id: photo.id, author: photo.photographer, provider_url: photo.url },
    license: { provider: "pexels", type: "pexels_license", provider_url: "https://www.pexels.com/license/" },
  })).filter((r: FulfillmentResult) => r.source_url);
}

async function pixabaySearch(query: string, kind: MediaKind, perPage: number): Promise<FulfillmentResult[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const endpoint = kind === "video"
    ? `https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&per_page=${perPage}`
    : `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&per_page=${perPage}`;
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`Pixabay search failed: HTTP ${res.status}`);
  const json: any = await res.json();
  return (json.hits ?? []).map((hit: any) => {
    if (kind === "video") {
      const video = hit.videos?.large ?? hit.videos?.medium ?? hit.videos?.small;
      if (!video?.url) return null;
      return {
        provider: "pixabay" as const,
        result_id: `pixabay:video:${hit.id}`,
        title: hit.tags || `Pixabay video ${hit.id}`,
        description: hit.tags ?? null,
        source_url: video.url,
        preview_url: hit.pageURL ?? null,
        thumbnail_url: hit.picture_id ? `https://i.vimeocdn.com/video/${hit.picture_id}_640x360.jpg` : null,
        width: Number(video.width) || null,
        height: Number(video.height) || null,
        duration_seconds: Number(hit.duration) || null,
        attribution: { provider: "pixabay", id: hit.id, author: hit.user, provider_url: hit.pageURL },
        license: { provider: "pixabay", type: "pixabay_content_license", provider_url: "https://pixabay.com/service/license-summary/" },
      };
    }
    return {
      provider: "pixabay" as const,
      result_id: `pixabay:image:${hit.id}`,
      title: hit.tags || `Pixabay image ${hit.id}`,
      description: hit.tags ?? null,
      source_url: hit.largeImageURL ?? hit.webformatURL,
      preview_url: hit.webformatURL ?? null,
      thumbnail_url: hit.previewURL ?? null,
      width: Number(hit.imageWidth) || null,
      height: Number(hit.imageHeight) || null,
      duration_seconds: null,
      attribution: { provider: "pixabay", id: hit.id, author: hit.user, provider_url: hit.pageURL },
      license: { provider: "pixabay", type: "pixabay_content_license", provider_url: "https://pixabay.com/service/license-summary/" },
    };
  }).filter(Boolean) as FulfillmentResult[];
}

async function unsplashSearch(query: string, kind: MediaKind, perPage: number): Promise<FulfillmentResult[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key || kind !== "image") return [];
  const endpoint = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const res = await fetch(endpoint, { headers: { Authorization: `Client-ID ${key}` } });
  if (!res.ok) throw new Error(`Unsplash search failed: HTTP ${res.status}`);
  const json: any = await res.json();
  return (json.results ?? []).map((photo: any) => ({
    provider: "unsplash" as const,
    result_id: `unsplash:photo:${photo.id}`,
    title: photo.description ?? photo.alt_description ?? `Unsplash photo ${photo.id}`,
    description: photo.alt_description ?? photo.description ?? null,
    source_url: photo.urls?.raw ?? photo.urls?.full ?? photo.urls?.regular,
    preview_url: photo.urls?.regular ?? null,
    thumbnail_url: photo.urls?.small ?? photo.urls?.thumb ?? null,
    width: Number(photo.width) || null,
    height: Number(photo.height) || null,
    duration_seconds: null,
    attribution: { provider: "unsplash", id: photo.id, author: photo.user?.name, provider_url: photo.links?.html },
    license: { provider: "unsplash", type: "unsplash_license", provider_url: "https://unsplash.com/license" },
  })).filter((r: FulfillmentResult) => r.source_url);
}

export async function searchFulfillmentAssets(args: {
  assetType: string;
  query: string;
  provider?: "pexels" | "pixabay" | "unsplash" | "any" | "internal";
  perPage?: number;
  context?: Record<string, unknown>;
}): Promise<{ status: ReturnType<typeof fulfillmentStatus>; results: FulfillmentResult[]; warnings: string[] }> {
  const status = fulfillmentStatus();
  const provider = args.provider ?? "any";
  const kind = assetKindForType(args.assetType);
  const routing = classifyMedicalAssetRequest({
    assetType: args.assetType,
    query: args.query,
    actionType: args.context?.action_type,
    title: args.context?.title,
    description: args.context?.description,
  });
  const warnings: string[] = [];
  if (!args.query.trim()) return { status, results: [], warnings: ["Candidate has no search query."] };
  const results: FulfillmentResult[] = [];

  if ((provider === "internal" || provider === "any") && routing.allowedProviders.includes("internal")) {
    const internal = internalGraphicResult(args.assetType, args.query, args.context);
    if (internal) results.push(internal);
  }

  if (routing.taxonomy === "CLINICAL_IMAGE") {
    warnings.push(`${routing.status}: ${routing.reason}`);
  } else if (routing.taxonomy === "MEDICAL_ILLUSTRATION" && !routing.allowedProviders.includes("pexels")) {
    warnings.push(`${routing.status}: ${routing.reason}`);
  }

  if (kind && routing.taxonomy === "CONTEXTUAL_BROLL") {
    const perPage = Math.max(1, Math.min(12, args.perPage ?? 6));
    const run = async (name: "pexels" | "pixabay" | "unsplash") => {
      if (name === "unsplash") return;
      if (!routing.allowedProviders.includes(name)) return;
      try {
        if (name === "pexels") results.push(...await pexelsSearch(args.query, kind, perPage));
        if (name === "pixabay") results.push(...await pixabaySearch(args.query, kind, perPage));
      } catch (e) {
        warnings.push(e instanceof Error ? e.message : String(e));
      }
    };
    if (provider === "any") {
      await run("pexels");
      await run("pixabay");
    } else if (provider === "pexels" || provider === "pixabay") {
      await run(provider);
    } else if (provider === "unsplash") {
      warnings.push("Unsplash is not enabled for medical routing; use Pexels/Pixabay for contextual b-roll or manual upload.");
    }
  } else if (provider !== "internal" && provider !== "any") {
    warnings.push(`${routing.taxonomy} does not allow ${provider}; ${routing.reason}`);
  }

  const seen = new Set<string>();
  return {
    status,
    results: results.filter((result) => {
      if (!result.source_url || seen.has(result.source_url)) return false;
      seen.add(result.source_url);
      return true;
    }),
    warnings,
  };
}

export async function searchFulfillmentAsset(assetType: string, query: string): Promise<FulfillmentResult | null> {
  const { results } = await searchFulfillmentAssets({ assetType, query, provider: "any", perPage: 3 });
  return results[0] ?? null;
}

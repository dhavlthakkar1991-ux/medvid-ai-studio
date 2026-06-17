// Server-only: provider-independent asset provider interface.
// Future implementations (Pexels, Pixabay, Unsplash, internal library)
// must implement this contract; the timeline compiler must never depend
// on any specific provider.

export interface AssetSearchResult {
  external_id: string;
  provider: string;
  title: string;
  description?: string;
  url: string;
  thumbnail_url?: string;
  duration_seconds?: number;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
}

export interface AssetSearchQuery {
  query: string;
  asset_type: string;
  perPage?: number;
}

export interface AssetProvider {
  readonly id: string;
  searchAssets(query: AssetSearchQuery): Promise<AssetSearchResult[]>;
  getAsset(externalId: string): Promise<AssetSearchResult | null>;
  approveAsset?(externalId: string): Promise<void>;
}

const registry = new Map<string, AssetProvider>();

export function registerAssetProvider(provider: AssetProvider) {
  registry.set(provider.id, provider);
}

export function getAssetProvider(id: string): AssetProvider | undefined {
  return registry.get(id);
}

export function listAssetProviders(): AssetProvider[] {
  return Array.from(registry.values());
}
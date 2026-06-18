import type { RenderSpec } from "../render-spec";

export type ProviderType = "mock" | "creatomate" | "shotstack" | "custom_worker";

export type ProviderRenderStatus =
  | "queued" | "preparing" | "rendering" | "completed" | "failed" | "cancelled";

export interface ProviderJobHandle {
  providerJobId: string;
  status: ProviderRenderStatus;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
}

export interface ProviderStatusReport {
  status: ProviderRenderStatus;
  progress: number;
  outputUrl?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  resolution?: string | null;
  error?: string | null;
  raw?: Record<string, unknown>;
}

export interface CreateRenderArgs {
  spec: RenderSpec;
  renderType: "preview" | "full";
  projectId: string;
  renderJobId: string;
  configuration: Record<string, unknown>;
}

export interface RenderProvider {
  type: ProviderType;
  name: string;
  isConfigured(configuration: Record<string, unknown>): Promise<boolean> | boolean;
  createRender(args: CreateRenderArgs): Promise<ProviderJobHandle>;
  getRenderStatus(
    providerJobId: string,
    args: { renderJobId: string; configuration: Record<string, unknown> },
  ): Promise<ProviderStatusReport>;
  cancelRender(
    providerJobId: string,
    args: { renderJobId: string; configuration: Record<string, unknown> },
  ): Promise<void>;
  downloadRender(
    providerJobId: string,
    args: { renderJobId: string; configuration: Record<string, unknown> },
  ): Promise<{ url: string | null; durationSeconds?: number | null; resolution?: string | null }>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string, hint?: string) {
    super(`Render provider "${provider}" is not configured${hint ? `: ${hint}` : "."}`);
    this.name = "ProviderNotConfiguredError";
  }
}
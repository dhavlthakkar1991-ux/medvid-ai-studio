import { ProviderNotConfiguredError, type RenderProvider } from "./types";

/** STUB — enable once CREATOMATE_API_KEY is set and integration is implemented. */
export const creatomateProvider: RenderProvider = {
  type: "creatomate",
  name: "Creatomate",
  isConfigured() { return Boolean(process.env.CREATOMATE_API_KEY); },
  async createRender() { throw new ProviderNotConfiguredError("Creatomate", "Add CREATOMATE_API_KEY and finish the integration."); },
  async getRenderStatus() { throw new ProviderNotConfiguredError("Creatomate"); },
  async cancelRender() { /* no-op */ },
  async downloadRender() { throw new ProviderNotConfiguredError("Creatomate"); },
};
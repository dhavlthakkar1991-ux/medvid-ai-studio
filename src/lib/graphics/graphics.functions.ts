import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ProjectInput = z.object({ projectId: z.string().uuid() });

export const compileProjectGraphics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectInput.parse(i))
  .handler(async ({ context, data }) => {
    const { compileGraphicsForProject } = await import("./graphic-compiler.server");
    return compileGraphicsForProject(context.supabase, data.projectId);
  });

export const listCompiledGraphics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectInput.parse(i))
  .handler(async ({ context, data }) => {
    const { data: rows } = await context.supabase
      .from("compiled_graphics")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true });
    return { graphics: rows ?? [] };
  });

export const listGraphicTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("graphic_templates")
      .select("id, template_name, graphic_type, spec, is_system")
      .order("graphic_type", { ascending: true });
    return { templates: data ?? [] };
  });
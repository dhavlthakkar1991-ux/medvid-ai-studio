import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("specialty_templates")
      .select("*")
      .order("is_builtin", { ascending: false })
      .order("template_name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const TemplateInput = z.object({
  id: z.string().optional(),
  specialty: z.string().min(1),
  template_name: z.string().min(1),
  default_audience: z.string().nullable(),
  default_brand_voice: z.string().nullable(),
  default_visual_style: z.string().nullable(),
  default_scene_patterns: z.array(z.string()),
  default_infographic_types: z.array(z.string()),
  default_broll_types: z.array(z.string()),
  default_thumbnail_style: z.record(z.string(), z.unknown()),
});

export const upsertTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TemplateInput.parse(input))
  .handler(async ({ context, data }) => {
    const row = {
      ...data,
      owner_user_id: context.userId,
      is_builtin: false,
    } as any;
    if (data.id) {
      const { error } = await context.supabase.from("specialty_templates").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    } else {
      const { data: ins, error } = await context.supabase.from("specialty_templates").insert(row).select("id").single();
      if (error) throw new Error(error.message);
      return { id: ins.id };
    }
  });

export const deleteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("specialty_templates").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

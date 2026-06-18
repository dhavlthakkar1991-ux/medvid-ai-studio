// Deterministic last-resort generators. Produce minimum-viable, schema-valid output
// from scenes/transcript when AI repeatedly fails validation.

function fmt(s: number): string {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

export async function fallbackChapters(_supabase: any, _projectId: string, project: any) {
  const duration = Math.max(60, Number(project?.duration_seconds) || 60);
  const topic = project?.topic || project?.title || "Topic";
  const count = duration < 180 ? 4 : duration < 360 ? 5 : 6;
  const step = duration / count;
  const labels = ["Introduction", "Background", "Key concept", "What to do", "Next steps", "Summary", "Q&A", "Closing"];
  const chapters = Array.from({ length: count }, (_, i) => {
    const start = Math.round(i * step);
    const end = i === count - 1 ? Math.round(duration) : Math.round((i + 1) * step);
    return {
      title: `${labels[i] ?? `Chapter ${i + 1}`} — ${topic}`.slice(0, 80),
      start: fmt(start),
      end: fmt(end),
    };
  });
  return { chapters };
}

type SceneRow = {
  scene_number: number;
  title: string;
  start_time: number;
  end_time: number;
  narration_text: string | null;
};

export async function fallbackScenePlan(supabase: any, projectId: string, project: any) {
  const duration = Number(project?.duration_seconds) || 60;
  const count = 6;
  const step = duration / count;
  const topic = project?.topic || project?.title || "Medical topic";
  const scene_plan = Array.from({ length: count }, (_, i) => {
    const start = Math.round(i * step);
    const end = Math.round((i + 1) * step);
    return {
      t: fmt(start),
      kind: i === 0 ? "talking-head" : i === count - 1 ? "callout" : "b-roll",
      title: `${topic} — part ${i + 1}`,
      prompt: `Discuss ${topic} segment ${i + 1}`,
      scene_number: i + 1,
      start_seconds: start,
      end_seconds: end,
      narration_text: `Narration for ${topic} segment ${i + 1}.`,
      objective: `Explain ${topic} segment ${i + 1} clearly to patients.`,
    };
  });
  return { scene_plan };
}

export async function fallbackBroll(supabase: any, projectId: string, project: any) {
  const { data: scenes } = await supabase
    .from("scenes")
    .select("scene_number, title, start_time, end_time, narration_text")
    .eq("project_id", projectId)
    .order("scene_number", { ascending: true });
  const list = (scenes as SceneRow[] | null) ?? [];
  const seeds: SceneRow[] = list.length >= 5
    ? list
    : Array.from({ length: 5 }, (_, i) => ({
        scene_number: i + 1,
        title: `${project?.topic ?? project?.title ?? "Medical topic"} — segment ${i + 1}`,
        start_time: i * 10,
        end_time: i * 10 + 5,
        narration_text: "",
      }));
  const broll = seeds.slice(0, Math.max(6, seeds.length)).map((s) => ({
    scene_number: s.scene_number,
    keyword: (s.title || `topic ${s.scene_number}`).slice(0, 60),
    search_prompt: `Cinematic medical b-roll showing ${s.title}`,
    placement_reason: `Visual support for narration: ${(s.narration_text || s.title || "").slice(0, 120)}`,
    recommended_start: fmt(Number(s.start_time) || 0),
    recommended_end: fmt(Number(s.end_time) || (Number(s.start_time) + 5) || 5),
  }));
  return { broll };
}

export async function fallbackVisualStoryboard(supabase: any, projectId: string, project: any) {
  const { data: scenes } = await supabase
    .from("scenes")
    .select("scene_number, title, start_time, end_time, narration_text")
    .eq("project_id", projectId)
    .order("scene_number", { ascending: true });
  const list = (scenes as SceneRow[] | null) ?? [];
  const duration = Number(project?.duration_seconds) || 60;
  const seeds: SceneRow[] = list.length > 0
    ? list
    : Array.from({ length: 10 }, (_, i) => ({
        scene_number: i + 1,
        title: `${project?.topic ?? project?.title ?? "Medical"} step ${i + 1}`,
        start_time: Math.round((duration / 10) * i),
        end_time: Math.round((duration / 10) * (i + 1)),
        narration_text: "",
      }));
  const visual_storyboard = seeds.map((s) => ({
    time: fmt(Number(s.start_time) || 0),
    visual_type: "Callout" as const,
    title: s.title || `Scene ${s.scene_number}`,
    screen_layout: "Full" as const,
    asset_prompt: `Clean medical illustration for: ${s.title}`,
    animation: "Fade" as const,
    priority: "medium" as const,
    duration_seconds: Math.max(2, Number(s.end_time) - Number(s.start_time) || 5),
    scene_number: s.scene_number,
  }));
  return { visual_storyboard };
}

export async function fallbackEditorialDecisions(supabase: any, projectId: string, _project: any) {
  const { data: scenes } = await supabase
    .from("scenes")
    .select("scene_number, title, start_time, end_time, narration_text")
    .eq("project_id", projectId)
    .order("scene_number", { ascending: true });
  const list = (scenes as SceneRow[] | null) ?? [];
  if (list.length === 0) {
    return { edit_actions: [{
      scene_number: 1,
      action_type: "show_lower_third",
      start_time: 0,
      end_time: 5,
      layer: 4,
      priority: 5,
      layout: "full_screen",
      transition_in: "fade",
      transition_out: "fade",
      asset_query: "Title lower third",
      reason: "Default introduction overlay",
    }] };
  }
  const edit_actions = list.map((s) => ({
    scene_number: s.scene_number,
    action_type: "show_broll",
    start_time: Number(s.start_time) || 0,
    end_time: Math.max((Number(s.start_time) || 0) + 2, Number(s.end_time) || (Number(s.start_time) || 0) + 4),
    layer: 1,
    priority: 5,
    layout: "doctor_with_broll",
    transition_in: "fade",
    transition_out: "fade",
    asset_query: `b-roll for ${s.title || `scene ${s.scene_number}`}`,
    reason: `Default cutaway to support narration of scene ${s.scene_number}`,
  }));
  return { edit_actions };
}

export async function fallbackSeo(_supabase: any, _projectId: string, project: any) {
  const topic = (project?.topic || project?.title || "Medical topic").toString();
  const titles = [
    `${topic}: What You Need to Know`,
    `${topic} — Doctor Explains`,
    `Understanding ${topic}`,
    `${topic}: Symptoms & Warning Signs`,
    `${topic}: A Patient Guide`,
  ].map((t) => t.slice(0, 70));
  const description =
    `In this video a medical specialist explains ${topic} in clear, accessible language. ` +
    `Learn about the key risk factors, warning signs, and when to consult a doctor. ` +
    `Share this with friends and family to raise awareness.`;
  const tags = [
    topic.toLowerCase(),
    "medical education",
    "health awareness",
    "doctor explains",
    "patient guide",
    "symptoms",
    "warning signs",
    "early detection",
    "treatment",
    "prevention",
    "healthcare",
    "medicine",
  ];
  return {
    seo: {
      titles,
      description,
      tags,
      chapters_text: "00:00 Introduction\n00:30 Main content\n01:30 Conclusion",
      pinned_comment: `If you found this helpful, please like and share to spread awareness about ${topic}.`,
    },
  };
}
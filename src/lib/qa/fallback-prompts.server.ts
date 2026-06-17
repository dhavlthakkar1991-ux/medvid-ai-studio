// Stricter fallback prompts used after the primary prompt fails validation.
// Keep these self-contained — they should produce minimum-viable, schema-valid output.

import type { TaskValidatorKey } from "./validators";

export const FALLBACK_PROMPTS: Partial<Record<TaskValidatorKey, string>> = {
  scene_plan: `Plan EXACTLY 6 scenes covering the full transcript.
Output JSON ONLY matching: { "scene_plan": [ { "t": "mm:ss", "kind": "talking-head"|"infographic"|"b-roll"|"callout"|"chapter-card", "title": string, "prompt": string, "scene_number": number, "start_seconds": number, "end_seconds": number, "narration_text": string, "objective": string } ] }
Every field is REQUIRED. Distribute scenes evenly across the duration. Title and objective must be non-empty sentences. narration_text must quote or paraphrase the transcript segment.`,

  broll: `Suggest EXACTLY 6 b-roll cutaways tied to specific narration timestamps.
Output JSON ONLY matching: { "broll": [ { "scene_number": number, "keyword": string, "search_prompt": string, "placement_reason": string, "recommended_start": "mm:ss", "recommended_end": "mm:ss" } ] }
Every field is REQUIRED and non-empty. keyword <= 4 words. search_prompt is a vivid cinematic description. placement_reason explains why this clip helps narration.`,

  visual_storyboard: `Produce EXACTLY 10 storyboard steps spread across the full duration.
Output JSON ONLY matching: { "visual_storyboard": [ { "time": "mm:ss", "visual_type": "Medical Infographic"|"B-Roll"|"Diagram"|"Chapter Card"|"Callout"|"Split Screen", "title": string, "screen_layout": "Full"|"Split Screen"|"PiP"|"Lower Third", "asset_prompt": string, "animation": "Slide In Right"|"Fade"|"Zoom"|"None", "priority": "low"|"medium"|"high"|"maximum", "duration_seconds": number, "scene_number": number } ] }
Every field REQUIRED. asset_prompt must be image/video generation ready (vivid). Sum of duration_seconds should approximate the transcript duration.`,

  editorial_decisions: `Decide what to layer on the doctor's talking-head for EVERY scene.
Output JSON ONLY matching: { "edit_actions": [ { "scene_number": number, "action_type": string, "start_time": number, "end_time": number, "layer": number, "priority": number, "layout": string, "transition_in": string, "transition_out": string, "asset_query": string, "reason": string } ] }
start_time and end_time MUST be numbers in seconds (not strings, not "mm:ss"). end_time MUST be greater than start_time. Produce 1-3 actions per scene so every scene is covered. Preserve doctor narration — only layer enhancements on top.`,
};
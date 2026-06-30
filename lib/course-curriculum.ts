import type { Caption } from "@remotion/captions";
import type { CardData } from "./cards";
import { updateCardForSegment } from "./cards";
import type { Curriculum, RenderableScript } from "./curriculum";
import { flattenScripts } from "./curriculum";
import { getSupabaseAdmin } from "./supabase-admin";

export async function getCourseCurriculum(courseId: string): Promise<Curriculum | null> {
  const { client } = getSupabaseAdmin();
  const { data, error } = await client
    .from("courses")
    .select("curriculum")
    .eq("id", courseId)
    .is("deleted_at", null)
    .single();

  if (error) throw new Error(error.message);
  return (data?.curriculum as Curriculum | null) ?? null;
}

export type EnrichedScript = RenderableScript & {
  video_url: string | null;
  captions: Caption[] | null;
  audio_url: string | null;
  audio_duration: number | null;
  board_url: string | null;
  final_script: string | null;
  board_prompt: string | null;
  video_prompt: string | null;
  slideshow_plan: import("./production").SlideshowSlide[] | null;
  costs: import("./production").ProductionCosts | null;
};

export async function enrichScripts(
  courseId: string,
  curriculum: Curriculum,
  cardsMap: Map<string, CardData>,
  resolveUrl: (key: string) => Promise<string>,
  discoverKey: (segmentKey: string) => Promise<string | null>,
): Promise<EnrichedScript[]> {
  const scripts = flattenScripts(curriculum);

  return Promise.all(
    scripts.map(async script => {
      const card = cardsMap.get(script.segmentKey);
      let key = card?.video_r2_key ?? null;

      if (!key) {
        const discovered = await discoverKey(script.segmentKey);
        if (discovered) {
          key = discovered;
          await updateCardForSegment(courseId, script.segmentKey, { video_r2_key: discovered });
        }
      }

      const production = card?.production ?? {};

      return {
        ...script,
        video_url: key ? await resolveUrl(key) : null,
        captions: card?.captions ?? null,
        audio_url: production.audio_r2_key ? await resolveUrl(production.audio_r2_key) : null,
        audio_duration: production.audio_duration ?? null,
        board_url: production.board_r2_key ? await resolveUrl(production.board_r2_key) : null,
        final_script:
          production.final_script && production.final_script !== script.script
            ? production.final_script
            : null,
        board_prompt: production.board_prompt ?? null,
        video_prompt: production.video_prompt ?? null,
        slideshow_plan: production.slideshow_plan ?? null,
        costs: production.costs ?? null,
      };
    }),
  );
}

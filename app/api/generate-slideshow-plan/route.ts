import { NextRequest, NextResponse } from "next/server";
import {
  addProductionCost,
  getCardProduction,
  mergeCardProduction,
} from "@/lib/cards";
import { parseJsonResponse, runTextPrompt } from "@/lib/llm";
import type { SlideshowSlide } from "@/lib/production";
import { buildSlideshowPlanPrompt } from "@/lib/production";

export const maxDuration = 120;

/** Validates + normalizes the LLM's slideshow JSON into ascending slides starting at 0. */
function parseSlideshowPlan(text: string): SlideshowSlide[] {
  const parsed = parseJsonResponse(text) as { slides?: unknown };
  const raw = Array.isArray(parsed.slides) ? parsed.slides : [];

  const slides = raw
    .filter(
      (s): s is { start: number; image_prompt: string } =>
        !!s &&
        typeof s === "object" &&
        typeof (s as { start?: unknown }).start === "number" &&
        typeof (s as { image_prompt?: unknown }).image_prompt === "string" &&
        (s as { image_prompt: string }).image_prompt.trim().length > 0,
    )
    .map(s => ({ start: Math.max(0, s.start), image_prompt: s.image_prompt.trim() }))
    .sort((a, b) => a.start - b.start);

  if (slides.length === 0) throw new Error("Slideshow plan had no usable slides");

  // The first frame must cover the opening of the narration.
  slides[0].start = 0;
  return slides;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";
  const segmentKey = typeof body.segmentKey === "string" ? body.segmentKey.trim() : "";
  const force = body.force === true;

  if (!courseId || !segmentKey) {
    return NextResponse.json({ error: "courseId and segmentKey are required" }, { status: 400 });
  }

  let spentUsd = 0;

  try {
    const production = await getCardProduction(courseId, segmentKey);

    if (!production.final_script) {
      return NextResponse.json(
        { error: "Generate narration audio before the slideshow plan" },
        { status: 400 },
      );
    }

    // Resume: plan already written.
    if (!force && production.slideshow_plan && production.slideshow_plan.length > 0) {
      return NextResponse.json({
        slideshowPlan: production.slideshow_plan,
        costs: production.costs ?? null,
        cached: true,
      });
    }

    // The plan LLM occasionally returns malformed JSON — retry once.
    let plan: SlideshowSlide[] | null = null;
    let parseError: unknown = null;
    for (let attempt = 0; attempt < 2 && !plan; attempt++) {
      const result = await runTextPrompt(
        buildSlideshowPlanPrompt(production.final_script, production.audio_duration),
      );
      spentUsd += result.costUsd;
      try {
        plan = parseSlideshowPlan(result.text);
      } catch (err) {
        parseError = err;
      }
    }
    if (!plan) {
      throw new Error(
        `Slideshow plan failed to parse twice: ${parseError instanceof Error ? parseError.message : "unknown"}`,
      );
    }

    await mergeCardProduction(courseId, segmentKey, { slideshow_plan: plan });
    // Book the storyboard LLM call to "board" (a design step), keeping the
    // "video" cost line for the actual image rendering + stitch.
    const costs = await addProductionCost(courseId, segmentKey, "board", spentUsd);

    return NextResponse.json({ slideshowPlan: plan, costs, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Slideshow plan generation failed";
    const costs = await addProductionCost(courseId, segmentKey, "board", spentUsd).catch(() => null);
    return NextResponse.json({ error: message, costs }, { status: 500 });
  }
}

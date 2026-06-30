import { NextRequest, NextResponse } from "next/server";
import { addProductionCost, getCardProduction, mergeCardProduction } from "@/lib/cards";
import { runTextPrompt } from "@/lib/llm";
import { buildVideoPromptPrompt } from "@/lib/production";

export const maxDuration = 300;

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
        { error: "Generate narration audio before the video prompt" },
        { status: 400 },
      );
    }

    // Resume: prompt already written.
    if (!force && production.video_prompt) {
      return NextResponse.json({
        videoPrompt: production.video_prompt,
        costs: production.costs ?? null,
        cached: true,
      });
    }

    const promptResult = await runTextPrompt(
      buildVideoPromptPrompt(
        production.final_script,
        production.audio_duration,
        production.board_tiles,
      ),
    );
    spentUsd += promptResult.costUsd;

    await mergeCardProduction(courseId, segmentKey, { video_prompt: promptResult.text });
    const costs = await addProductionCost(courseId, segmentKey, "video", spentUsd);

    return NextResponse.json({ videoPrompt: promptResult.text, costs, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Video prompt generation failed";
    const costs = await addProductionCost(courseId, segmentKey, "video", spentUsd).catch(() => null);
    return NextResponse.json({ error: message, costs }, { status: 500 });
  }
}

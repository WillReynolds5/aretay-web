import { NextRequest, NextResponse } from "next/server";
import {
  addProductionCost,
  clearProductionFields,
  getCardProduction,
  mergeCardProduction,
} from "@/lib/cards";
import { getCourseCurriculum } from "@/lib/course-curriculum";
import { flattenScripts } from "@/lib/curriculum";
import { generateImage, parseJsonResponse, runTextPrompt } from "@/lib/llm";
import type { BoardTile } from "@/lib/production";
import { buildBoardDesignPrompt } from "@/lib/production";
import { getVideoUrl, segmentBoardKey, uploadObject } from "@/lib/r2";

export const maxDuration = 300;

type BoardDesign = { image_prompt: string; tiles: BoardTile[] };

function parseBoardDesign(text: string): BoardDesign {
  const parsed = parseJsonResponse(text) as Partial<BoardDesign>;
  if (typeof parsed.image_prompt !== "string" || !parsed.image_prompt.trim()) {
    throw new Error("Board design is missing image_prompt");
  }
  const tiles = Array.isArray(parsed.tiles)
    ? parsed.tiles.filter(
        (t): t is BoardTile =>
          !!t && typeof t.position === "string" && typeof t.label === "string" && typeof t.description === "string",
      )
    : [];
  return { image_prompt: parsed.image_prompt.trim(), tiles };
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
        { error: "Generate narration audio before the production board" },
        { status: 400 },
      );
    }

    // Resume: board already produced.
    if (!force && production.board_r2_key) {
      return NextResponse.json({
        boardUrl: await getVideoUrl(production.board_r2_key),
        tiles: production.board_tiles ?? [],
        boardPrompt: production.board_prompt ?? null,
        costs: production.costs ?? null,
        cached: true,
      });
    }

    const curriculum = await getCourseCurriculum(courseId);
    const courseTitle = curriculum?.title ?? "Untitled course";
    const unitTitle = curriculum
      ? (flattenScripts(curriculum).find(s => s.segmentKey === segmentKey)?.unitTitle ?? null)
      : null;

    // The design LLM occasionally returns truncated/malformed JSON — retry once.
    let design: BoardDesign | null = null;
    let parseError: unknown = null;
    for (let attempt = 0; attempt < 2 && !design; attempt++) {
      const designResult = await runTextPrompt(
        buildBoardDesignPrompt(courseTitle, unitTitle, production.final_script),
      );
      spentUsd += designResult.costUsd;
      try {
        design = parseBoardDesign(designResult.text);
      } catch (err) {
        parseError = err;
      }
    }
    if (!design) {
      throw new Error(
        `Board design JSON failed to parse twice: ${parseError instanceof Error ? parseError.message : "unknown"}`,
      );
    }

    const image = await generateImage(design.image_prompt);
    spentUsd += image.costUsd;
    const r2Key = segmentBoardKey(courseId, segmentKey);
    await uploadObject(r2Key, image.buffer, "image/png");

    await mergeCardProduction(courseId, segmentKey, {
      board_r2_key: r2Key,
      board_prompt: design.image_prompt,
      board_tiles: design.tiles,
    });
    // New board panels make the stored video prompt stale (it references them by position).
    await clearProductionFields(courseId, segmentKey, ["video_prompt"]);
    const costs = await addProductionCost(courseId, segmentKey, "board", spentUsd);

    return NextResponse.json({
      boardUrl: await getVideoUrl(r2Key),
      tiles: design.tiles,
      boardPrompt: design.image_prompt,
      costs,
      cached: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Production board generation failed";
    const costs = await addProductionCost(courseId, segmentKey, "board", spentUsd).catch(() => null);
    return NextResponse.json({ error: message, costs }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  addProductionCost,
  getCardProduction,
  updateCardForSegment,
} from "@/lib/cards";
import { SEEDANCE_USD_PER_VIDEO_SECOND, VIDEO_DURATION_SECONDS } from "@/lib/production";
import { fetchOutputBuffer, getReplicate } from "@/lib/replicate";
import { getVideoUrl, segmentVideoKey, uploadObject } from "@/lib/r2";

export const maxDuration = 300;

const SEEDANCE_MODEL = "bytedance/seedance-2.0";
const SEED = 99;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";
  const segmentKey = typeof body.segmentKey === "string" ? body.segmentKey.trim() : "";

  if (!courseId || !segmentKey) {
    return NextResponse.json({ error: "courseId and segmentKey are required" }, { status: 400 });
  }

  let videoPrompt: string | null = null;
  let spentUsd = 0;

  try {
    const production = await getCardProduction(courseId, segmentKey);

    if (!production.audio_r2_key || !production.final_script) {
      return NextResponse.json(
        { error: "Generate narration audio before the video" },
        { status: 400 },
      );
    }
    if (!production.video_prompt) {
      return NextResponse.json(
        { error: "Generate the video prompt before the video" },
        { status: 400 },
      );
    }

    // The stored prompt is the input — regenerate it explicitly (↻ Prompt)
    // to get different wording.
    videoPrompt = production.video_prompt;

    const referenceAudios = [await getVideoUrl(production.audio_r2_key)];
    const referenceImages = production.board_r2_key
      ? [await getVideoUrl(production.board_r2_key)]
      : [];

    const replicate = getReplicate();
    const output = await replicate.run(SEEDANCE_MODEL, {
      input: {
        seed: SEED,
        prompt: videoPrompt.slice(0, 4000),
        duration: VIDEO_DURATION_SECONDS,
        resolution: "480p",
        aspect_ratio: "9:16",
        generate_audio: true,
        reference_audios: referenceAudios,
        reference_images: referenceImages,
        reference_videos: [],
      },
    });

    // Official Replicate models bill per output second; failed/blocked
    // predictions produce no output and aren't charged.
    spentUsd += VIDEO_DURATION_SECONDS * SEEDANCE_USD_PER_VIDEO_SECOND;

    const videoBuffer = await fetchOutputBuffer(output);
    const r2Key = segmentVideoKey(courseId, segmentKey);
    await uploadObject(r2Key, videoBuffer, "video/mp4");
    await updateCardForSegment(courseId, segmentKey, { video_r2_key: r2Key, captions: null });
    const costs = await addProductionCost(courseId, segmentKey, "video", spentUsd);
    const url = await getVideoUrl(r2Key);

    return NextResponse.json({ url, r2Key, videoPrompt, costs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Video generation failed";
    const costs = await addProductionCost(courseId, segmentKey, "video", spentUsd).catch(() => null);
    // Return the prompt so the UI can show exactly what Seedance rejected.
    return NextResponse.json({ error: message, videoPrompt, costs }, { status: 500 });
  }
}

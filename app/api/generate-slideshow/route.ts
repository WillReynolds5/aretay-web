import { NextRequest, NextResponse } from "next/server";
import {
  addProductionCost,
  getCardProduction,
  updateCardForSegment,
} from "@/lib/cards";
import { generateImage, NANO_BANANA_MODEL } from "@/lib/llm";
import { MAX_AUDIO_SECONDS } from "@/lib/production";
import { buildSlideshowVideo, slideDurations, type SlideFrame } from "@/lib/slideshow";
import {
  getVideoUrl,
  resolveMediaUrl,
  segmentVideoKey,
  uploadObject,
} from "@/lib/r2";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 300;

/** Course cover — used as a shared style anchor so every slide matches the course look. */
async function getCoverImageUrl(courseId: string): Promise<string | null> {
  const { client } = getSupabaseAdmin();
  const { data } = await client
    .from("courses")
    .select("cover_image_url")
    .eq("id", courseId)
    .is("deleted_at", null)
    .maybeSingle();
  return data?.cover_image_url ?? null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";
  const segmentKey = typeof body.segmentKey === "string" ? body.segmentKey.trim() : "";

  if (!courseId || !segmentKey) {
    return NextResponse.json({ error: "courseId and segmentKey are required" }, { status: 400 });
  }

  let spentUsd = 0;

  try {
    const production = await getCardProduction(courseId, segmentKey);

    if (!production.audio_r2_key || !production.final_script) {
      return NextResponse.json(
        { error: "Generate narration audio before the slideshow" },
        { status: 400 },
      );
    }
    const plan = production.slideshow_plan;
    if (!plan || plan.length === 0) {
      return NextResponse.json(
        { error: "Generate the slideshow plan before the slideshow" },
        { status: 400 },
      );
    }

    // Style anchor shared across every frame for visual continuity.
    const referenceImageUrl =
      resolveMediaUrl(await getCoverImageUrl(courseId)) ?? undefined;

    // Render each still (Nano Banana). Serial keeps memory + rate limits sane.
    const buffers: Buffer[] = [];
    for (const slide of plan) {
      const image = await generateImage(slide.image_prompt, {
        model: NANO_BANANA_MODEL,
        referenceImageUrl,
      });
      spentUsd += image.costUsd;
      buffers.push(image.buffer);
    }

    // Fetch the narration so ffmpeg can mux it under the stills.
    const audioRes = await fetch(await getVideoUrl(production.audio_r2_key));
    if (!audioRes.ok) throw new Error("Failed to download narration audio");
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    const audioDuration = production.audio_duration ?? MAX_AUDIO_SECONDS;
    const durations = slideDurations(
      plan.map(s => s.start),
      audioDuration,
    );
    const frames: SlideFrame[] = buffers.map((buffer, i) => ({
      buffer,
      durationSeconds: durations[i],
    }));

    const videoBuffer = buildSlideshowVideo(frames, audioBuffer);
    const r2Key = segmentVideoKey(courseId, segmentKey);
    await uploadObject(r2Key, videoBuffer, "video/mp4");
    // Same shape as the Seedance path: set the video key + clear stale captions.
    await updateCardForSegment(courseId, segmentKey, { video_r2_key: r2Key, captions: null });
    const costs = await addProductionCost(courseId, segmentKey, "video", spentUsd);
    const url = await getVideoUrl(r2Key);

    return NextResponse.json({ url, r2Key, slideCount: plan.length, costs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Slideshow generation failed";
    const costs = await addProductionCost(courseId, segmentKey, "video", spentUsd).catch(() => null);
    return NextResponse.json({ error: message, costs }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { wavDurationSeconds } from "@/lib/audio";
import {
  addProductionCost,
  clearProductionFields,
  getCardProduction,
  mergeCardProduction,
} from "@/lib/cards";
import { runTextPrompt } from "@/lib/llm";
import {
  buildShortenPrompt,
  KOKORO_USD_PER_COMPUTE_SECOND,
  MAX_AUDIO_SECONDS,
} from "@/lib/production";
import { fetchOutputBuffer, getReplicate, runWithMetrics } from "@/lib/replicate";
import { getVideoUrl, segmentAudioKey, uploadObject } from "@/lib/r2";

export const maxDuration = 300;

const KOKORO_MODEL =
  "jaaari/kokoro-82m:f559560eb822dc509045f3921a1921234918b91739db4bf3daab2169b71c7a13";
const VOICE = "bm_george";
// 1.0 = natural storytelling pace. 15s holds ~26-30 words; the trim loop catches overruns.
const SPEED = 1.0;
const MAX_SHORTEN_ATTEMPTS = 4;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const script = typeof body.script === "string" ? body.script.trim() : "";
  const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";
  const segmentKey = typeof body.segmentKey === "string" ? body.segmentKey.trim() : "";
  const force = body.force === true;

  if (!script) {
    return NextResponse.json({ error: "Script is required" }, { status: 400 });
  }
  if (!courseId || !segmentKey) {
    return NextResponse.json({ error: "courseId and segmentKey are required" }, { status: 400 });
  }

  let spentUsd = 0;

  try {
    const production = await getCardProduction(courseId, segmentKey);

    // Resume: audio already produced for this exact script.
    if (
      !force &&
      production.audio_r2_key &&
      production.audio_duration != null &&
      production.source_script === script
    ) {
      return NextResponse.json({
        audioUrl: await getVideoUrl(production.audio_r2_key),
        duration: production.audio_duration,
        finalScript: production.final_script ?? script,
        shortened: (production.shorten_attempts ?? 0) > 0,
        costs: production.costs ?? null,
        cached: true,
      });
    }

    const replicate = getReplicate();
    let currentScript = script;
    let audioBuffer: Buffer | null = null;
    let duration = Infinity;
    let attempts = 0;

    while (attempts <= MAX_SHORTEN_ATTEMPTS) {
      const { output, predictTimeSeconds } = await runWithMetrics(replicate, KOKORO_MODEL, {
        text: currentScript,
        speed: SPEED,
        voice: VOICE,
      });
      spentUsd += (predictTimeSeconds ?? 0) * KOKORO_USD_PER_COMPUTE_SECOND;
      audioBuffer = await fetchOutputBuffer(output);
      duration = wavDurationSeconds(audioBuffer);

      if (duration <= MAX_AUDIO_SECONDS) break;

      attempts += 1;
      if (attempts > MAX_SHORTEN_ATTEMPTS) break;
      const trim = await runTextPrompt(buildShortenPrompt(currentScript, duration));
      spentUsd += trim.costUsd;
      currentScript = trim.text;
    }

    if (!audioBuffer || duration > MAX_AUDIO_SECONDS) {
      const costs = await addProductionCost(courseId, segmentKey, "audio", spentUsd);
      return NextResponse.json(
        {
          error: `Could not trim narration under ${MAX_AUDIO_SECONDS}s after ${MAX_SHORTEN_ATTEMPTS} attempts (last run: ${duration.toFixed(2)}s)`,
          costs,
        },
        { status: 500 },
      );
    }

    const r2Key = segmentAudioKey(courseId, segmentKey);
    await uploadObject(r2Key, audioBuffer, "audio/wav");
    await mergeCardProduction(courseId, segmentKey, {
      source_script: script,
      final_script: currentScript,
      audio_r2_key: r2Key,
      audio_duration: Number(duration.toFixed(2)),
      shorten_attempts: attempts,
    });
    // New narration makes the stored video prompt + slideshow plan stale (both quote the script).
    await clearProductionFields(courseId, segmentKey, ["video_prompt", "slideshow_plan"]);
    const costs = await addProductionCost(courseId, segmentKey, "audio", spentUsd);

    return NextResponse.json({
      audioUrl: await getVideoUrl(r2Key),
      duration: Number(duration.toFixed(2)),
      finalScript: currentScript,
      shortened: attempts > 0,
      costs,
      cached: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Audio generation failed";
    const costs = await addProductionCost(courseId, segmentKey, "audio", spentUsd).catch(() => null);
    return NextResponse.json({ error: message, costs }, { status: 500 });
  }
}

import type { Caption } from "@remotion/captions";
import { flattenQuestions, flattenScripts } from "./curriculum";
import { getCourseCurriculum } from "./course-curriculum";
import type { CostStage, ProductionCosts, ProductionData } from "./production";
import { emptyCosts } from "./production";
import { getSupabaseAdmin } from "./supabase-admin";

export type CardData = {
  video_r2_key: string | null;
  captions: Caption[] | null;
  production: ProductionData;
};

export type CardPatch = {
  captions?: Caption[] | null;
  video_r2_key?: string | null;
};

export async function syncCardsForCourse(courseId: string) {
  const curriculum = await getCourseCurriculum(courseId);
  if (!curriculum) return;

  const keys = [
    ...flattenScripts(curriculum).map(script => script.segmentKey),
    ...flattenQuestions(curriculum).map(question => question.questionKey),
  ];
  if (!keys.length) return;

  const { client } = getSupabaseAdmin();

  const { data: existing, error: fetchError } = await client
    .from("cards")
    .select("segment_key")
    .eq("course_id", courseId)
    .is("deleted_at", null);

  if (fetchError) throw new Error(fetchError.message);

  const existingKeys = new Set((existing ?? []).map(row => row.segment_key));
  const toInsert = keys
    .filter(key => !existingKeys.has(key))
    .map(key => ({
      course_id: courseId,
      segment_key: key,
      video_r2_key: null,
      captions: null,
      metadata: {},
    }));

  if (!toInsert.length) return;

  const { error } = await client.from("cards").insert(toInsert);
  if (error) throw new Error(error.message);
}

export async function updateCardForSegment(
  courseId: string,
  segmentKey: string,
  patch: CardPatch,
) {
  await syncCardsForCourse(courseId);

  const { client } = getSupabaseAdmin();
  const updates: CardPatch = {};

  if (patch.captions !== undefined) updates.captions = patch.captions;
  if (patch.video_r2_key !== undefined) updates.video_r2_key = patch.video_r2_key;

  const { error } = await client
    .from("cards")
    .update(updates)
    .eq("course_id", courseId)
    .eq("segment_key", segmentKey)
    .is("deleted_at", null);

  if (error) throw new Error(error.message);
}

export async function getCardDataMap(courseId: string): Promise<Map<string, CardData>> {
  const { client } = getSupabaseAdmin();
  const { data, error } = await client
    .from("cards")
    .select("segment_key, video_r2_key, captions, metadata")
    .eq("course_id", courseId)
    .is("deleted_at", null)
    .not("segment_key", "is", null);

  if (error) throw new Error(error.message);

  const map = new Map<string, CardData>();
  for (const row of data ?? []) {
    if (!row.segment_key) continue;
    map.set(row.segment_key, {
      video_r2_key: row.video_r2_key ?? null,
      captions: Array.isArray(row.captions) ? (row.captions as Caption[]) : null,
      production: extractProduction(row.metadata),
    });
  }
  return map;
}

function extractProduction(metadata: unknown): ProductionData {
  if (metadata && typeof metadata === "object" && "production" in metadata) {
    const production = (metadata as { production?: unknown }).production;
    if (production && typeof production === "object") return production as ProductionData;
  }
  return {};
}

export async function getCardProduction(
  courseId: string,
  segmentKey: string,
): Promise<ProductionData> {
  await syncCardsForCourse(courseId);

  const { client } = getSupabaseAdmin();
  const { data, error } = await client
    .from("cards")
    .select("metadata")
    .eq("course_id", courseId)
    .eq("segment_key", segmentKey)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return extractProduction(data?.metadata);
}

/**
 * Adds spend to the segment's cumulative cost ledger and returns the
 * updated totals. Costs only ever accumulate — retries and regenerates
 * keep counting toward "what this video has cost so far".
 */
export async function addProductionCost(
  courseId: string,
  segmentKey: string,
  stage: CostStage,
  usd: number,
): Promise<ProductionCosts> {
  const production = await getCardProduction(courseId, segmentKey);
  const costs = { ...emptyCosts(), ...(production.costs ?? {}) };

  if (usd > 0) {
    costs[`${stage}_usd`] = round6(costs[`${stage}_usd`] + usd);
    costs.total_usd = round6(costs.audio_usd + costs.board_usd + costs.video_usd);
    await mergeCardProduction(courseId, segmentKey, { costs });
  }

  return costs;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Removes fields from cards.metadata.production — used for dependency
 * invalidation (e.g. new audio or board makes the stored video prompt stale).
 */
export async function clearProductionFields(
  courseId: string,
  segmentKey: string,
  fields: (keyof ProductionData)[],
) {
  const { client } = getSupabaseAdmin();
  const { data, error: fetchError } = await client
    .from("cards")
    .select("id, metadata")
    .eq("course_id", courseId)
    .eq("segment_key", segmentKey)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);
  if (!data) return;

  const metadata =
    data.metadata && typeof data.metadata === "object" ? { ...(data.metadata as object) } : {};
  const production = { ...extractProduction(metadata) };
  for (const field of fields) delete production[field];

  const { error } = await client
    .from("cards")
    .update({ metadata: { ...metadata, production } })
    .eq("id", data.id);

  if (error) throw new Error(error.message);
}

/** Merges a partial production patch into cards.metadata.production. */
export async function mergeCardProduction(
  courseId: string,
  segmentKey: string,
  patch: Partial<ProductionData>,
) {
  const { client } = getSupabaseAdmin();
  const { data, error: fetchError } = await client
    .from("cards")
    .select("id, metadata")
    .eq("course_id", courseId)
    .eq("segment_key", segmentKey)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);
  if (!data) throw new Error(`No card row for segment ${segmentKey}`);

  const metadata =
    data.metadata && typeof data.metadata === "object" ? { ...(data.metadata as object) } : {};
  const production = { ...extractProduction(metadata), ...patch };

  const { error } = await client
    .from("cards")
    .update({ metadata: { ...metadata, production } })
    .eq("id", data.id);

  if (error) throw new Error(error.message);
}

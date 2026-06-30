// Client-safe (no SDK imports) — shared by the new-course page and the
// generate-curriculum API route.

/** Single-model options for curriculum generation. */
export const CURRICULUM_MODELS = [
  "anthropic/claude-fable-5",
  "anthropic/claude-opus-4.8-fast",
  "anthropic/claude-sonnet-4.6",
  "google/gemini-3.1-pro-preview",
  "openai/gpt-5.5",
] as const;

export type SingleCurriculumModel = (typeof CURRICULUM_MODELS)[number];

/** OpenRouter Fusion — multi-model deliberation with a judge synthesis step. */
export const FUSION_CURRICULUM_MODEL = "openrouter/fusion" as const;

export const CURRICULUM_MODEL_OPTIONS = [
  ...CURRICULUM_MODELS,
  FUSION_CURRICULUM_MODEL,
] as const;

export type CurriculumModel = (typeof CURRICULUM_MODEL_OPTIONS)[number];

export const DEFAULT_CURRICULUM_MODEL: CurriculumModel = "anthropic/claude-fable-5";

export const CURRICULUM_MODEL_LABELS: Record<CurriculumModel, string> = {
  "anthropic/claude-fable-5": "Claude Fable 5",
  "anthropic/claude-opus-4.8-fast": "Claude Opus 4.8 Fast",
  "anthropic/claude-sonnet-4.6": "Claude Sonnet 4.6",
  "google/gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  "openai/gpt-5.5": "GPT-5.5",
  [FUSION_CURRICULUM_MODEL]: "OpenRouter Fusion",
};

export function isCurriculumModel(value: unknown): value is CurriculumModel {
  return typeof value === "string" && (CURRICULUM_MODEL_OPTIONS as readonly string[]).includes(value);
}

export function isFusionCurriculumModel(model: CurriculumModel): boolean {
  return model === FUSION_CURRICULUM_MODEL;
}

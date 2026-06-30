// ------------------------------------------------------------
//  Per-segment production pipeline state + prompts.
//
//  Every script section goes through three stages, each persisted
//  to cards.metadata.production so a failed run resumes where
//  it left off:
//    1. audio  — Kokoro TTS, auto-trimmed until ≤ 15.00s
//    2. board  — "Visual Production Board" reference image
//    3. video  — Seedance 2.0 with audio + board as references
// ------------------------------------------------------------

export const MAX_AUDIO_SECONDS = 15.0;
export const VIDEO_DURATION_SECONDS = 15;

// ------------------------------------------------------------
//  Cost tracking
//
//  OpenRouter returns the exact cost on each response. Replicate
//  has no per-prediction cost API, so those are estimated:
//  Kokoro from measured GPU seconds x hardware rate, Seedance
//  from a per-output-second rate. Tweak to match the rates shown
//  on each model's Replicate page.
// ------------------------------------------------------------

export const KOKORO_USD_PER_COMPUTE_SECOND = 0.000725;
// Observed: a 15s 480p generation bills $1.20 → $0.08 per output second.
export const SEEDANCE_USD_PER_VIDEO_SECOND = 0.08;

export type ProductionCosts = {
  total_usd: number;
  audio_usd: number;
  board_usd: number;
  video_usd: number;
};

export type CostStage = "audio" | "board" | "video";

export function emptyCosts(): ProductionCosts {
  return { total_usd: 0, audio_usd: 0, board_usd: 0, video_usd: 0 };
}

export type BoardTile = {
  /** Panel position on the board, e.g. "top-left". */
  position: string;
  label: string;
  description: string;
};

/**
 * One frame of the alternate "slideshow" video pipeline: a still image shown
 * starting at `start` seconds into the narration. Duration is derived from the
 * next slide's start (last slide runs to the end of the audio).
 */
export type SlideshowSlide = {
  /** Seconds from the start of narration when this image appears. */
  start: number;
  /** A full, standalone image-model prompt for this frame. */
  image_prompt: string;
};

export type ProductionData = {
  /** The original curriculum script the audio was generated from (staleness check). */
  source_script?: string;
  /** The script actually narrated — possibly trimmed to fit 15s. */
  final_script?: string;
  audio_r2_key?: string;
  audio_duration?: number;
  shorten_attempts?: number;
  board_r2_key?: string;
  board_prompt?: string;
  board_tiles?: BoardTile[];
  video_prompt?: string;
  /** Alternate pipeline: timestamped image prompts stitched into a slideshow video. */
  slideshow_plan?: SlideshowSlide[];
  /** Cumulative spend across every attempt — never reset, even on regenerate. */
  costs?: ProductionCosts;
};

// Alternate slideshow pipeline: how many stills the plan should target across
// the ~15s narration. Used to size the LLM prompt and the up-front estimate.
export const SLIDESHOW_TARGET_SLIDES = 4;

export function buildShortenPrompt(script: string, durationSeconds: number): string {
  const words = script.split(/\s+/).filter(Boolean).length;
  // Aim a touch under the cap so the re-render lands safely at or below 15.00s.
  const targetWords = Math.max(8, Math.floor(words * (14.3 / durationSeconds)));

  return [
    "You are tightening narration for a 15-second vertical lesson video.",
    `The script below runs ${durationSeconds.toFixed(2)} seconds when spoken, but it must run at or under 15.00 seconds.`,
    `It is currently ${words} words; cut it down to roughly ${targetWords} words.`,
    "Trim filler and redundancy only — keep every key fact, the teaching intent, and the tone. Do not add new content.",
    "Return ONLY the revised script text. No quotes, no preamble, no markdown.",
    "",
    "SCRIPT:",
    script,
  ].join("\n");
}

export function buildBoardDesignPrompt(
  courseTitle: string,
  unitTitle: string | null,
  script: string,
): string {
  return [
    "You are the art director for a short cinematic lesson video.",
    `Course: "${courseTitle}"${unitTitle ? ` — Lesson: "${unitTitle}"` : ""}`,
    "Narration script for this segment:",
    `"${script}"`,
    "",
    "Design a single VISUAL PRODUCTION BOARD: one image laid out as a 2x2 grid of labeled reference panels",
    "that will guide a video generation model. Panels should depict the concrete characters, places, landscapes,",
    "or objects that belong in this segment's video, rendered in one consistent cinematic, photorealistic style",
    "with unified color grading and lighting so the video model can match it.",
    "",
    "CONTENT SAFETY — the downstream video model scans this board with a strict input filter, and one",
    "bad panel gets the entire video generation rejected. Measured experimentally, the #1 trigger is",
    "prominent photorealistic human faces (deepfake screening):",
    "- NO close-up or prominent photorealistic faces. People are allowed ONLY when small, distant, and",
    "  indistinct — wide crowd shots, silhouettes, figures seen from behind, or tiny against landscapes.",
    "  Prefer panels of places, architecture, landscapes, and objects over people.",
    "- NO weapons: no swords, daggers, spears, axes, bows, or anything held as a weapon.",
    "- No blood, wounds, corpses, combat, battles, or armored soldiers.",
    "- Convey conflict, power, or drama through architecture, distant crowds, weather, skies, light,",
    "  and the posture of small far-away figures — never through faces.",
    "- Express safety by OMISSION, never by negation: the image_prompt you write must not contain the",
    '  words "weapon", "unarmed", "no violence", "no blood", or similar — filters match keywords without',
    "  understanding negation, so naming the banned thing gets the prompt flagged anyway.",
    "",
    "Respond with ONLY a JSON object (no markdown fences) of this exact shape:",
    `{`,
    `  "image_prompt": "<full prompt for the image model: describe the 2x2 reference board, each panel's position, subject, and the shared cinematic style>",`,
    `  "tiles": [`,
    `    { "position": "top-left", "label": "<short name>", "description": "<what this panel shows>" },`,
    `    { "position": "top-right", ... },`,
    `    { "position": "bottom-left", ... },`,
    `    { "position": "bottom-right", ... }`,
    `  ]`,
    `}`,
  ].join("\n");
}

export function buildVideoPromptPrompt(
  script: string,
  audioDuration: number | undefined,
  tiles: BoardTile[] | undefined,
): string {
  const durationNote = audioDuration ? ` (${audioDuration.toFixed(1)}s long)` : "";

  const lines = [
    "You are writing the generation prompt for a text-to-video model (Seedance 2.0).",
    "It will render one continuous 15-second cinematic clip.",
    `The model is given a reference audio file — a narrator reading this lesson script${durationNote}:`,
    `"${script}"`,
  ];

  if (tiles?.length) {
    lines.push(
      "",
      "The model is also given a reference image: a 2x2 visual production board with these panels:",
      ...tiles.map(t => `- ${t.position}: ${t.label} — ${t.description}`),
      "The shot list SHOULD explicitly reference specific panels of the reference image and assign",
      'them timestamps, e.g. "0:00–0:06 open on the temple from the top-left reference panel...".',
    );
  }

  lines.push(
    "",
    "Write the prompt in this exact structure, with these section headers:",
    "",
    "OVERVIEW:",
    "<2-3 sentences in plain prose describing the video at a high level — the mood, the setting, and",
    "the visual arc from start to finish. This orients the model before the detailed shot list.>",
    "",
    "SHOT LIST (this is the visual guide for the video — it is NOT spoken aloud):",
    "<a timestamped shot list covering 0:00–0:15 — 2 to 4 cinematic shots that visually illustrate the",
    "lesson, with camera movement and lighting described per shot>",
    "",
    "NARRATION (this exact text is the voiceover read in the provided reference audio file — do not",
    "alter it, and do not turn it into on-screen text):",
    `"<the full narration script, quoted verbatim>"`,
    "",
    "Music: <a full cinematic orchestral score with a clear emotional arc that follows the shot list —",
    "name the instrumentation and how it builds, swells, and resolves across the 15 seconds>",
    "Sound effects: <2-4 specific diegetic effects tied to shots by timestamp, e.g. \"0:00 wind and",
    "distant footsteps on stone, 0:05 rolling thunder, 0:11 swelling crowd murmur\" — vivid and present>",
    "Ambience: <one line — the continuous environmental bed under everything>",
    "",
    "Requirements:",
    "- The OVERVIEW must come first and read as natural prose, not a list.",
    "- Make it unmistakable which text is the visual guide and which text is spoken: keep the shot list",
    "  and the narration in their own clearly labeled sections, never blended together.",
    "- The NARRATION text must be the exact script above, word for word.",
    "- The soundscape should be rich and layered — sweeping score plus distinct sound effects — like a",
    "  film trailer, but the narration must always stay clearly intelligible on top of the mix.",
    "- Photorealistic, cinematic lighting, smooth camera movement.",
    "- No on-screen text, captions, watermarks, or logos.",
    "- Keep the whole prompt under 1800 characters.",
    "- CONTENT SAFETY: never mention weapons (swords, daggers, spears), blood, wounds, combat, or",
    "  violence of any kind — the model's filter rejects the whole generation. Depict conflict",
    "  symbolically: expressions, gestures, skies, ruins, marching distance silhouettes, light.",
    "- Express safety by OMISSION, never by negation: your prompt must not contain words like",
    '  "weapon", "unarmed", "no violence", or "no blood" — the filter matches keywords without',
    "  understanding negation, so naming the banned thing gets the prompt flagged anyway.",
    "",
    "Return ONLY the video prompt text (starting with OVERVIEW:). No preamble, no markdown fences.",
  );

  return lines.join("\n");
}

/**
 * Prompt for the alternate SLIDESHOW pipeline. Instead of a single generated
 * clip, this asks an LLM to storyboard the narration as a short sequence of
 * still images, each with a start timestamp and a fully self-contained image
 * prompt. The stills are rendered (Nano Banana) and stitched over the narration
 * audio into an MP4 — far cheaper than a text-to-video model.
 */
export function buildSlideshowPlanPrompt(
  script: string,
  audioDuration: number | undefined,
): string {
  const duration = audioDuration && audioDuration > 0 ? audioDuration : MAX_AUDIO_SECONDS;
  const durationNote = `${duration.toFixed(1)}s`;

  return [
    "You are storyboarding a short vertical (9:16) lesson video as a SLIDESHOW of still images",
    "shown over a fixed narration track. The narration is already recorded and runs about",
    `${durationNote}. Your job: break the narration into a sequence of still frames that visually`,
    "illustrate it as it plays.",
    "",
    "Narration script (spoken verbatim over the slideshow):",
    `"${script}"`,
    "",
    `Plan ${SLIDESHOW_TARGET_SLIDES} images (use 3–5 only if the content clearly calls for it).`,
    "Each image gets a START timestamp in seconds — the moment it appears — and stays on screen",
    "until the next image's start (the last image holds until the narration ends).",
    "RULES for timestamps:",
    "- The first image MUST start at 0.",
    `- Timestamps strictly ascending, each less than ${duration.toFixed(1)}.`,
    "- Space them to follow the beats of the narration, not necessarily evenly.",
    "",
    "Each image_prompt must be a COMPLETE, standalone prompt for a photorealistic image model",
    "(the model sees only that one prompt, not the others). Requirements per image:",
    "- Photorealistic, cinematic lighting, unified color grading. Keep ONE consistent visual style,",
    "  palette, and world across ALL images so the slideshow feels continuous.",
    "- 9:16 vertical composition with a single clear focal subject and calm negative space near the",
    "  top and bottom for caption overlay.",
    "- Depict the concrete idea of that narration beat (place, object, process, or distant figures).",
    "CONTENT SAFETY (express by OMISSION, never by negation — do not write words like \"weapon\",",
    "\"unarmed\", \"no blood\"):",
    "- No on-screen text, captions, watermarks, numbers, or logos.",
    "- No prominent photorealistic human faces; people only small, distant, and indistinct.",
    "- No weapons, blood, wounds, or combat — convey drama through architecture, skies, light,",
    "  weather, ruins, and the posture of distant figures.",
    "",
    "Respond with ONLY a JSON object (no markdown fences) of this exact shape:",
    "{",
    '  "slides": [',
    '    { "start": 0, "image_prompt": "<full standalone image prompt>" },',
    '    { "start": <seconds>, "image_prompt": "<full standalone image prompt>" }',
    "  ]",
    "}",
  ].join("\n");
}

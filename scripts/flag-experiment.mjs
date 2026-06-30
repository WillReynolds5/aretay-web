#!/usr/bin/env node
// ------------------------------------------------------------
//  Seedance E005 flag experiment
//
//  Reverse-engineers what trips Seedance's sensitive-content
//  filter by running controlled variants of one segment's real
//  inputs and measuring the flag rate of each (the filter is
//  stochastic — the same input can pass on attempt 4 — so every
//  variant runs multiple trials).
//
//  Usage (from aretay-admin/):
//    node --env-file=.env.local scripts/flag-experiment.mjs <courseId> <segmentKey> [--trials=3] [--duration=5] [--concurrency=3]
//    npm run experiment -- <courseId> <segmentKey>
//
//  Cost: flagged/failed predictions are not billed. Successful
//  ones bill ~$0.08 x duration seconds each (so duration=5 keeps
//  a passing trial around $0.40).
// ------------------------------------------------------------

import Replicate from "replicate";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "node:fs";

const SEEDANCE_MODEL = "bytedance/seedance-2.0";
const SEED = 99; // matches production

// A deliberately safe prompt — the control, and the carrier for
// audio-only / image-only reference tests.
const BLAND_PROMPT = [
  "A slow cinematic tour of an ancient Mediterranean city at golden hour.",
  "The camera glides past sunlit marble columns, stone courtyards, and quiet streets",
  "with olive trees swaying in a gentle breeze. Warm haze, glowing dust particles,",
  "photorealistic, vertical 9:16, smooth camera movement, soft ambient score.",
  "No on-screen text, watermarks, or logos.",
].join(" ");

// Words that plausibly trip a keyword filter, mapped to neutral
// replacements. Applied case-insensitively, longest-first.
const SANITIZE_MAP = [
  ["brutal fighting", "a hard-fought struggle"],
  ["intense wars", "long campaigns"],
  ["no weapons or armor", ""],
  ["absolutely no weapons", ""],
  ["unarmed", ""],
  ["weapons", "tools"],
  ["tyranny", "one-man rule"],
  ["fought", "contended"],
  ["fighting", "struggle"],
  ["wars", "campaigns"],
  ["war", "campaign"],
  ["armies", "expeditions"],
  ["executed", "carried out"],
  ["conquered", "unified"],
  ["defiance", "resolve"],
  ["brutal", "grueling"],
];

function parseArgs() {
  const positional = [];
  const flags = { trials: 3, duration: 5, concurrency: 3 };
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) flags[m[1]] = Number(m[2]) || m[2];
    else positional.push(arg);
  }
  return { courseId: positional[0], segmentKey: positional[1], ...flags };
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function fetchProduction(courseId, segmentKey) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing (use --env-file=.env.local)");

  const res = await fetch(
    `${url}/rest/v1/cards?course_id=eq.${courseId}&segment_key=eq.${encodeURIComponent(segmentKey)}&deleted_at=is.null&select=metadata`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) fail(`Supabase query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  const production = rows[0]?.metadata?.production;
  if (!production) fail(`No production metadata for ${segmentKey} — run the pipeline once first`);
  return production;
}

async function presign(key) {
  const client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT_URL,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const bucket = process.env.R2_BUCKET_NAME ?? "click-dataset";
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: 60 * 60 * 12,
  });
}

function sanitizeWords(text) {
  let out = text;
  for (const [from, to] of SANITIZE_MAP) {
    out = out.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), to);
  }
  return out.replace(/  +/g, " ");
}

function stripNarrationText(prompt, script) {
  // The narration is quoted verbatim inside the prompt — remove just that text.
  return prompt.includes(script)
    ? prompt.replace(script, "(narration provided via the reference audio file)")
    : prompt;
}

function classify(error) {
  const msg = typeof error === "string" ? error : JSON.stringify(error ?? "unknown error");
  if (/flagged as sensitive|E005/i.test(msg)) return { result: "FLAGGED", detail: msg };
  return { result: "ERROR", detail: msg };
}

async function runOnce(replicate, variant, ctx) {
  const input = {
    seed: SEED,
    prompt: variant.prompt.slice(0, 4000),
    duration: ctx.duration,
    resolution: "480p",
    aspect_ratio: "9:16",
    generate_audio: true,
    reference_audios: variant.audio ? [ctx.audioUrl] : [],
    reference_images: variant.image ? [ctx.imageUrl] : [],
    reference_videos: [],
  };

  const started = Date.now();
  try {
    const pred = await replicate.predictions.create({ model: SEEDANCE_MODEL, input });
    const final = await replicate.wait(pred);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (final.status === "succeeded") return { result: "PASS", seconds };
    return { ...classify(final.error), seconds };
  } catch (err) {
    const seconds = Math.round((Date.now() - started) / 1000);
    return { ...classify(err?.message ?? String(err)), seconds };
  }
}

async function main() {
  const { courseId, segmentKey, trials, duration, concurrency } = parseArgs();
  if (!courseId || !segmentKey) {
    fail("Usage: node --env-file=.env.local scripts/flag-experiment.mjs <courseId> <segmentKey> [--trials=3] [--duration=5] [--concurrency=3]");
  }
  if (!process.env.REPLICATE_API_TOKEN) fail("REPLICATE_API_TOKEN missing");

  console.log(`\nLoading production data for ${segmentKey}…`);
  const production = await fetchProduction(courseId, segmentKey);
  const { final_script: script, video_prompt: videoPrompt, audio_r2_key, board_r2_key } = production;
  if (!script || !videoPrompt) fail("Segment needs final_script and video_prompt — run the pipeline first");
  if (!audio_r2_key || !board_r2_key) fail("Segment needs audio and board in R2 — run the pipeline first");

  const ctx = {
    duration,
    audioUrl: await presign(audio_r2_key),
    imageUrl: await presign(board_r2_key),
  };

  // Each variant isolates ONE hypothesis about what gets flagged.
  const variants = [
    { name: "bland-control",       prompt: BLAND_PROMPT,                              audio: false, image: false, tests: "sanity — should always pass" },
    { name: "control-full",        prompt: videoPrompt,                               audio: true,  image: true,  tests: "reproduces production (expected to flag)" },
    { name: "text-only",           prompt: videoPrompt,                               audio: false, image: false, tests: "is the prompt TEXT alone flagged?" },
    { name: "audio-ref-only",      prompt: BLAND_PROMPT,                              audio: true,  image: false, tests: "is the narration AUDIO flagged?" },
    { name: "image-ref-only",      prompt: BLAND_PROMPT,                              audio: false, image: true,  tests: "is the BOARD IMAGE flagged?" },
    { name: "no-narration-quote",  prompt: stripNarrationText(videoPrompt, script),   audio: true,  image: true,  tests: "does removing the quoted script text fix it?" },
    { name: "sanitized-words",     prompt: sanitizeWords(videoPrompt),                audio: true,  image: true,  tests: "does replacing war/violence vocabulary fix it?" },
    { name: "narration-text-only", prompt: `A cinematic historical scene. Narration: "${script}"`, audio: false, image: false, tests: "is the SCRIPT text itself the trigger?" },
  ];

  const totalRuns = variants.length * trials;
  console.log(`\n${variants.length} variants × ${trials} trials = ${totalRuns} runs (duration ${duration}s, concurrency ${concurrency})`);
  console.log(`Cost: only PASSING runs bill (~$${(0.08 * duration).toFixed(2)} each). Flagged runs are free.\n`);

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  const queue = variants.flatMap(v => Array.from({ length: trials }, (_, i) => ({ variant: v, trial: i + 1 })));
  const results = [];

  async function worker() {
    while (queue.length) {
      const { variant, trial } = queue.shift();
      const r = await runOnce(replicate, variant, ctx);
      results.push({ variant: variant.name, trial, ...r });
      const mark = r.result === "PASS" ? "✓" : r.result === "FLAGGED" ? "✕" : "?";
      console.log(`  ${mark} ${variant.name} [${trial}/${trials}] → ${r.result} (${r.seconds}s)`);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  // ── report ──
  const summary = variants.map(v => {
    const rs = results.filter(r => r.variant === v.name);
    const flagged = rs.filter(r => r.result === "FLAGGED").length;
    const passed = rs.filter(r => r.result === "PASS").length;
    const errored = rs.filter(r => r.result === "ERROR").length;
    return { name: v.name, tests: v.tests, trials: rs.length, passed, flagged, errored, flagRate: rs.length ? flagged / rs.length : 0 };
  });

  const reportPath = `scripts/flag-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(reportPath, JSON.stringify({ courseId, segmentKey, duration, trials, variants: variants.map(({ name, prompt, audio, image, tests }) => ({ name, prompt, audio, image, tests })), results, summary }, null, 2));

  console.log("\n── RESULTS ──────────────────────────────────────────────");
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("variant", 22) + pad("pass", 6) + pad("flag", 6) + pad("err", 5) + "flag-rate  tests");
  for (const s of summary) {
    console.log(pad(s.name, 22) + pad(s.passed, 6) + pad(s.flagged, 6) + pad(s.errored, 5) + pad(`${Math.round(s.flagRate * 100)}%`, 11) + s.tests);
  }

  console.log("\n── HOW TO READ ──────────────────────────────────────────");
  console.log("bland-control flags        → something is wrong beyond inputs (account/model level)");
  console.log("image-ref-only flags       → the BOARD IMAGE is a trigger → ↻ Board");
  console.log("audio-ref-only flags       → the narration AUDIO is a trigger → soften script wording");
  console.log("text-only flags            → the prompt TEXT is a trigger; compare:");
  console.log("  no-narration-quote clean → the verbatim quoted script is the problem");
  console.log("  sanitized-words clean    → specific vocabulary (wars/tyranny/etc.) is the problem");
  console.log(`\nFull report: ${reportPath}\n`);
}

main();

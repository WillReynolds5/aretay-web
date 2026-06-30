#!/usr/bin/env node
// ------------------------------------------------------------
//  Follow-up to flag-experiment: is it FACES in reference images?
//
//  flag-experiment proved the board image (no weapons on it)
//  flags 100% as a Seedance reference. The surviving hypothesis:
//  prominent photorealistic human faces trip the filter
//  (ByteDance deepfake screening). This generates three boards
//  that differ ONLY in face prominence and tests each.
//
//  Usage: node --env-file=.env.local scripts/face-experiment.mjs [--trials=2 --duration=5]
// ------------------------------------------------------------

import Replicate from "replicate";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "node:fs";

const SEEDANCE_MODEL = "bytedance/seedance-2.0";
const IMAGE_MODEL = "openai/gpt-5.4-image-2";

const BLAND_PROMPT =
  "A slow cinematic tour of an ancient Mediterranean city at golden hour. The camera glides past sunlit marble columns, stone courtyards, and quiet streets with olive trees swaying in a gentle breeze. Warm haze, glowing dust particles, photorealistic, vertical 9:16, smooth camera movement, soft ambient score. No on-screen text, watermarks, or logos.";

const STYLE =
  "Cinematic, photorealistic, ancient Roman historical epic, warm golden hour amber tones, dramatic directional lighting, highly detailed, 8k.";

const TEST_IMAGES = [
  {
    name: "face-closeup",
    tests: "prominent photorealistic faces",
    prompt: `A 2x2 grid of labeled reference panels. ${STYLE} Each panel is a close-up portrait of a different Roman senator in a white toga — faces large, sharply detailed, filling most of each frame, varied ages and expressions, marble interiors behind them. Text label at the bottom of each panel: 'SENATOR I', 'SENATOR II', 'SENATOR III', 'SENATOR IV'.`,
  },
  {
    name: "distant-people",
    tests: "people present but small/indistinct",
    prompt: `A 2x2 grid of labeled reference panels. ${STYLE} Top-left labeled 'FORUM': a wide shot of the Roman forum with a crowd of toga-clad figures seen from far away, faces indistinct. Top-right labeled 'PROCESSION': a distant procession walking a stone road through a valley, figures tiny against the landscape. Bottom-left labeled 'HARBOR': a busy ancient harbor seen from a cliff, people like specks among ships. Bottom-right labeled 'AMPHITHEATER': a vast amphitheater with a distant seated crowd.`,
  },
  {
    name: "no-people",
    tests: "architecture/landscape only",
    prompt: `A 2x2 grid of labeled reference panels. ${STYLE} Top-left labeled 'TEMPLE': a marble temple with tall columns in morning light. Top-right labeled 'ROAD': an empty Roman stone road stretching across a misty valley. Bottom-left labeled 'FORUM': empty forum plaza with long shadows at dawn. Bottom-right labeled 'COAST': a rugged Mediterranean coastline with cypress trees, no people anywhere.`,
  },
];

function parseArgs() {
  const flags = { trials: 2, duration: 5, concurrency: 3 };
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) flags[m[1]] = Number(m[2]) || m[2];
  }
  return flags;
}

function getR2() {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT_URL,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}
const BUCKET = () => process.env.R2_BUCKET_NAME ?? "click-dataset";

async function generateImage(prompt) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("No image in OpenRouter response");
  if (url.startsWith("data:")) return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  const img = await fetch(url);
  return Buffer.from(await img.arrayBuffer());
}

function classify(error) {
  const msg = typeof error === "string" ? error : JSON.stringify(error ?? "unknown");
  if (/flagged as sensitive|E005/i.test(msg)) return { result: "FLAGGED", detail: msg };
  return { result: "ERROR", detail: msg };
}

async function runSeedance(replicate, imageUrl, duration) {
  const started = Date.now();
  try {
    const pred = await replicate.predictions.create({
      model: SEEDANCE_MODEL,
      input: {
        seed: 99,
        prompt: BLAND_PROMPT,
        duration,
        resolution: "480p",
        aspect_ratio: "9:16",
        generate_audio: true,
        reference_audios: [],
        reference_images: [imageUrl],
        reference_videos: [],
      },
    });
    const final = await replicate.wait(pred);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (final.status === "succeeded") return { result: "PASS", seconds };
    return { ...classify(final.error), seconds };
  } catch (err) {
    return { ...classify(err?.message ?? String(err)), seconds: Math.round((Date.now() - started) / 1000) };
  }
}

async function main() {
  const { trials, duration, concurrency } = parseArgs();
  for (const v of ["REPLICATE_API_TOKEN", "OPENROUTER_API_KEY", "R2_ENDPOINT_URL"]) {
    if (!process.env[v]) { console.error(`✗ ${v} missing`); process.exit(1); }
  }

  const r2 = getR2();
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  console.log("\nGenerating test images (GPT Image)…");
  const images = [];
  for (const t of TEST_IMAGES) {
    const buffer = await generateImage(t.prompt);
    const key = `aretay/experiments/face-test-${t.name}.png`;
    await r2.send(new PutObjectCommand({ Bucket: BUCKET(), Key: key, Body: buffer, ContentType: "image/png" }));
    const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: BUCKET(), Key: key }), { expiresIn: 60 * 60 * 12 });
    images.push({ ...t, key, url });
    console.log(`  ✓ ${t.name} (${Math.round(buffer.length / 1024)} KB) → r2:${key}`);
  }

  console.log(`\n${images.length} images × ${trials} trials, bland prompt + image ref only\n`);
  const queue = images.flatMap(img => Array.from({ length: trials }, (_, i) => ({ img, trial: i + 1 })));
  const results = [];

  async function worker() {
    while (queue.length) {
      const { img, trial } = queue.shift();
      const r = await runSeedance(replicate, img.url, duration);
      results.push({ image: img.name, trial, ...r });
      const mark = r.result === "PASS" ? "✓" : r.result === "FLAGGED" ? "✕" : "?";
      console.log(`  ${mark} ${img.name} [${trial}/${trials}] → ${r.result} (${r.seconds}s)`);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  const reportPath = `scripts/face-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(reportPath, JSON.stringify({ images: images.map(({ name, key, tests, prompt }) => ({ name, key, tests, prompt })), results }, null, 2));

  console.log("\n── RESULTS ──────────────────────────────────────────────");
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("image", 18) + pad("pass", 6) + pad("flag", 6) + pad("err", 5) + "tests");
  for (const img of images) {
    const rs = results.filter(r => r.image === img.name);
    console.log(
      pad(img.name, 18) +
      pad(rs.filter(r => r.result === "PASS").length, 6) +
      pad(rs.filter(r => r.result === "FLAGGED").length, 6) +
      pad(rs.filter(r => r.result === "ERROR").length, 5) +
      img.tests,
    );
  }
  console.log(`\nface-closeup flags + distant/no-people pass → prominent faces are the trigger`);
  console.log(`Full report: ${reportPath}\n`);
}

main();

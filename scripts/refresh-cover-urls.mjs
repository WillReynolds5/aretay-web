#!/usr/bin/env node
// Rewrites courses.cover_image_url from expired presigned R2 URLs to stable
// public URLs. Requires R2_PUBLIC_BASE_URL in .env.local.
//
// Usage (from aretay-admin/):
//   node --env-file=.env.local scripts/refresh-cover-urls.mjs
//   npm run refresh-covers

import { createClient } from "@supabase/supabase-js";

function extractR2Key(stored) {
  const idx = stored.indexOf("aretay/courses/");
  if (idx === -1) return null;
  return stored.slice(idx).split("?")[0] || null;
}

const publicBase = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
if (!publicBase) {
  console.error("R2_PUBLIC_BASE_URL is required in .env.local");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  process.exit(1);
}

const client = createClient(url, key, { auth: { persistSession: false } });

const { data: courses, error } = await client
  .from("courses")
  .select("id, title, cover_image_url")
  .is("deleted_at", null)
  .not("cover_image_url", "is", null);

if (error) {
  console.error(error.message);
  process.exit(1);
}

let updated = 0;
for (const course of courses ?? []) {
  const r2Key = extractR2Key(course.cover_image_url);
  if (!r2Key) continue;
  const publicUrl = `${publicBase}/${r2Key}`;
  if (publicUrl === course.cover_image_url) continue;
  const { error: updateError } = await client
    .from("courses")
    .update({ cover_image_url: publicUrl })
    .eq("id", course.id);
  if (updateError) {
    console.error(`${course.title}: ${updateError.message}`);
    continue;
  }
  console.log(`✓ ${course.title}`);
  updated += 1;
}

console.log(`\nUpdated ${updated} of ${courses?.length ?? 0} course(s).`);

import { getCardDataMap, syncCardsForCourse } from "./cards";
import { getCourseCurriculum } from "./course-curriculum";
import { flattenScripts } from "./curriculum";
import { getVideoUrl } from "./r2";
import { getSupabaseAdmin } from "./supabase-admin";

// ------------------------------------------------------------
//  Server-side "Generate all" job
//
//  The bulk production loop runs inside the Next.js process so a
//  page reload or closed tab doesn't kill generation. One job per
//  course, state in module memory (this admin is local-only,
//  single-instance). Work executes by calling the existing API
//  routes over localhost, so every stage keeps its caching and
//  cost-ledger behavior. A killed server is safe too: every stage
//  skips what already exists, so restarting the job resumes.
// ------------------------------------------------------------

export type BulkJobStatus = {
  courseId: string;
  phase: "running" | "done";
  total: number;
  done: number;
  failed: string[];
  active: string[];
  stopping: boolean;
  startedAt: string;
  finishedAt: string | null;
};

type BulkJob = Omit<BulkJobStatus, "stopping"> & { cancelRequested: boolean };

type SegmentItem = { segmentKey: string; script: string };
type CaptionItem = { segmentKey: string; videoUrl: string };

type BulkPlan = {
  needsCover: boolean;
  segments: SegmentItem[];
  captionOnly: CaptionItem[];
};

// Survive Next.js dev-mode HMR module reloads.
const globalStore = globalThis as unknown as { __aretayBulkJobs?: Map<string, BulkJob> };
const jobs = (globalStore.__aretayBulkJobs ??= new Map<string, BulkJob>());

function toStatus(job: BulkJob): BulkJobStatus {
  return {
    courseId: job.courseId,
    phase: job.phase,
    total: job.total,
    done: job.done,
    failed: [...job.failed],
    active: [...job.active],
    stopping: job.cancelRequested && job.phase === "running",
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export function getBulkJob(courseId: string): BulkJobStatus | null {
  const job = jobs.get(courseId);
  return job ? toStatus(job) : null;
}

export function cancelBulkJob(courseId: string): BulkJobStatus | null {
  const job = jobs.get(courseId);
  if (!job) return null;
  if (job.phase === "running") job.cancelRequested = true;
  return toStatus(job);
}

export async function startBulkJob(
  courseId: string,
  origin: string,
  videoRetries: number,
): Promise<{ job: BulkJobStatus; alreadyRunning: boolean }> {
  const existing = jobs.get(courseId);
  if (existing?.phase === "running") {
    return { job: toStatus(existing), alreadyRunning: true };
  }

  const plan = await buildPlan(courseId);
  const total = plan.segments.length + plan.captionOnly.length + (plan.needsCover ? 1 : 0);

  const job: BulkJob = {
    courseId,
    phase: "running",
    total,
    done: 0,
    failed: [],
    active: [],
    cancelRequested: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(courseId, job);

  void runJob(job, plan, origin, videoRetries)
    .catch(err => {
      console.error(`bulk job for ${courseId} crashed:`, err);
    })
    .finally(() => {
      job.phase = "done";
      job.active = [];
      job.finishedAt = new Date().toISOString();
    });

  return { job: toStatus(job), alreadyRunning: false };
}

async function buildPlan(courseId: string): Promise<BulkPlan> {
  const curriculum = await getCourseCurriculum(courseId);
  if (!curriculum?.lessons?.length) throw new Error("Course has no curriculum");

  await syncCardsForCourse(courseId);
  const cards = await getCardDataMap(courseId);

  const segments: SegmentItem[] = [];
  const captionOnly: CaptionItem[] = [];
  for (const script of flattenScripts(curriculum)) {
    const card = cards.get(script.segmentKey);
    if (!card?.video_r2_key) {
      segments.push({ segmentKey: script.segmentKey, script: script.script });
    } else if (!card.captions || card.captions.length === 0) {
      captionOnly.push({ segmentKey: script.segmentKey, videoUrl: await getVideoUrl(card.video_r2_key) });
    }
  }

  const { client } = getSupabaseAdmin();
  const { data, error } = await client
    .from("courses")
    .select("cover_image_url")
    .eq("id", courseId)
    .is("deleted_at", null)
    .single();
  if (error) throw new Error(error.message);

  return { needsCover: !data.cover_image_url, segments, captionOnly };
}

async function postJson(origin: string, path: string, body: Record<string, unknown>) {
  const res = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `${path} failed (${res.status})`);
  }
  return data;
}

async function runJob(job: BulkJob, plan: BulkPlan, origin: string, videoRetries: number) {
  const retries = Math.max(1, videoRetries);
  const courseId = job.courseId;

  async function runItem(label: string, work: () => Promise<void>) {
    if (job.cancelRequested) return;
    job.active.push(label);
    try {
      await work();
      job.done += 1;
    } catch {
      job.failed.push(label);
    } finally {
      job.active = job.active.filter(l => l !== label);
    }
  }

  async function pool<T>(items: T[], worker: (item: T) => Promise<void>, concurrency = 2) {
    const queue = [...items];
    await Promise.all(
      Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, async () => {
        while (queue.length && !job.cancelRequested) {
          await worker(queue.shift()!);
        }
      }),
    );
  }

  async function produceSegment(s: SegmentItem) {
    await postJson(origin, "/api/generate-audio", { script: s.script, courseId, segmentKey: s.segmentKey });
    await postJson(origin, "/api/generate-board", { courseId, segmentKey: s.segmentKey });
    await postJson(origin, "/api/generate-video-prompt", { courseId, segmentKey: s.segmentKey });
    let lastError: unknown = null;
    let url: string | null = null;
    for (let attempt = 1; attempt <= retries && !url; attempt++) {
      try {
        const video = await postJson(origin, "/api/generate-video", { courseId, segmentKey: s.segmentKey });
        url = typeof video.url === "string" ? video.url : null;
        lastError = url ? null : new Error("Video route returned no URL");
      } catch (err) {
        lastError = err;
      }
    }
    if (!url) throw lastError ?? new Error("Video failed");
    await postJson(origin, "/api/transcribe-captions", { videoUrl: url, courseId, segmentKey: s.segmentKey });
  }

  if (plan.needsCover) {
    await runItem("cover", async () => {
      await postJson(origin, "/api/generate-cover", { courseId });
    });
  }
  await pool(plan.segments, s => runItem(s.segmentKey, () => produceSegment(s)));
  await pool(plan.captionOnly, c =>
    runItem(`${c.segmentKey} captions`, async () => {
      await postJson(origin, "/api/transcribe-captions", {
        videoUrl: c.videoUrl,
        courseId,
        segmentKey: c.segmentKey,
      });
    }),
  );
}

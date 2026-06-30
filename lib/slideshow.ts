import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// Output canvas — matches the Remotion LessonVideo composition (1080x1920, 9:16)
// so the caption overlay lines up exactly with slideshow videos too.
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

export type SlideFrame = {
  /** Raw image bytes (any format ffmpeg can decode). */
  buffer: Buffer;
  /** How long this frame stays on screen, in seconds. */
  durationSeconds: number;
};

/** Scales/crops one image to fill the 1080x1920 canvas (center-crop overflow). */
function normalizeFrame(srcPath: string, destPath: string) {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      srcPath,
      "-vf",
      `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1`,
      "-frames:v",
      "1",
      destPath,
    ],
    { stdio: "pipe" },
  );
}

/**
 * Stitches a sequence of stills over a narration track into an MP4.
 *
 * Each image is first normalized to the 1080x1920 canvas, then the concat
 * demuxer assembles them with per-frame durations and the audio is muxed in.
 * The video is trimmed to the audio length so it never runs long.
 */
export function buildSlideshowVideo(frames: SlideFrame[], audio: Buffer): Buffer {
  if (frames.length === 0) throw new Error("Slideshow needs at least one frame");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aretay-slideshow-"));

  try {
    const audioPath = path.join(tmpDir, "narration.wav");
    fs.writeFileSync(audioPath, audio);

    // Normalize every frame and build the concat list. The concat demuxer
    // needs the final entry repeated without a trailing duration so the last
    // image's duration is honored.
    const listLines: string[] = [];
    frames.forEach((frame, i) => {
      const rawPath = path.join(tmpDir, `raw-${i}`);
      const normPath = path.join(tmpDir, `frame-${i}.png`);
      fs.writeFileSync(rawPath, frame.buffer);
      normalizeFrame(rawPath, normPath);

      const duration = Math.max(0.5, frame.durationSeconds);
      listLines.push(`file '${normPath}'`);
      listLines.push(`duration ${duration.toFixed(3)}`);
    });
    listLines.push(`file '${path.join(tmpDir, `frame-${frames.length - 1}.png`)}'`);

    const listPath = path.join(tmpDir, "frames.txt");
    fs.writeFileSync(listPath, listLines.join("\n"));

    const outPath = path.join(tmpDir, "out.mp4");
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-i",
        audioPath,
        "-vf",
        `fps=${FPS},format=yuv420p`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        "-movflags",
        "+faststart",
        outPath,
      ],
      { stdio: "pipe" },
    );

    return fs.readFileSync(outPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Turns ascending slide start times into per-frame durations that fill the
 * narration. The last slide runs to the end of the audio.
 */
export function slideDurations(starts: number[], audioDuration: number): number[] {
  return starts.map((start, i) => {
    const next = i + 1 < starts.length ? starts[i + 1] : audioDuration;
    return Math.max(0.5, next - start);
  });
}

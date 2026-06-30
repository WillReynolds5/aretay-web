import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { Caption } from "@remotion/captions";
import {
  downloadWhisperModel,
  installWhisperCpp,
  transcribe,
  toCaptions,
} from "@remotion/install-whisper-cpp";

const WHISPER_VERSION = "1.5.5";
const WHISPER_MODEL = "medium.en" as const;
const WHISPER_DIR = path.join(process.cwd(), ".whisper-cpp");

let installPromise: Promise<void> | null = null;

async function ensureWhisper() {
  if (!installPromise) {
    installPromise = (async () => {
      await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION, printOutput: true });
      await downloadWhisperModel({ model: WHISPER_MODEL, folder: WHISPER_DIR, printOutput: true });
    })();
  }
  await installPromise;
}

function extractAudioWav(videoPath: string, wavPath: string) {
  execSync(
    `ffmpeg -y -i "${videoPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`,
    { stdio: "pipe" },
  );
}

export async function transcribeVideoFile(videoPath: string): Promise<Caption[]> {
  await ensureWhisper();

  const wavPath = `${videoPath.replace(/\.[^.]+$/, "")}.wav`;
  extractAudioWav(videoPath, wavPath);

  try {
    const whisperCppOutput = await transcribe({
      model: WHISPER_MODEL,
      whisperPath: WHISPER_DIR,
      whisperCppVersion: WHISPER_VERSION,
      inputPath: wavPath,
      tokenLevelTimestamps: true,
      printOutput: true,
    });

    const { captions } = toCaptions({ whisperCppOutput });
    return captions;
  } finally {
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
  }
}

export async function transcribeFromUrl(videoUrl: string): Promise<Caption[]> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aretay-transcribe-"));
  const videoPath = path.join(tmpDir, "video.mp4");

  try {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error("Failed to download video for transcription");
    fs.writeFileSync(videoPath, Buffer.from(await res.arrayBuffer()));
    return await transcribeVideoFile(videoPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

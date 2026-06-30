import { OpenRouter } from "@openrouter/sdk";

export const TEXT_MODEL = "google/gemini-3.1-pro-preview";
export const IMAGE_MODEL = "openai/gpt-5.4-image-2";
// Nano Banana 2 — cheap, fast still images for voice-review backdrops (RFC §5.2, §8.3).
export const NANO_BANANA_MODEL = "google/gemini-3.1-flash-image-preview";

export function getOpenRouter(): OpenRouter {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  return new OpenRouter({ apiKey });
}

export function extractContent(result: unknown): string {
  if (!result || typeof result !== "object") return "";

  const choices = (result as { choices?: unknown[] }).choices;
  const first = choices?.[0];
  if (!first || typeof first !== "object") return "";

  const message = (first as { message?: { content?: unknown } }).message;
  const content = message?.content;

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === "object" && part && "text" in part ? String(part.text) : ""))
      .join("");
  }

  return "";
}

function extractImageUrl(result: unknown): string {
  const choices = (result as { choices?: unknown[] })?.choices;
  const first = choices?.[0];
  const message = (first as { message?: { images?: unknown[] } } | undefined)?.message;
  const image = message?.images?.[0];
  if (image && typeof image === "object") {
    const holder = image as { imageUrl?: { url?: string }; image_url?: { url?: string } };
    const url = holder.imageUrl?.url ?? holder.image_url?.url;
    if (url) return url;
  }
  throw new Error("Image model returned no image");
}

/** OpenRouter reports the exact charge (in USD credits) on each response. */
function extractCostUsd(result: unknown): number {
  const usage = (result as { usage?: { cost?: number | null } } | null)?.usage;
  return typeof usage?.cost === "number" ? usage.cost : 0;
}

export async function runTextPrompt(
  prompt: string,
  maxTokens = 8192,
): Promise<{ text: string; costUsd: number }> {
  const openrouter = getOpenRouter();
  const result = await openrouter.chat.send({
    chatRequest: {
      model: TEXT_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      maxTokens,
    },
  });
  const content = extractContent(result).trim();
  if (!content) throw new Error("LLM returned an empty response");
  return { text: content, costUsd: extractCostUsd(result) };
}

/**
 * Generates a single image and returns its bytes. Pass `referenceImageUrl` to
 * supply a style/subject anchor (e.g. the parent board or course cover) so the
 * output inherits the course's visual identity, and `model` to choose between
 * the high-quality default (GPT Image) and the cheap Nano Banana 2.
 */
export async function generateImage(
  prompt: string,
  opts: { model?: string; referenceImageUrl?: string } = {},
): Promise<{ buffer: Buffer; costUsd: number }> {
  const openrouter = getOpenRouter();
  const content = opts.referenceImageUrl
    ? [
        { type: "text" as const, text: prompt },
        { type: "image_url" as const, imageUrl: { url: opts.referenceImageUrl } },
      ]
    : prompt;
  const result = await openrouter.chat.send({
    chatRequest: {
      model: opts.model ?? IMAGE_MODEL,
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
      stream: false,
    },
  });
  const costUsd = extractCostUsd(result);

  const url = extractImageUrl(result);
  if (url.startsWith("data:")) {
    const base64 = url.slice(url.indexOf(",") + 1);
    return { buffer: Buffer.from(base64, "base64"), costUsd };
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to download generated image");
  return { buffer: Buffer.from(await res.arrayBuffer()), costUsd };
}

/** Parses JSON out of an LLM response, tolerating markdown code fences. */
export function parseJsonResponse(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("LLM response contained no JSON object");
  return JSON.parse(candidate.slice(start, end + 1));
}

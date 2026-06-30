import Replicate from "replicate";

export function getReplicate(): Replicate {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN is not configured");
  return new Replicate({ auth: token });
}

export function resolveOutputUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.length) return resolveOutputUrl(output[0]);
  if (
    output &&
    typeof output === "object" &&
    "url" in output &&
    typeof (output as { url: () => URL }).url === "function"
  ) {
    return (output as { url: () => URL }).url().href;
  }
  throw new Error("Unexpected Replicate output format");
}

export async function fetchOutputBuffer(output: unknown): Promise<Buffer> {
  const url = resolveOutputUrl(output);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download Replicate output (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Like replicate.run, but also returns the prediction's measured GPU time
 * so hardware-billed models can be costed.
 */
export async function runWithMetrics(
  replicate: Replicate,
  ref: string,
  input: Record<string, unknown>,
): Promise<{ output: unknown; predictTimeSeconds: number | null }> {
  const version = ref.includes(":") ? ref.split(":")[1] : null;
  const created = version
    ? await replicate.predictions.create({ version, input })
    : await replicate.predictions.create({ model: ref, input });

  const final = await replicate.wait(created);
  if (final.status !== "succeeded") {
    throw new Error(
      typeof final.error === "string" ? final.error : `Prediction ${final.status}`,
    );
  }

  const predictTime = (final.metrics as { predict_time?: number } | undefined)?.predict_time;
  return {
    output: final.output,
    predictTimeSeconds: typeof predictTime === "number" ? predictTime : null,
  };
}

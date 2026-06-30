/**
 * Reads the duration of a WAV buffer by walking its RIFF chunks.
 * Kokoro returns PCM WAV, so no decoding library is needed.
 */
export function wavDurationSeconds(buf: Buffer): number {
  if (
    buf.length < 44 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Audio output is not a WAV file");
  }

  let offset = 12;
  let byteRate: number | null = null;
  let dataSize: number | null = null;

  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;

    if (id === "fmt " && dataStart + 12 <= buf.length) {
      byteRate = buf.readUInt32LE(dataStart + 8);
    }
    if (id === "data") {
      // Some encoders write 0 / overflow sizes for streamed WAVs; fall back to what's actually there.
      dataSize = size > 0 && dataStart + size <= buf.length ? size : buf.length - dataStart;
    }

    offset = dataStart + size + (size % 2);
  }

  if (!byteRate || dataSize == null) throw new Error("Malformed WAV file");
  return dataSize / byteRate;
}

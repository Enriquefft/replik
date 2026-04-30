import "server-only";
import OpenAI from "openai";

const WHISPER_MODEL = "whisper-1";

let cachedClient: OpenAI | undefined;

function client(): OpenAI {
  cachedClient ??= new OpenAI();
  return cachedClient;
}

export interface TranscribeResult {
  text: string;
  language: string;
  srt: string;
}

/**
 * Lane L3b — Whisper transcription with SRT synthesis.
 *
 * Single `verbose_json` round-trip. Whisper returns segments with start/end
 * timestamps; we synthesize an SRT cue for each segment instead of asking
 * for `srt` separately. One API call, identical billing, zero drift between
 * the language detection and the timed cues.
 */
export async function transcribe(videoUrl: string): Promise<TranscribeResult> {
  const response = await fetch(videoUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `transcribe: download failed ${response.status.toString()} ${response.statusText}`,
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  const filename = inferFilename(videoUrl);
  const file = new File([arrayBuffer], filename, {
    type: response.headers.get("content-type") ?? "video/mp4",
  });

  const verbose = await client().audio.transcriptions.create({
    file,
    model: WHISPER_MODEL,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const segments = verbose.segments ?? [];
  const srt = segments.length > 0 ? buildSrt(segments) : synthesizeFromText(verbose.text, verbose.duration);

  return {
    text: verbose.text,
    language: verbose.language,
    srt,
  };
}

interface SrtSegment {
  start: number;
  end: number;
  text: string;
}

function buildSrt(segments: SrtSegment[]): string {
  const lines: string[] = [];
  segments.forEach((segment, index) => {
    const cueIndex = index + 1;
    const start = formatTimestamp(segment.start);
    const end = formatTimestamp(segment.end);
    const text = segment.text.trim();
    lines.push(cueIndex.toString(), `${start} --> ${end}`, text, "");
  });
  return lines.join("\n");
}

/**
 * Fallback when Whisper omits segments (very short clips). Emits one cue
 * spanning the full duration so libass still has a real timeline to render.
 */
function synthesizeFromText(text: string, duration: number): string {
  const start = formatTimestamp(0);
  const end = formatTimestamp(Math.max(duration, 0.5));
  return ["1", `${start} --> ${end}`, text.trim(), ""].join("\n");
}

function formatTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const totalMs = Math.round(clamped * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}

function inferFilename(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").pop();
    if (last?.includes(".")) return last;
  } catch {
    // fall through
  }
  return "input.mp4";
}

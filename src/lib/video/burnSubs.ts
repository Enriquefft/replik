import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "@trigger.dev/sdk";

export interface BurnSubsInput {
  videoUrl: string;
  srt: string;
}

export interface BurnSubsResult {
  buffer: Buffer;
  mime: "video/mp4";
}

const FONT_NAME = "DejaVu Sans";
const FONT_SIZE = 20;
const SUBTITLE_STYLE = [
  `FontName=${FONT_NAME}`,
  `FontSize=${FONT_SIZE.toString()}`,
  // PrimaryColour: white fill (libass uses &HAABBGGRR, AA=00 = opaque)
  "PrimaryColour=&H00FFFFFF",
  // OutlineColour: black
  "OutlineColour=&H00000000",
  // BorderStyle=1 means outline + drop shadow (no opaque box)
  "BorderStyle=1",
  "Outline=2",
  "Shadow=0",
  // Alignment=2 = bottom-center (libass numpad layout)
  "Alignment=2",
  // MarginV=40 lifts the cue 40px above the bottom edge
  "MarginV=40",
].join(",");

/**
 * Lane L3b — burn translated SRT into video using libass via ffmpeg.
 *
 * Command (assembled programmatically below):
 *
 *   ffmpeg -y -i input.mp4 \
 *     -vf "subtitles=input.srt:force_style='FontName=DejaVu Sans,FontSize=20,
 *          PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,
 *          Outline=2,Shadow=0,Alignment=2,MarginV=40'" \
 *     -c:v libx264 -crf 23 -preset medium -c:a copy output.mp4
 *
 * No crop, no speed change. Audio passthrough. ffmpeg path comes from PATH —
 * the `ffmpeg()` build extension installs the static binary system-wide on
 * Trigger workers; locally `bun run trigger:dev` resolves it the same way.
 */
export async function burnSubs(input: BurnSubsInput): Promise<BurnSubsResult> {
  const workdir = await mkdtemp(join(tmpdir(), "replik-burn-"));
  const inputPath = join(workdir, "input.mp4");
  const srtPath = join(workdir, "input.srt");
  const outputPath = join(workdir, "output.mp4");

  try {
    const response = await fetch(input.videoUrl, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(
        `burnSubs: download failed ${response.status.toString()} ${response.statusText}`,
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    await writeFile(inputPath, Buffer.from(arrayBuffer));
    await writeFile(srtPath, input.srt, "utf8");

    const args = [
      "-y",
      "-progress",
      "pipe:2",
      "-nostats",
      "-i",
      inputPath,
      "-vf",
      `subtitles=${escapeFilterArg(srtPath)}:force_style='${SUBTITLE_STYLE}'`,
      "-c:v",
      "libx264",
      "-crf",
      "23",
      "-preset",
      "medium",
      "-c:a",
      "copy",
      outputPath,
    ];

    await runFfmpeg(args);

    const buffer = await readFile(outputPath);
    return { buffer, mime: "video/mp4" };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

function runFfmpeg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
    const child = spawn(ffmpegPath, [...args], { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      // ffmpeg `-progress pipe:2` emits `key=value` lines; surface out_time_ms.
      const match = /out_time_ms=(\d+)/.exec(chunk);
      if (match?.[1]) {
        const outTimeMs = Number.parseInt(match[1], 10);
        if (Number.isFinite(outTimeMs)) {
          logger.info("burn_progress", { outTimeMs });
        }
      }
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `ffmpeg exited with code ${(code ?? -1).toString()}: ${stderr.slice(-2000)}`,
          ),
        );
      }
    });
  });
}

/**
 * Escape an absolute path for the `subtitles=` filter argument. The libavfilter
 * parser splits on `:` and `,`; on POSIX paths the colon never appears, but
 * commas in directory names would corrupt the filter graph.
 */
function escapeFilterArg(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/,/g, "\\,");
}

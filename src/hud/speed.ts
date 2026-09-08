import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { PINGLET_DIR } from "../config";
import { atomicWrite } from "../storage";
import { StatuslinePayload } from "./stdin";

/**
 * 출력 속도(tok/s) — claude-hud의 speed-tracker와 같은 방식.
 * 이전 tick의 output_tokens와 시각을 transcript 경로별 캐시에 남겨 두고 증가분으로 계산한다.
 *   - 2초를 넘긴 창은 버린다 (유휴 뒤 첫 tick이 거대한 속도로 보이지 않게)
 *   - 0.5초 미만 창은 보고하지 않는다 (렌더가 초당 여러 번 돌면 노이즈가 커진다)
 *   - output_tokens가 없으면 transcript 파일 크기 증가(≈4바이트/토큰)로 추정한다
 */
const SPEED_WINDOW_MS = 2000;
const MIN_DELTA_MS = 500;
const BYTES_PER_TOKEN = 4;
const CACHE_DIR = path.join(PINGLET_DIR, "hud-cache", "speed");

interface Sample {
  value: number;
  timestamp: number;
}

function cachePath(transcriptPath: string, suffix: string): string {
  const hash = createHash("sha256").update(path.resolve(transcriptPath)).digest("hex").slice(0, 32);
  return path.join(CACHE_DIR, `${hash}${suffix}.json`);
}

function readSample(file: string): Sample | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Sample;
    return typeof parsed?.value === "number" && typeof parsed.timestamp === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function writeSample(file: string, sample: Sample): void {
  try {
    atomicWrite(file, JSON.stringify(sample));
  } catch {
    // 캐시 실패는 표시에 영향을 주면 안 된다.
  }
}

function rate(file: string, value: number, now: number): number | null {
  const previous = readSample(file);
  if (!previous || value < previous.value) {
    writeSample(file, { value, timestamp: now });
    return null;
  }
  const deltaValue = value - previous.value;
  const deltaMs = now - previous.timestamp;
  if (deltaMs > SPEED_WINDOW_MS || deltaValue <= 0) {
    writeSample(file, { value, timestamp: now });
    return null;
  }
  if (deltaMs < MIN_DELTA_MS) return null;
  writeSample(file, { value, timestamp: now });
  return deltaValue / (deltaMs / 1000);
}

export function getOutputSpeed(payload: StatuslinePayload, now = Date.now()): number | null {
  const transcriptPath = typeof payload.transcript_path === "string" ? payload.transcript_path.trim() : "";
  if (!transcriptPath) return null; // 세션 키가 없으면 다른 세션과 캐시가 섞인다.

  const outputTokens = payload.context_window?.current_usage?.output_tokens;
  if (typeof outputTokens === "number" && Number.isFinite(outputTokens)) {
    return rate(cachePath(transcriptPath, ""), outputTokens, now);
  }

  try {
    const stat = fs.statSync(transcriptPath);
    if (!stat.isFile()) return null;
    const tokens = rate(cachePath(transcriptPath, ".fs"), stat.size, now);
    return tokens === null ? null : tokens / BYTES_PER_TOKEN;
  } catch {
    return null;
  }
}

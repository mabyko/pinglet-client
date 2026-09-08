import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { PINGLET_DIR } from "../config";
import { atomicWrite } from "../storage";

/**
 * 기기 전체 RAM 사용률 — claude-hud의 "Approx RAM" 줄과 같은 계산.
 *   macOS: vm_stat의 active + wired 페이지 (compressed·inactive는 제외)
 *   Linux: /proc/meminfo의 MemTotal - MemAvailable
 *   그 외: os.totalmem() - os.freemem()
 * vm_stat은 서브프로세스라 MEMORY_CACHE_MS 동안 결과를 재사용한다.
 */
export interface MemoryInfo {
  totalBytes: number;
  usedBytes: number;
  usedPercent: number;
}

const CACHE_PATH = path.join(PINGLET_DIR, "hud-cache", "memory.json");
const MEMORY_CACHE_MS = 5_000;

interface MemoryCacheFile {
  checkedAt: number;
  info: MemoryInfo | null;
}

export function parseVmStat(output: string): { pageSize: number; active: number; wired: number } | null {
  const pageSize = output.match(/page size of (\d+) bytes/);
  const active = output.match(/Pages active:\s+(\d+)/);
  const wired = output.match(/Pages wired down:\s+(\d+)/);
  if (!pageSize || !active || !wired) return null;
  return { pageSize: Number(pageSize[1]), active: Number(active[1]), wired: Number(wired[1]) };
}

export function parseLinuxMeminfo(output: string): { totalBytes: number; freeBytes: number } | null {
  const total = output.match(/^MemTotal:\s+(\d+)\s+kB/m);
  const available = output.match(/^MemAvailable:\s+(\d+)\s+kB/m);
  if (!total || !available) return null;
  return { totalBytes: Number(total[1]) * 1024, freeBytes: Number(available[1]) * 1024 };
}

function readRaw(): { totalBytes: number; freeBytes: number } {
  const fallback = () => ({ totalBytes: os.totalmem(), freeBytes: os.freemem() });
  try {
    if (process.platform === "darwin") {
      const parsed = parseVmStat(execFileSync("/usr/bin/vm_stat", { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }));
      if (!parsed) return fallback();
      const totalBytes = os.totalmem();
      return { totalBytes, freeBytes: totalBytes - (parsed.active + parsed.wired) * parsed.pageSize };
    }
    if (process.platform === "linux") {
      return parseLinuxMeminfo(fs.readFileSync("/proc/meminfo", "utf8")) ?? fallback();
    }
  } catch {
    // 플랫폼 도구 실패 — Node 값으로.
  }
  return fallback();
}

export function toMemoryInfo(raw: { totalBytes: number; freeBytes: number }): MemoryInfo | null {
  if (!Number.isFinite(raw.totalBytes) || raw.totalBytes <= 0) return null;
  const free = Number.isFinite(raw.freeBytes) ? Math.min(Math.max(raw.freeBytes, 0), raw.totalBytes) : 0;
  const usedBytes = raw.totalBytes - free;
  return {
    totalBytes: raw.totalBytes,
    usedBytes,
    usedPercent: Math.min(100, Math.max(0, Math.round((usedBytes / raw.totalBytes) * 100))),
  };
}

export function getMemoryUsage(now = Date.now()): MemoryInfo | null {
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as MemoryCacheFile;
    if (cached && typeof cached.checkedAt === "number" && now - cached.checkedAt < MEMORY_CACHE_MS) return cached.info;
  } catch {
    // 캐시 없음
  }
  const info = toMemoryInfo(readRaw());
  try {
    atomicWrite(CACHE_PATH, JSON.stringify({ checkedAt: now, info } satisfies MemoryCacheFile));
  } catch {
    // 캐시 실패는 표시에 영향을 주면 안 된다.
  }
  return info;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

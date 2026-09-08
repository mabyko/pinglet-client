import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { createHash } from "crypto";
import { PINGLET_DIR } from "../config";
import { atomicWrite } from "../storage";

/**
 * 세션 transcript(JSONL)에서 활동 정보만 뽑는다 — claude-hud의 transcript.ts와 같은 방식.
 * 도구 호출, 서브 에이전트, todo 진행, 스킬, 자문 모델, prompt cache 시계, 세션 누적 토큰,
 * 압축 횟수, ultracode 상태. prompt/응답 본문은 저장하지 않는다.
 *
 * 파일은 비동기 스트림(readline)으로 한 줄씩 읽고, mtime+size가 같으면
 * `~/.pinglet/hud-cache/`의 결과를 재사용한다.
 */

export interface ToolEntry {
  id: string;
  name: string;
  target?: string;
  status: "running" | "completed" | "error";
  startTime: number;
  endTime?: number;
}

export interface AgentEntry {
  id: string;
  type: string;
  model?: string;
  description?: string;
  status: "running" | "completed";
  startTime: number;
  endTime?: number;
  background: boolean;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface TranscriptData {
  tools: ToolEntry[];
  agents: AgentEntry[];
  todos: TodoItem[];
  /** 세션에서 호출된 Skill 이름 (중복 제거, 호출 순). */
  skills: string[];
  sessionStart?: number;
  sessionName?: string;
  /** `/advisor`로 지정된 자문 모델 ID — assistant 기록의 advisorModel 필드, 마지막 값. */
  advisorModel?: string;
  /**
   * prompt cache 시계의 기준 시각(epoch ms) — 메인 대화의 마지막 API 요청이 시작된 시각.
   * 응답 기록이 아니라 그 응답을 만든 요청 기록에 맞춘다 (캐시 수명은 요청 시점부터).
   */
  promptCacheAnchorAt?: number;
  /** 마지막 캐시 쓰기가 사용한 TTL(초): 300 또는 3600. 감지 못 하면 undefined. */
  promptCacheTtlSeconds?: number;
  /** assistant usage의 세션 누적 (같은 API 응답의 중복 기록은 message.id로 한 번만). */
  sessionTokens?: SessionTokenUsage;
  /** 메인 대화의 마지막 API 응답이 보고한 입력 usage — 캐시 히트율 계산용. */
  lastRequestUsage?: SessionTokenUsage;
  /** compact_boundary 기록 수 (/compact·자동 압축). */
  compactionCount?: number;
  /** ultracode effort 활성 여부 — stdin은 일반 레벨로만 보고하므로 transcript가 유일한 신호. */
  ultracodeActive?: boolean;
}

interface CacheFile {
  version: number;
  transcriptPath: string;
  mtimeMs: number;
  size: number;
  data: TranscriptData;
}

const CACHE_VERSION = 4;
const CACHE_DIR = path.join(PINGLET_DIR, "hud-cache");
const NAME_MAX_LEN = 64;
const TEXT_MAX_LEN = 120;
const TOOLS_KEPT = 20;
const AGENTS_KEPT = 10;
const MESSAGE_USAGE_MAX = 4096;

export const PROMPT_CACHE_TTL_5M = 300;
export const PROMPT_CACHE_TTL_1H = 3600;

const emptyTranscript = (): TranscriptData => ({ tools: [], agents: [], todos: [], skills: [] });

/** 클라이언트 안에서만 처리되는 user 기록 — 요청을 보내지 않으므로 캐시를 갱신하지 않는다. */
const LOCAL_ONLY_USER_TEXT_PREFIXES = [
  "<command-name>",
  "<command-message>",
  "<local-command-",
  "[Request interrupted by user",
];

/** 터미널에 그리기 전 방어선 — ANSI·제어·서식 문자를 제거하고 길이를 제한한다. */
export function sanitizeText(value: unknown, maxLen = TEXT_MAX_LEN): string {
  if (typeof value !== "string") return "";
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

function cachePath(transcriptPath: string): string {
  const hash = createHash("sha256").update(transcriptPath).digest("hex").slice(0, 32);
  return path.join(CACHE_DIR, `${hash}.json`);
}

function readCache(file: string): CacheFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as CacheFile;
    if (parsed?.version !== CACHE_VERSION || !parsed.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** doctor/uninstall --purge 용: 캐시 디렉터리 경로. */
export const HUD_CACHE_DIR = CACHE_DIR;

export async function parseTranscript(transcriptPath: string | undefined): Promise<TranscriptData> {
  if (!transcriptPath) return emptyTranscript();
  let canonical: string;
  let stat: fs.Stats;
  try {
    canonical = fs.realpathSync(transcriptPath);
    stat = fs.statSync(canonical);
    if (!stat.isFile()) return emptyTranscript();
  } catch {
    return emptyTranscript();
  }

  const file = cachePath(canonical);
  const cached = readCache(file);
  if (cached && cached.transcriptPath === canonical && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.data;
  }

  const { data, complete } = await parseFile(canonical);
  if (complete) {
    try {
      atomicWrite(file, JSON.stringify({ version: CACHE_VERSION, transcriptPath: canonical, mtimeMs: stat.mtimeMs, size: stat.size, data } satisfies CacheFile));
    } catch {
      // 캐시 실패는 표시에 영향을 주면 안 된다.
    }
  }
  return data;
}

interface ContentBlock {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
}

interface CacheCreation {
  ephemeral_1h_input_tokens?: number;
  ephemeral_5m_input_tokens?: number;
}

interface TranscriptLine {
  timestamp?: string;
  type?: string;
  subtype?: string;
  operation?: string;
  content?: string;
  slug?: string;
  customTitle?: string;
  /** 서브 에이전트(Task) 기록 — 메인 대화와 별개 캐시를 쓴다. */
  isSidechain?: boolean;
  /** 같은 API 요청에서 나온 assistant 기록들이 공유하는 ID. */
  requestId?: string;
  advisorModel?: string;
  message?: {
    id?: unknown;
    content?: ContentBlock[] | string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation?: CacheCreation;
    };
  };
  toolUseResult?: { resolvedModel?: unknown; isAsync?: unknown; status?: unknown };
  attachment?: { type?: string };
}

const positive = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v > 0;
const tokenCount = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0);

/** 이번 요청이 실제로 쓴 캐시 TTL. 캐시만 읽은 요청은 둘 다 0이라 undefined (이전 판정 유지). */
function detectCacheTtl(creation: CacheCreation | undefined): number | undefined {
  if (!creation) return undefined;
  if (positive(creation.ephemeral_5m_input_tokens)) return PROMPT_CACHE_TTL_5M;
  if (positive(creation.ephemeral_1h_input_tokens)) return PROMPT_CACHE_TTL_1H;
  return undefined;
}

/** user 기록이 실제 요청의 시작인지 — 로컬 슬래시 명령 출력·중단 마커는 아니다. */
function isRequestStart(entry: TranscriptLine): boolean {
  const content = entry.message?.content;
  if (typeof content === "string") return !LOCAL_ONLY_USER_TEXT_PREFIXES.some((p) => content.startsWith(p));
  if (Array.isArray(content)) {
    return content.some((b) => b?.type === "tool_result") ||
      !content.some((b) => b?.type === "text" && LOCAL_ONLY_USER_TEXT_PREFIXES.some((p) => (b.text ?? "").startsWith(p)));
  }
  return true;
}

/**
 * 같은 API 응답을 Claude Code가 2~3번 기록하므로 message.id별 최대값의 증가분만 더한다.
 * id가 없는 기록은 직전 기록과 usage 지문이 같으면 중복으로 본다.
 */
class SessionTokenAccumulator {
  readonly total: SessionTokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  private readonly byMessageId = new Map<string, SessionTokenUsage>();
  private lastFingerprint: string | undefined;

  add(messageId: string | null, usage: SessionTokenUsage): void {
    if (messageId !== null) {
      this.lastFingerprint = undefined;
      const prior = this.byMessageId.get(messageId);
      if (!prior && this.byMessageId.size >= MESSAGE_USAGE_MAX) {
        const oldest = this.byMessageId.keys().next().value;
        if (oldest !== undefined) this.byMessageId.delete(oldest);
      }
      const base = prior ?? { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      this.total.inputTokens += Math.max(0, usage.inputTokens - base.inputTokens);
      this.total.outputTokens += Math.max(0, usage.outputTokens - base.outputTokens);
      this.total.cacheCreationTokens += Math.max(0, usage.cacheCreationTokens - base.cacheCreationTokens);
      this.total.cacheReadTokens += Math.max(0, usage.cacheReadTokens - base.cacheReadTokens);
      this.byMessageId.set(messageId, {
        inputTokens: Math.max(base.inputTokens, usage.inputTokens),
        outputTokens: Math.max(base.outputTokens, usage.outputTokens),
        cacheCreationTokens: Math.max(base.cacheCreationTokens, usage.cacheCreationTokens),
        cacheReadTokens: Math.max(base.cacheReadTokens, usage.cacheReadTokens),
      });
      return;
    }
    const fingerprint = `${usage.inputTokens}|${usage.outputTokens}|${usage.cacheCreationTokens}|${usage.cacheReadTokens}`;
    const duplicate = fingerprint === this.lastFingerprint;
    this.lastFingerprint = fingerprint;
    if (duplicate) return;
    this.total.inputTokens += usage.inputTokens;
    this.total.outputTokens += usage.outputTokens;
    this.total.cacheCreationTokens += usage.cacheCreationTokens;
    this.total.cacheReadTokens += usage.cacheReadTokens;
  }

  reset(): void {
    this.lastFingerprint = undefined;
  }
}

async function parseFile(transcriptPath: string): Promise<{ data: TranscriptData; complete: boolean }> {
  const tools = new Map<string, ToolEntry>();
  const agents = new Map<string, AgentEntry>();
  const skills = new Set<string>();
  let todos: TodoItem[] = [];
  const taskIdToIndex = new Map<string, number>();
  const queueCompletion = new Map<string, number>();
  const tokens = new SessionTokenAccumulator();
  let sessionStart: number | undefined;
  let slug: string | undefined;
  let customTitle: string | undefined;
  let advisorModel: string | undefined;
  let compactionCount = 0;
  let ultracodeActive: boolean | undefined;
  let lastRequestUsage: SessionTokenUsage | undefined;
  // prompt cache 시계 — 메인 대화(isSidechain 아님)만 본다.
  let prevMainChainAt: number | undefined;
  let cacheAnchorAt: number | undefined;
  let cacheTtl: number | undefined;
  let cacheRequestId: string | undefined;
  let cacheRequestAnchorAt: number | undefined;
  let cachePendingRequestAt: number | undefined;
  let complete = false;

  try {
    const rl = readline.createInterface({ input: fs.createReadStream(transcriptPath), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) {
        tokens.reset();
        continue;
      }
      let entry: TranscriptLine;
      try {
        entry = JSON.parse(line) as TranscriptLine;
      } catch {
        tokens.reset();
        continue;
      }
      if (!entry || typeof entry !== "object") continue;

      const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
      const timestamp = Number.isNaN(ts) ? Date.now() : ts;
      if (sessionStart === undefined && !Number.isNaN(ts)) sessionStart = ts;
      if (entry.type === "custom-title" && typeof entry.customTitle === "string") {
        customTitle = sanitizeText(entry.customTitle, NAME_MAX_LEN);
      } else if (typeof entry.slug === "string") {
        slug = sanitizeText(entry.slug, NAME_MAX_LEN);
      }
      if (entry.type === "assistant" && typeof entry.advisorModel === "string" && entry.advisorModel) {
        advisorModel = sanitizeText(entry.advisorModel, NAME_MAX_LEN) || advisorModel;
      }
      // ultracode 상태: 마커 attachment(한 턴 늦을 수 있음)와 /effort 명령 출력(즉시) — 파일 순서대로 마지막 값.
      if (entry.type === "attachment") {
        if (entry.attachment?.type === "ultra_effort_enter") ultracodeActive = true;
        else if (entry.attachment?.type === "ultra_effort_exit") ultracodeActive = false;
      }
      if (entry.type === "user" && typeof entry.message?.content === "string") {
        const match = entry.message.content.match(/^<local-command-stdout>Set effort level to (\w+)/);
        if (match) ultracodeActive = match[1].toLowerCase() === "ultracode";
      }
      if (entry.type === "assistant" && entry.message?.usage) {
        const usage = entry.message.usage;
        const id = typeof entry.message.id === "string" && entry.message.id.length > 0 && entry.message.id.length <= 128 ? entry.message.id : null;
        const normalized: SessionTokenUsage = {
          inputTokens: tokenCount(usage.input_tokens),
          outputTokens: tokenCount(usage.output_tokens),
          cacheCreationTokens: tokenCount(usage.cache_creation_input_tokens),
          cacheReadTokens: tokenCount(usage.cache_read_input_tokens),
        };
        tokens.add(id, normalized);
        if (entry.isSidechain !== true && normalized.inputTokens + normalized.cacheCreationTokens + normalized.cacheReadTokens > 0) {
          lastRequestUsage = normalized;
        }
      } else {
        tokens.reset();
      }
      if (entry.type === "system" && entry.subtype === "compact_boundary" && !Number.isNaN(ts)) compactionCount++;
      // 백그라운드 에이전트의 실제 완료 시각은 queue-operation 기록에 있다 (tool_result는 시작 시각).
      if (entry.type === "queue-operation" && entry.operation === "enqueue" && typeof entry.content === "string" && !Number.isNaN(ts)) {
        const toolUseId = entry.content.match(/<tool-use-id>([^<]+)<\/tool-use-id>/);
        if (toolUseId && /<task-id>[^<]+<\/task-id>/.test(entry.content)) queueCompletion.set(toolUseId[1], ts);
      }

      if (entry.isSidechain !== true && !Number.isNaN(ts)) {
        if (entry.type === "assistant") {
          // 같은 requestId를 공유하는 기록은 한 요청 — 첫 기록 직전의 메인 대화 기록이 요청 시작이다.
          const requestId = typeof entry.requestId === "string" && entry.requestId.length <= 128 ? entry.requestId : undefined;
          if (requestId === undefined || requestId !== cacheRequestId) {
            cacheRequestId = requestId;
            cacheRequestAnchorAt = prevMainChainAt;
          }
          cacheAnchorAt = cacheRequestAnchorAt !== undefined && cacheRequestAnchorAt <= ts ? cacheRequestAnchorAt : ts;
          const detected = detectCacheTtl(entry.message?.usage?.cache_creation);
          if (detected !== undefined) cacheTtl = detected;
          cachePendingRequestAt = undefined;
        }
        // 응답이 아직 안 적힌 요청도 이미 캐시를 갱신했다 — 그 요청을 연 기록이 살아 있는 기준점.
        if (entry.type === "user" && isRequestStart(entry)) cachePendingRequestAt = ts;
        prevMainChainAt = ts;
      }

      const blocks = entry.message?.content;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
          const name = sanitizeText(block.name, NAME_MAX_LEN);
          const input = block.input && typeof block.input === "object" ? block.input : {};
          if (name === "Skill") {
            const skill = sanitizeText(input.skill, NAME_MAX_LEN);
            if (skill) skills.add(skill);
          }
          if (name === "Task" || name === "Agent") {
            agents.set(block.id, {
              id: block.id,
              type: sanitizeText(input.subagent_type, 24) || "agent",
              model: sanitizeText(input.model, 40) || undefined,
              description: sanitizeText(input.description, 40) || undefined,
              status: "running",
              startTime: timestamp,
              background: input.run_in_background === true,
            });
          } else if (name === "TodoWrite") {
            const next = normalizeTodos(input.todos);
            if (next) {
              todos = next;
              taskIdToIndex.clear();
            }
          } else if (name === "TaskCreate") {
            const subject = sanitizeText(input.subject) || sanitizeText(input.description) || "Untitled task";
            todos.push({ content: subject, status: normalizeTaskStatus(input.status) ?? "pending" });
            const taskId = input.taskId;
            const key = typeof taskId === "string" || typeof taskId === "number" ? String(taskId) : block.id;
            taskIdToIndex.set(key, todos.length - 1);
          } else if (name === "TaskUpdate") {
            const index = resolveTaskIndex(input.taskId, taskIdToIndex, todos.length);
            if (index !== null) {
              const status = normalizeTaskStatus(input.status);
              if (status) todos[index].status = status;
              const subject = sanitizeText(input.subject) || sanitizeText(input.description);
              if (subject) todos[index].content = subject;
            }
          } else {
            tools.set(block.id, {
              id: block.id,
              name,
              target: extractTarget(name, input),
              status: "running",
              startTime: timestamp,
            });
          }
        }
        if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          const tool = tools.get(block.tool_use_id);
          if (tool) {
            tool.status = block.is_error ? "error" : "completed";
            tool.endTime = timestamp;
          }
          const agent = agents.get(block.tool_use_id);
          if (agent) {
            const resolved = sanitizeText(entry.toolUseResult?.resolvedModel, 40);
            if (resolved) agent.model = resolved;
            if (entry.toolUseResult?.isAsync === true || entry.toolUseResult?.status === "async_launched") {
              agent.background = true;
            }
            if (!agent.background) agent.endTime = timestamp;
          }
        }
      }
    }
    complete = true;
  } catch {
    // 읽는 중 오류 — 지금까지 모은 결과로 그린다 (캐시에는 남기지 않는다).
  }

  for (const [toolUseId, endTime] of queueCompletion) {
    const agent = agents.get(toolUseId);
    if (agent?.background) {
      agent.endTime = endTime;
      agent.status = "completed";
    }
  }
  for (const agent of agents.values()) {
    if (agent.status === "running" && agent.endTime !== undefined) agent.status = "completed";
  }

  // 응답 없는 요청은 시계를 앞으로 당길 때만 채택한다 (시계가 꼬인 기록은 무시).
  const anchor = cachePendingRequestAt !== undefined && (cacheAnchorAt === undefined || cachePendingRequestAt > cacheAnchorAt)
    ? cachePendingRequestAt
    : cacheAnchorAt;

  return {
    complete,
    data: {
      tools: Array.from(tools.values()).slice(-TOOLS_KEPT),
      agents: Array.from(agents.values()).slice(-AGENTS_KEPT),
      todos,
      skills: Array.from(skills),
      sessionStart,
      sessionName: customTitle ?? slug,
      advisorModel,
      promptCacheAnchorAt: anchor,
      promptCacheTtlSeconds: cacheTtl,
      sessionTokens: tokens.total,
      lastRequestUsage,
      compactionCount,
      ultracodeActive,
    },
  };
}

function normalizeTodos(value: unknown): TodoItem[] | null {
  if (!Array.isArray(value)) return null;
  const out: TodoItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const todo = item as { content?: unknown; status?: unknown };
    const content = sanitizeText(todo.content);
    if (!content) continue;
    out.push({ content, status: normalizeTaskStatus(todo.status) ?? "pending" });
  }
  return out;
}

function normalizeTaskStatus(status: unknown): TodoItem["status"] | null {
  switch (status) {
    case "pending":
    case "not_started":
      return "pending";
    case "in_progress":
    case "running":
      return "in_progress";
    case "completed":
    case "complete":
    case "done":
      return "completed";
    default:
      return null;
  }
}

function resolveTaskIndex(taskId: unknown, map: Map<string, number>, length: number): number | null {
  if (typeof taskId !== "string" && typeof taskId !== "number") return null;
  const key = String(taskId);
  const mapped = map.get(key);
  if (mapped !== undefined) return mapped;
  if (/^\d+$/.test(key)) {
    const index = Number.parseInt(key, 10) - 1;
    if (index >= 0 && index < length) return index;
  }
  return null;
}

/** 도구별로 한 줄 요약에 쓸 대상 — 파일 경로, 패턴, 명령 앞부분. */
function extractTarget(name: string, input: Record<string, unknown>): string | undefined {
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
      return sanitizeText(input.file_path ?? input.path) || undefined;
    case "Glob":
    case "Grep":
      return sanitizeText(input.pattern) || undefined;
    case "Skill":
      return sanitizeText(input.skill, NAME_MAX_LEN) || undefined;
    case "Bash": {
      const cmd = sanitizeText(input.command);
      if (!cmd) return undefined;
      return cmd.length > 30 ? `${cmd.slice(0, 30).trimEnd()}...` : cmd;
    }
  }
  return undefined;
}

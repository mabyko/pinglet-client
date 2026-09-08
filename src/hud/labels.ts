import { detectLocale } from "../render";

/** HUD 고정 문구 — statusline 언어 판정(detectLocale)을 따른다. */
const TABLE = {
  en: {
    context: "Context",
    usage: "Usage",
    weekly: "Weekly",
    resetsIn: "resets in",
    resets: "resets",
    at: "at",
    limitReached: "Limit reached",
    allTodosComplete: "All todos complete",
    in: "in",
    cache: "cache",
    cost: "Cost",
    more: "more",
    skills: "Skills",
    approxRam: "Approx RAM",
    promptCache: "Cache",
    until: "until",
    expired: "expired",
    hit: "hit",
    advisor: "Advisor",
    tokens: "Tokens",
    tok: "tok",
    out: "out",
    tokPerSec: "tok/s",
    compactions: "Compactions",
  },
  ko: {
    context: "컨텍스트",
    usage: "사용량",
    weekly: "주간",
    resetsIn: "리셋까지",
    resets: "리셋",
    at: "",
    limitReached: "한도 도달",
    allTodosComplete: "할 일 모두 완료",
    in: "입력",
    cache: "캐시",
    cost: "비용",
    more: "개 더",
    skills: "스킬",
    approxRam: "RAM",
    promptCache: "캐시",
    until: "만료",
    expired: "만료됨",
    hit: "히트",
    advisor: "자문 모델",
    tokens: "토큰",
    tok: "토큰",
    out: "출력",
    tokPerSec: "tok/s",
    compactions: "압축",
  },
  ja: {
    context: "コンテキスト",
    usage: "使用量",
    weekly: "週間",
    resetsIn: "リセットまで",
    resets: "リセット",
    at: "",
    limitReached: "上限到達",
    allTodosComplete: "Todo すべて完了",
    in: "入力",
    cache: "キャッシュ",
    cost: "コスト",
    more: "件",
    skills: "スキル",
    approxRam: "RAM",
    promptCache: "キャッシュ",
    until: "期限",
    expired: "期限切れ",
    hit: "ヒット",
    advisor: "アドバイザー",
    tokens: "トークン",
    tok: "トークン",
    out: "出力",
    tokPerSec: "tok/s",
    compactions: "圧縮",
  },
} as const;

export type HudLabelKey = keyof (typeof TABLE)["en"];

let cached: (typeof TABLE)[keyof typeof TABLE] | null = null;

export function hudLabel(key: HudLabelKey): string {
  cached ??= TABLE[detectLocale()];
  return cached[key];
}

/** 테스트용 — 언어 판정 캐시를 비운다. */
export function resetHudLabels(): void {
  cached = null;
}

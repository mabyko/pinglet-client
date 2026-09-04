import { loadConfig, saveConfig } from "../config";

/**
 * `pinglet logout` — 로컬에 저장된 로그인 토큰만 지운다.
 * 통합 설정·installation·캐시는 그대로라 읽기는 계속 되고, 다시 `pinglet login`으로
 * 다른 계정(GitHub/Google)을 연결할 수 있다. 서버 측 토큰 폐기는 하지 않는다 (JWT 만료까지 유효).
 */
export function runLogout(): void {
  const config = loadConfig();
  if (!config.userToken) {
    console.log("○ 로그인 상태가 아닙니다.");
    return;
  }
  delete config.userToken;
  saveConfig(config);
  console.log("✓ 로그아웃했습니다. 읽기는 계속 되고, 메시지 작성은 `pinglet login` 후 가능합니다.");
}

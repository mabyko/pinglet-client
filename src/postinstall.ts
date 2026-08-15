import { runInstall } from "./commands/install";

/**
 * npm install -g pinglet-cli 직후 자동으로 `pinglet install`을 수행한다.
 * - 글로벌 설치(npm_config_global=true)일 때만 동작 — 개발용 npm install,
 *   의존성 설치, CI에서는 아무것도 하지 않는다.
 * - 어떤 경우에도 실패로 npm install 자체를 깨뜨리지 않는다 (항상 exit 0).
 * - pnpm/bun처럼 postinstall을 기본 차단하는 매니저에서는 실행되지 않으며,
 *   그 경우 사용자가 `pinglet install`을 직접 실행하면 된다.
 */
async function main(): Promise<void> {
  if (process.env.npm_config_global !== "true") return;
  console.log("\npinglet: 첫 설정을 자동으로 진행합니다 (`pinglet install`)");
  await runInstall([]);
}

main()
  .catch(() => {
    console.log(
      "pinglet: 자동 설정에 실패했습니다. `pinglet install`을 직접 실행해 주세요.",
    );
  })
  .finally(() => process.exit(0));

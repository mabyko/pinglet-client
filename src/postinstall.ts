import { runInstall } from "./commands/install";
import { t } from "./i18n";
import { withPingletLock } from "./lock";

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
  console.log(t("postinstall.start"));
  await withPingletLock(() => runInstall([]));
}

main()
  .catch(() => {
    console.log(t("postinstall.failed"));
  })
  .finally(() => process.exit(0));

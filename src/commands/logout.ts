import { loadConfig, saveConfig } from "../config";
import { t } from "../i18n";
import { releaseCredential } from "../api";
import { withPingletLock } from "../lock";

/**
 * Revoke the user session and unlink this device's installations before
 * removing local credentials. On failure preserve credentials for retry.
 */
export async function runLogout(): Promise<void> {
  const config = loadConfig();
  for (const record of Object.values(config.installations)) {
    if (!await releaseCredential(config, "unlink", record.token)) {
      throw new Error(t("logout.failed"));
    }
  }
  if (!config.userToken) {
    console.log(t("logout.notLoggedIn"));
    return;
  }
  if (!await releaseCredential(config, "user", config.userToken)) {
    throw new Error(t("logout.failed"));
  }
  await withPingletLock(() => {
    const current = loadConfig();
    delete current.userToken;
    saveConfig(current);
  });
  console.log(t("logout.done"));
}

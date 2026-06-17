import type { PreModelCallContext } from "@vellumai/plugin-api";
import { getModelProfiles } from "@vellumai/plugin-api";

/**
 * Randomly routes each user-facing model call to one of the workspace's
 * enabled inference profiles.
 *
 * Fires before every provider call. Only acts on `mainAgent` calls
 * (the user-facing reply); background / utility calls are left alone so
 * internal tooling keeps using whatever profile the platform chose.
 */
export default async function preModelCall(
  ctx: PreModelCallContext,
): Promise<void> {
  if (ctx.callSite !== "mainAgent") {
    return;
  }

  const profiles = getModelProfiles().filter((p) => !p.isDisabled);
  if (profiles.length === 0) return;

  const pick = profiles[Math.floor(Math.random() * profiles.length)];
  ctx.modelProfile = pick.key;
}

/**
 * Payout HTTP Lambdas — maker-only gates. Dual-capability users use the same
 * ambiguous default as AppSync maker-primary domains (see ACTIVE_MODE_POLICY.txt under `hand-made-active-mode/` reference package in repo).
 */
import {
  isAuthorizedForMode as isAuthorizedForModeCore,
  PLATFORM_DUAL_ROLE_DEFAULT_GRAPHQL,
  type RequiredMode,
} from "./active-mode";

export function isAuthorizedForMode(
  claims: Record<string, unknown> | undefined,
  required: RequiredMode,
): boolean {
  return isAuthorizedForModeCore(claims, required, PLATFORM_DUAL_ROLE_DEFAULT_GRAPHQL);
}

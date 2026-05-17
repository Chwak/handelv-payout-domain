/**
 * HTTP API (v2) maker auth — uses {@link getClaimsFromHttpApiEvent} so JWT and Lambda authorizer shapes match production.
 */

import { getClaimsFromHttpApiEvent } from "./active-mode";
import { isAuthorizedForMode } from './operation-mode-auth';

export function getMakerSubFromHttpApiEvent(event: {
  requestContext?: { authorizer?: unknown; identity?: unknown };
}): string | null {
  const claims = getClaimsFromHttpApiEvent(event);
  if (!isAuthorizedForMode(claims, 'maker')) return null;
  const sub = claims?.sub;
  return typeof sub === 'string' && sub.trim() ? sub.trim() : null;
}

/** When `pathParameters.makerUserId` is set, it must match the authenticated maker sub. */
export function getMakerUserIdFromHttpApiEvent(event: {
  pathParameters?: { makerUserId?: string } | null;
  requestContext?: { authorizer?: unknown; identity?: unknown };
}): string | null {
  const authUserId = getMakerSubFromHttpApiEvent(event);
  if (!authUserId) return null;

  const fromPath = event.pathParameters?.makerUserId;
  if (typeof fromPath === 'string' && fromPath.trim()) {
    const requested = fromPath.trim();
    return requested === authUserId ? requested : null;
  }

  return authUserId;
}

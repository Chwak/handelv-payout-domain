import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";
import { isAuthorizedForMode } from '../../../../utils/operation-mode-auth';

const MAKER_BALANCES_TABLE = process.env.MAKER_BALANCES_TABLE_NAME;

function getMakerUserId(event: {
  pathParameters?: { makerUserId?: string } | null;
  requestContext?: { authorizer?: { claims?: { sub?: string } }; identity?: { sub?: string } };
}): string | null {
  const claims = (event.requestContext?.authorizer?.claims ?? event.requestContext?.identity) as Record<string, unknown> | undefined;
  if (!isAuthorizedForMode(claims, 'maker')) return null;
  const sub = (claims as { sub?: string })?.sub;
  const authUserId = typeof sub === 'string' && sub.trim() ? sub.trim() : null;
  if (!authUserId) return null;

  const fromPath = event.pathParameters?.makerUserId;
  if (typeof fromPath === 'string' && fromPath.trim()) {
    const requested = fromPath.trim();
    return requested === authUserId ? requested : null;
  }

  return authUserId;
}

export const handler = async (
  event: {
    pathParameters?: { makerUserId?: string } | null;
    requestContext?: { authorizer?: { claims?: { sub?: string } }; identity?: { sub?: string } };
  }
) => {
  initTelemetryLogger(event, { domain: "payout-domain", service: "get-maker-balance" });
  if (!MAKER_BALANCES_TABLE) throw new Error('Internal server error');

  const makerUserId = getMakerUserId(event);
  if (!makerUserId) throw new Error('Invalid input format');

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const result = await client.send(
    new GetCommand({
      TableName: MAKER_BALANCES_TABLE,
      Key: { makerUserId },
    })
  );

  const body = result.Item
    ? (result.Item as Record<string, unknown>)
    : { makerUserId, availableBalance: 0, pendingBalance: 0, currency: 'USD' };
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
};
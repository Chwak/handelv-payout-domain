import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";
import { isAuthorizedForMode } from '../../../../utils/operation-mode-auth';

const PAYOUTS_TABLE = process.env.PAYOUTS_TABLE_NAME;
const GSI1_MAKER = 'GSI1-MakerUserId';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function getMakerUserId(event: {
  pathParameters?: { makerUserId?: string } | null;
  requestContext?: { authorizer?: { claims?: { sub?: string } } };
}): string | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined;
  if (!isAuthorizedForMode(claims, 'maker')) return null;
  const fromPath = event.pathParameters?.makerUserId;
  if (typeof fromPath === 'string' && fromPath.trim()) return fromPath.trim();
  const sub = event.requestContext?.authorizer?.claims?.sub;
  if (typeof sub === 'string' && sub.trim()) return sub.trim();
  return null;
}

function getLimit(event: { queryStringParameters?: { limit?: string } | null }): number {
  const raw = event.queryStringParameters?.limit;
  if (raw == null) return DEFAULT_LIMIT;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export const handler = async (event: {
  pathParameters?: { makerUserId?: string } | null;
  queryStringParameters?: { limit?: string; nextToken?: string } | null;
  requestContext?: { authorizer?: { claims?: { sub?: string } } };
}) => {
  initTelemetryLogger(event, { domain: "payout-domain", service: "list-payouts" });
  if (!PAYOUTS_TABLE) throw new Error('Internal server error');

  const makerUserId = getMakerUserId(event);
  if (!makerUserId) throw new Error('Invalid input format');

  const limit = getLimit(event);
  const nextToken = event.queryStringParameters?.nextToken?.trim() || undefined;

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const queryInput: Record<string, unknown> = {
    TableName: PAYOUTS_TABLE,
    IndexName: GSI1_MAKER,
    KeyConditionExpression: 'makerUserId = :uid',
    ExpressionAttributeValues: { ':uid': makerUserId },
    Limit: limit,
  };
  if (nextToken) {
    try {
      queryInput.ExclusiveStartKey = JSON.parse(
        Buffer.from(nextToken, 'base64url').toString('utf8')
      ) as Record<string, unknown>;
    } catch {
      // ignore invalid token
    }
  }

  const result = await client.send(new QueryCommand(queryInput as import('@aws-sdk/lib-dynamodb').QueryCommandInput));
  const items = (result.Items ?? []) as Record<string, unknown>[];
  const newNextToken = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey), 'utf8').toString('base64url')
    : null;

  const body = { items, nextToken: newNextToken };
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
};
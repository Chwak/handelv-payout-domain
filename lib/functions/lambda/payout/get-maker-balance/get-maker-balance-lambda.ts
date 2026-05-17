import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";
import { getMakerUserIdFromHttpApiEvent } from '../../../../utils/payout-http-maker-auth';

const MAKER_BALANCES_TABLE = process.env.MAKER_BALANCES_TABLE_NAME;

export const handler = async (
  event: {
    pathParameters?: { makerUserId?: string } | null;
    requestContext?: { authorizer?: unknown; identity?: unknown };
  }
) => {
  initTelemetryLogger(event, { domain: "payout-domain", service: "get-maker-balance" });
  if (!MAKER_BALANCES_TABLE) throw new Error('Internal server error');

  const makerUserId = getMakerUserIdFromHttpApiEvent(event);
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
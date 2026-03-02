import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

const PAYOUTS_TABLE = process.env.PAYOUTS_TABLE_NAME;
const MAKER_BALANCES_TABLE = process.env.MAKER_BALANCES_TABLE_NAME;
const MIN_PAYOUT_THRESHOLD = 10;

export const handler = async (event: unknown) => {
  initTelemetryLogger(event, { domain: "payout-domain", service: "schedule-payouts" });
  if (!PAYOUTS_TABLE || !MAKER_BALANCES_TABLE) throw new Error('Internal server error');

  const isApiGateway = event && typeof event === 'object' && 'requestContext' in event;
  if (isApiGateway) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Not supported' }),
    };
  }

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const scheduledAt = new Date().toISOString();
  let scheduledCount = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const scanResult = await client.send(
      new ScanCommand({
        TableName: MAKER_BALANCES_TABLE,
        ExclusiveStartKey: lastKey,
        Limit: 25,
      })
    );
    const items = (scanResult.Items ?? []) as Record<string, unknown>[];
    lastKey = scanResult.LastEvaluatedKey as Record<string, unknown> | undefined;

    for (const item of items) {
      const makerUserId = item.makerUserId as string;
      const availableBalance = Number(item.availableBalance ?? 0);
      if (!makerUserId || !Number.isFinite(availableBalance) || availableBalance < MIN_PAYOUT_THRESHOLD) continue;

      const payoutId = crypto.randomUUID();
      await client.send(
        new PutCommand({
          TableName: PAYOUTS_TABLE,
          Item: {
            payoutId,
            makerUserId,
            amount: availableBalance,
            status: 'SCHEDULED',
            scheduledAt,
            createdAt: scheduledAt,
          },
        })
      );
      scheduledCount += 1;
    }
  } while (lastKey && Object.keys(lastKey).length > 0);

  return { scheduledCount };
};
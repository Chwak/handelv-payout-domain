import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const ORDERS_TABLE = process.env.ORDERS_TABLE_NAME;
const EARNINGS_TABLE = process.env.EARNINGS_TABLE_NAME;
const MAKER_BALANCES_TABLE = process.env.MAKER_BALANCES_TABLE_NAME;

function parseEvent(event: unknown): {
  orderId: string;
  makerUserId: string;
  platformFeePercent: number;
  availableAt: string;
} | null {
  const raw = (event as { body?: string; detail?: unknown })?.body
    ? JSON.parse((event as { body: string }).body)
    : (event as { detail?: unknown })?.detail ?? event;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const orderId = typeof o.orderId === 'string' ? o.orderId.trim() : '';
  const makerUserId = typeof o.makerUserId === 'string' ? o.makerUserId.trim() : '';
  const platformFeePercent = typeof o.platformFeePercent === 'number' ? o.platformFeePercent : Number(o.platformFeePercent);
  const availableAt = typeof o.availableAt === 'string' ? o.availableAt : new Date().toISOString();
  if (!orderId || !makerUserId || !Number.isFinite(platformFeePercent) || platformFeePercent < 0 || platformFeePercent > 100)
    return null;
  return { orderId, makerUserId, platformFeePercent, availableAt };
}

export const handler = async (event: unknown) => {
  initTelemetryLogger(event, { domain: "payout-domain", service: "calculate-earnings" });
  if (!ORDERS_TABLE || !EARNINGS_TABLE || !MAKER_BALANCES_TABLE) throw new Error('Internal server error');

  const input = parseEvent(event);
  if (!input) throw new Error('Invalid input format');

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const orderResult = await client.send(
    new GetCommand({
      TableName: ORDERS_TABLE,
      Key: { orderId: input.orderId },
    })
  );
  const order = orderResult.Item as Record<string, unknown> | undefined;
  if (!order) throw new Error('Order not found');
  if (String(order.status) !== 'COMPLETED') throw new Error('Order must be COMPLETED to calculate earnings');
  if (String(order.makerUserId ?? order.sellerId) !== input.makerUserId) throw new Error('Maker does not match order');

  const totalAmount = Number(order.totalAmount ?? order.amount ?? 0);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) throw new Error('Invalid order amount');
  const platformFee = (totalAmount * input.platformFeePercent) / 100;
  const netAmount = totalAmount - platformFee;

  const transactionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await client.send(
    new PutCommand({
      TableName: EARNINGS_TABLE,
      Item: {
        makerUserId: input.makerUserId,
        transactionId,
        orderId: input.orderId,
        grossAmount: totalAmount,
        platformFee,
        netAmount,
        status: 'PENDING',
        availableAt: input.availableAt,
        createdAt,
      },
    })
  );

  await client.send(
    new UpdateCommand({
      TableName: MAKER_BALANCES_TABLE,
      Key: { makerUserId: input.makerUserId },
      UpdateExpression: 'ADD pendingBalance :net, totalEarned :net',
      ExpressionAttributeValues: { ':net': netAmount },
    })
  );

  return {
    transactionId,
    orderId: input.orderId,
    makerUserId: input.makerUserId,
    grossAmount: totalAmount,
    platformFee,
    netAmount,
    status: 'PENDING',
    availableAt: input.availableAt,
    createdAt,
  };
};
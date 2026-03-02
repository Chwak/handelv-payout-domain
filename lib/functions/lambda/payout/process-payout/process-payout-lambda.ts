import { SFNClient, StartSyncExecutionCommand } from '@aws-sdk/client-sfn';
import { randomUUID } from 'crypto';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";
import { isAuthorizedForMode } from '../../../../utils/operation-mode-auth';

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;

function getMakerUserId(event: {
  pathParameters?: { payoutId?: string } | null;
  requestContext?: { authorizer?: { claims?: { sub?: string } } };
  body?: string | null;
}): string | null {
  const sub = event.requestContext?.authorizer?.claims?.sub;
  if (typeof sub === 'string' && sub.trim()) return sub.trim();
  if (event.body) {
    try {
      const o = JSON.parse(event.body) as Record<string, unknown>;
      if (typeof o.makerUserId === 'string' && o.makerUserId.trim()) return o.makerUserId.trim();
    } catch {
      // ignore
    }
  }
  return null;
}

function parseBody(event: { body?: string | null }): {
  makerUserId: string;
  amount: number;
  payoutMethod: string;
} | null {
  if (!event.body) return null;
  try {
    const o = JSON.parse(event.body) as Record<string, unknown>;
    const makerUserId = typeof o.makerUserId === 'string' ? o.makerUserId.trim() : '';
    const amount = Number(o.amount);
    const payoutMethod = typeof o.payoutMethod === 'string' ? o.payoutMethod.trim() : '';
    if (!makerUserId || !Number.isFinite(amount) || amount <= 0 || !payoutMethod) return null;
    return { makerUserId, amount, payoutMethod };
  } catch {
    return null;
  }
}

type ApiGatewayEvent = {
  pathParameters?: { payoutId?: string } | null;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  requestContext?: { authorizer?: { claims?: { sub?: string } } };
};

function resolveTraceparent(event: ApiGatewayEvent): string {
  const headerTraceparent = event.headers?.traceparent || event.headers?.Traceparent;
  const isValid = headerTraceparent
    && /^\d{2}-[0-9a-f]{32}-[0-9a-f]{16}-\d{2}$/i.test(headerTraceparent);

  if (isValid) return headerTraceparent;

  const traceId = randomUUID().replace(/-/g, '');
  const spanId = randomUUID().replace(/-/g, '').slice(0, 16);
  return `00-${traceId}-${spanId}-01`;
}

export const handler = async (event: ApiGatewayEvent) => {
  initTelemetryLogger(event, { domain: "payout-domain", service: "process-payout" });
  if (!STATE_MACHINE_ARN) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }

  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined;
  if (!isAuthorizedForMode(claims, 'maker')) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }
  const authUserId = typeof (claims as { sub?: string })?.sub === 'string'
    ? (claims as { sub?: string }).sub?.trim()
    : null;
  if (!authUserId) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  const payoutId = event.pathParameters?.payoutId?.trim();
  if (!payoutId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'payoutId required' }),
    };
  }

  const body = parseBody(event);
  if (!body) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Body must include makerUserId, amount (> 0), payoutMethod' }),
    };
  }
  if (body.makerUserId !== authUserId) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  const publisherPayoutId = payoutId;
  const negativeAmount = -body.amount;
  const traceparent = resolveTraceparent(event);

  const sfn = new SFNClient({});
  try {
    const exec = await sfn.send(
      new StartSyncExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        input: JSON.stringify({
          action: 'processPayout',
          makerUserId: body.makerUserId,
          payoutId,
          payoutAmount: body.amount,
          payoutMethod: body.payoutMethod,
          negativeAmount,
          publisherPayoutId,
          traceparent,
        }),
      })
    );

    if (exec.status === 'FAILED' || exec.error) {
      const cause = (exec.error ?? exec.cause ?? '').toString();
      if (cause.includes('InsufficientBalance') || cause.includes('Insufficient')) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Insufficient balance for payout' }),
        };
      }
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: cause || 'Payout processing failed' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payoutId,
        amount: body.amount,
        payoutMethod: body.payoutMethod,
        status: 'COMPLETED',
      }),
    };
  } catch (err) {
    console.error('process-payout error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Payout processing failed' }),
    };
  }
};
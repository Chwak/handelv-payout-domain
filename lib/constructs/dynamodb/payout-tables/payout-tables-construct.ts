import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface PayoutTablesConstructProps {
  environment: string;
  regionCode: string;
  removalPolicy?: cdk.RemovalPolicy;
}

export class PayoutTablesConstruct extends Construct {
  public readonly makerBalancesTable: dynamodb.Table;
  public readonly payoutsTable: dynamodb.Table;
  public readonly earningsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: PayoutTablesConstructProps) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? cdk.RemovalPolicy.DESTROY;

    // Maker Balances Table
    this.makerBalancesTable = new dynamodb.Table(this, 'MakerBalancesTable', {
      tableName: `${props.environment}-${props.regionCode}-payout-domain-maker-balances-table`,
      partitionKey: {
        name: 'makerUserId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.environment === 'prod' },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Payouts Table
    this.payoutsTable = new dynamodb.Table(this, 'PayoutsTable', {
      tableName: `${props.environment}-${props.regionCode}-payout-domain-payouts-table`,
      partitionKey: {
        name: 'payoutId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.environment === 'prod' },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // GSI: payouts by maker
    this.payoutsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1-MakerUserId',
      partitionKey: {
        name: 'makerUserId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI: payouts by status
    this.payoutsTable.addGlobalSecondaryIndex({
      indexName: 'GSI2-Status',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Earnings Transactions Table
    this.earningsTable = new dynamodb.Table(this, 'EarningsTable', {
      tableName: `${props.environment}-${props.regionCode}-payout-domain-earnings-table`,
      partitionKey: {
        name: 'makerUserId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'transactionId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.environment === 'prod' },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // GSI: earnings by order
    this.earningsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1-OrderId',
      partitionKey: {
        name: 'orderId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI: earnings by status
    this.earningsTable.addGlobalSecondaryIndex({
      indexName: 'GSI2-Status',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });
  }
}

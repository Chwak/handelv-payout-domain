import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface CalculateEarningsLambdaConstructProps {
  environment: string;
  regionCode: string;
  ordersTable: dynamodb.ITable;
  earningsTable: dynamodb.ITable;
  makerBalancesTable: dynamodb.ITable;
  removalPolicy?: cdk.RemovalPolicy;
}

export class CalculateEarningsLambdaConstruct extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: CalculateEarningsLambdaConstructProps) {
    super(scope, id);

    const role = new iam.Role(this, 'CalculateEarningsLambdaRole', {
      roleName: `${props.environment}-${props.regionCode}-payout-domain-calculate-earnings-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Calculate Earnings Lambda',
      inlinePolicies: {
        CloudWatchLogsAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              resources: [
                `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${props.environment}-${props.regionCode}-payout-domain-calculate-earnings-lambda*`,
              ],
            }),
          ],
        }),
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
              resources: [
                props.ordersTable.tableArn,
                `${props.ordersTable.tableArn}/index/*`,
                props.earningsTable.tableArn,
                props.makerBalancesTable.tableArn,
              ],
            }),
          ],
        }),
      },
    });

    const logGroup = new logs.LogGroup(this, 'CalculateEarningsLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-payout-domain-calculate-earnings-lambda`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    });

    const lambdaCodePath = path.join(__dirname, '../../../../functions/lambda/payout/calculate-earnings');
    this.function = new lambda.Function(this, 'CalculateEarningsFunction', {
      functionName: `${props.environment}-${props.regionCode}-payout-domain-calculate-earnings-lambda`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'calculate-earnings-lambda.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      role,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      tracing: lambda.Tracing.DISABLED,
      logGroup,
      environment: {
        ENVIRONMENT: props.environment,
        REGION_CODE: props.regionCode,
        ORDERS_TABLE_NAME: props.ordersTable.tableName,
        EARNINGS_TABLE_NAME: props.earningsTable.tableName,
        MAKER_BALANCES_TABLE_NAME: props.makerBalancesTable.tableName,
        LOG_LEVEL: props.environment === 'prod' ? 'ERROR' : 'INFO',
      },
      description: 'Calculate earnings from completed orders',
    });

    props.ordersTable.grantReadData(this.function);
    props.earningsTable.grantReadWriteData(this.function);
    props.makerBalancesTable.grantReadWriteData(this.function);


    if (props.removalPolicy) {
      this.function.applyRemovalPolicy(props.removalPolicy);
    }
  }
}

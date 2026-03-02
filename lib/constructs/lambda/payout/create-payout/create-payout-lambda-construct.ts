import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import * as path from 'path';

export interface CreatePayoutLambdaConstructProps {
  environment: string;
  regionCode: string;
  stateMachine: stepfunctions.IStateMachine;
  removalPolicy?: cdk.RemovalPolicy;
}

export class CreatePayoutLambdaConstruct extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: CreatePayoutLambdaConstructProps) {
    super(scope, id);

    const role = new iam.Role(this, 'CreatePayoutLambdaRole', {
      roleName: `${props.environment}-${props.regionCode}-payout-domain-create-payout-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Create Payout Lambda with Step Functions access',
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
                `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${props.environment}-${props.regionCode}-payout-domain-create-payout-lambda*`,
              ],
            }),
          ],
        }),
        StepFunctionsAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['states:StartSyncExecution'],
              resources: [props.stateMachine.stateMachineArn],
            }),
          ],
        }),
      },
    });

    const logGroup = new logs.LogGroup(this, 'CreatePayoutLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-payout-domain-create-payout-lambda`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    });

    const lambdaCodePath = path.join(__dirname, '../../../../functions/lambda/payout/create-payout');
    this.function = new lambda.Function(this, 'CreatePayoutFunction', {
      functionName: `${props.environment}-${props.regionCode}-payout-domain-create-payout-lambda`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'create-payout-lambda.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      role,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      tracing: lambda.Tracing.DISABLED,
      logGroup,
      environment: {
        ENVIRONMENT: props.environment,
        REGION_CODE: props.regionCode,
        STATE_MACHINE_ARN: props.stateMachine.stateMachineArn,
        LOG_LEVEL: props.environment === 'prod' ? 'ERROR' : 'INFO',
      },
      description: 'Create payout by invoking Step Functions state machine',
    });


    if (props.removalPolicy) {
      this.function.applyRemovalPolicy(props.removalPolicy);
    }
  }
}

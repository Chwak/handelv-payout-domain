import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ProcessPayoutLambdaConstructProps {
  environment: string;
  regionCode: string;
  stateMachine: stepfunctions.IStateMachine;
  removalPolicy?: cdk.RemovalPolicy;
}

export class ProcessPayoutLambdaConstruct extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: ProcessPayoutLambdaConstructProps) {
    super(scope, id);

    const role = new iam.Role(this, 'ProcessPayoutLambdaRole', {
      roleName: `${props.environment}-${props.regionCode}-payout-domain-process-payout-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Process Payout Lambda with Step Functions access',
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
                `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${props.environment}-${props.regionCode}-payout-domain-process-payout-lambda*`,
              ],
            }),
          ],
        }),
        StepFunctionsAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'states:StartSyncExecution',
              ],
              resources: [props.stateMachine.stateMachineArn],
            }),
          ],
        }),
      },
    });

    const logGroup = new logs.LogGroup(this, 'ProcessPayoutLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-payout-domain-process-payout-lambda`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    });

    const lambdaCodePath = path.join(__dirname, '../../../../functions/lambda/payout/process-payout');
    this.function = new lambda.Function(this, 'ProcessPayoutFunction', {
      functionName: `${props.environment}-${props.regionCode}-payout-domain-process-payout-lambda`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'process-payout-lambda.handler',
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
      description: 'Process payout by invoking Step Functions state machine',
    });

    if (props.removalPolicy) {
      this.function.applyRemovalPolicy(props.removalPolicy);
    }
  }
}

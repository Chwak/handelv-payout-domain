import * as cdk from 'aws-cdk-lib';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import * as fs from 'fs';
import { Construct } from 'constructs';

export interface PayoutStateMachineConstructProps {
  environment: string;
  regionCode: string;
  makerBalancesTable: dynamodb.ITable;
  payoutsTable: dynamodb.ITable;
  earningsTable: dynamodb.ITable;
  ordersTable: dynamodb.ITable;
  minimumPayoutThreshold?: number;
}

export class PayoutStateMachineConstruct extends Construct {
  public readonly stateMachine: stepfunctions.StateMachine;
  public readonly stateMachineArn: string;

  constructor(scope: Construct, id: string, props: PayoutStateMachineConstructProps) {
    super(scope, id);

    // Create CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, 'PayoutStateMachineLogGroup', {
      logGroupName: `/aws/stepfunctions/${props.environment}-${props.regionCode}-payout-domain-state-machine`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Read ASL JSON definition and perform substitutions
    const aslFilePath = path.join(__dirname, 'payout-state-machine.asl.json');
    let aslContent = fs.readFileSync(aslFilePath, 'utf-8');
    aslContent = aslContent.replace(/\${MakerBalancesTableName}/g, props.makerBalancesTable.tableName);
    aslContent = aslContent.replace(/\${PayoutsTableName}/g, props.payoutsTable.tableName);
    aslContent = aslContent.replace(/\${EarningsTableName}/g, props.earningsTable.tableName);
    aslContent = aslContent.replace(/\${OrdersTableName}/g, props.ordersTable.tableName);
    aslContent = aslContent.replace(/\${MinimumPayoutThreshold}/g, String(props.minimumPayoutThreshold || 10));
    
    const definitionBody = stepfunctions.DefinitionBody.fromString(aslContent);

    // Create Express Step Functions state machine
    this.stateMachine = new stepfunctions.StateMachine(this, 'PayoutStateMachine', {
      stateMachineName: `${props.environment}-${props.regionCode}-payout-domain-state-machine`,
      definitionBody: definitionBody,
      stateMachineType: stepfunctions.StateMachineType.EXPRESS,
      timeout: cdk.Duration.minutes(5),
      tracingEnabled: false,
      logs: {
        destination: logGroup,
        level: stepfunctions.LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    this.stateMachineArn = this.stateMachine.stateMachineArn;

    // Grant permissions
    props.makerBalancesTable.grantReadWriteData(this.stateMachine);
    props.payoutsTable.grantReadWriteData(this.stateMachine);
    props.earningsTable.grantReadWriteData(this.stateMachine);
    props.ordersTable.grantReadData(this.stateMachine);

    // Export to SSM
    new ssm.StringParameter(this, 'PayoutStateMachineArnParameter', {
      parameterName: `/${props.environment}/payout-domain/stepfunctions/state-machine-arn`,
      stringValue: this.stateMachineArn,
      description: 'Payout Domain Step Functions State Machine ARN',
    });

    new cdk.CfnOutput(this, 'PayoutStateMachineArn', {
      value: this.stateMachineArn,
      description: 'Payout Domain Step Functions State Machine ARN',
      exportName: `${props.environment}-${props.regionCode}-payout-domain-state-machine-arn`,
    });
  }
}

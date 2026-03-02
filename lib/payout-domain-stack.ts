import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import type { DomainStackProps } from "./domain-stack-props";
import { PayoutApiGatewayConstruct } from "./constructs/apigateway/payout-apigateway/payout-apigateway-construct";
import { PayoutStateMachineConstruct } from "./constructs/stepfunctions/payout-state-machine/payout-state-machine-construct";
import { PayoutTablesConstruct } from "./constructs/dynamodb/payout-tables/payout-tables-construct";
import { OutboxTableConstruct } from "./constructs/dynamodb/outbox-table/outbox-table-construct";
import { ProcessPayoutLambdaConstruct } from "./constructs/lambda/payout/process-payout/process-payout-lambda-construct";
import { GetMakerBalanceLambdaConstruct } from "./constructs/lambda/payout/get-maker-balance/get-maker-balance-lambda-construct";
import { ListPayoutsLambdaConstruct } from "./constructs/lambda/payout/list-payouts/list-payouts-lambda-construct";
import { ListEarningsLambdaConstruct } from "./constructs/lambda/payout/list-earnings/list-earnings-lambda-construct";
import { CreatePayoutLambdaConstruct } from "./constructs/lambda/payout/create-payout/create-payout-lambda-construct";
import { CalculateEarningsLambdaConstruct } from "./constructs/lambda/payout/calculate-earnings/calculate-earnings-lambda-construct";
import { SchedulePayoutsLambdaConstruct } from "./constructs/lambda/payout/schedule-payouts/schedule-payouts-lambda-construct";
import { RepublishLambdaConstruct } from "./constructs/lambda/republish/republish-lambda-construct";

export class PayoutDomainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DomainStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Domain", "hand-made-payout-domain");
    cdk.Tags.of(this).add("Environment", props.environment);
    cdk.Tags.of(this).add("Project", "hand-made");
    cdk.Tags.of(this).add("Region", props.regionCode);
    cdk.Tags.of(this).add("StackName", this.stackName);

    const removalPolicy = props.environment === 'prod'
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    const schemaRegistryName = ssm.StringParameter.valueForStringParameter(
      this,
      `/${props.environment}/shared-infra/glue/schema-registry-name`,
    );

    const eventBusName = ssm.StringParameter.fromStringParameterName(
      this,
      "EventBusNameParameter",
      `/${props.environment}/shared-infra/eventbridge/event-bus-name`,
    ).stringValue;

    const eventBus = events.EventBus.fromEventBusName(this, "ImportedEventBus", eventBusName);

    // Step 1: Import Orders table from Order Domain (for earnings calculation)
    const ordersTableName = ssm.StringParameter.fromStringParameterName(
      this,
      'OrdersTableName',
      `/${props.environment}/order-domain/dynamodb/orders-table-name`
    ).stringValue;

    const ordersTable = dynamodb.Table.fromTableName(
      this,
      'ImportedOrdersTable',
      ordersTableName
    );

    // Step 2: Create DynamoDB tables
    const payoutTables = new PayoutTablesConstruct(this, "PayoutTables", {
      environment: props.environment,
      regionCode: props.regionCode,
      removalPolicy,
    });

    const outboxTable = new OutboxTableConstruct(this, "OutboxTable", {
      environment: props.environment,
      regionCode: props.regionCode,
      domainName: "payout-domain",
      removalPolicy,
    });

    new RepublishLambdaConstruct(this, "RepublishLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      domainName: "payout-domain",
      outboxTable: outboxTable.table,
      eventBus,
      schemaRegistryName,
      removalPolicy,
    });

    // Step 3: Create Step Functions State Machine
    const payoutStateMachine = new PayoutStateMachineConstruct(this, "PayoutStateMachine", {
      environment: props.environment,
      regionCode: props.regionCode,
      makerBalancesTable: payoutTables.makerBalancesTable,
      payoutsTable: payoutTables.payoutsTable,
      earningsTable: payoutTables.earningsTable,
      ordersTable: ordersTable,
    });

    // Step 4: Create Lambda functions that invoke Step Functions
    const processPayoutLambda = new ProcessPayoutLambdaConstruct(this, "ProcessPayoutLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      stateMachine: payoutStateMachine.stateMachine,
      removalPolicy,
    });

    // Create additional Lambda functions
    const calculateEarningsLambda = new CalculateEarningsLambdaConstruct(this, "CalculateEarningsLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      ordersTable: ordersTable,
      earningsTable: payoutTables.earningsTable,
      makerBalancesTable: payoutTables.makerBalancesTable,
      removalPolicy,
    });

    const createPayoutLambda = new CreatePayoutLambdaConstruct(this, "CreatePayoutLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      stateMachine: payoutStateMachine.stateMachine,
      removalPolicy,
    });

    const getMakerBalanceLambda = new GetMakerBalanceLambdaConstruct(this, "GetMakerBalanceLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      makerBalancesTable: payoutTables.makerBalancesTable,
      removalPolicy,
    });

    const listPayoutsLambda = new ListPayoutsLambdaConstruct(this, "ListPayoutsLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      payoutsTable: payoutTables.payoutsTable,
      removalPolicy,
    });

    const listEarningsLambda = new ListEarningsLambdaConstruct(this, "ListEarningsLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      earningsTable: payoutTables.earningsTable,
      removalPolicy,
    });

    const schedulePayoutsLambda = new SchedulePayoutsLambdaConstruct(this, "SchedulePayoutsLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      payoutsTable: payoutTables.payoutsTable,
      makerBalancesTable: payoutTables.makerBalancesTable,
      scheduleExpression: 'cron(0 2 * * ? *)', // Daily at 2 AM UTC
      removalPolicy,
    });

    // Step 6: Create API Gateway REST API with Lambda integrations
    const payoutApiGateway = new PayoutApiGatewayConstruct(this, "PayoutApiGateway", {
      environment: props.environment,
      regionCode: props.regionCode,
      processPayoutLambda: processPayoutLambda.function,
      calculateEarningsLambda: calculateEarningsLambda.function,
      createPayoutLambda: createPayoutLambda.function,
      getMakerBalanceLambda: getMakerBalanceLambda.function,
      listPayoutsLambda: listPayoutsLambda.function,
      listEarningsLambda: listEarningsLambda.function,
    });
  }
}

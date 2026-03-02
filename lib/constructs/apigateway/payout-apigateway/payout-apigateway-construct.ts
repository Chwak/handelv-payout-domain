import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface PayoutApiGatewayConstructProps {
  environment: string;
  regionCode: string;
  calculateEarningsLambda?: lambda.IFunction;
  createPayoutLambda?: lambda.IFunction;
  processPayoutLambda?: lambda.IFunction;
  getMakerBalanceLambda?: lambda.IFunction;
  listPayoutsLambda?: lambda.IFunction;
  listEarningsLambda?: lambda.IFunction;
}

export class PayoutApiGatewayConstruct extends Construct {
  public readonly api: apigateway.RestApi;
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: PayoutApiGatewayConstructProps) {
    super(scope, id);

    // Import User Pool from SSM (created by auth-essentials stack)
    const userPoolId = ssm.StringParameter.fromStringParameterName(
      this,
      'UserPoolId',
      `/${props.environment}/auth-essentials/cognito/user-pool-id`
    ).stringValue;

    const userPool = cognito.UserPool.fromUserPoolId(
      this,
      'ImportedUserPool',
      userPoolId
    );

    // Create API Gateway for payout operations
    this.api = new apigateway.RestApi(this, 'PayoutApi', {
      restApiName: `${props.environment}-${props.regionCode}-payout-domain-api`,
      description: 'Payout API for Hand-Made Platform',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ['http://localhost:3000', 'https://localhost:3000'],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: true,
      },
    });

    this.apiUrl = this.api.url;

    // Cognito authorizer is the primary authorizer in all domains except auth.
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
    });

    // ===== BALANCE ENDPOINTS =====

    // GET /balances/{makerUserId} - Get maker balance (requires auth)
    if (props.getMakerBalanceLambda) {
      const balancesResource = this.api.root.addResource('balances');
      const makerUserIdResource = balancesResource.addResource('{makerUserId}');
      const getBalanceIntegration = new apigateway.LambdaIntegration(props.getMakerBalanceLambda);

      makerUserIdResource.addMethod('GET', getBalanceIntegration, {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer: cognitoAuthorizer,
      });
    }

    // ===== EARNINGS ENDPOINTS =====

    // GET /earnings/{makerUserId} - List earnings (requires auth)
    if (props.listEarningsLambda) {
      const earningsResource = this.api.root.addResource('earnings');
      const makerUserIdResource = earningsResource.addResource('{makerUserId}');
      const listEarningsIntegration = new apigateway.LambdaIntegration(props.listEarningsLambda);

      makerUserIdResource.addMethod('GET', listEarningsIntegration, {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer: cognitoAuthorizer,
      });
    }

    // POST /earnings/calculate - Calculate earnings (internal/event-driven, may not need API endpoint)
    // This is typically triggered by events, but included for admin operations if needed

    // ===== PAYOUT ENDPOINTS =====

    // POST /payouts - Create payout (requires auth)
    if (props.createPayoutLambda) {
      const payoutsResource = this.api.root.addResource('payouts');
      const createPayoutIntegration = new apigateway.LambdaIntegration(props.createPayoutLambda);

      payoutsResource.addMethod('POST', createPayoutIntegration, {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer: cognitoAuthorizer,
      });
    }

    // GET /payouts/makers/{makerUserId} - List payouts (requires auth)
    if (props.listPayoutsLambda) {
      const payoutsResource = this.api.root.getResource('payouts');
      if (payoutsResource) {
        const makersResource = payoutsResource.addResource('makers');
        const makerUserIdResource = makersResource.addResource('{makerUserId}');
        const listPayoutsIntegration = new apigateway.LambdaIntegration(props.listPayoutsLambda);

        makerUserIdResource.addMethod('GET', listPayoutsIntegration, {
          authorizationType: apigateway.AuthorizationType.COGNITO,
          authorizer: cognitoAuthorizer,
        });
      }
    }

    // POST /payouts/{payoutId}/process - Process payout (requires auth, typically admin)
    if (props.processPayoutLambda) {
      const payoutsResource = this.api.root.getResource('payouts');
      if (payoutsResource) {
        const payoutIdResource = payoutsResource.addResource('{payoutId}');
        const processResource = payoutIdResource.addResource('process');
        const processPayoutIntegration = new apigateway.LambdaIntegration(props.processPayoutLambda);

        processResource.addMethod('POST', processPayoutIntegration, {
          authorizationType: apigateway.AuthorizationType.COGNITO,
          authorizer: cognitoAuthorizer,
        });
      }
    }

    // GET /payouts/{payoutId} - Get payout details (requires auth)
    if (props.listPayoutsLambda) {
      const payoutsResource = this.api.root.getResource('payouts');
      if (payoutsResource) {
        const payoutIdResource = payoutsResource.getResource('{payoutId}');
        if (payoutIdResource) {
          const getPayoutIntegration = new apigateway.LambdaIntegration(props.listPayoutsLambda);

          payoutIdResource.addMethod('GET', getPayoutIntegration, {
            authorizationType: apigateway.AuthorizationType.COGNITO,
            authorizer: cognitoAuthorizer,
          });
        }
      }
    }

    // Grant Lambda functions permission to be invoked by API Gateway
    const lambdaFunctions = [
      props.calculateEarningsLambda,
      props.createPayoutLambda,
      props.processPayoutLambda,
      props.getMakerBalanceLambda,
      props.listPayoutsLambda,
      props.listEarningsLambda,
    ].filter(fn => fn !== undefined);

    lambdaFunctions.forEach(lambdaFn => {
      if (lambdaFn) {
        lambdaFn.addPermission(`${lambdaFn.node.id}ApiGatewayPermission`, {
          principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          action: 'lambda:InvokeFunction',
          sourceArn: this.api.arnForExecuteApi('*', '/*', '*'),
        });
      }
    });

    // Export API URL to SSM
    new ssm.StringParameter(this, 'PayoutApiUrlParameter', {
      parameterName: `/${props.environment}/payout-domain/apigateway/api-url`,
      stringValue: this.apiUrl,
      description: 'Payout Domain API Gateway REST API URL',
    });

    new cdk.CfnOutput(this, 'PayoutApiUrl', {
      value: this.apiUrl,
      description: 'Payout Domain API Gateway REST API URL',
      exportName: `${props.environment}-${props.regionCode}-payout-domain-api-url`,
    });
  }
}

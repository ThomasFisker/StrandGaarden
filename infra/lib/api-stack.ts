import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwAuthz from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigwIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  stage: string;
  table: dynamodb.ITableV2;
  originalsBucket: s3.IBucket;
  derivedBucket: s3.IBucket;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  allowedOrigins: string[];
}

/**
 * HTTP API + starter Lambdas. `GET /health` is public; `GET /whoami` is
 * gated by a Cognito JWT authorizer and echoes the caller's claims — the
 * two routes together prove the whole pipeline is wired end-to-end.
 *
 * Business routes (upload URL issuance, photo CRUD, committee actions)
 * will land as follow-up increments that reuse the authorizer here.
 */
export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const lambdaDir = path.join(__dirname, '..', 'lambdas');

    const commonFnProps: Omit<lambdaNodejs.NodejsFunctionProps, 'entry' | 'functionName' | 'description'> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        STAGE: props.stage,
        TABLE_NAME: props.table.tableName,
        ORIGINALS_BUCKET: props.originalsBucket.bucketName,
        DERIVED_BUCKET: props.derivedBucket.bucketName,
      },
    };

    const healthFn = new lambdaNodejs.NodejsFunction(this, 'HealthFn', {
      ...commonFnProps,
      entry: path.join(lambdaDir, 'health.ts'),
      functionName: `strandgaarden-${props.stage}-health`,
      description: 'Public health check endpoint',
    });

    const whoamiFn = new lambdaNodejs.NodejsFunction(this, 'WhoamiFn', {
      ...commonFnProps,
      entry: path.join(lambdaDir, 'whoami.ts'),
      functionName: `strandgaarden-${props.stage}-whoami`,
      description: 'Returns caller JWT claims — proves the JWT authorizer works',
    });

    const jwtAuthorizer = new apigwAuthz.HttpJwtAuthorizer(
      'CognitoJwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}`,
      {
        jwtAudience: [props.userPoolClient.userPoolClientId],
        authorizerName: 'CognitoJwtAuthorizer',
      },
    );

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `strandgaarden-${props.stage}`,
      corsPreflight: {
        allowOrigins: props.allowedOrigins,
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: cdk.Duration.hours(1),
      },
      createDefaultStage: true,
    });

    this.httpApi.addRoutes({
      path: '/health',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwIntegrations.HttpLambdaIntegration('HealthIntegration', healthFn),
    });

    this.httpApi.addRoutes({
      path: '/whoami',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwIntegrations.HttpLambdaIntegration('WhoamiIntegration', whoamiFn),
      authorizer: jwtAuthorizer,
    });

    new ssm.StringParameter(this, 'ApiUrlParam', {
      parameterName: `/strandgaarden/${props.stage}/api/url`,
      stringValue: this.httpApi.apiEndpoint,
      description: 'Base URL of the HTTP API',
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: this.httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'HealthCheckUrl', { value: `${this.httpApi.apiEndpoint}/health` });
  }
}

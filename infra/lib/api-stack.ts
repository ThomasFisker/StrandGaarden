import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwAuthz from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigwIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
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
        // Bundle the AWS SDK instead of relying on the runtime-provided copy:
        // some sub-packages (e.g. @aws-sdk/s3-request-presigner) are not
        // guaranteed to be present in the Node.js 22 Lambda runtime image.
        externalModules: [],
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

    const uploadUrlFn = new lambdaNodejs.NodejsFunction(this, 'UploadUrlFn', {
      ...commonFnProps,
      entry: path.join(lambdaDir, 'upload-url.ts'),
      functionName: `strandgaarden-${props.stage}-upload-url`,
      description: 'Issues a presigned PUT URL for an originals-bucket upload and creates the PHOTO stub row',
      timeout: cdk.Duration.seconds(15),
    });
    props.table.grantWriteData(uploadUrlFn);
    props.originalsBucket.grantPut(uploadUrlFn);

    const mineFn = new lambdaNodejs.NodejsFunction(this, 'MineFn', {
      ...commonFnProps,
      entry: path.join(lambdaDir, 'mine.ts'),
      functionName: `strandgaarden-${props.stage}-mine`,
      description: 'Returns photos uploaded by the caller, with presigned thumbnail URLs',
      timeout: cdk.Duration.seconds(15),
    });
    props.table.grantReadData(mineFn);
    props.derivedBucket.grantRead(mineFn);

    const reviewListFn = new lambdaNodejs.NodejsFunction(this, 'ReviewListFn', {
      ...commonFnProps,
      entry: path.join(lambdaDir, 'review-list.ts'),
      functionName: `strandgaarden-${props.stage}-review-list`,
      description: 'Lists photos awaiting committee review (status=In Review) with thumb+web URLs',
      timeout: cdk.Duration.seconds(20),
    });
    props.table.grantReadData(reviewListFn);
    props.derivedBucket.grantRead(reviewListFn);

    const reviewDecideFn = new lambdaNodejs.NodejsFunction(this, 'ReviewDecideFn', {
      ...commonFnProps,
      entry: path.join(lambdaDir, 'review-decide.ts'),
      functionName: `strandgaarden-${props.stage}-review-decide`,
      description: 'Records a committee decision: sets visibility flags, advances to Decided, audits',
      timeout: cdk.Duration.seconds(10),
    });
    props.table.grantReadWriteData(reviewDecideFn);

    const photosDeleteFn = new lambdaNodejs.NodejsFunction(this, 'PhotosDeleteFn', {
      ...commonFnProps,
      entry: path.join(lambdaDir, 'photos-delete.ts'),
      functionName: `strandgaarden-${props.stage}-photos-delete`,
      description: 'Admin-only: hard-delete a photo (original + derivatives + DDB rows)',
      timeout: cdk.Duration.seconds(30),
    });
    props.table.grantReadWriteData(photosDeleteFn);
    props.originalsBucket.grantDelete(photosDeleteFn);
    props.derivedBucket.grantDelete(photosDeleteFn);

    const galleryListFn = new lambdaNodejs.NodejsFunction(this, 'GalleryListFn', {
      ...commonFnProps,
      entry: path.join(lambdaDir, 'gallery-list.ts'),
      functionName: `strandgaarden-${props.stage}-gallery-list`,
      description: 'Lists Decided+visibilityWeb photos with presigned thumbs; year/house filters',
      timeout: cdk.Duration.seconds(20),
    });
    props.table.grantReadData(galleryListFn);
    props.derivedBucket.grantRead(galleryListFn);

    const galleryDetailFn = new lambdaNodejs.NodejsFunction(this, 'GalleryDetailFn', {
      ...commonFnProps,
      entry: path.join(lambdaDir, 'gallery-detail.ts'),
      functionName: `strandgaarden-${props.stage}-gallery-detail`,
      description: 'Detail view for a single Decided+visibilityWeb photo (web URL + download URL)',
      timeout: cdk.Duration.seconds(10),
    });
    props.table.grantReadData(galleryDetailFn);
    props.derivedBucket.grantRead(galleryDetailFn);

    // Admin user-management lambdas — all pick up USER_POOL_ID via env.
    const userMgmtEnv = { ...commonFnProps.environment, USER_POOL_ID: props.userPool.userPoolId };
    const userMgmtFnProps: Omit<lambdaNodejs.NodejsFunctionProps, 'entry' | 'functionName' | 'description'> = {
      ...commonFnProps,
      environment: userMgmtEnv,
      timeout: cdk.Duration.seconds(15),
    };

    const usersListFn = new lambdaNodejs.NodejsFunction(this, 'UsersListFn', {
      ...userMgmtFnProps,
      entry: path.join(lambdaDir, 'users-list.ts'),
      functionName: `strandgaarden-${props.stage}-users-list`,
      description: 'Admin-only: list Cognito users with group membership and status',
    });
    const usersCreateFn = new lambdaNodejs.NodejsFunction(this, 'UsersCreateFn', {
      ...userMgmtFnProps,
      entry: path.join(lambdaDir, 'users-create.ts'),
      functionName: `strandgaarden-${props.stage}-users-create`,
      description: 'Admin-only: invite a new user with a permanent initial password and group',
    });
    const usersUpdateGroupFn = new lambdaNodejs.NodejsFunction(this, 'UsersUpdateGroupFn', {
      ...userMgmtFnProps,
      entry: path.join(lambdaDir, 'users-update-group.ts'),
      functionName: `strandgaarden-${props.stage}-users-update-group`,
      description: 'Admin-only: move a user to a different role group',
    });
    const usersUpdateNameFn = new lambdaNodejs.NodejsFunction(this, 'UsersUpdateNameFn', {
      ...userMgmtFnProps,
      entry: path.join(lambdaDir, 'users-update-name.ts'),
      functionName: `strandgaarden-${props.stage}-users-update-name`,
      description: 'Admin-only: set a user\'s display name (preferred_username)',
    });
    const usersResetPasswordFn = new lambdaNodejs.NodejsFunction(this, 'UsersResetPasswordFn', {
      ...userMgmtFnProps,
      entry: path.join(lambdaDir, 'users-reset-password.ts'),
      functionName: `strandgaarden-${props.stage}-users-reset-password`,
      description: 'Admin-only: set a permanent new password for a user',
    });
    const usersDeleteFn = new lambdaNodejs.NodejsFunction(this, 'UsersDeleteFn', {
      ...userMgmtFnProps,
      entry: path.join(lambdaDir, 'users-delete.ts'),
      functionName: `strandgaarden-${props.stage}-users-delete`,
      description: 'Admin-only: delete a user from the pool (cannot delete self)',
    });

    const personsListFn = new lambdaNodejs.NodejsFunction(this, 'PersonsListFn', {
      ...commonFnProps,
      entry: path.join(lambdaDir, 'persons-list.ts'),
      functionName: `strandgaarden-${props.stage}-persons-list`,
      description: 'Lists people for tagging autocomplete + admin management',
      timeout: cdk.Duration.seconds(10),
    });
    props.table.grantReadData(personsListFn);

    const personsCreateFn = new lambdaNodejs.NodejsFunction(this, 'PersonsCreateFn', {
      ...commonFnProps,
      entry: path.join(lambdaDir, 'persons-create.ts'),
      functionName: `strandgaarden-${props.stage}-persons-create`,
      description: 'Admin-only: create an approved person directly',
      timeout: cdk.Duration.seconds(10),
    });
    props.table.grantReadWriteData(personsCreateFn);

    const personsUpdateFn = new lambdaNodejs.NodejsFunction(this, 'PersonsUpdateFn', {
      ...commonFnProps,
      entry: path.join(lambdaDir, 'persons-update.ts'),
      functionName: `strandgaarden-${props.stage}-persons-update`,
      description: 'Admin-only: rename a person and/or approve a pending proposal',
      timeout: cdk.Duration.seconds(10),
    });
    props.table.grantReadWriteData(personsUpdateFn);

    const personsDeleteFn = new lambdaNodejs.NodejsFunction(this, 'PersonsDeleteFn', {
      ...commonFnProps,
      entry: path.join(lambdaDir, 'persons-delete.ts'),
      functionName: `strandgaarden-${props.stage}-persons-delete`,
      description: 'Admin-only: delete a person and scrub their slug from every photo',
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
    });
    props.table.grantReadWriteData(personsDeleteFn);

    // Upload-url Lambda also needs to read and write PERSON items (to verify
    // known slugs and upsert pending proposals). Its existing grantWriteData
    // covers the write side; add read for the GetCommand guard.
    props.table.grantReadData(uploadUrlFn);

    const userPoolAdminActions = new iam.PolicyStatement({
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminListGroupsForUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminUpdateUserAttributes',
      ],
      resources: [props.userPool.userPoolArn],
    });
    usersListFn.addToRolePolicy(userPoolAdminActions);
    usersCreateFn.addToRolePolicy(userPoolAdminActions);
    usersUpdateGroupFn.addToRolePolicy(userPoolAdminActions);
    usersUpdateNameFn.addToRolePolicy(userPoolAdminActions);
    usersResetPasswordFn.addToRolePolicy(userPoolAdminActions);
    usersDeleteFn.addToRolePolicy(userPoolAdminActions);

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

    this.httpApi.addRoutes({
      path: '/upload-url',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwIntegrations.HttpLambdaIntegration('UploadUrlIntegration', uploadUrlFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/photos/mine',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwIntegrations.HttpLambdaIntegration('MineIntegration', mineFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/photos/review',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwIntegrations.HttpLambdaIntegration('ReviewListIntegration', reviewListFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/photos/{id}/decision',
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new apigwIntegrations.HttpLambdaIntegration('ReviewDecideIntegration', reviewDecideFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/photos/{id}',
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new apigwIntegrations.HttpLambdaIntegration('PhotosDeleteIntegration', photosDeleteFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/gallery',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwIntegrations.HttpLambdaIntegration('GalleryListIntegration', galleryListFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/gallery/{id}',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwIntegrations.HttpLambdaIntegration('GalleryDetailIntegration', galleryDetailFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/users',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwIntegrations.HttpLambdaIntegration('UsersListIntegration', usersListFn),
      authorizer: jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/users',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwIntegrations.HttpLambdaIntegration('UsersCreateIntegration', usersCreateFn),
      authorizer: jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/users/{username}/groups',
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new apigwIntegrations.HttpLambdaIntegration('UsersUpdateGroupIntegration', usersUpdateGroupFn),
      authorizer: jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/users/{username}/login-name',
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new apigwIntegrations.HttpLambdaIntegration('UsersUpdateNameIntegration', usersUpdateNameFn),
      authorizer: jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/users/{username}/password',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwIntegrations.HttpLambdaIntegration('UsersResetPasswordIntegration', usersResetPasswordFn),
      authorizer: jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/users/{username}',
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new apigwIntegrations.HttpLambdaIntegration('UsersDeleteIntegration', usersDeleteFn),
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/persons',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwIntegrations.HttpLambdaIntegration('PersonsListIntegration', personsListFn),
      authorizer: jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/persons',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwIntegrations.HttpLambdaIntegration('PersonsCreateIntegration', personsCreateFn),
      authorizer: jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/persons/{slug}',
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new apigwIntegrations.HttpLambdaIntegration('PersonsUpdateIntegration', personsUpdateFn),
      authorizer: jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/persons/{slug}',
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new apigwIntegrations.HttpLambdaIntegration('PersonsDeleteIntegration', personsDeleteFn),
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

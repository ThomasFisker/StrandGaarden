import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
  stage: string;
}

/**
 * Cognito user pool + SPA client for the photo platform.
 *
 * Roles are represented as Cognito groups (admin / member / viewer). The
 * ID token's `cognito:groups` claim carries membership to the backend —
 * no Lambda trigger required.
 *
 * User creation is admin-only (no self-signup). The admin tool creates
 * users with AdminCreateUser and immediately calls AdminSetUserPassword
 * with Permanent=true so the user is not forced to change the password
 * on first login (per the "nothing secret here" architectural decision).
 *
 * Email delivery uses Cognito's default sender for now. Switching to SES
 * (for password resets, approval notices, etc.) is a follow-up increment.
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const isProd = props.stage === 'prod';

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `strandgaarden-${props.stage}-users`,
      selfSignUpEnabled: false,
      signInAliases: { email: true, username: false },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OFF,
      deletionProtection: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    for (const groupName of ['admin', 'member', 'viewer']) {
      new cognito.CfnUserPoolGroup(this, `Group-${groupName}`, {
        userPoolId: this.userPool.userPoolId,
        groupName,
        description: `Strandgaarden ${groupName} role`,
      });
    }

    this.userPoolClient = new cognito.UserPoolClient(this, 'SpaClient', {
      userPool: this.userPool,
      userPoolClientName: `strandgaarden-${props.stage}-spa`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
      },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: `/strandgaarden/${props.stage}/cognito/user-pool-id`,
      stringValue: this.userPool.userPoolId,
      description: 'Cognito user pool ID',
    });
    new ssm.StringParameter(this, 'UserPoolClientIdParam', {
      parameterName: `/strandgaarden/${props.stage}/cognito/user-pool-client-id`,
      stringValue: this.userPoolClient.userPoolClientId,
      description: 'Cognito SPA app client ID',
    });
    new ssm.StringParameter(this, 'UserPoolIssuerParam', {
      parameterName: `/strandgaarden/${props.stage}/cognito/user-pool-issuer`,
      stringValue: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`,
      description: 'OIDC issuer URL for the Cognito user pool (for API Gateway JWT authorizer)',
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
  }
}

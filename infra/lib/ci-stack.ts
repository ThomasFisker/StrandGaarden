import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface CiStackProps extends cdk.StackProps {
  /** GitHub "owner/repo", e.g. "ThomasFisker/StrandGaarden". */
  githubOwnerRepo: string;
}

export class CiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);

    const oidcProvider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const deployRole = new iam.Role(this, 'GithubActionsDeployRole', {
      roleName: 'strandgaarden-ci-deploy',
      description: 'Assumed by GitHub Actions to deploy Strandgaarden CDK stacks via OIDC',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(oidcProvider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${props.githubOwnerRepo}:*`,
        },
      }),
    });

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: deployRole.roleArn,
      description: 'ARN to put in the GitHub Actions workflow role-to-assume field',
    });
  }
}

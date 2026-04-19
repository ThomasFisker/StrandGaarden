#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack';
import { CiStack } from '../lib/ci-stack';
import { StorageStack } from '../lib/storage-stack';
import { DataStack } from '../lib/data-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-west-1',
};

new FoundationStack(app, 'Strandgaarden-Dev-Foundation', {
  env,
  stage: 'dev',
  description: 'Phase 0 proof-of-life stack for the Strandgaarden anniversary photo platform',
});

new CiStack(app, 'Strandgaarden-Ci', {
  env,
  githubOwnerRepo: 'ThomasFisker/StrandGaarden',
  description: 'GitHub Actions OIDC provider and deploy role for the Strandgaarden CI/CD pipeline',
});

const devAllowedOrigins = ['http://localhost:5173', 'http://localhost:3000'];

const storage = new StorageStack(app, 'Strandgaarden-Dev-Storage', {
  env,
  stage: 'dev',
  uploadAllowedOrigins: devAllowedOrigins,
  description: 'S3 buckets for photo originals and generated derivatives',
});

const data = new DataStack(app, 'Strandgaarden-Dev-Data', {
  env,
  stage: 'dev',
  description: 'Single-table DynamoDB for photos, audit log, person list, removals, and users',
});

const auth = new AuthStack(app, 'Strandgaarden-Dev-Auth', {
  env,
  stage: 'dev',
  description: 'Cognito user pool, admin/member/viewer groups, and SPA client',
});

new ApiStack(app, 'Strandgaarden-Dev-Api', {
  env,
  stage: 'dev',
  table: data.table,
  originalsBucket: storage.originalsBucket,
  derivedBucket: storage.derivedBucket,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  allowedOrigins: devAllowedOrigins,
  description: 'HTTP API Gateway + starter Lambdas (health, whoami) with Cognito JWT authorizer',
});

cdk.Tags.of(app).add('Project', 'Strandgaarden');
cdk.Tags.of(app).add('Stage', 'dev');
cdk.Tags.of(app).add('ManagedBy', 'CDK');

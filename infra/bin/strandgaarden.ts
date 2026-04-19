#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack';
import { CiStack } from '../lib/ci-stack';
import { StorageStack } from '../lib/storage-stack';
import { DataStack } from '../lib/data-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';
import { ImagePipelineStack } from '../lib/image-pipeline-stack';
import { HostingStack } from '../lib/hosting-stack';

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

const hosting = new HostingStack(app, 'Strandgaarden-Dev-Hosting', {
  env,
  stage: 'dev',
  description: 'S3 + CloudFront hosting for the React SPA (default CloudFront domain until DNS lands)',
});

// Origins that need to talk to the API (browser → API Gateway) and PUT
// uploads (browser → originals bucket). localhost entries stay so
// `npm run dev` keeps working alongside the deployed site.
const webOrigin = `https://${hosting.distribution.distributionDomainName}`;
const localDevOrigins = ['http://localhost:5173', 'http://localhost:3000'];
const allowedOrigins = [...localDevOrigins, webOrigin];

const storage = new StorageStack(app, 'Strandgaarden-Dev-Storage', {
  env,
  stage: 'dev',
  uploadAllowedOrigins: allowedOrigins,
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
  allowedOrigins,
  description: 'HTTP API Gateway + starter Lambdas (health, whoami) with Cognito JWT authorizer',
});

new ImagePipelineStack(app, 'Strandgaarden-Dev-ImagePipeline', {
  env,
  stage: 'dev',
  table: data.table,
  originalsBucketName: storage.originalsBucket.bucketName,
  derivedBucketName: storage.derivedBucket.bucketName,
  description: 'S3-triggered Lambda that generates web/thumb derivatives, blurhash, and advances photos to In Review',
});

cdk.Tags.of(app).add('Project', 'Strandgaarden');
cdk.Tags.of(app).add('Stage', 'dev');
cdk.Tags.of(app).add('ManagedBy', 'CDK');

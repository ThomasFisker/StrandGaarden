#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack';
import { CiStack } from '../lib/ci-stack';
import { StorageStack } from '../lib/storage-stack';
import { DataStack } from '../lib/data-stack';

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

new StorageStack(app, 'Strandgaarden-Dev-Storage', {
  env,
  stage: 'dev',
  uploadAllowedOrigins: ['http://localhost:5173', 'http://localhost:3000'],
  description: 'S3 buckets for photo originals and generated derivatives',
});

new DataStack(app, 'Strandgaarden-Dev-Data', {
  env,
  stage: 'dev',
  description: 'Single-table DynamoDB for photos, audit log, person list, removals, and users',
});

cdk.Tags.of(app).add('Project', 'Strandgaarden');
cdk.Tags.of(app).add('Stage', 'dev');
cdk.Tags.of(app).add('ManagedBy', 'CDK');

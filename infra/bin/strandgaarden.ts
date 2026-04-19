#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack';

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

cdk.Tags.of(app).add('Project', 'Strandgaarden');
cdk.Tags.of(app).add('Stage', 'dev');
cdk.Tags.of(app).add('ManagedBy', 'CDK');

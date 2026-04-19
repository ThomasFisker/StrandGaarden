import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface FoundationStackProps extends cdk.StackProps {
  stage: string;
}

export class FoundationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    const proofOfLife = new ssm.StringParameter(this, 'ProofOfLifeParam', {
      parameterName: `/strandgaarden/${props.stage}/foundation/version`,
      stringValue: 'phase-0',
      description: 'Proof-of-life parameter confirming the CDK deploy pipeline reaches AWS',
    });

    new cdk.CfnOutput(this, 'Stage', { value: props.stage });
    new cdk.CfnOutput(this, 'ProofOfLifeParameterName', { value: proofOfLife.parameterName });
  }
}

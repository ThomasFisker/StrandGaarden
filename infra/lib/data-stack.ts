import * as cdk from 'aws-cdk-lib';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface DataStackProps extends cdk.StackProps {
  stage: string;
}

/**
 * Single-table DynamoDB design for the photo platform.
 *
 * Base table keys: PK (string) + SK (string).
 * GSI1 keys:       GSI1PK (string) + GSI1SK (string), ALL projection, sparse.
 *
 * Item layout (invariant — items are addressed by these exact key patterns):
 *   PHOTO#<id>        / META                       — photo record
 *                       GSI1PK = STATUS#<status>,   GSI1SK = <uploadedAt>#<id>   (review/decided queues)
 *   PHOTO#<id>        / AUDIT#<ts>#<evt>           — state-change audit log (no GSI)
 *   PERSONLIST        / PERSON#<slug>              — controlled name list; attr `state` = approved|pending
 *   REMOVAL#<id>      / META                       — GDPR removal request
 *                       GSI1PK = REMOVAL#<status>, GSI1SK = <requestedAt>#<id>  (committee queue)
 *   USER#<email>      / META                       — user record (role, added-by)
 *
 * Multi-valued filters (house numbers, tagged persons) are Scan+Filter for now —
 * fine at ~500 photos. Add a GSI or denormalized tag items only if that access
 * pattern starts to hurt.
 */
export class DataStack extends cdk.Stack {
  public readonly table: ddb.TableV2;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const isProd = props.stage === 'prod';

    this.table = new ddb.TableV2(this, 'DataTable', {
      tableName: `strandgaarden-${props.stage}-data`,
      partitionKey: { name: 'PK', type: ddb.AttributeType.STRING },
      sortKey: { name: 'SK', type: ddb.AttributeType.STRING },
      billing: ddb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      dynamoStream: ddb.StreamViewType.NEW_AND_OLD_IMAGES,
      deletionProtection: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: ddb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: ddb.AttributeType.STRING },
          projectionType: ddb.ProjectionType.ALL,
        },
      ],
    });

    new ssm.StringParameter(this, 'TableNameParam', {
      parameterName: `/strandgaarden/${props.stage}/dynamodb/table-name`,
      stringValue: this.table.tableName,
      description: 'Name of the single-table DynamoDB instance for the photo platform',
    });

    new cdk.CfnOutput(this, 'TableName', { value: this.table.tableName });
    new cdk.CfnOutput(this, 'TableArn', { value: this.table.tableArn });
  }
}

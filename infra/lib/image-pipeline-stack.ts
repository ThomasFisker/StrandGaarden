import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';

export interface ImagePipelineStackProps extends cdk.StackProps {
  stage: string;
  table: dynamodb.ITableV2;
  /**
   * Bucket names are taken (not bucket constructs) to avoid a cross-stack
   * dependency cycle: StorageStack already creates the buckets, and this
   * stack needs to wire an S3 event → Lambda notification. Passing the L2
   * Bucket would make Storage depend on the Lambda ARN *and* this stack
   * depend on the bucket ARN — cyclic.
   */
  originalsBucketName: string;
  derivedBucketName: string;
}

const SHARP_VERSION = '0.33.5';

export class ImagePipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ImagePipelineStackProps) {
    super(scope, id, props);

    const sharpLayer = new lambda.LayerVersion(this, 'SharpLayer', {
      description: `sharp@${SHARP_VERSION} for linux-arm64`,
      compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
      compatibleArchitectures: [lambda.Architecture.ARM_64],
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'layers', 'sharp'), {
        assetHashType: cdk.AssetHashType.OUTPUT,
        bundling: {
          // Docker path is unused; we take the local path below unconditionally.
          image: lambda.Runtime.NODEJS_22_X.bundlingImage,
          command: ['bash', '-c', 'false'],
          local: {
            tryBundle(outputDir: string): boolean {
              // --libc=glibc is required so npm picks @img/sharp-libvips-linux-arm64
              // (Lambda Node 22 runs on Amazon Linux 2023, glibc-based). Without
              // it, only the generic sharp package is copied and the runtime
              // fails at module-load with "Could not load the sharp module".
              execSync(
                `npm install --os=linux --cpu=arm64 --libc=glibc --omit=dev --no-save --no-package-lock --prefix "${outputDir}/nodejs" sharp@${SHARP_VERSION}`,
                { stdio: 'inherit' },
              );
              return true;
            },
          },
        },
      }),
    });

    const processFn = new lambdaNodejs.NodejsFunction(this, 'ProcessImageFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'handler',
      entry: path.join(__dirname, '..', 'lambdas', 'process-image.ts'),
      functionName: `strandgaarden-${props.stage}-process-image`,
      description: 'S3 PutObject → generate derivatives, blurhash; bump photo to In Review',
      memorySize: 2048,
      timeout: cdk.Duration.minutes(2),
      layers: [sharpLayer],
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
        // sharp is delivered via the layer at /opt/nodejs/node_modules/sharp.
        externalModules: ['sharp'],
      },
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        STAGE: props.stage,
        TABLE_NAME: props.table.tableName,
        ORIGINALS_BUCKET: props.originalsBucketName,
        DERIVED_BUCKET: props.derivedBucketName,
      },
    });

    const originalsBucket = s3.Bucket.fromBucketName(this, 'OriginalsBucketImport', props.originalsBucketName);
    const derivedBucket = s3.Bucket.fromBucketName(this, 'DerivedBucketImport', props.derivedBucketName);

    originalsBucket.grantRead(processFn);
    derivedBucket.grantWrite(processFn);
    props.table.grantReadWriteData(processFn);

    originalsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(processFn),
      { prefix: 'photos/' },
    );

    new cdk.CfnOutput(this, 'ProcessImageFunctionName', { value: processFn.functionName });
    new cdk.CfnOutput(this, 'SharpLayerVersionArn', { value: sharpLayer.layerVersionArn });
  }
}

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface StorageStackProps extends cdk.StackProps {
  stage: string;
  /** Origins allowed to upload directly to the originals bucket via presigned PUT. */
  uploadAllowedOrigins: string[];
}

/**
 * S3 buckets for the photo pipeline:
 *   - originals: system of record for uploaded photos (TIFF/PNG/JPEG/HEIC). Versioned, Intelligent-Tiering.
 *   - derived:   generated web JPEG + thumbnail + blurhash. Rebuildable, unversioned.
 */
export class StorageStack extends cdk.Stack {
  public readonly originalsBucket: s3.Bucket;
  public readonly derivedBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const isProd = props.stage === 'prod';
    const protectData: Pick<s3.BucketProps, 'removalPolicy' | 'autoDeleteObjects'> = isProd
      ? { removalPolicy: cdk.RemovalPolicy.RETAIN, autoDeleteObjects: false }
      : { removalPolicy: cdk.RemovalPolicy.DESTROY, autoDeleteObjects: true };

    this.originalsBucket = new s3.Bucket(this, 'OriginalsBucket', {
      bucketName: `strandgaarden-${props.stage}-${this.account}-originals`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      ...protectData,
      intelligentTieringConfigurations: [
        {
          name: 'archive-cold-originals',
          archiveAccessTierTime: cdk.Duration.days(90),
          deepArchiveAccessTierTime: cdk.Duration.days(180),
        },
      ],
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: props.uploadAllowedOrigins,
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'transition-new-uploads-to-intelligent-tiering',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(0),
            },
          ],
        },
        {
          id: 'expire-noncurrent-versions-after-90d',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
        {
          id: 'abort-incomplete-multipart-uploads',
          enabled: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    this.derivedBucket = new s3.Bucket(this, 'DerivedBucket', {
      bucketName: `strandgaarden-${props.stage}-${this.account}-derived`,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          id: 'abort-incomplete-multipart-uploads',
          enabled: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    new ssm.StringParameter(this, 'OriginalsBucketNameParam', {
      parameterName: `/strandgaarden/${props.stage}/buckets/originals`,
      stringValue: this.originalsBucket.bucketName,
      description: 'Name of the S3 bucket that stores uploaded photo originals',
    });
    new ssm.StringParameter(this, 'DerivedBucketNameParam', {
      parameterName: `/strandgaarden/${props.stage}/buckets/derived`,
      stringValue: this.derivedBucket.bucketName,
      description: 'Name of the S3 bucket that stores generated web JPEGs and thumbnails',
    });

    new cdk.CfnOutput(this, 'OriginalsBucketName', { value: this.originalsBucket.bucketName });
    new cdk.CfnOutput(this, 'DerivedBucketName', { value: this.derivedBucket.bucketName });
  }
}

import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface HostingStackProps extends cdk.StackProps {
  stage: string;
}

/**
 * Static hosting for the React SPA.
 *
 * - Private S3 bucket, read by CloudFront via Origin Access Control only.
 * - CloudFront distribution with React Router-friendly SPA fallback
 *   (403/404 → /index.html with 200), HTTPS-only viewer protocol,
 *   price class 100 (covers DK/Europe), TLS 1.2_2021 minimum.
 * - BucketDeployment syncs packages/web/dist/ and invalidates /* on each
 *   deploy. The web bundle MUST be built before `cdk deploy` (CI does this
 *   in the workflow; locally run `npm run build -w @strandgaarden/web`).
 *
 * Custom domain (jubilaeum.strandgaardenis.dk) is intentionally deferred —
 * DNS delegation is still pending. When it lands we add an ACM cert in
 * us-east-1, a CNAME + domainNames on the distribution, and a Route53
 * alias, all additive.
 */
export class HostingStack extends cdk.Stack {
  public readonly webBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: HostingStackProps) {
    super(scope, id, props);

    const isProd = props.stage === 'prod';

    this.webBucket = new s3.Bucket(this, 'WebBucket', {
      bucketName: `strandgaarden-${props.stage}-${this.account}-web`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // index.html must revalidate every load so a new deploy is picked up
    // without the user hard-refreshing. The browser still keeps the file
    // (304 on revalidation is cheap), but never serves it from cache
    // without checking with CloudFront first.
    const htmlHeaders = new cloudfront.ResponseHeadersPolicy(this, 'HtmlNoCacheHeaders', {
      responseHeadersPolicyName: `strandgaarden-${props.stage}-html-no-cache`,
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'cache-control',
            value: 'no-cache, no-store, must-revalidate',
            override: true,
          },
        ],
      },
    });

    // Vite-hashed assets under /assets/<file>-<hash>.<ext> are immutable
    // by construction — a new build always means a new filename. Cache
    // them in the browser for a year so repeat visits are instant.
    const assetHeaders = new cloudfront.ResponseHeadersPolicy(this, 'AssetLongCacheHeaders', {
      responseHeadersPolicyName: `strandgaarden-${props.stage}-asset-long-cache`,
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'cache-control',
            value: 'public, max-age=31536000, immutable',
            override: true,
          },
        ],
      },
    });

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.webBucket);

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Strandgaarden ${props.stage} SPA`,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: htmlHeaders,
      },
      additionalBehaviors: {
        // Hashed Vite assets — long-cache.
        '/assets/*': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          compress: true,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: assetHeaders,
        },
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(1),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(1),
        },
      ],
    });

    new s3deploy.BucketDeployment(this, 'DeployWeb', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '..', '..', 'packages', 'web', 'dist')),
      ],
      destinationBucket: this.webBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      prune: true,
      memoryLimit: 512,
    });

    new ssm.StringParameter(this, 'WebUrlParam', {
      parameterName: `/strandgaarden/${props.stage}/web/url`,
      stringValue: `https://${this.distribution.distributionDomainName}`,
      description: 'Base URL of the deployed SPA (CloudFront default domain)',
    });

    new cdk.CfnOutput(this, 'WebUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Public URL of the SPA',
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
    });
  }
}

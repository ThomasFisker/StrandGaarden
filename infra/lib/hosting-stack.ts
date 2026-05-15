import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

/** Custom domain alias for the SPA. The CNAME at one.com points
 * medlemmer.strandgaardenis.dk → the CloudFront distribution domain;
 * the ACM cert below is referenced as the viewer cert. Cert lives in
 * us-east-1 (CloudFront requirement) and was issued outside CDK via
 * `aws acm request-certificate` since the DNS validation record lives
 * at one.com and isn't managed in this repo. */
const CUSTOM_DOMAIN = 'medlemmer.strandgaardenis.dk';
const CUSTOM_DOMAIN_CERT_ARN =
  'arn:aws:acm:us-east-1:734705207936:certificate/4d4d17cd-7bce-46b0-8bee-67ae7d286909';

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
 * Custom domain: medlemmer.strandgaardenis.dk is served via the alias
 * configured below. DNS for both the validation CNAME and the
 * subdomain itself lives at one.com (the parent registrar) — see
 * CUSTOM_DOMAIN_CERT_ARN above for the issued cert.
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

    const customDomainCert = acm.Certificate.fromCertificateArn(
      this,
      'CustomDomainCert',
      CUSTOM_DOMAIN_CERT_ARN,
    );

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Strandgaarden ${props.stage} SPA`,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      domainNames: [CUSTOM_DOMAIN],
      certificate: customDomainCert,
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
      stringValue: `https://${CUSTOM_DOMAIN}`,
      description: 'Public URL of the SPA (custom-domain alias)',
    });

    new cdk.CfnOutput(this, 'WebUrl', {
      value: `https://${CUSTOM_DOMAIN}`,
      description: 'Public URL of the SPA (custom-domain alias)',
    });
    new cdk.CfnOutput(this, 'WebUrlCloudFront', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Default CloudFront URL — still works, useful as a fallback',
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
    });
  }
}

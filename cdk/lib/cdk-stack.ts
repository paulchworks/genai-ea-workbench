import { Construct } from 'constructs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'path';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Store in Secrets Manager
    const authPassword = new secretsmanager.Secret(this, 'AuthPassword', {
      generateSecretString: {
        passwordLength: 12,
        excludePunctuation: true,
        excludeCharacters: '()[]{}<>/\\@/\\"\'` ',
        includeSpace: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development - change for production
    });

    // Create VPC and ECS Cluster
    const vpc = new ec2.Vpc(this, 'BackendVPC', { maxAzs: 2 });
    const cluster = new ecs.Cluster(this, 'BackendCluster', { vpc });

    // Create DynamoDB table
    const analysisTable = new dynamodb.Table(this, 'PDFAnalysisTable', {
      partitionKey: { name: 'job_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development - change for production
    });

    // Create S3 bucket for uploaded files
    const uploadBucket = new s3.Bucket(this, 'PDFUploadBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development - change for production
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30), // Auto-delete files after 30 days
        },
      ],
    });

    // Create IAM role for the ECS task
    const taskRole = new iam.Role(this, 'BackendTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Add required permissions
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [`arn:aws:bedrock:${this.region}:${this.account}:*`],
      actions: [
        'bedrock:InvokeModel',
        'bedrock:ListFoundationModels'
      ]
    }));

    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        analysisTable.tableArn,
        `${analysisTable.tableArn}/index/*`
      ],
      actions: [
        'dynamodb:PutItem',
        'dynamodb:GetItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:BatchGetItem',
        'dynamodb:BatchWriteItem'
      ]
    }));

    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        uploadBucket.arnForObjects('*'),
        uploadBucket.bucketArn
      ],
      actions: [
        's3:PutObject',
        's3:GetObject',
        's3:DeleteObject',
        's3:ListBucket'
      ]
    }));

    // Add permissions for Amazon Knowledge Bases
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
        'kendra:Retrieve',
        'kendra:Query',
      ]
    }));

    // Create Fargate Service with ALB
    const backendService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'BackendService', {
      cluster,
      cpu: 1024, // Increased for ML workloads
      memoryLimitMiB: 2048,
      desiredCount: 1,
      taskImageOptions: {
        containerPort: 5000,
        image: ecs.ContainerImage.fromAsset('../backend', {
          platform: Platform.LINUX_AMD64
        }),
        environment: {
          AWS_REGION: this.region,
          ANALYSIS_TABLE_NAME: analysisTable.tableName,
          UPLOAD_BUCKET_NAME: uploadBucket.bucketName,
          // AUTH_PASSWORD: '************', // Use Secrets Manager instead
        },
        secrets: {
          AUTH_PASSWORD: ecs.Secret.fromSecretsManager(authPassword),
        },
        taskRole,
      },
      publicLoadBalancer: true,
      enableExecuteCommand: true,
    });

    // Grant permissions
    authPassword.grantRead(backendService.taskDefinition.taskRole);

    // Configure health check
    backendService.targetGroup.configureHealthCheck({
      path: '/health',
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 10,
      timeout: cdk.Duration.seconds(20),
      interval: cdk.Duration.seconds(30),
    });

    // Create S3 bucket for frontend
    // amazonq-ignore-next-line
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    const originRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.all(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
    });

    // Create CloudFront OAI
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI');
    websiteBucket.grantRead(originAccessIdentity);

    // Create CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        '/analyze-stream': {
          origin: new origins.LoadBalancerV2Origin(backendService.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        '/analyze-progress/*': {
          origin: new origins.LoadBalancerV2Origin(backendService.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        '/analyze': {
          origin: new origins.LoadBalancerV2Origin(backendService.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        '/analysis/*': {
          origin: new origins.LoadBalancerV2Origin(backendService.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        '/pdf/*': {
          origin: new origins.LoadBalancerV2Origin(backendService.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        '/chat/*': {
          origin: new origins.LoadBalancerV2Origin(backendService.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        '/login': {
          origin: new origins.LoadBalancerV2Origin(backendService.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: '/index.html',
        },
      ],
    });

    // Deploy frontend to S3
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../frontend'), {
        bundling: {
          command: [
            '/bin/sh',
            '-c',
            'npm install && npm run build && cp -r dist/. /asset-output/'
          ],
          image: cdk.DockerImage.fromRegistry('node:20'),
          user: 'root',
        },
      })],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // Output the CloudFront URL and other important resources
    new cdk.CfnOutput(this, 'FrontendURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Frontend URL',
    });

    new cdk.CfnOutput(this, 'UploadBucketName', {
      value: uploadBucket.bucketName,
      description: 'S3 Bucket for file uploads',
    });

    new cdk.CfnOutput(this, 'AnalysisTableName', {
      value: analysisTable.tableName,
      description: 'DynamoDB table for analysis results',
    });
  }
}

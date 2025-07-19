#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkStack } from '../lib/cdk-stack';

const app = new cdk.App();

// Get the deployment mode from context or environment variable
const deploymentMode = app.node.tryGetContext('deploymentMode') || process.env.DEPLOYMENT_MODE || 'ecs';

new CdkStack(app, 'AWS-GENAI-UW-DEMO', {
  description: 'AWS Underwriting Assistant'
});
#!/bin/bash

# Script to deploy the Lambda-based architecture

set -e  # Exit on error

# Check for required environment
if [ ! -d "./lib" ] || [ ! -d "./lambda-functions" ] || [ ! -d "./lambda-layers" ]; then
  echo "Error: This script must be run from the CDK project directory."
  echo "Make sure the directories lib/, lambda-functions/ and lambda-layers/ exist."
  exit 1
fi

echo "=== AWS Underwriting Assistant Lambda-Based Architecture Deployment ==="
echo ""
echo "This script will deploy the serverless Lambda-based architecture."
echo ""

# Install dependencies
echo "=== Installing Dependencies ==="
npm install
echo "Dependencies installed."
echo ""

# Deploy with lambda deployment mode
echo "=== Deploying Lambda-based Architecture ==="
echo "Running cdk deploy with deploymentMode=lambda..."

# Deploy with context variable
npx cdk deploy --context deploymentMode=lambda --require-approval never

echo ""
echo "=== Deployment Complete ==="
echo "You can now access the application using the FrontendURL printed above."
echo ""
echo "Note: It may take a few minutes for the CloudFront distribution to be ready."
echo "If you encounter any issues, please check the AWS Console for more details."
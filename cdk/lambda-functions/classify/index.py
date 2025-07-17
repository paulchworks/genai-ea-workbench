import json
import boto3
import os
import base64
import io
import urllib.parse
from pdf2image import convert_from_path
from datetime import datetime, timezone

# Initialize AWS clients outside the handler for reuse
s3 = boto3.client('s3')
bedrock_runtime = boto3.client(service_name='bedrock-runtime')
dynamodb_client = boto3.client('dynamodb')

def lambda_handler(event, context):
    print("Received event:", json.dumps(event))

    bucket = None
    key = None
    download_path = None
    classification_result = 'ERROR_UNKNOWN' # Default result
    job_id_parsed = None

    try:
        # --- Step 1: Extract S3 info, parse job ID, and update status ---
        
        # Extract from Step Functions input
        bucket = event['detail']['bucket']['name']
        encoded_key = event['detail']['object']['key']

        # Decode the key for S3 operations
        key = urllib.parse.unquote_plus(encoded_key)

        if not bucket or not key:
            raise ValueError("Missing S3 bucket or key in input event")

        print(f"Original encoded key: {encoded_key}")
        print(f"Decoded key for S3: {key}")
        print(f"Processing s3://{bucket}/{key}")

        # Parse Job ID from S3 key
        if key.startswith("uploads/") and key.count("/") >= 2:
            parts = key.split("/")
            job_id_parsed = parts[1]
            print(f"Parsed Job ID: {job_id_parsed}")
        else:
            print(f"Warning: Could not parse Job ID from S3 key: {key}. DynamoDB update will be skipped.")

        # For the local file path, use the decoded filename
        safe_filename = os.path.basename(key)
        download_path = f'/tmp/{safe_filename}'
        print(f"Using download path: {download_path}")

        # Update DynamoDB status to CLASSIFYING
        if job_id_parsed and os.environ.get('JOBS_TABLE_NAME'):
            try:
                timestamp_now = datetime.now(timezone.utc).isoformat()
                dynamodb_client.update_item(
                    TableName=os.environ['JOBS_TABLE_NAME'],
                    Key={'jobId': {'S': job_id_parsed}},
                    UpdateExpression="SET #status_attr = :status_val, #classifyTs = :classifyTsVal",
                    ExpressionAttributeNames={
                        '#status_attr': 'status',
                        '#classifyTs': 'classifyTimestamp'
                    },
                    ExpressionAttributeValues={
                        ':status_val': {'S': 'CLASSIFYING'},
                        ':classifyTsVal': {'S': timestamp_now}
                    }
                )
                print(f"Updated job {job_id_parsed} status to CLASSIFYING")
            except Exception as ddb_e:
                print(f"Error updating DynamoDB status for job {job_id_parsed}: {str(ddb_e)}")

        # --- Step 2: Download PDF from S3 ---
        try:
            # Use the decoded key for S3 download
            s3.download_file(bucket, key, download_path)
            print(f"Successfully downloaded to {download_path}")
        except Exception as e:
            print(f"Error downloading from S3: {e}")
            # Try to list objects in the bucket to help debug
            try:
                print("Listing objects in bucket to help debug:")
                response = s3.list_objects_v2(Bucket=bucket, Prefix="input/")
                if 'Contents' in response:
                    for obj in response['Contents']:
                        print(f"  - {obj['Key']}")
                else:
                    print("  No objects found with prefix 'input/'")
            except Exception as list_e:
                print(f"Error listing objects: {list_e}")
            return { 'classification': 'ERROR_S3_DOWNLOAD' }

        # --- Step 3: Convert first page to image ---
        base64_image_data = None
        try:
            images = convert_from_path(download_path, first_page=1, last_page=1)
            if images:
                first_page_image = images[0]
                buffer = io.BytesIO()
                first_page_image.save(buffer, format="PNG")
                image_bytes = buffer.getvalue()
                base64_image_data = base64.b64encode(image_bytes).decode('utf-8')
                print("Successfully converted first page to base64 PNG.")
            else:
                print(f"Warning: pdf2image returned no images for {download_path}")
        except Exception as e:
            print(f"Error converting PDF page to image: {e}")

        if not base64_image_data:
            print("Could not generate base64 image data from PDF.")
            classification_result = { 'classification': 'ERROR_NO_IMAGE' }
            
        # --- Step 4: Call Bedrock for classification and parse response ---
        if base64_image_data:
            try:
                # Use Claude 3 Sonnet v2 by default, but can be configured via environment variable
                model_id = os.environ.get('BEDROCK_MODEL_ID', 'us.anthropic.claude-3-7-sonnet-20250219-v1:0')
                
                # Define the prompt for document classification
                prompt_text = """Analyze the provided image, which is the first page of a document.
                Based *only* on this first page, classify the document type.
                The possible types are: ACORD_FORM, MEDICAL_REPORT, FINANCIAL_STATEMENT, COMMERCIAL_PROPERTY_APPLICATION, CRIME_REPORT, OTHER.
                
                Here are some characteristics of each document type:
                
                ACORD_FORM:
                - Contains the ACORD logo
                - Has structured form fields for insurance information
                - Often includes policy numbers, insured details, and coverage information
                
                COMMERCIAL_PROPERTY_APPLICATION:
                - An application for commercial property insurance
                - Includes information on the properties/locations, agency information, coverages requested, and other relevant information
                - Might have a header or footer with Commercial Property Application Form or something similar
                
                CRIME_REPORT:
                - A report of a crime that has been committed in the area of the property(s) being insured
                - Mentions property crime statistics for the given zip code
                - Often has a header or footer with Crime Report or something similar

                FINANCIAL_STATEMENT:
                - Contains financial data like income, expenses, assets, or liabilities
                - May include tables with monetary values
                - Often has terms like "Balance Sheet", "Income Statement", or "Cash Flow"
                
                MEDICAL_REPORT:
                - Often contains patient information, medical history, diagnosis, or treatment plans.
                - May include letterheads from hospitals, clinics, or doctor's offices.
                - Look for terms like "Patient Name", "Date of Birth", "Diagnosis", "Symptoms", "Medication".

                OTHER:
                - Any document that doesn't clearly fit the above categories
                
                Respond ONLY with a JSON object containing a single key 'document_type' with the classification value.
                Example: {"document_type": "ACORD_FORM"}
                """
                
                # Construct the Bedrock request body for Claude 3
                request_body = {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 100,
                    "temperature": 0.0,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": "image/png",
                                        "data": base64_image_data
                                    }
                                },
                                {
                                    "type": "text",
                                    "text": prompt_text
                                }
                            ]
                        }
                    ]
                }
                
                print(f"Invoking Bedrock model {model_id}...")
                response = bedrock_runtime.invoke_model(
                    modelId=model_id,
                    body=json.dumps(request_body),
                    contentType='application/json',
                    accept='application/json'
                )
                print("Bedrock invoke_model call successful.")
                
                # Parse the response
                response_body = json.loads(response.get('body').read())
                assistant_response = response_body['content'][0]['text']
                print(f"Bedrock raw response text: {assistant_response}")
                
                try:
                    classification_data = json.loads(assistant_response)
                    print(f"Classification data: {classification_data}")
                    document_type = classification_data.get('document_type', 'OTHER')
                    classification_result = document_type # Store the string directly
                    print(f"Successfully parsed document type: {document_type}")
                except Exception as parse_e:
                    print(f"Error parsing Bedrock JSON response: {parse_e}")
                    classification_result = 'ERROR_PARSING' # Store the string directly
            
            except Exception as bedrock_e:
                print(f"Error during Bedrock interaction: {bedrock_e}")
                classification_result = 'ERROR_BEDROCK_API' # Store the string directly
        elif classification_result != { 'classification': 'ERROR_NO_IMAGE' }: # Only update if not already ERROR_NO_IMAGE
            print("Setting classification to ERROR_NO_IMAGE as image data is missing and not previously set.")
            classification_result = 'ERROR_NO_IMAGE' # Store the string directly
    
    except Exception as e:
        # Catch any other unhandled exceptions during the main try block
        print(f"Unhandled exception in lambda_handler: {e}")
        classification_result = 'ERROR_UNHANDLED' # Store the string directly
    
    finally:
        # Cleanup temporary files
        if download_path and os.path.exists(download_path):
            try:
                os.remove(download_path)
                print(f"Cleaned up temporary file: {download_path}")
            except Exception as cleanup_e:
                print(f"Error during file cleanup: {cleanup_e}")

    # Ensure the final return is a dictionary as expected by Step Functions
    if isinstance(classification_result, str):
        final_output = { 'classification': classification_result, 'jobId': job_id_parsed }
    elif isinstance(classification_result, dict) and 'classification' in classification_result:
        final_output = classification_result
        final_output['jobId'] = job_id_parsed
    else: # Fallback for unexpected types
        final_output = { 'classification': 'ERROR_FINAL_OUTPUT_FORMAT' }

    # Return the final classification result
    print("Returning final classification result:", json.dumps(final_output))
    return final_output
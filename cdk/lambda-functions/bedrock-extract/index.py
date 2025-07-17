import json
import boto3
import os
import base64
import io
import urllib.parse
from pdf2image import convert_from_path
from datetime import datetime, timezone
import re

# Initialize AWS clients outside the handler for reuse
s3 = boto3.client('s3')
bedrock_runtime = boto3.client(service_name='bedrock-runtime')
dynamodb_client = boto3.client('dynamodb')
jobs_table_name = os.environ.get('JOBS_TABLE_NAME')

# Define schemas for different document types
DOCUMENT_SCHEMAS = {
    "COMMERCIAL_PROPERTY_APPLICATION": {
        "agency_information": {
            "agency_name": "string",
            "division": "string",
            "agent_name": "string",
            "agent_phone": "string",
            "agent_email": "string"
        },
        "submission_details": {
            "submitted_to": "string",
            "policy_number_or_status": "string",
            "underwriter_name": "string",
            "transaction_type": "string",
            "submission_date": "string"
        },
        "applicant_information": {
            "applicant_name": "string",
            "applicant_street": "string",
            "applicant_city": "string",
            "applicant_state": "string",
            "applicant_zip_code": "string",
            "applicant_phone": "string",
            "applicant_website": "string",
            "business_type": "string",
            "primary_naic_code": "string",
            "approximate_total_annual_revenues": "string",
            "applicant_contact_name": "string",
            "applicant_contact_title": "string",
            "applicant_contact_phone": "string",
            "applicant_contact_email": "string"
        },
        "coverages_requested_global": {
            "commercial_property": "string",
            "water_damage": "string",
            "flood": "string",
            "business_interruption": "string",
            "crime": "string",
            "boiler_and_machinery": "string"
        },
        "locations": [
            {
                "location_identifier": "string",
                "location_address": {
                    "street": "string",
                    "city": "string",
                    "state": "string",
                    "zip_code": "string"
                },
                "location_phone": "string",
                "building_owner_name": "string",
                "occupancy_details": {
                    "approx_number_of_employees": "string",
                    "total_sq_ft": "string",
                    "applicant_occupied_area_sq_ft": "string",
                    "non_applicant_occupied_area_sq_ft": "string",
                    "public_area_sq_ft": "string"
                },
                "operations_description": "string",
                "location_property_coverages": {
                    "building_coverage_amount": "string",
                    "personal_property_coverage_amount": "string",
                    "coinsurance_percentage": "string",
                    "valuation_type": "string",
                    "coverage_form_type": "string",
                    "deductible_amount": "string",
                    "inflation_guard_percentage": "string"
                },
                "property_and_building_description": {
                    "iso_class": "string",
                    "construction_type": "string",
                    "year_built": "string",
                    "number_of_stories_above_ground": "string",
                    "basement_exists": "string",
                    "distance_to_nearest_fire_hydrant_ft": "string",
                    "distance_to_nearest_fire_station_miles": "string",
                    "protection_class": "string",
                    "primary_occupancy_type": "string",
                    "other_occupant_types": "string",
                    "roof_type": "string",
                    "primary_heat_type": "string",
                    "age_of_wiring_years": "string"
                },
                "exposures": {
                    "left_exposure": {"description": "string", "distance_ft": "string"},
                    "right_exposure": {"description": "string", "distance_ft": "string"},
                    "rear_exposure": {"description": "string", "distance_ft": "string"},
                    "front_exposure": {"description": "string", "distance_ft": "string"}
                },
                "alarms_and_protection": {
                    "sprinkler_system": {
                        "exists": "string",
                        "percentage_coverage": "string"
                    }
                }
            }
        ],
        "additional_notes": "string"
    },
    "FINANCIAL_STATEMENT": {
        "document_information": {
            "document_title": "string",
            "company_name": "string",
            "statement_date": "date", 
            "currency": "string"
        },
        "balance_sheet": {
            "assets": {
                "current_assets": {
                    "cash_and_equivalents": "number",
                    "accounts_receivable": "number",
                    "inventory": "number",
                    "other_current_assets": "number",
                    "total_current_assets": "number"
                },
                "non_current_assets": {
                    "property_plant_equipment_net": "number",
                    "goodwill": "number",
                    "intangible_assets": "number",
                    "other_non_current_assets": "number",
                    "total_non_current_assets": "number"
                },
                "total_assets": "number"
            },
            "liabilities": {
                "current_liabilities": {
                    "accounts_payable": "number",
                    "short_term_debt": "number",
                    "other_current_liabilities": "number",
                    "total_current_liabilities": "number"
                },
                "non_current_liabilities": {
                    "long_term_debt": "number",
                    "deferred_tax_liabilities": "number",
                    "other_non_current_liabilities": "number",
                    "total_non_current_liabilities": "number"
                },
                "total_liabilities": "number"
            },
            "equity": {
                "common_stock": "number",
                "retained_earnings": "number",
                "other_equity": "number",
                "total_equity": "number"
            },
            "total_liabilities_and_equity": "number"
        },
        "income_statement": {
            "revenue": "number",
            "cost_of_goods_sold": "number",
            "gross_profit": "number",
            "operating_expenses": {
                "research_and_development": "number",
                "selling_general_administrative": "number",
                "total_operating_expenses": "number"
            },
            "operating_income": "number",
            "interest_expense": "number",
            "income_before_tax": "number",
            "income_tax_expense": "number",
            "net_income": "number"
        },
        "cash_flow_statement": {
            "cash_flow_from_operating_activities": "number",
            "cash_flow_from_investing_activities": "number",
            "cash_flow_from_financing_activities": "number",
            "net_increase_in_cash": "number"
        },
        "notes": "string"
    },
    "MEDICAL_REPORT": {
        "patient_information": {
            "patient_name": "string",
            "date_of_birth": "date",
            "patient_id": "string",
            "gender": "string",
            "address": "string",
            "phone_number": "string"
        },
        "report_information": {
            "report_date": "date",
            "report_id": "string",
            "author_doctor_name": "string",
            "clinic_hospital_name": "string"
        },
        "medical_history": {
            "allergies": "string",
            "past_illnesses": "string",
            "surgeries": "string",
            "family_history": "string",
            "medications": "string"
        },
        "examination_findings": {
            "chief_complaint": "string",
            "physical_examination": "string",
            "vital_signs": {
                "blood_pressure": "string",
                "heart_rate": "string",
                "respiratory_rate": "string",
                "temperature": "string"
            }
        },
        "diagnosis": {
            "primary_diagnosis": "string",
            "secondary_diagnoses": "string",
            "icd_codes": "string"
        },
        "treatment_plan": {
            "recommendations": "string",
            "follow_up_instructions": "string"
        },
        "notes_summary": "string"
    }
}

def lambda_handler(event, context):
    print("Received event:", json.dumps(event))
    
    # Initialize variables
    bucket = None
    key = None 
    encoded_key = None 
    download_path = None
    document_type = None
    all_extracted_data = {}
    extraction_result = {"status": "ERROR", "message": "Processing not completed", "data": {}}
    job_id = None
    
    try:
        # --- Step 1: Extract input parameters from the event ---
        try:
            bucket = event['detail']['bucket']['name']
            encoded_key = event['detail']['object']['key'] 
            key = urllib.parse.unquote_plus(encoded_key)
            job_id = event.get('classification').get('jobId')

            classification_output = event.get('classification')
            if isinstance(classification_output, dict):
                document_type = classification_output.get('classification', 'OTHER')
            elif isinstance(classification_output, str):
                document_type = classification_output
            else:
                document_type = 'OTHER'
                
            if not bucket or not key:
                raise ValueError("Missing S3 bucket or key in input event")

            print(f"Original encoded key: {encoded_key}")
            print(f"Decoded key for S3: {key}")
            print(f"Processing s3://{bucket}/{key} with document type: {document_type}")
            
            safe_filename = os.path.basename(key) 
            download_path = f'/tmp/{safe_filename}'
            print(f"Download path set to: {download_path}")


            # --- Update DynamoDB status to EXTRACTING ---
            if job_id and jobs_table_name:
                try:
                    timestamp_now = datetime.now(timezone.utc).isoformat()
                    dynamodb_client.update_item(
                        TableName=jobs_table_name,
                        Key={'jobId': {'S': job_id}},
                        UpdateExpression="SET #status_attr = :status_val, #extractStartTs = :extractStartTsVal",
                        ExpressionAttributeNames={
                            '#status_attr': 'status',
                            '#extractStartTs': 'extractionStartTimestamp'
                        },
                        ExpressionAttributeValues={
                            ':status_val': {'S': 'EXTRACTING'},
                            ':extractStartTsVal': {'S': timestamp_now}
                        }
                    )
                    print(f"Updated job {job_id} status to EXTRACTING")
                except Exception as ddb_e:
                    print(f"Error updating DynamoDB status for job {job_id}: {str(ddb_e)}")

        except (KeyError, ValueError, TypeError) as e:
            print(f"Error extracting input parameters: {e}")
            extraction_result["message"] = f"Error extracting input parameters: {str(e)}"
            return extraction_result
        print(f"Successfully extracted input parameters. Bucket: {bucket}, Key: {key}, DocType: {document_type}")

        # --- Step 2: Download PDF from S3 ---
        try:
            s3.download_file(bucket, key, download_path)
            print(f"Successfully downloaded to {download_path}")
        except Exception as e:
            print(f"Error downloading from S3: {e}")
            extraction_result["message"] = f"Error downloading from S3: {str(e)}"
            return extraction_result
        print(f"Successfully downloaded PDF from S3 to {download_path}")

        # --- Step 3: Convert PDF pages to images ---
        try:
            max_pages = 10
            print(f"Attempting to convert PDF to images. Max pages: {max_pages}")
            images = convert_from_path(download_path, dpi=200, fmt='JPEG', first_page=1, last_page=max_pages)
            print(f"Successfully converted {len(images)} pages to images.")
            
            if not images:
                raise ValueError("No images were extracted from the PDF")
                
        except Exception as e:
            print(f"Error converting PDF to images: {e}")
            extraction_result["message"] = f"Error converting PDF to images: {str(e)}"
            return extraction_result

        # --- Step 4: Get the appropriate schema and prepare images ---
        if document_type in DOCUMENT_SCHEMAS:
            schema = DOCUMENT_SCHEMAS[document_type]
        else:
            print(f"Error: Document type '{document_type}' is not supported. Currently supported types: {list(DOCUMENT_SCHEMAS.keys())}")
            extraction_result["message"] = f"Unsupported document type: {document_type}. Supported: {list(DOCUMENT_SCHEMAS.keys())}"
            return extraction_result
        schema_json = json.dumps(schema, indent=2)
        
        # Process images with Claude
        all_extracted_data = {}
        
        # Prepare raw image bytes for Bedrock (instead of base64 strings)
        print(f"Starting image processing loop to convert to bytes.")
        image_byte_list = [] 
        for i, img in enumerate(images):
            print(f"Processing image {i+1} of {len(images)}...")
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG")
            raw_bytes = buffer.getvalue()
            image_byte_list.append(raw_bytes)
            print(f"Finished processing image {i+1}.")
        print(f"Finished image processing loop. {len(image_byte_list)} images converted to bytes.")

        # --- Step 5: Create prompt and call Bedrock ---
        print(f"Creating prompt for document type: {document_type} with schema... Schema JSON length: {len(schema_json)}")
        prompt_text = f"""You are an AI assistant helping with insurance underwriting document analysis.

I'm providing you with images from a {document_type} document. Please extract all relevant information according to the following schema:

{schema_json}

Guidelines:
1. Extract ONLY information that is visible in the provided images
2. If a field in the schema cannot be found in the document, use "N/A"
3. Format numbers and dates consistently
4. Return your response as a valid JSON object that matches the provided schema exactly
5. Do not include any explanations or notes outside the JSON structure

Return ONLY the JSON object with the extracted information.
"""

        # Prepare the content for the user message in Converse API
        converse_user_message_content = [{"text": prompt_text}]
        
        # Add images to the user message content
        for i, raw_image_data in enumerate(image_byte_list):
            converse_user_message_content.append({"text": f"Page {i+1}:"})
            converse_user_message_content.append({
                "image": {
                    "format": "jpeg",
                    "source": {
                        "bytes": raw_image_data
                    }
                }
            })
        
        # Call Bedrock with Claude 3 using the Converse API
        try:
            model_id = os.environ.get('BEDROCK_MODEL_ID', 'anthropic.claude-3-sonnet-20240229-v1:0')
            
            print(f"Preparing to call Bedrock Converse API with model {model_id}. Number of content items: {len(converse_user_message_content)}")
            response = bedrock_runtime.converse(
                modelId=model_id,
                messages=[{
                            "role": "user",
                    "content": converse_user_message_content
                }],
                inferenceConfig={
                    "maxTokens": 4096,
                    "temperature": 0.0
                }
            )

            print(f"Received raw response from Bedrock Converse API. Attempting to parse...")
            
        except Exception as e:
            print(f"Error calling Bedrock: {e}")
            extraction_result["message"] = f"Error calling Bedrock: {str(e)}"
            return extraction_result

        # --- Step 6: Parse response, update DynamoDB, and return results ---
        # Parse the response from Converse API
        output_message = response.get('output', {}).get('message', {})
        if not output_message:
            print(f"Bedrock Converse API response missing 'output' or message field. Response: {json.dumps(response)}")
            raise ValueError("Bedrock Converse API response missing 'output' or 'message' field.")

        assistant_response_content_list = output_message.get('content', [])
        if not assistant_response_content_list or \
           not isinstance(assistant_response_content_list[0], dict) or \
           'text' not in assistant_response_content_list[0]:
            print(f"Error: Could not extract text from Bedrock Converse response. Content list: {json.dumps(assistant_response_content_list)}. Full response: {json.dumps(response)}")
            raise ValueError("Bedrock Converse API response content is not in the expected format or is empty.")
            
        assistant_response = assistant_response_content_list[0]['text']
        print(f"Successfully extracted assistant response text from Converse API. Length: {len(assistant_response)}")
        
        # Extract JSON from the response
        try:
            print(f"Attempting to parse JSON from Bedrock response...")
            extracted_data = json.loads(assistant_response)
            
            # If that fails, try to find JSON within the text
            if not isinstance(extracted_data, dict):
                json_match = re.search(r'```json\s*([\s\S]*?)\s*```', assistant_response)
                if json_match:
                    extracted_data = json.loads(json_match.group(1))
                else:
                    # Last resort: find anything that looks like JSON
                    json_match = re.search(r'(\{[\s\S]*\})', assistant_response)
                    if json_match:
                        extracted_data = json.loads(json_match.group(1))
                    else:
                        raise ValueError("Could not find valid JSON in the response")
            
            # Validate that the extracted data matches our schema structure
            validate_extracted_data(extracted_data, schema)
            
            all_extracted_data = extracted_data
            print("Successfully extracted and validated data from Bedrock response.")
            
        except Exception as e:
            print(f"Error parsing JSON from Claude response: {e}")
            print(f"Raw response: {assistant_response}")
            extraction_result["message"] = f"Error parsing extraction results: {str(e)}"
            return extraction_result
            
        # --- DynamoDB Update Logic --- 
        if job_id and jobs_table_name and all_extracted_data:
            try:
                timestamp_now = datetime.now(timezone.utc).isoformat()
                
                update_expression_parts = [
                    "SET #docType = :docType", 
                    "#extDataJsonStr = :extDataJsonStrVal", 
                    "#extTimestamp = :extTimestampVal"
                ]
                expression_attribute_names = {
                    '#docType': 'documentType',
                    '#extDataJsonStr': 'extractedDataJsonStr', 
                    '#extTimestamp': 'extractionTimestamp'
                }
                expression_attribute_values = {
                    ':docType': {'S': document_type},
                    ':extDataJsonStrVal': {'S': json.dumps(all_extracted_data)},
                    ':extTimestampVal': {'S': timestamp_now}
                }

                inferred_insurance_type = None
                if document_type in ["COMMERCIAL_PROPERTY_APPLICATION", "FINANCIAL_STATEMENT"]:
                    inferred_insurance_type = "property_casualty"
                elif document_type in ["MEDICAL_REPORT"]:
                    inferred_insurance_type = "life"
                
                if inferred_insurance_type:
                    update_expression_parts.append("#insType = :insTypeVal")
                    expression_attribute_names['#insType'] = 'insuranceType'
                    expression_attribute_values[':insTypeVal'] = {'S': inferred_insurance_type}

                dynamodb_client.update_item(
                    TableName=jobs_table_name,
                    Key={'jobId': {'S': job_id}},
                    UpdateExpression=', '.join(update_expression_parts),
                    ExpressionAttributeNames=expression_attribute_names,
                    ExpressionAttributeValues=expression_attribute_values
                )
                print(f"Successfully updated job {job_id} in DynamoDB with extraction results.")
            except Exception as ddb_e:
                print(f"Error updating DynamoDB for job {job_id}: {str(ddb_e)}. Proceeding without DDB update.")
        else:
            print("Skipping DynamoDB update: jobId not parsed, table name missing, or no extracted data.")

        # Return the extracted data
        extraction_result = {
            "status": "SUCCESS",
            "message": f"Successfully extracted data from {document_type}",
            "document_type": document_type,
            "data": all_extracted_data
        }

    finally:
        # Clean up temporary files
        if download_path and os.path.exists(download_path):
            try:
                os.remove(download_path)
                print(f"Cleaned up temporary file: {download_path}")
            except Exception as e:
                print(f"Error during cleanup: {e}")

    print(f"Final extraction result: {json.dumps(extraction_result)}")
    return extraction_result

def validate_extracted_data(data, schema):
    """
    Basic validation to ensure the extracted data matches the schema structure.
    This is a simplified validation that just checks for required top-level keys.
    """
    for key in schema:
        if key not in data:
            data[key] = {}  # Add missing sections with empty values
            print(f"Warning: Missing section '{key}' in extracted data")
    
    return True
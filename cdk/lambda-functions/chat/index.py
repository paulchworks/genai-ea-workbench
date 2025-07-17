import json
import boto3
import os
import math
from datetime import datetime, timezone

# Initialize AWS clients
dynamodb = boto3.client('dynamodb')
bedrock_runtime = boto3.client(service_name='bedrock-runtime')

# Environment variables
JOBS_TABLE_NAME = os.environ.get('JOBS_TABLE_NAME')
BEDROCK_CHAT_MODEL_ID = os.environ.get('BEDROCK_CHAT_MODEL_ID', 'us.anthropic.claude-3-7-sonnet-20250219-v1:0')

def lambda_handler(event, context):
    print(f"Received event: {json.dumps(event)}")
    
    # Extract HTTP method and path from the event
    http_method = event.get('httpMethod', '')
    resource = event.get('resource', '')
    path_parameters = event.get('pathParameters', {}) or {}
    
    # Set CORS headers for all responses
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Content-Type': 'application/json'
    }
    
    # Handle OPTIONS requests for CORS preflight
    if http_method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({'message': 'CORS preflight request successful'})
        }
    
    try:
        # Chat endpoint - "/chat/{jobId}"
        if http_method == 'POST' and resource == '/chat/{jobId}':
            job_id = path_parameters.get('jobId')
            if not job_id:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Missing jobId parameter'})
                }
            
            # Parse request body for chat message
            body = json.loads(event.get('body', '{}'))
            message = body.get('message')
            
            if not message:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Missing message in request body'})
                }
            
            # Process the chat request
            response = process_chat(job_id, message)
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps(response)
            }
            
        else:
            return {
                'statusCode': 404,
                'headers': headers,
                'body': json.dumps({'error': 'Not found'})
            }
            
    except Exception as e:
        print(f"Error processing request: {str(e)}")
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({'error': f'Internal server error: {str(e)}'})
        }

def process_chat(job_id, message):
    """
    Process a chat message for a specific job.
    Retrieves job data from DynamoDB and uses it to provide context for the LLM.
    """
    try:
        # Retrieve the job data from DynamoDB
        response = dynamodb.get_item(
            TableName=JOBS_TABLE_NAME,
            Key={'jobId': {'S': job_id}}
        )
        
        if 'Item' not in response:
            return {'error': f'Job {job_id} not found'}
        
        item = response['Item']
        
        # Extract job details for context
        document_type = item.get('documentType', {}).get('S', 'Unknown')
        insurance_type = item.get('insuranceType', {}).get('S', 'Unknown')
        
        # Extract structured data if available
        extracted_data_json = item.get('extractedDataJsonStr', {}).get('S', '{}')
        analysis_output_json = item.get('analysisOutputJsonStr', {}).get('S', '{}')
        
        try:
            extracted_data = json.loads(extracted_data_json)
            analysis_output = json.loads(analysis_output_json)
        except json.JSONDecodeError:
            extracted_data = {}
            analysis_output = {}
        
        # Define tools for the AI assistant
        tools = [
            {
                "name": "calculate_bmi",
                "description": "Calculate BMI (Body Mass Index) given height and weight",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "height_cm": {
                            "type": "number",
                            "description": "Height in centimeters"
                        },
                        "weight_kg": {
                            "type": "number",
                            "description": "Weight in kilograms"
                        }
                    },
                    "required": ["height_cm", "weight_kg"]
                }
            }
        ]
        
        # Create the system prompt with context
        system_prompt = f"""You are an AI assistant for insurance underwriting.
        
        You are currently helping with a document of type: {document_type}
        Insurance type: {insurance_type}
        
        The following data was extracted from the document:
        ```
        {json.dumps(extracted_data, indent=2)}
        ```
        
        The following analysis was performed:
        ```
        {json.dumps(analysis_output, indent=2)}
        ```
        
        Please answer any questions about this document or analysis. Be professional, accurate, and helpful.
        If asked to perform calculations related to medical underwriting (like BMI), please use the calculate_bmi tool.
        """
        
        # Prepare the conversation for Claude
        messages = [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": message
            }
        ]
        
        # Call Claude via Bedrock
        response = bedrock_runtime.converse(
            modelId=BEDROCK_CHAT_MODEL_ID,
            messages=messages,
            tools=tools,
            toolConfig={
                "toolChoice": "auto"
            },
            inferenceConfig={
                "maxTokens": 2048,
                "temperature": 0.1
            }
        )
        
        # Process the response
        output_message = response.get('output', {}).get('message', {})
        assistant_response = ""
        tool_calls = []
        
        # Handle text content
        for content_item in output_message.get('content', []):
            if content_item.get('type') == 'text':
                assistant_response += content_item.get('text', '')
        
        # Handle tool calls
        for tool_call in output_message.get('toolCalls', []):
            if tool_call.get('name') == 'calculate_bmi':
                try:
                    params = json.loads(tool_call.get('parameters', '{}'))
                    height_cm = params.get('height_cm', 0)
                    weight_kg = params.get('weight_kg', 0)
                    bmi = weight_kg / ((height_cm/100) ** 2)
                    bmi_rounded = round(bmi, 1)
                    
                    # Interpret BMI
                    bmi_interpretation = "Unknown"
                    if bmi < 18.5:
                        bmi_interpretation = "Underweight"
                    elif bmi >= 18.5 and bmi < 25:
                        bmi_interpretation = "Normal weight"
                    elif bmi >= 25 and bmi < 30:
                        bmi_interpretation = "Overweight"
                    elif bmi >= 30:
                        bmi_interpretation = "Obese"
                    
                    tool_result = {
                        'name': 'calculate_bmi',
                        'input': {
                            'height_cm': height_cm,
                            'weight_kg': weight_kg
                        },
                        'output': {
                            'bmi': bmi_rounded,
                            'interpretation': bmi_interpretation
                        }
                    }
                    
                    tool_calls.append(tool_result)
                    
                    # Add BMI result to the assistant's response
                    bmi_response = f"\n\nBMI Calculation: {bmi_rounded} ({bmi_interpretation})"
                    assistant_response += bmi_response
                except Exception as e:
                    print(f"Error processing BMI calculation: {str(e)}")
                    tool_calls.append({
                        'name': 'calculate_bmi',
                        'error': str(e)
                    })
        
        # Log the interaction in DynamoDB
        try:
            timestamp_now = datetime.now(timezone.utc).isoformat()
            chat_interaction = {
                'timestamp': timestamp_now,
                'user_message': message,
                'assistant_response': assistant_response
            }
            
            # Update the job with the chat interaction
            # Note: This is a simple append; in production you'd need a more 
            # sophisticated approach to handle chat history
            dynamodb.update_item(
                TableName=JOBS_TABLE_NAME,
                Key={'jobId': {'S': job_id}},
                UpdateExpression="SET #chat = list_append(if_not_exists(#chat, :empty_list), :interaction)",
                ExpressionAttributeNames={
                    '#chat': 'chatHistory'
                },
                ExpressionAttributeValues={
                    ':empty_list': {'L': []},
                    ':interaction': {'L': [{'M': {
                        'timestamp': {'S': timestamp_now},
                        'user_message': {'S': message},
                        'assistant_response': {'S': assistant_response}
                    }}]}
                }
            )
        except Exception as e:
            print(f"Error logging chat interaction: {str(e)}")
        
        return {
            'jobId': job_id,
            'message': message,
            'response': assistant_response,
            'toolCalls': tool_calls
        }
    
    except Exception as e:
        print(f"Error in chat process for job {job_id}: {str(e)}")
        raise
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import os
import tempfile
import json
import uuid
from werkzeug.utils import secure_filename
from extract import analyze_document, underwriter_analysis, GOOD_MODEL_ID, BEDROCK_CLIENT
import boto3
from botocore.exceptions import ClientError
from datetime import datetime, timedelta
from tools import calculate_bmi, handle_knowledge_base_query, TOOL_DEFINITIONS
from functools import wraps
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
if not logger.handlers:
    # Create console handler and set level to debug
    ch = logging.StreamHandler()
    ch.setLevel(logging.DEBUG)
    
    # Create formatter
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    
    # Add formatter to ch
    ch.setFormatter(formatter)
    
    # Add ch to logger
    logger.addHandler(ch)

# Initialize AWS clients
dynamodb = boto3.client('dynamodb', region_name='us-east-1')
s3 = boto3.client('s3', region_name='us-east-1')
ANALYSIS_TABLE_NAME = os.environ.get('ANALYSIS_TABLE_NAME', 'insurance_analysis')
UPLOAD_BUCKET_NAME = os.environ.get('UPLOAD_BUCKET_NAME', 'rga-underwriting-genai-demo')
AUTH_PASSWORD = os.environ.get('AUTH_PASSWORD', 'demo123')
logger.info(f"ANALYSIS_TABLE_NAME: {ANALYSIS_TABLE_NAME}")
logger.info(f"UPLOAD_BUCKET_NAME: {UPLOAD_BUCKET_NAME}")
logger.info(f"AUTH_PASSWORD: {AUTH_PASSWORD}")

# Add authentication configuration
AUTH_PASSWORD = os.environ.get('AUTH_PASSWORD', 'demo123')  # Default password for development

# def require_auth(f):
#     @wraps(f)
#     def decorated(*args, **kwargs):
#         auth_header = request.headers.get('Authorization')
#         logger.debug(f"auth_header: {auth_header}")
#         if not auth_header or auth_header != f'Bearer {AUTH_PASSWORD}':
#             return jsonify({'error': 'Unauthorized'}), 401
#         return f(*args, **kwargs)
#     return decorated

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

def get_token_from_request():
    """Get token from either Authorization header or query parameter"""
    # Try Authorization header first
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        return auth_header.split(' ')[1]
    
    # Try query parameter
    return request.args.get('token')

# Apply authentication to all routes
@app.before_request
def authenticate():
    #skip authentication for health check
    logger.debug(f"request.endpoint: {request.endpoint}")
    if request.endpoint == 'health':
        logger.info("health check, skipping authentication")
        return None
    # Skip authentication for preflight requests
    if request.method == 'OPTIONS':
        logger.info("preflight request, skipping authentication")
        return None
        
    # Skip authentication for the login endpoint
    if request.endpoint == 'login':
        logger.info("login endpoint, skipping authentication")
        return None
        
    token = get_token_from_request()
    if not token or token != AUTH_PASSWORD:
        logger.error(f"Unauthorized request: {token}")
        return jsonify({'error': 'Unauthorized'}), 401

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200

# Add login endpoint
@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    logger.info(f"received password: {data['password']}")
    if not data or 'password' not in data:
        return jsonify({'error': 'Password is required'}), 400
        
    if data['password'] == AUTH_PASSWORD:
        
        return jsonify({
            'token': AUTH_PASSWORD,
            'message': 'Login successful'
        })
    else:
        return jsonify({'error': 'Invalid password'}), 401

# Configure upload settings
ALLOWED_EXTENSIONS = {'pdf'}
UPLOAD_FOLDER = tempfile.gettempdir()  # Use system temp directory
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# Store ongoing analyses
analyses = {}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/analyze-stream', methods=['POST'])
def start_analysis():
    logger.info("start_analysis()")
    if 'file' not in request.files:
        logger.error("No file provided")
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        logger.error("No file selected")
        return jsonify({'error': 'No file selected'}), 400
    
    if not allowed_file(file.filename):
        logger.error("Invalid file type")
        return jsonify({'error': 'Invalid file type. Only PDF files are allowed'}), 400

    try:
        logger.info("Valid file provided")
        # Generate unique ID for this analysis
        analysis_id = str(uuid.uuid4())
        
        # Save uploaded file to temp directory
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)

        # Upload to S3
        logger.info("Uploading to S3")
        s3.upload_file(
            filepath,
            UPLOAD_BUCKET_NAME,
            f"{analysis_id}.pdf"
        )
        
        # Store file path and parameters
        logger.info("Storing file path and parameters")
        analyses[analysis_id] = {
            'filepath': filepath,
            'batch_size': request.form.get('batch_size', default=3, type=int),
            'page_limit': request.form.get('page_limit', default=None, type=int),
            'status': 'pending'
        }
        logger.info(f"analyses: {analyses}")


        return jsonify({'analysisId': analysis_id})

    except Exception as e:
        return jsonify({
            'error': 'File processing failed',
            'details': str(e)
        }), 500

@app.route('/analyze-progress/<analysis_id>', methods=['GET'])
def stream_progress(analysis_id):
    logger.info(f"stream_progress() analysis_id: {analysis_id}")
    if analysis_id not in analyses:
        return jsonify({'error': 'Analysis not found'}), 404

    analysis = analyses[analysis_id]
    
    def generate():
        logger.info(f"generate() analysis: {analysis}")
        try:
            page_analysis = {}  # Store accumulated page results
            final_underwriter_analysis = None
            
            # Define a progress_callback that itself yields strings
            # to our streaming response:
            def progress_callback(message, batch_results=None):
                logger.info(f"progress_callback() message: {message}")
                logger.info(f"progress_callback() batch_results: {batch_results}")
                nonlocal page_analysis
                if batch_results:
                    # If we have results, accumulate them
                    page_analysis.update(batch_results)
                    yield f"data: {json.dumps({'type': 'batch_complete', 'message': message, 'pages': batch_results})}\n\n"
                else:
                    # Just a progress update
                    yield f"data: {json.dumps({'type': 'progress', 'message': message})}\n\n"
            
            # -----------------
            # Phase 1: Analyze PDF
            # -----------------
            for progress_event in analyze_document(
                analysis['filepath'],
                analysis['batch_size'],
                analysis['page_limit'],
                progress_callback
            ):
                yield progress_event

            # Signal phase 1 complete
            yield f"data: {json.dumps({'type': 'phase1_complete'})}\n\n"
            
            # -----------------
            # Phase 2: Underwriter Analysis
            # -----------------
            for progress_event in underwriter_analysis(page_analysis, 100, progress_callback):
                if isinstance(progress_event, str) and progress_event.startswith('data: '):
                    data = json.loads(progress_event.replace('data: ', ''))
                    if data['type'] == 'complete':
                        final_underwriter_analysis = data['data']
                yield progress_event
            
            # Store results in DynamoDB
            if final_underwriter_analysis:
                try:
                    dynamodb.put_item(
                        TableName=ANALYSIS_TABLE_NAME,
                        Item={
                            'job_id': {'S': analysis_id},
                            'timestamp': {'S': datetime.now().isoformat()},
                            'filename': {'S': os.path.basename(analysis['filepath'])},
                            'page_analysis': {'S': json.dumps(page_analysis)},
                            'underwriter_analysis': {'S': json.dumps(final_underwriter_analysis)},
                            'status': {'S': 'completed'}
                        }
                    )
                    logger.info(f"Stored analysis results for job {analysis_id} in DynamoDB")
                except Exception as e:
                    logger.error(f"Error storing results in DynamoDB: {str(e)}")
                    # Don't fail the response if storage fails
                    yield f"data: {json.dumps({'type': 'warning', 'message': 'Analysis completed but failed to persist results'})}\n\n"
            
        except Exception as e:
            logger.error(f"Error in stream_progress: {str(e)}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        
        finally:
            # Clean up
            try:
                os.remove(analysis['filepath'])
            except:
                pass
            analyses.pop(analysis_id, None)

    return Response(generate(), mimetype='text/event-stream')

# Keep the existing /analyze endpoint as fallback

@app.route('/analysis/<job_id>', methods=['GET'])
def get_analysis(job_id):
    logger.info(f"get_analysis() job_id: {job_id}")
    logger.info(f"get_analysis() ANALYSIS_TABLE_NAME: {ANALYSIS_TABLE_NAME}")
    """Retrieve analysis results and generate presigned URL for PDF."""
    try:
        # Get analysis from DynamoDB
        response = dynamodb.get_item(
            TableName=ANALYSIS_TABLE_NAME,
            Key={'job_id': {'S': job_id}}
        )
        
        if 'Item' not in response:
            return jsonify({'error': 'Analysis not found'}), 404
            
        item = response['Item']
        
        # Generate presigned URL for PDF
        try:
            presigned_url = s3.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': UPLOAD_BUCKET_NAME,
                    'Key': f"{job_id}.pdf"
                },
                ExpiresIn=3600  # URL valid for 1 hour
            )
        except ClientError as e:
            logger.error(f"Error generating presigned URL: {str(e)}")
            presigned_url = None
            
        return jsonify({
            'job_id': item['job_id']['S'],
            'timestamp': item['timestamp']['S'],
            'filename': item['filename']['S'],
            'page_analysis': json.loads(item['page_analysis']['S']),
            'underwriter_analysis': json.loads(item['underwriter_analysis']['S']),
            'status': item['status']['S'],
            'pdf_url': presigned_url
        })
        
    except Exception as e:
        logger.error(f"Error retrieving analysis: {str(e)}")
        return jsonify({'error': 'Failed to retrieve analysis'}), 500

@app.route('/pdf/<job_id>', methods=['GET'])
def get_pdf(job_id):
    logger.info(f"get_pdf() job_id: {job_id}")
    """Proxy PDF requests through backend to avoid CORS issues."""
    try:
        # Get the PDF from S3
        response = s3.get_object(
            Bucket=UPLOAD_BUCKET_NAME,
            Key=f"{job_id}.pdf"
        )
        
        # Stream the PDF content
        return Response(
            response['Body'].read(),
            mimetype='application/pdf',
            headers={
                'Content-Disposition': f'inline; filename={job_id}.pdf'
            }
        )
        
    except ClientError as e:
        logger.error(f"Error retrieving PDF: {str(e)}")
        return jsonify({'error': 'Failed to retrieve PDF'}), 404

@app.route('/chat/<job_id>', methods=['POST'])
def chat(job_id):
    logger.info(f"chat() job_id: {job_id}")
    try:
        # Get the message from request
        data = request.get_json()
        if not data or 'messages' not in data:
            return jsonify({'error': 'No messages provided'}), 400

        # Get the analysis data first
        response = dynamodb.get_item(
            TableName=ANALYSIS_TABLE_NAME,
            Key={'job_id': {'S': job_id}}
        )
        
        if 'Item' not in response:
            return jsonify({'error': 'Analysis not found'}), 404
            
        item = response['Item']
        page_analysis = json.loads(item['page_analysis']['S'])
        underwriter_analysis = json.loads(item['underwriter_analysis']['S'])

        # Construct the system message
        system_message = f"""You are an AI assistant helping answer questions about an insurance document that has been analyzed.
        You have access to both a page-by-page analysis and an underwriter's analysis of the document.

        The page analysis shows the content and key information from each page:
        {json.dumps(page_analysis, indent=2)}

        The underwriter's analysis provides key insights:
        {json.dumps(underwriter_analysis, indent=2)}

        Guidelines:
        1. Use the provided analyses to answer questions accurately
        2. When referencing specific pages, use markdown links in this exact format: [pg XX](/page/XX)
           For example: [pg 7](/page/7) or [pg 12](/page/12)
        3. If you're unsure about something, say so rather than making assumptions
        4. Keep responses clear and concise
        5. Format your responses using markdown:
           - Use headers (# ## ###) for sections
           - Use bold (**) for emphasis
           - Use lists (- or 1.) for enumerated items
           - Use blockquotes (>) for important callouts
           - Use code blocks (```) for structured data
           - Use tables for tabular data
        6. Ensure markdown is properly formatted and closed
        7. You have access to tools that can help with calculations and lookups.
           Use them when appropriate to provide accurate information.
        """

        # Convert frontend messages to Bedrock format
        bedrock_messages = []

        # Add conversation history
        for msg in data['messages']:
            bedrock_messages.append({
                "role": "user" if msg['sender'] == 'user' else "assistant",
                "content": [{"text": msg['text']}]
            })

        while True:
            # Call Bedrock with tool definitions
            kwargs = {
                "modelId": GOOD_MODEL_ID,
                "messages": bedrock_messages,
                "system": [{"text": system_message}],
                "inferenceConfig": {
                    "maxTokens": 2048,
                    "temperature": 0.0,
                    "topP": 0.9
                },
                "toolConfig": {
                    "tools": TOOL_DEFINITIONS["tools"],
                }
            }

            response = BEDROCK_CLIENT.converse(**kwargs)
            logger.info(json.dumps(response, indent=2))
            #
#   "ResponseMetadata": {
#     "RequestId": "f610dad8-bc3c-42b9-b71d-73a69f9ed3d0",
#     "HTTPStatusCode": 200,
#     "HTTPHeaders": {
#       "date": "Wed, 22 Jan 2025 18:23:04 GMT",
#       "content-type": "application/json",
#       "content-length": "324",
#       "connection": "keep-alive",
#       "x-amzn-requestid": "f610dad8-bc3c-42b9-b71d-73a69f9ed3d0"
#     },
#     "RetryAttempts": 0
#   },
#   "output": {
#     "message": {
#       "role": "assistant",
#       "content": [
#         {
#           "toolUse": {
#             "toolUseId": "tooluse_Ftde3QOSS02hFjtwS25xnQ",
#             "name": "calculate_juvenile_bmi",
#             "input": {
#               "height": 60,
#               "weight": 130,
#               "age": 10,
#               "sex": "male"
#             }
#           }
#         }
#       ]
#     }
#   },
#   "stopReason": "tool_use",
#   "usage": {
#     "inputTokens": 12913,
#     "outputTokens": 92,
#     "totalTokens": 13005
#   },
#   "metrics": {
#     "latencyMs": 3552
#   }
# }
            # Check if tool use is requested
            chat_response = ""
            if response["stopReason"] == 'tool_use':

            # Tool use requested. Call the tool and send the result to the model.
                tool_requests = response["output"]["message"]["content"]
                for tool_request in tool_requests:
                    if 'toolUse' in tool_request:
                        
                        tool = tool_request['toolUse']
                        logger.info(f"Requesting tool {tool['name']} Request: {tool['toolUseId']}")
                        # Execute the appropriate tool
                        if tool['name'] == "calculate_bmi":
                            logger.info("calling tool calculate_bmi")
                            bmi  = calculate_bmi(tool['input'])
                            logger.info(f"result from calculate_bmi {bmi}")
                            chat_response += bmi
                        elif tool['name'] == "combined_knowledge_base":
                            logger.info("calling tool combined_knowledge_base")
                            kb_response = handle_knowledge_base_query(tool['input'], bedrock_messages)
                            logger.info(f"result from combined_knowledge_base {kb_response}")
                            chat_response += kb_response
                        

   
           
            ai_response = response["output"]["message"]["content"][0]["text"]
            chat_response = ai_response + "\n\n" + chat_response

            return jsonify({
                'response': chat_response,
                'status': 'success'
            })

    except ClientError as e:
        logger.error(f"Bedrock error: {str(e)}")
        return jsonify({
            'error': 'Failed to generate response',
            'details': str(e)
        }), 500
    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        return jsonify({
            'error': 'Internal server error',
            'details': str(e)
        }), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0') 
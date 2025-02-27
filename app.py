from flask import request, jsonify
import os
import uuid
import threading
import json
from werkzeug.utils import secure_filename
from datetime import datetime

@app.route('/analyze-stream', methods=['POST'])
def start_analysis():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    # Get insurance type from request with default to 'life' for backward compatibility
    insurance_type = request.form.get('insuranceType', 'life')
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        analysis_id = str(uuid.uuid4())
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], f"{analysis_id}_{filename}")
        file.save(filepath)
        
        # Store file path and parameters
        analyses[analysis_id] = {
            'filepath': filepath,
            'batch_size': request.form.get('batch_size', default=3, type=int),
            'page_limit': request.form.get('page_limit', default=None, type=int),
            'insurance_type': insurance_type,
            'status': 'pending'
        }
        
        threading.Thread(target=process_document, args=(analysis_id, filename)).start()
        
        return jsonify({
            "analysis_id": analysis_id,
            "status": "processing",
            "filename": filename
        }), 202
    
    return jsonify({"error": "File type not allowed"}), 400

def process_document(analysis_id, filename):
    """Process document in background"""
    
    analysis_info = analyses[analysis_id]
    filepath = analysis_info['filepath']
    batch_size = analysis_info['batch_size']
    page_limit = analysis_info['page_limit']
    insurance_type = analysis_info.get('insurance_type', 'life')  # Default to 'life' for backward compatibility
    
    analyses[analysis_id]['status'] = 'processing'
    
    try:
        # Extract pages from PDF
        pages = extract_pages(filepath, page_limit=page_limit)
        total_pages = len(pages)
        
        # Set up progress tracking
        current_progress = 0
        
        def update_progress(message):
            nonlocal current_progress
            current_progress += 1
            progress_percentage = min(95, int((current_progress / (total_pages + 1)) * 100))
            analyses[analysis_id]['progress'] = {
                'percentage': progress_percentage,
                'message': message
            }
        
        # Analyze pages in batches
        page_analysis = {}
        for i in range(0, len(pages), batch_size):
            batch = list(range(i + 1, min(i + batch_size + 1, len(pages) + 1)))
            batch_results = analyze_page_batch(batch, analysis_id, batch_size, update_progress, insurance_type)
            page_analysis.update(batch_results)
        
        # Generate underwriter analysis based on page results
        update_progress("Generating underwriter analysis...")
        underwriter_analysis = analyze_underwriter(page_analysis, insurance_type=insurance_type)
        
        # Store results in DynamoDB for persistence
        item = {
            'job_id': {'S': analysis_id},
            'timestamp': {'N': str(int(datetime.now().timestamp()))},
            'filename': {'S': filename},
            'page_analysis': {'S': json.dumps(page_analysis)},
            'underwriter_analysis': {'S': json.dumps(underwriter_analysis)},
            'insurance_type': {'S': insurance_type},  # Store insurance type
            'status': {'S': 'Complete'}
        }
        dynamo_client.put_item(TableName=DYNAMODB_TABLE, Item=item)
        
        # Add the insurance type to the analysis result
        analyses[analysis_id]['result'] = {
            'page_analysis': page_analysis,
            'underwriter_analysis': underwriter_analysis,
            'insurance_type': insurance_type
        }
        analyses[analysis_id]['status'] = 'complete'
    except Exception as e:
        print(f"Error processing document: {e}")
        analyses[analysis_id]['status'] = 'error'
        analyses[analysis_id]['error'] = str(e)

def analyze_page_batch(pages, analysis_id, batch_size=3, progress_callback=None, insurance_type='life'):
    """Analyze a batch of pages and return the summaries"""
    # this is needed for the progress callback
    if progress_callback:
        progress_callback(f"Analyzing pages {pages[0]} to {pages[-1]}")
    
    client = get_bedrock_client()
    
    # Get the appropriate prompt based on insurance type
    prompt = get_page_analysis_prompt(insurance_type)
    
    # Replace page numbers in prompt
    page_prompts = []
    for page_num in pages:
        page_image = get_page_image(analysis_id, page_num)
        page_prompts.append({
            'page_num': page_num,
            'prompt': prompt,
            'image': page_image
        })
    
    # Process the batch
    results = {}
    for page_data in page_prompts:
        page_num = page_data['page_num']
        page_prompt = page_data['prompt']
        page_image = page_data['image']
        
        try:
            result = invoke_claude_with_image(client, page_prompt, page_image)
            
            # Process and parse the response
            parsed_result = parse_page_analysis(result, page_num)
            results[str(page_num)] = parsed_result
            
        except Exception as e:
            print(f"Error analyzing page {page_num}: {e}")
            results[str(page_num)] = {
                'page_type': 'Error',
                'content': f"Error analyzing page: {str(e)}"
            }
    
    return results

def analyze_underwriter(page_analysis, insurance_type='life', batch_size=10, progress_callback=None):
    """
    Takes a dict of {page_num: summary_text} from Phase 1
    and returns or yields the final JSON analysis from Phase 2.
    """
    client = get_bedrock_client()
    
    # Get the appropriate prompt based on insurance type
    prompt = get_underwriter_analysis_prompt(insurance_type)
    
    # Format the page summaries for the prompt
    page_summary_text = ""
    for page_num, data in sorted(page_analysis.items(), key=lambda x: int(x[0])):
        page_type = data.get('page_type', 'Unknown')
        page_content = data.get('content', 'No content available')
        page_summary_text += f"PAGE {page_num} ({page_type}):\n{page_content}\n\n"
    
    # Build the full prompt
    full_prompt = f"{prompt}\n\nHere are the page summaries:\n\n{page_summary_text}"
    
    # Call Claude to analyze
    try:
        if progress_callback:
            progress_callback("Generating underwriter analysis...")
        
        result = invoke_claude_text(client, full_prompt)
        
        # Extract JSON from result
        analysis = extract_json(result)
        return analysis
        
    except Exception as e:
        print(f"Error in underwriter analysis: {e}")
        return {
            "RISK_ASSESSMENT": f"Error generating analysis: {str(e)}",
            "DISCREPANCIES": "",
            "FINAL_RECOMMENDATION": ""
        }

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400
    
    job_id = data.get('job_id')
    message = data.get('message')
    chat_history = data.get('history', [])
    
    if not job_id or not message:
        return jsonify({"error": "Missing job_id or message"}), 400
    
    # Check if analysis exists
    if job_id not in analyses and not load_analysis_from_db(job_id):
        return jsonify({"error": "Analysis not found"}), 404
    
    analysis_data = analyses[job_id]
    if 'result' not in analysis_data:
        return jsonify({"error": "Analysis not complete"}), 400
    
    page_analysis = analysis_data['result']['page_analysis']
    underwriter_analysis = analysis_data['result']['underwriter_analysis']
    insurance_type = analysis_data['result'].get('insurance_type', 'life')  # Default to 'life' for backward compatibility
    
    client = get_bedrock_client()
    
    # Get system message with context
    system_message = get_chat_system_message(page_analysis, underwriter_analysis, insurance_type)
    
    # Format chat history for the API
    formatted_history = [
        {"role": "system", "content": system_message}
    ]
    
    for msg in chat_history:
        role = "user" if msg["role"] == "user" else "assistant"
        formatted_history.append({"role": role, "content": msg["content"]})
    
    formatted_history.append({"role": "user", "content": message})
    
    try:
        # Call Claude chat API
        response = client.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1500,
                "messages": formatted_history
            })
        )
        
        response_body = json.loads(response['body'].read())
        ai_response = response_body['content'][0]['text']
        
        return jsonify({"response": ai_response})
    
    except Exception as e:
        print(f"Error in chat: {e}")
        return jsonify({"error": str(e)}), 500 
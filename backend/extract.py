import sys
import re
import random
import boto3
import json
import argparse
from datetime import datetime
from botocore.config import Config
from io import BytesIO
from botocore.exceptions import ClientError
from pdf2image import convert_from_path
import math

GOOD_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"
FAST_MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0"
REGION = "us-west-2"
BATCH_SIZE = 3
config = Config(retries={'max_attempts': 10, 'mode': 'adaptive'})
BEDROCK_CLIENT = boto3.client("bedrock-runtime", REGION, config=config)

def analyze_document(pdf_path, batch_size=BATCH_SIZE, page_limit=None, progress_callback=None):
    pages = convert_from_path(pdf_path, dpi=200, fmt='JPEG')
    
    # Apply page limit if specified
    if page_limit is not None:
        pages = list(pages)[:page_limit]
        if progress_callback:
            yield from progress_callback(f"Processing only the first {page_limit} pages")
        
    image_data_list = []
    for page in pages:
        buf = BytesIO()
        page.save(buf, format='JPEG')
        image_data_list.append(buf.getvalue())

    results = {}
    total_pages = len(image_data_list)
    page_idx = 0

    while page_idx < total_pages:
        current_batch_pages = {}
        if progress_callback:
            yield from progress_callback(
                f"Processing pages {page_idx+1} to {min(page_idx+batch_size, total_pages)} ..."
            )
        
        batch = image_data_list[page_idx:page_idx + batch_size]
        batch_page_nums = range(page_idx + 1, page_idx + 1 + len(batch))

        user_content = [
            {
                "text": (
                    f"""You are an underwriter analyzing pages {list(batch_page_nums)} from a pdf containing an individual life insurance application.
                    Your job is to extract all relevant data from each page related to life insurance underwriting, such as:
                    - Health details (medical history, conditions, medications, lab results)
                    - Occupation information
                    - Credit scores
                    - Driving history
                    - Hobbies
                    - Discrepancies (contradictory or unclear information)

                    Guidelines:
                    - For each page, think about the page in <thinking>...</thinking> tags. 
                    - Then Output your the page details in <output page="X">...</output> tags. 
                    - Within the <output>, start with a description of the <page_type>, such as "Pharmacy Report" or "Driving History" or "Occupation History"
                       - If it's a continuation of a previous page, add "-Continued," I
                    - Then include all information relevant to life insurance underwriting in <page_content>...</page_content> tags. Dates are very important.  
                    - Do not mention absent information, as each page will pertain to only specific information. 
                    - Some pages may have redactions. That is ok. Just ignore them. 

                    Output example:
                    <output page="1">
                        <page_type>Pharmacy Report-Continued</page_type>
                        <page_content>
                            - Date Submitted: 12/29/2020)
                            - Gender: Male
                            - Risk Score: 2.650
                            - Medications:
                                - Prescription by Oncologist (#380)
                                - Anti-Convulsant with multiple uses (#354)
                            - Multiple prescription benefit periods from 01/01/2003 through 12/31/2039
                        </page_content>
                    </output>
                    Here come the images:"""
                )
            }
        ]
        for pg_num, img_bytes in zip(batch_page_nums, batch):
            user_content.append({"text": f"Page {pg_num}:"})
            user_content.append({
                "image": {
                    "format": "png",
                    "source": {"bytes": img_bytes}
                }
            })

        # Start with only a user message
        messages = [{"role": "user", "content": user_content}]

        assistant_accumulated = ""
        stop_reason = "max_tokens"

        # Keep calling while we get partial output
        while stop_reason == "max_tokens":
            try:
                response = BEDROCK_CLIENT.converse(
                    modelId=GOOD_MODEL_ID,
                    messages=messages,
                    inferenceConfig={
                        "maxTokens": 2048,
                        "temperature": 0.0,
                        "topP": 0.9
                    }
                )
            except ClientError as e:
                print("Error from Bedrock: ", e)
                break

            stop_reason = response["stopReason"]
            chunk_list = response["output"]["message"]["content"]
            if chunk_list:
                chunk_text = chunk_list[0]["text"]
                print("\n=== New chunk received ===")
                print(chunk_text)
                print("=== End of chunk ===\n")
                
                assistant_accumulated += chunk_text
                
                # Add assistant partial text
                messages.append({
                    "role": "assistant",
                    "content": [{"text": chunk_text}]
                })

                # If we still need more tokens, add a user prompt to continue
                if stop_reason == "max_tokens":
                    print("Max tokens reached, requesting continuation...")
                    messages.append({
                        "role": "user",
                        "content": [{"text": "Please continue from where you left off."}]
                    })

        # Now assistant_accumulated has the full batch output
        full_text = assistant_accumulated
        print("\n=== Full accumulated text ===")
        print(full_text)
        print("=== End of full text ===\n")

        # Parse the output using the new function
        parsed_results, found_pages = parse_page_output(full_text)
        results.update(parsed_results)

        # For any page in the batch that didn't appear in output, store placeholder
        for pg_num in batch_page_nums:
            if pg_num not in found_pages:
                print(f"Warning: No output found for page {pg_num} in batch {list(batch_page_nums)}")
                results[pg_num] = {
                    "page_type": "Unknown",
                    "content": "No analysis found."
                }

        # After processing the batch, store results
        current_batch_pages.clear()  # Ensure we start fresh
        for pg_num in batch_page_nums:
            if pg_num in results:
                current_batch_pages[str(pg_num)] = results[pg_num]
                print(f"Added page {pg_num} to current batch")

        if progress_callback and current_batch_pages:
            print(f"Sending batch update with {len(current_batch_pages)} pages: {list(current_batch_pages.keys())}")
            yield from progress_callback(
                f"Completed pages {page_idx+1} to {min(page_idx+batch_size, total_pages)}",
                current_batch_pages
            )

        page_idx += batch_size

    print("Final results:", results)
    return results

def get_current_focus(thinking_text):
    """
    Uses the FAST model to generate a concise summary of the current analysis focus.
    """
    messages = [{
        "role": "user",
        "content": [{
            "text": f"""You are helping summarize an insurance underwriter's current analytical focus.
            Below is their current thinking. Respond with ONLY a single, very concise sentence that captures
            what they are currently analyzing or considering. Start with an -ing verb.

            Output your response in <output>...</output> tags.

            Example responses:
            - "Analyzing medical history..."
            - "Comparing medication lists against disclosed conditions..."
            - "Reviewing family history of cardiovascular issues..."
            - "Cross-referencing lifestyle factors with medical records..."

            Guidelines:
            - Wrap your response in <output>...</output> tags.
            - Keep the response very concise. Brevity is preferred over an accurate summary.
            - Do not include any other text in your response.
            Current thinking:
            {thinking_text}"""
        }]
    }]

    try:
        response = BEDROCK_CLIENT.converse(
            modelId=FAST_MODEL_ID,
            messages=messages,
            inferenceConfig={
                "maxTokens": 100,
                "temperature": 0.0,
                "topP": 0.9
            }
        )
        # return response["output"]["message"]["content"][0]["text"].strip()
        return re.search(r'<output>(.*?)</output>', response["output"]["message"]["content"][0]["text"].strip()).group(1)
    except Exception as e:
        print(f"Error getting focus summary: {e}")
        return None

def underwriter_analysis(page_summaries, batch_size=10, progress_callback=None):
    """
    Takes a dict of {page_num: summary_text} from Phase 1
    and returns or yields the final JSON analysis from Phase 2.
    """
    summary_items = sorted(page_summaries.items(), key=lambda x: int(x[0]))
    messages = []
    final_output = None

    initial_prompt = (
        f"""You are a senior life insurance underwriter. I will show you page-level summaries in groups of {batch_size} at a time
        from an underwriting document. Your job: combine them into an overall risk 
        assessment. Identify specific risks, callouts, and discrepancies. Cite the 
        page number(s) where info was found. Keep updating and refining your assessment each time 
        you receive new page summaries.

        You must:
        1) Keep a chain-of-thought in <thinking>...</thinking> tags. Write 10-15 paragraphs summarizing your thoughts. 
        2) Produce interim and final results in <output> tags containing VALID JSON like this exact format:
        <output>
        {{
            "RISK_ASSESSMENT": "Detailed assessment with page references...",
            "DISCREPANCIES": "List of any conflicting information found with page references (pay special attention to medication prescriptions, which can indicate undisclosed conditions)",
            "MEDICAL_TIMELINE": "Timeline of major medical events ordered by date with page references. Only include major medical events, not minor ones.",
            "FINAL_RECOMMENDATION": "Clear recommendation based on all data. Do not make recommendations on accept or decline, but rather observe risks and recommend next steps."
        }}
        </output>

        Important:
        - Use EXACTLY the aforementioned key names
        - Make sure your JSON is properly formatted with quotes
        - Include page numbers in your analysis
        - Put the entire JSON inside <output> tags
        Guidelines:
        - Always include the page number(s) in your analysis. Use exactly this format "(pg 1)", "(pg 1, pg 7)"
        - Your general rule of thumb should be to add or refine information to the JSON, but not remove information.
        - Avoid speculative or subjective language such as "unrealistic." Instead, note any concerns or red flags factually and request clarification if needed.
        - Avoid strong or overly aggressive or conclusive language like "clear pattern of material misrepresentation".
        - Refrain from definitive conclusions about undisclosed or ongoing conditions unless explicitly supported by the source text. If something is uncertain, mark it as "requires further clarification" or "possible discrepancy."
        - Generally you should aim to describe the page in a way that is useful for an underwriter to make a decision, but not make judgement calls (except for the FINAL_RECOMMENDATION)
        
        Begin by acknowledging this prompt in your chain-of-thought, then produce 
        an initial empty JSON structure within <output> tags."""
    )

    messages.append({"role": "user", "content": [{"text": initial_prompt}]})
    overall_analysis = continue_bedrock_conversation(messages)

    # Extract thinking from initial analysis for first focus update
    thinking_match = re.search(r'<thinking>(.*?)</thinking>', overall_analysis, re.DOTALL)
    if thinking_match and progress_callback:
        current_focus = get_current_focus(thinking_match.group(1))
        if current_focus:
            yield from progress_callback(current_focus)

    num_batches = math.ceil(len(summary_items) / batch_size)
    for b in range(num_batches):
        batch_start = b * batch_size
        batch_end = batch_start + batch_size
        chunk = summary_items[batch_start:batch_end]

        chunk_text = (
            f"Analysis so far:\n{overall_analysis}\n\n"
            f"Here are new page summaries:\n"
        )
        for pg_num, summary in chunk:
            chunk_text += f"Page {pg_num}: {summary}\n"

        chunk_text += (
            "\nPlease refine your overall analysis. Keep the chain-of-thought in <thinking> tags. "
            "Update the JSON inside <output> so it has the keys "
            "[RISK_ASSESSMENT, DISCREPANCIES, MEDICAL_TIMELINE, FINAL_RECOMMENDATION]. "
            "Reference page numbers where relevant."
        )

        messages.append({"role": "user", "content": [{"text": chunk_text}]})
        overall_analysis = continue_bedrock_conversation(messages)
        final_output = parse_output_json(overall_analysis)

        # Extract thinking from latest analysis for focus update
        # Only do thinking/focus updates if we're not on the final batch
        thinking_match = re.search(r'<thinking>(.*?)</thinking>', overall_analysis, re.DOTALL)
        if thinking_match and progress_callback and b < num_batches - 1:
            current_focus = get_current_focus(thinking_match.group(1))
            if current_focus:
                yield from progress_callback(current_focus)

    if progress_callback:
        # yield final SSE with the completed JSON
        yield f"data: {json.dumps({'type': 'complete', 'data': final_output})}\n\n"
    else:
        # Return the final dict in non-streamed scenarios
        return final_output

def parse_output_json(full_text):
    """
    Looks for <output>...</output> blocks in the final text,
    extracts them, and tries to parse JSON from inside.
    If there are multiple <output> blocks, we take the last one as final.
    """
    pattern = re.compile(r"<output>(.*?)</output>", re.DOTALL | re.IGNORECASE)
    matches = pattern.findall(full_text)
    if not matches:
        print("WARNING: No <output> block found in final text.")
        print("Full text received:", full_text)
        return {
            "RISK_ASSESSMENT": "Error: No output block found",
            "DISCREPANCIES": "Error: No output block found",
            "MEDICAL_TIMELINE": "Error: No output block found",
            "FINAL_RECOMMENDATION": "Error: No output block found"
        }

    # Take the last match as the final output
    json_block = matches[-1].strip()
    
    try:
        data = json.loads(json_block)
        # Verify all required keys are present
        required_keys = ["RISK_ASSESSMENT", "DISCREPANCIES", "MEDICAL_TIMELINE", "FINAL_RECOMMENDATION"]
        missing_keys = [key for key in required_keys if key not in data]
        if missing_keys:
            print(f"WARNING: Missing required keys in JSON: {missing_keys}")
            for key in missing_keys:
                data[key] = f"Error: Missing {key}"
        return data
    except json.JSONDecodeError as e:
        print("Failed to parse JSON from <output>:")
        print("JSON block:", json_block)
        print("Error:", str(e))
        # Return error structure instead of empty dict
        return {
            "RISK_ASSESSMENT": f"Error parsing JSON: {str(e)}",
            "DISCREPANCIES": "Error: JSON parse failed",
            "MEDICAL_TIMELINE": "Error: JSON parse failed",
            "FINAL_RECOMMENDATION": "Error: JSON parse failed"
        }

def continue_bedrock_conversation(messages):
    """
    Calls the Bedrock model repeatedly if stopReason == 'max_tokens',
    appending the new partial text to 'assistant' role messages
    so the conversation continues. Returns the final accumulated text.
    """
    accumulated_text = ""
    stop_reason = "max_tokens"
    while stop_reason == "max_tokens":
        response = BEDROCK_CLIENT.converse(
            modelId=GOOD_MODEL_ID,
            messages=messages,
            inferenceConfig={
                "maxTokens": 2048,
                "temperature": 0.0,
                "topP": 0.9
            }
        )
        stop_reason = response["stopReason"]
        chunk_list = response["output"]["message"]["content"]
        if chunk_list:
            chunk_text = chunk_list[0]["text"]
            accumulated_text += chunk_text
            print("=== Partial response chunk ===\n", chunk_text, "\n=== End chunk ===")
            # Add that chunk as an assistant message
            messages.append({
                "role": "assistant",
                "content": [{"text": chunk_text}]
            })
            # If we still need more tokens, tell the model "Please continue..."
            if stop_reason == "max_tokens":
                messages.append({
                    "role": "user",
                    "content": [{"text": "Please continue where you left off."}]
                })
        else:
            break

    return accumulated_text

def parse_page_output(text: str) -> tuple[dict, set]:
    """
    Parse the XML-like output from the model into structured data.
    
    Args:
        text: The text to parse containing <output> tags
        
    Returns:
        Tuple of (results dict, set of found page numbers)
    """
    # Use </output> as the closing tag
    pattern = re.compile(r'<output\s+page="(\d+)">(.*?)</output>', re.DOTALL | re.IGNORECASE)
    matches = list(pattern.finditer(text))
    print(f"Found {len(matches)} output blocks in text")
    
    results = {}
    found_pages = set()
    
    for m in matches:
        pg_str = m.group(1)
        if pg_str.isdigit():
            pg_num = int(pg_str)
            page_content = m.group(2).strip()
            print(f"\n=== Processing page {pg_num} ===")
            print(f"Raw content: {page_content}")
            
            # Extract page_type and page_content
            page_type_match = re.search(r'<page_type>(.*?)</page_type>', page_content, re.DOTALL)
            content_match = re.search(r'<page_content>(.*?)</page_content>', page_content, re.DOTALL)
            
            if page_type_match and content_match:
                results[pg_num] = {
                    "page_type": page_type_match.group(1).strip(),
                    "content": content_match.group(1).strip()
                }
                print(f"Successfully extracted page_type: {results[pg_num]['page_type']}")
                print(f"Content length: {len(results[pg_num]['content'])} characters")
            else:
                print(f"Warning: Failed to extract page_type or content for page {pg_num}")
                print(f"page_type_match found: {bool(page_type_match)}")
                print(f"content_match found: {bool(content_match)}")
                results[pg_num] = {
                    "page_type": "Unknown",
                    "content": page_content.strip()
                }
            found_pages.add(pg_num)
            print(f"Added page {pg_num} to results")
    
    return results, found_pages

# if __name__ == "__main__":
#     parser = argparse.ArgumentParser(description='Analyze insurance underwriting documents')
#     group = parser.add_mutually_exclusive_group(required=True)
#     group.add_argument('--pdf', help='Path to PDF file to analyze')
#     group.add_argument('--analysis-json', help='Path to existing page analysis JSON file')
#     parser.add_argument('--batch-size', type=int, default=BATCH_SIZE, help='Batch size for processing')
#     parser.add_argument('--page-limit', type=int, help='Only process the first N pages of the PDF')
#     args = parser.parse_args()

#     BATCH_SIZE = args.batch_size

#     if args.pdf:
#         # Phase 1: PDF to page analysis
#         pdf_file = args.pdf
#         base_filename = pdf_file.rsplit('.', 1)[0]
        
#         print("Phase 1: Analyzing PDF pages...")
#         analysis_result = analyze_document(pdf_file, BATCH_SIZE, args.page_limit)
        
#         # Save page analysis as JSON with metadata
#         analysis_data = {
#             "metadata": {
#                 "source_file": pdf_file,
#                 "batch_size": BATCH_SIZE,
#                 "timestamp": datetime.now().isoformat(),
#             },
#             "page_analysis": analysis_result
#         }
        
#         json_output = f"{base_filename}_page_analysis.json"
#         with open(json_output, 'w') as f:
#             json.dump(analysis_data, f, indent=2)
            
#         # Also save human-readable version
#         txt_output = f"{base_filename}_page_analysis.txt"
#         with open(txt_output, 'w') as f:
#             f.write(f"Analysis generated: {datetime.now().isoformat()}\n")
#             f.write(f"Source file: {pdf_file}\n")
#             f.write(f"Batch size: {BATCH_SIZE}\n\n")
#             for page_num in sorted(analysis_result.keys()):
#                 f.write(f"=== Page {page_num} ===\n")
#                 f.write(analysis_result[page_num])
#                 f.write("\n\n")
        
#         print(f"Page analysis saved to:")
#         print(f"- {json_output} (machine-readable)")
#         print(f"- {txt_output} (human-readable)")
        
#     else:  # args.analysis_json
#         # Load existing analysis
#         with open(args.analysis_json, 'r') as f:
#             analysis_data = json.load(f)
#             analysis_result = analysis_data["page_analysis"]
#             base_filename = args.analysis_json.rsplit('_page_analysis.json', 1)[0]

#     # Phase 2: Generate underwriter analysis
#     print("\nPhase 2: Generating underwriter analysis...")
#     for progress_event in underwriter_analysis(analysis_result, BATCH_SIZE):
#         yield progress_event

#     # Save both JSON and human-readable versions
#     json_output = f"{base_filename}_underwriter_analysis.json"
#     with open(json_output, 'w') as f:
#         json.dump(final_output, f, indent=2)

#     txt_output = f"{base_filename}_underwriter_analysis.txt"
#     with open(txt_output, 'w') as f:
#         f.write("=== FINAL UNDERWRITER ANALYSIS ===\n")
#         if args.analysis_json:
#             f.write(f"Generated from analysis file: {args.analysis_json}\n\n")
        
#         for key, value in final_output.items():
#             f.write(f"=== {key} ===\n")
#             f.write(f"{value}\n\n")

#     print("\n=== FINAL UNDERWRITER ANALYSIS ===")
#     print(json.dumps(final_output, indent=2))
#     print(f"\nFinal analysis saved to:")
#     print(f"- {json_output} (machine-readable)")
#     print(f"- {txt_output} (human-readable)")

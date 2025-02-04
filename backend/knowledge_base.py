from langchain_community.retrievers import AmazonKnowledgeBasesRetriever
import boto3
from typing import List, Dict, Any
import json

# Initialize retrievers with us-east-1 region
bedrock_client = boto3.client('bedrock-runtime', region_name='us-east-1')

medical_topics_retriever = AmazonKnowledgeBasesRetriever(
    knowledge_base_id="0KJTQFKWOQ",
    retrieval_config={"vectorSearchConfiguration": {"numberOfResults": 4}},
    region_name="us-east-1"
)

articles_retriever = AmazonKnowledgeBasesRetriever(
    knowledge_base_id="NQ9A0JAJ80",
    retrieval_config={"vectorSearchConfiguration": {"numberOfResults": 4}},
    region_name="us-east-1"
)

def chat_with_claude(messages: List[Dict[str, Any]], system_message: str = None, require_tool_choice: bool = False) -> Dict[str, Any]:
    """
    Helper function to chat with Claude, similar to the smartChat function in the reference.
    """
    kwargs = {
        "modelId": "anthropic.claude-3-sonnet-20240229-v1:0",
        "messages": messages,
        "inferenceConfig": {
            "temperature": 0,
            "topP": 0.9
        }
    }
    
    if system_message:
        kwargs["system"] = [{"text": system_message}]
    
    response = bedrock_client.converse(**kwargs)
    return response

def process_knowledge_base_results(medical_docs, article_docs) -> tuple[str, List[str]]:
    """
    Process the retrieved documents and format them for Claude.
    Returns a tuple of (context, formatted_links).
    """
    context = ""
    formatted_links = []

    for doc in medical_docs + article_docs:
        if 'location' in doc.metadata:
            s3_uri = doc.metadata['location']['s3Location']['uri']
            if 'rga-genai-uw-demo-medical-articles' in s3_uri:
                # This is a knowledge center article
                link = s3_uri.split('/')[-1]
                formatted_link = f'[{link}](https://www.rgare.com/knowledge-center/article/{link})'
                context += f"<source>Knowledge Center</source> <link>{formatted_link}</link> \n <content>{doc.page_content}</content> \n"
                if formatted_link not in formatted_links:
                    formatted_links.append(formatted_link)
            else:
                # This is an underwriting manual link
                link = s3_uri.split('/')[-1].split('.')[0]
                formatted_link = f'[{link}](/{link})'
                context += f"<source>Underwriting Manual</source> <link>{formatted_link}</link> \n <content>{doc.page_content}</content> \n"
                if formatted_link not in formatted_links:
                    formatted_links.append(formatted_link)

    return context, formatted_links

def query_combined_knowledge_base(question: str) -> str:
    """
    Query both knowledge bases and return a formatted response.
    """
    # Retrieve documents from both knowledge bases
    medical_docs = medical_topics_retriever.invoke(question)
    article_docs = articles_retriever.invoke(question)

    print("Retrieved", len(medical_docs), "medical docs")
    print("Retrieved", len(article_docs), "article docs")

    # Process the retrieved documents
    context, formatted_links = process_knowledge_base_results(medical_docs, article_docs)

    # Create the prompt for Claude
    prompt_template = f"""
Here are some relevant passages retrieved from RGA's underwriting manual and knowledge center articles. Read them over and answer the question at the bottom. Please format your response in Markdown.

While answering the question, please include inline references to the relevant documents in Markdown format. You should quote the <source> when appropriate. 

Here are some examples:
- As outlined in the [Underwriting Manual guide on Tremors](/Tremors), you may need to order a...
- According to the [Knowledge Center article on Risk Assessment](https://www.rgare.com/knowledge-center/article/Risk_Assessment), ...

If it makes sense, use text fragments like this to link to the correct text in the cited document:
[Alcohol use](/Non-Medical_Considerations#:~:text=alcohol%20use) can be a factor

<context> {context} </context>

<question> {question} </question>
"""

    # Get Claude's response
    human_message = {"role": "user", "content": [{"text": prompt_template}]}
    response = chat_with_claude([human_message])
    answer = response["output"]["message"]["content"][0]["text"]

    print("Claude's answer", answer)

    # Add the further reading section
    final_response = answer + "\n\n*Further Reading:*\n\n" + "\n".join(formatted_links)
    return final_response 
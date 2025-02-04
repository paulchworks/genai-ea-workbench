## This is an example streamlit app from a previous project. It implements an underwriting chatbot with access to tools.
## It is not used in the current project.

import streamlit as st
import json
import base64
from PIL import Image
import io
from streamlit_chat import message
from langchain_community.retrievers import AmazonKnowledgeBasesRetriever
import boto3
st.set_page_config(layout="wide",
                   initial_sidebar_state="collapsed",
                   )
customer_name = "RGA"
chatbot_role = "life insurance medical underwriting"
user_role = "underwriters"
additional_guidelines = "assess risk, present favorable and unfavorable factors, "
bedrock_client = boto3.client(service_name='bedrock-runtime')
# smartChat = ChatBedrock(
#     model_id="anthropic.claude-3-sonnet-20240229-v1:0",
#     model_kwargs={"temperature": 0},
# )

if "uploaded_image_base64" not in st.session_state:
    st.session_state['uploaded_image_base64'] = None

bedrockClient = boto3.client('bedrock-runtime')

medical_topics_retriever = AmazonKnowledgeBasesRetriever(
    knowledge_base_id="0KJTQFKWOQ",
    retrieval_config={"vectorSearchConfiguration": {"numberOfResults": 4}},
)

articles_retriever = AmazonKnowledgeBasesRetriever(
    knowledge_base_id="NQ9A0JAJ80",
    retrieval_config={"vectorSearchConfiguration": {"numberOfResults": 4}},
)

if "prompt_modifier" not in st.session_state:
    st.session_state["prompt_modifier"] = "Informative, empathetic, and friendly"

sysMessage = f"""
You are a helpful, knowledgeable and talkative {customer_name} {chatbot_role} assistant. You assist {user_role} by providing information and guidance
on ${chatbot_role} to help them {additional_guidelines} and make informed decisions. You will have access to certain tools to assist you.
You should use the following guidance to control the tone: {st.session_state["prompt_modifier"]}

Please format your answers in Markdown. Avoid creating numbered lists. They don't format very well. Instead favor formatted markdown headings.
You may also use information from your own knowledege of {chatbot_role}, but should specify this in your response.

Below are some General Guidelines for your responses. If these topics come up you should absolutely mention these guidelines. 

- RGA does not use genetic information for underwriting: GINA prohibits the use of genetic information in underwriting decisions. While GINA doesn't apply to life insurance, RGA still prohibits the use of genetic information in underwriting.
- RGA does not based on protected characteristics: Underwriters cannot discriminate against applicants based on race, ethnicity, gender, religion, or other protected characteristics.
- RGA does not deny coverage based on a single risk factor: Underwriters should not automatically deny coverage based on a single risk factor, such as a pre-existing condition, without considering the applicant's overall health and risk profile.
"""

st.title("RGA Underwriting Assistant")
if "chat_history" not in st.session_state:
    st.session_state["chat_history"] = []


def smartChat(messages, useTools=True, required_tool_choice=False):
    kwargs = {
        "modelId": "anthropic.claude-3-sonnet-20240229-v1:0",
        "messages": messages,
        "system": [{"text": sysMessage}],
        "inferenceConfig": {"temperature": 0},
    }

    if useTools:
        kwargs["toolConfig"] = {
            "tools": [
                # {
                #     "toolSpec": {
                #         "name": "knowledge_center_articles",
                #         "description": "Use this tool by default if no other tool choice seems appropriate.",
                #         "inputSchema": {
                #             "json": {
                #                 "type": "object",
                #                 "properties": {
                #                     "question": {
                #                         "type": "string",
                #                         "description": "The user's question to lookup in the underwriting manual"
                #                     }
                #                 },
                #                 "required": [
                #                     "question"
                #                 ]
                #             }
                #         }

                #     }
                # },
                # {
                #     "toolSpec": {
                #         "name": "underwriting_guidelines",
                #         "description": "Only use this tool when the user asks about the 'underwriting manual', 'Global Underwriting Manual' or 'GUM'",
                #         "inputSchema": {
                #             "json": {
                #                 "type": "object",
                #                 "properties": {
                #                     "question": {
                #                         "type": "string",
                #                         "description": "The user's question to lookup in the underwriting manual"
                #                     }
                #                 },
                #                 "required": [
                #                     "question"
                #                 ]
                #             }
                #         }

                #     }
                # },

                {
                    "toolSpec": {
                        "name": "calculate_juvenile_BMI",
                        "description": "Calculate the BMI of a juvenile based on their height and weight.",
                        "inputSchema": {
                            "json": {
                                "type": "object",
                                "properties": {
                                    "height": {
                                        "type": "integer",
                                        "description": "The child's height in inches"
                                    },
                                    "weight": {
                                        "type": "integer",
                                        "description": "The child's weight in pounds"
                                    },
                                    "age": {
                                        "type": "integer",
                                        "description": "The child's age in years"
                                    },
                                    "sex": {
                                        "type": "string",
                                        "description": "The biological sex of the child"
                                    }
                                },
                                "required": [
                                    "height",
                                    "weight",
                                    "age",
                                    "sex"
                                ]
                            }
                        }
                    }
                },
                {
                    "toolSpec": {
                        "name": "cac_risk_percentile",
                        "description": "Calculate the Coronary Artery Calcium risk percentile for an individual based on age, biological sex, and CAC score. Ensure all 3 inputs are provided. If an input is missing, set it to <UNKNOWN>. Don't make them up!!!",
                        "inputSchema": {
                            "json": {
                                "type": "object",
                                "properties": {
                                    "age": {
                                        "type": "integer",
                                        "description": "The individual's age"
                                    },
                                    "sex": {
                                        "type": "string",
                                        "description": "The individual's biological sex"
                                    },
                                    "cac_score": {
                                        "type": "integer",
                                        "description": "The individual's CAC score"
                                    }

                                },
                                "required": [
                                    "age",
                                    "sex",
                                    "cac_score"
                                ]
                            }
                        }
                    }
                },
                                {
                    "toolSpec": {
                        "name": "combined_knowledge_base",
                        "description": "Use this tool to lookup articles on underwriting topics from the underwriting manual and knowledge center articles. Any requests for guidance related to underwriting should go here.",
                        "inputSchema": {
                            "json": {
                                "type": "object",
                                "properties": {
                                    "question": {
                                        "type": "string",
                                        "description": "The user's question to lookup in the combined knowledge base"
                                    }
                                },
                                "required": [
                                    "question"
                                ]
                            }
                        }
                    }
                },


            ],

        }
        if required_tool_choice:
            kwargs["toolConfig"]["toolChoice"] = {"any": {}}

    response = bedrock_client.converse(**kwargs)

    # print(response)
    return {"message": response["output"]["message"], "stop_reason": response["stopReason"]}


def handle_prompt_modifier_input():
    st.session_state["prompt_modifier"] = st.session_state["prompt_modifier_input"]


def calculate_juvenile_BMI(input):
    height = input["height"]
    weight = input["weight"]
    age = input["age"]
    sex = input["sex"]

    if height == "<UNKNOWN>":
        return "What is the height of the child?"
    if weight == "<UNKNOWN>":
        return "What is the weight of the child?"
    if age == "<UNKNOWN>":
        return "What is the age of the child?"
    if sex == "<UNKNOWN>":
        return "What is the biological sex of the child"

    bmi = round((weight / (height * height)) * 703, 2)
    prompt = f"""
The {sex} child age {age}, height {height} inches and weight {weight} pounds has a bmi of {bmi}. Can you categorize if this is underweight, normal, overweight, or obese according to CDC growth charts?
Start your answer by showing the BMI calculation and then provide the categorization.
    """
    print(prompt)
    response = smartChat(
        [{"content": [{"text": prompt}], "role": "user"}], False)["message"]["content"][0]["text"]
    return response


def call_combined_knowledgebase(original_question, user_input):
    # Rewrite the question if there's conversational context
    if len(st.session_state["chat_history"]) > 2:
        condensed_question_template = f"""Given the context of the current conversation and this follow up question, rephrase the follow up question to be a standalone question.

Follow Up Input: {user_input}

Standalone question:"""
        condensed_question_message = {"content": [{"text": condensed_question_template}], "role": "user"}
        condensed_question_response = smartChat(
            st.session_state["chat_history"] + [condensed_question_message])["message"]
        user_input = condensed_question_response["content"][0]["text"]

    # Retrieve documents from both knowledge bases
    medical_docs = medical_topics_retriever.invoke(user_input)
    article_docs = articles_retriever.invoke(user_input)

    print (medical_docs[0].page_content)


    # Combine and process the retrieved documents
    context = ""
    formatted_links = []

    for doc in medical_docs + article_docs:
        if 'location' in doc.metadata:
            s3_uri = doc.metadata['location']['s3Location']['uri']
            if 'rga-genai-uw-demo-medical-articles' in s3_uri:
                # This is a knowledge center article
                link = s3_uri.split('/')[-1]
                link = f'[{link}](https://www.rgare.com/knowledge-center/article/{link})'
                context += f"<source>Knowledge Center</source> <link>{link}<link> \n <content>{doc.page_content}</content> \n"
                if link not in formatted_links:
                    formatted_links.append(link)
            else:
                # This is an underwriting manual link
                link = s3_uri.split('/')[-1].split('.')[0]
                context += f"<source> Underwriting Manual</source><link>/{link}</link> \n <content>{doc.page_content}</content> \n"
                link = f'[{link}](/{link})'
                if link not in formatted_links:
                    formatted_links.append(link)

    promptTemplate = f"""
Here are some relevant passages retrieved from {customer_name}'s underwriting manual and knowledge center articles. Read them over and answer the question at the bottom. Please format your response in Markdown.

While answering the question, please include inline references to the relevant documents in Markdown format. You should quote the <source> when appropriate. 

Here are some examples:
- As outlined in the [Underwriting Manual guide on Tremors](/Tremors), you may need to order a...
- According to the [Knowledge Center article on Risk Assessment](https://www.rgare.com/knowledge-center/article/Risk_Assessment), ...

If it makes sense, use text fragments like this to link to the correct text in the cited document:
[Alcohol use](/Non-Medical_Considerations#:~:text=alcohol%20use) can be a factor

<context> {context} </context>

<question> {user_input} </question>
    """

    human_message = {"content": [{"text": promptTemplate}], "role": "user"}
    messages = st.session_state['chat_history'] + [human_message]
    response = smartChat(messages)["message"]["content"][0]["text"]

    # Format links for further reading
    # formatted_links = []
    # for link in links:
    #     if '.' in link:  # This is likely an article link
    #         formatted_links.append(f'[{link}](https://www.rgare.com/knowledge-center/article/{link})')
    #     else:  # This is likely an underwriting manual link
    #         formatted_links.append(f'[{link}](/{link})')

    response = response + "\n\n*Further Reading:*\n\n" + "\n".join(formatted_links)
    return response


def call_articles_knowledgebase(original_question, user_input):
    docs = articles_retriever.invoke(user_input)
    print("Docs")
    print(docs)
    # iterate over each document and append the page_content to a string
    context = ""
    links = []
    for doc in docs:
        link = doc.metadata['location']['s3Location']['uri'].split(
            '/')[-1]
        context += f"<article-uri>{link}</article-uri> \n <content>{doc.page_content}</content> \n"
        if link not in links:
            links.append(link)
    promptTemplate = f"""
Here are some  passages retrieved from {customer_name}'s article knowledge base. Read them over and answer the question at the bottom. Please format your response in Markdown.
While answering the question, please include inline references to the relevant documents in Markdown format. The links should ALWAYS follow this convention "https://www.rgare.com/knowledge-center/article/<article-uri>"
[<inline textual description of the document>](https://www.rgare.com/knowledge-center/article/<article-uri>)
Here is an example:
As outlined in the [article on Tremors](https://www.rgare.com/knowledge-center/article/Tremors), you may need to order a...
If it makes sense, use text fragments like this to link to the correct text in the cited document like this:
[Alcohol use](https://www.rgare.com/knowledge-center/article/Non-Medical_Considerations#:~:text=alcohol%20use) can be a factor

Don't start with 'according to the context' or 'as per the passages provided'. Just answer the questions directly!

Finally, it's possible the passages are not relevant, you should answer from your own knowledge of the topic. In that case, don't talk about the context, just answer the question directly!

<context> {context} </context>
<question> {user_input} </question>
        """

    human_message = {"content": [{"text": promptTemplate}], "role": "user"}
    messages = st.session_state['chat_history'] + [human_message]
    response = smartChat(messages)["message"]["content"][0]["text"]

    formatted_links = []
    for link in links:
        formatted_links.append(
            f'[{link}](https://www.rgare.com/knowledge-center/article/{link})')
    response = response + "\n\n*Further Reading:*\n\n" + \
        "\n".join(formatted_links)
    return response


def cac_risk_rating(percentile):
    risk_data = {
        ("<25"): {
            'rating': 0,
            'info': 'Best Class Preferred Available.'
        },
        ("25-49"): {
            'rating': 0,
            'info': 'Best Class Preferred Available.'
        },
        ("50-74"): {
            'rating': 0,
            'info': 'Best Class Preferred Available.'
        },
        ("75-89"): {
            'rating': 0,
            'info': 'No Preferred Available.'
        },
        ("90-94"): {
            'rating': 75,
            'info': """If current tobacco use, sum debits from above and Precision Calculator and add 25. 
            If diabetes sum debits from above and add 50, refer to MD if HbA1c < 6.5 (usually RNA) or RNA if HbA1c ≥ 6.5. 
            If hypertension or lipids, sum debits from above and Precision Calculator. If NTproBNP, see NTproBNP for possible additional debits.
            """
        },
        ("95-99"): {
            'rating': 100,
            'info': """If current tobacco use, sum debits from above and Precision Calculator and add 25. 
            If diabetes, (diagnosed or undiagnosed with an HbA1c ≥6.5)
               ≤ +100 from Glucose Metabolism in Precision Calculator	Refer to MD (Usually RNA)
               > +100 from Glucose Metabolism in Precision Calculator	RNA
            If hypertension or lipids, sum debits from above and Precision Calculator. 
            If NTproBNP, see NTproBNP for possible additional debits.'
            """
        },
        (">99"): {
            'rating': 150,
            'info': """If current tobacco use, sum debits from above and Precision Calculator and add 25. 
            If Diabetes (diagnosed or undiagnosed with an HbA1c ≥6.5)	RNA
            If hypertension or lipids, sum debits from above and Precision Calculator. 
            If NTproBNP, see NTproBNP for possible additional debits.
            """
        }

    }
    return risk_data.get(percentile, None)['rating'], risk_data.get(percentile, None)['info']


def cac_risk_percentile(age, sex, cac_score):
    percResult = '>99'
    # Male Age at CAC (years)
    male_data = {
        (0, 40): {'25th': 0, '50th': 1, '75th': 3, '90th': 14, '95th': 25, '99th': 37, '>99th': 37},
        (40, 44): {'25th': 0, '50th': 1, '75th': 9, '90th': 59, '95th': 85, '99th': 110, '>99th': 110},
        (45, 49): {'25th': 0, '50th': 3, '75th': 36, '90th': 154, '95th': 192, '99th': 390, '>99th': 390},
        (50, 54): {'25th': 1, '50th': 15, '75th': 103, '90th': 332, '95th': 426, '99th': 700, '>99th': 700},
        (55, 59): {'25th': 4, '50th': 48, '75th': 215, '90th': 554, '95th': 660, '99th': 1210, '>99th': 1210},
        (60, 64): {'25th': 13, '50th': 113, '75th': 410, '90th': 994, '95th': 1312, '99th': 2175, '>99th': 2175},
        (65, 69): {'25th': 32, '50th': 180, '75th': 566, '90th': 1299, '95th': 1963, '99th': 3790, '>99th': 3790},
        (70, 74): {'25th': 64, '50th': 310, '75th': 892, '90th': 1774, '95th': 2675, '99th': 5675, '>99th': 5675},
        (75, float('inf')): {'25th': 166, '50th': 473, '75th': 1071, '90th': 1982, '95th': 3995, '99th': 8750, '>99th': 8750}
    }

    # Female Age at CAC (years)
    female_data = {
        (0, 40): {'25th': 0, '50th': 0, '75th': 1, '90th': 3, '95th': 5, '99th': 6, '>99th': 6},
        (40, 44): {'25th': 0, '50th': 0, '75th': 1, '90th': 4, '95th': 8, '99th': 12, '>99th': 12},
        (45, 49): {'25th': 0, '50th': 0, '75th': 2, '90th': 22, '95th': 32, '99th': 75, '>99th': 75},
        (50, 54): {'25th': 0, '50th': 0, '75th': 5, '90th': 55, '95th': 117, '99th': 185, '>99th': 185},
        (55, 59): {'25th': 0, '50th': 1, '75th': 23, '90th': 121, '95th': 201, '99th': 389, '>99th': 389},
        (60, 64): {'25th': 0, '50th': 3, '75th': 57, '90th': 193, '95th': 330, '99th': 769, '>99th': 769},
        (65, 69): {'25th': 1, '50th': 24, '75th': 145, '90th': 410, '95th': 633, '99th': 1238, '>99th': 1238},
        (70, 74): {'25th': 3, '50th': 52, '75th': 210, '90th': 631, '95th': 850, '99th': 1900, '>99th': 1900},
        (75, float('inf')): {'25th': 9, '50th': 75, '75th': 241, '90th': 709, '95th': 1382, '99th': 2925, '>99th': 2925}
    }

    data = male_data if sex.lower() == 'male' else female_data
    age = int(age)
    cac_score = int(cac_score)
    for age_range, percentiles in data.items():
        print("Checking between ", age_range[0], "and", age_range[1])
        print("age is ", age)
        if age_range[0] <= age <= age_range[1]:
            print("matched age range", age_range)
            print("percentiles", percentiles)
            print("cac_score", cac_score)
            if cac_score <= 0:
                print("setting percResult to <25")
                percResult = '<25'
            elif cac_score < percentiles['25th']:
                print("setting percResult to <25")
                percResult = '<25'
            elif cac_score < percentiles['50th']:
                print("setting percResult to 25-49")
                percResult = '25-49'
            elif cac_score < percentiles['75th']:
                print("setting percResult to 50-74")
                percResult = '50-74'
            elif cac_score < percentiles['90th']:
                print("setting percResult to 75-89")
                percResult = '75-89'
            elif cac_score < percentiles['95th']:
                print("setting percResult to 90-94")
                percResult = '90-94'
            elif cac_score < percentiles['99th']:
                print("setting percResult to 95-99")
                percResult = '95-99'
            else:
                print("setting percResult to >99")
                percResult = '>99'
            break
    # if percResult starts with <, strip it off, then replace the 'th' with '' and convert it to an int
    print("percResult", percResult)

    rating, info = cac_risk_rating(percResult)
    print("rating", rating)
    print("info", info)

    prompt = f"""
Based on the inputs of CAC score <cac_score>{cac_score}<cac_score> for a <sex>{sex}</sex> of age <age>{age}</age>, the percentile is <percentile> {percResult} </percentile> percentile. 
This corresponds to a risk rating of <rating>{rating}</rating>. Here's additional information on the rating 

<info>{info}</info>.

Above is some information on the Coronary Artery Calcium (CAC) score for an individual. Provide a summary of the inputs (age, sex, CAC score) and calculated percentile for the inputs (age, sex, and CAC score) and the risk rating for the underwriter:
Then provide the risk rating and additional info. Pay attention to ranges for the percentile. Sometimes it will contain a less than or greater than symbol (< or >). That needs to be preserved. 

<template> 
## Caclulated Percentile
A <age> year old <sex> with a CAC score of <cac_score> would fall into the <percentile>th percentile"

## Risk Rating
This corresponds to a base risk rating of <rating>.

## Additional Rating Information
 <info>
</template>
    Don't add any additional information after printing the <info> tag.
    """
    print(prompt)
    human_message = {"content": [{"text": prompt}], "role": "user"}
    messages = st.session_state['chat_history'] + [human_message]
    response = smartChat(messages, useTools=False)[
        "message"]["content"][0]["text"]
    response = response + """

## Underwriting Considerations
If there is definite coronary artery disease by angiography or clinical history of MI and a ratable calcium score, use the higher of the 2 ratings.  
If CAD is suspected based on symptoms or positive stress test, both the CAC and symptoms/stress test should be taken into account. 
If there are multiple CACs, use the most recent to determine rating.  If there has been a significant increase in the CAC percentile over time, this may indicate progression of CAD – consider Refer to MD

Please note that the underwriter should always double-check the [ratings table in the underwriting manual](https://gum2.rgare.com/sections/medical/chapters/cardiovascular/topic/coronary-ct-angiography) to ensure accurate risk assessment.
"""
    return response


def call_caclulate_cac_risk_percentile(input):
    age = input["age"]
    sex = input["sex"]
    cac_score = input["cac_score"]
    print("inputs")
    print("age", age)
    print("sex", sex)
    print("cac_score", cac_score)
    # check inputs are not empty
    if age == "<UNKNOWN>":
        return "What is the age of the individual?"
    if sex == "<UNKNOWN>":
        return "What is the biological sex of the individual?"
    if cac_score == "<UNKNOWN>":
        return "What is the CAC score of the individual?"

    response = cac_risk_percentile(age, sex, cac_score)

    return response


def call_medical_topics_knowledgebase(original_question, user_input):

    # if st.session_state["chat_history"] has more than two messages, we need to ask the LLM to help us rewrite the question to consider the conversational context
    if len(st.session_state["chat_history"]) > 2:
        # ask the LLM
        condensed_question_template = f"""Given the context of the current conversation and this follow up question, rephrase the follow up question to be a standalone question.

Follow Up Input: {user_input}

Standalone question:"""
        condensed_question_message = {"content": [
            {"text": condensed_question_template}], "role": "user"}
        condensed_question_response = smartChat(
            st.session_state["chat_history"] + [condensed_question_message])["message"]
        user_input = condensed_question_response["content"][0]["text"]

    docs = medical_topics_retriever.invoke(user_input)

    print(docs)
    # iterate over each document and append the page_content to a string
    context = ""
    links = []
    for doc in docs:
        link = doc.metadata['location']['s3Location']['uri'].split(
            '/')[-1].split('.')[0]
        context += f"<link>{link}</link> \n <content>{doc.page_content}</content> \n"
        if link not in links:
            links.append(link)
    promptTemplate = f"""
Here are some relevant passages retrieved from {customer_name}'s underwriting manual. Read them over and answer the question at the bottom. Please format your response in Markdown.
While answering the question, please include inline references to the relevant documents in Markdown format:
[<inline textual description of the document>](/<link>)

Here is an example:
As outlined in the [article on Tremors](/Tremors), you may need to order a...

If it makes sense, use text fragments like this to link to the correct text in the cited document like this:

[Alcohol use](/Non-Medical_Considerations#:~:text=alcohol%20use) can be a factor

<context> {context} </context>

<question> {user_input} </question>
        """

    # human_message = HumanMessage(content=promptTemplate)
    human_message = {"content": [{"text": promptTemplate}], "role": "user"}
    # print(human_message)
    messages = st.session_state['chat_history'] + [human_message]
    response = smartChat(messages)["message"]["content"][0]["text"]
    # print("----Response from smartChat-----\n\n" + response)

    formatted_links = []
    for link in links:
        formatted_links.append(f'[{link}](/{link})')
    # print(formatted_links)
    response = response + "\n\n*Further Reading:*\n\n" + \
        "\n".join(formatted_links)
    # st.session_state['chat_history'].append(HumanMessage(content=original_question))
    return response


with st.sidebar:
    st.header("Chatbot Prompt Engineering")
    st.text_area("Prompt Modifier", value=st.session_state['prompt_modifier'],
                 key="prompt_modifier_input", on_change=handle_prompt_modifier_input)
    st.caption(
        "The Prompt Modifier describes the tone of the assistant, i.e. 'Informative, empathetic, and friendly'")


# Prompt template for internal data bot interface


# From here down is all the StreamLit UI.
# if favicon_url is defined, use it

def submit():
    user_input = st.session_state['input']
    st.session_state['input'] = ""
    original_question = user_input
    if user_input:
        user_message = {"content": [{"text": user_input}], "role": "user"}
        #upload base64 encoded image
        
        if st.session_state['uploaded_image_base64']:
            print("Uploaded image base64")
            user_message["content"].append( {
            "image": {
                "format": "jpeg",
                "source": {
                    "bytes": st.session_state['uploaded_image_base64']
                }
            }
            }
        )
        print("User message")
        print(user_message)
        use_tools = True
        if "uploaded_image_base64" in st.session_state and st.session_state['uploaded_image_base64'] is not None:
            use_tools = False

        response = smartChat(messages=st.session_state["chat_history"] + [
            user_message], useTools= use_tools, required_tool_choice=use_tools)
        print(response)
        if response["stop_reason"] == 'tool_use':
            # Tool use requested. Call the tool and send the result to the model.
            tool_requests = response["message"]['content']
            for tool_request in tool_requests:
                if 'toolUse' in tool_request:
                    tool = tool_request['toolUse']
                    print("Requesting tool " +
                          tool['name'] + " Request: " + tool['toolUseId'])

                    if tool['name'] == 'underwriting_guidelines':
                        response = call_medical_topics_knowledgebase(
                            original_question, user_input)

                    elif tool['name'] == 'knowledge_center_articles':
                        response = call_articles_knowledgebase(
                            original_question, user_input)

                    elif tool['name'] == 'calculate_juvenile_BMI':
                        response = calculate_juvenile_BMI(tool['input'])
                        print("Bmi response")
                        print(response)
                    elif tool['name'] == 'cac_risk_percentile':
                        response = call_caclulate_cac_risk_percentile(
                            tool['input'])
                        print("CAC response")
                        print(response)
                    elif tool['name'] == 'combined_knowledge_base':
                        response = call_combined_knowledgebase(
                            original_question, user_input)
                        print("Combined response")
                        print(response)
        else:
            response = response["message"]["content"][0]["text"]
        st.session_state['chat_history'].append(
            {"content": [{"text": original_question}], "role": "user"})
        # st.session_state['chat_history'].append(response)
        st.session_state['chat_history'].append(
            {"content": [{"text": response}], "role": "assistant"})
        st.session_state['uploaded_image_base64'] = None
        st.session_state['uploaded_image'] = None


print("session_state chathistory")
print(st.session_state["chat_history"])
introMessage = f"""
Hi! 👋 

Welcome to the {customer_name} Underwriting Assistant! Ask me anything about {chatbot_role} and I'll do my best to help you.

Things I can help with:
- Looking up information in the Global Underwriting Manual
- Looking up information from articles from the RGA Knowledge Center
- Calculating BMI for juveniles
- Calculating CAC risk percentile
- Image analysis

Just type your question in the box below and I'll do my best to help you out.
"""
message(introMessage, is_user=False, allow_html=True)

if st.session_state["chat_history"]:
    for eachMessage in st.session_state["chat_history"]:
        # if type(eachMessage) == HumanMessage:
        if eachMessage["role"] == "user":
            message(eachMessage["content"][0]["text"], is_user=True)
        # elif type(eachMessage) == AIMessage:
        elif eachMessage["role"] == "assistant":
            message(eachMessage["content"][0]["text"],
                    is_user=False, allow_html=True, )

st.text_input(label="You: ", key="input", value="",
              on_change=submit, placeholder="Ask a question!")


def add_image_upload():
    uploaded_file = st.file_uploader(
        "Choose an image...", type=["jpg", "jpeg", "png"])
    if uploaded_file is not None:
        image = Image.open(uploaded_file)
        st.image(image, caption='Uploaded Image.', use_column_width=True)
        # Encode the image bytes and save to session state
        st.session_state['uploaded_image_base64'] = uploaded_file.getvalue()
    return None


# Add this line where you want the upload button to appear in your UI
uploaded_image = add_image_upload()

# You can then use the uploaded_image in your chat logic if needed
if uploaded_image:
    # Add logic to process or reference the uploaded image in your chat
    st.session_state['uploaded_image'] = uploaded_image
   

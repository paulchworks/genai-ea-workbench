from typing import Dict, Any, List
# from knowledge_base import query_combined_knowledge_base

def calculate_bmi(input_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate BMI for an individual and return the result with CDC categorization.
    
    Args:
        input_data: Dictionary containing height (inches), weight (pounds), age, and sex
        
    Returns:
        Dictionary containing BMI calculation and categorization
    """
    print("in calculate_bmi")
    print("input_data", input_data)
    try:
        height = float(input_data["height"])
        weight = float(input_data["weight"])

        # Input validation
        if height <= 0 or weight <= 0:
            return "Height and weight must be positive numbers"
        # Calculate BMI
        bmi = round((weight / (height * height)) * 703, 1)

        # Return both the raw BMI and let Claude interpret it
        return f"The BMI for a height of {height} inches and a weight of {weight} pounds is {bmi}."

    except (KeyError, ValueError, TypeError) as e:
        return {"error": f"Invalid input: {str(e)}"}

def handle_knowledge_base_query(input_data: Dict[str, Any], conversation_history: List[Dict[str, Any]] = None) -> str:
    """
    Handle queries to the combined knowledge base.
    
    Args:
        input_data: Dictionary containing the question
        conversation_history: Optional list of previous messages for context
        
    Returns:
        Formatted response with citations and further reading
    """
    try:
        print("in handle_knowledge_base_query")
        print("input_data", input_data)
        print("conversation_history", conversation_history)
        question = input_data["question"]
        return "This is a placeholder response. The actual implementation of the knowledge base query is not yet available."
        # return query_combined_knowledge_base(question)
    except (KeyError, ValueError, TypeError) as e:
        return {"error": f"Invalid input: {str(e)}"}

# Tool definitions that will be added to the system message
TOOL_DEFINITIONS = {
    "tools": [
        {
            "toolSpec": {
                "name": "calculate_bmi",
                "description": "Calculate the BMI of an individual based on their height and weight.",
                "inputSchema": {
                    "json": {
                        "type": "object",
                        "properties": {
                            "height": {
                                "type": "integer",
                                "description": "The individual's height in inches"
                            },
                            "weight": {
                                "type": "integer",
                                "description": "The individual's weight in pounds"
                            },
                        },
                        "required": ["height", "weight"]
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
                        "required": ["question"]
                    }
                }
            }
        }
    ]
} 
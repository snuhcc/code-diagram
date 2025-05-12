import logging
import inspect
import traceback
import os
from fastapi import HTTPException
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, HumanMessagePromptTemplate
from llm.prompt_util import *
from typing import Optional
import json

OPENAI_O3 = "o3-2025-04-16"
OPENAI_O4_MINI = "o4-mini-2025-04-16"

BACKEND_ROOT_DIR = os.getcwd()
ARTIFACTS_REPO_PROMPT_TXT = os.path.join(BACKEND_ROOT_DIR, "artifacts", "repo_prompt.txt")
CFG_JSON_OUTPUT = os.path.join(BACKEND_ROOT_DIR, "artifacts", "cfg_json_output.json")


reasoning = {
    "effort": "low",  # 'low', 'medium', or 'high'
    # Reasoning Summary 사용하려면 조직인증 해야함.
    # "summary": "None",  # 'detailed', 'auto', or None
}

def create_messages(path: str, file_type: Optional[str]):
    repo_prompt = generate_repo_prompt(path)
    print(repo_prompt)

    with open(ARTIFACTS_REPO_PROMPT_TXT, "w") as f:
        f.write(repo_prompt)

    chat_prompt = ChatPromptTemplate.from_messages([
            HumanMessagePromptTemplate.from_template(
                """
                    You are a SOFTWARE ENGINEERING EXPERT. You are given a directory structure and codes.
                    Please GENERATE a CONTROL FLOW GRAPH (CFG) for the given code.

                    INPUT:
                    - Directory structure and code:
                    {repo_prompt}

                    - Example of the output format(json):
                    {diagram_example}

                    OUTPUT:
                    - Output should be in provided example json format
                    - Ensure the flowchart is clear and accurately represents the code structure.
                    - Include comments in the generated flowchart for better understanding.
                """
            ),
        ]
    )
    messages = chat_prompt.format_messages(repo_prompt=repo_prompt, diagram_example=json.dumps(DIAGRAM_EXAMPLE))
    return messages

async def generate_control_flow_graph(path: str, file_type: Optional[str]):
    try:
        llm = ChatOpenAI(
            model=OPENAI_O4_MINI,
            use_responses_api=True,
            model_kwargs={"reasoning": reasoning}
        )
        
        messages = create_messages(path, file_type)

        response = llm.invoke(messages)
        print(f"Output: {response.text()}")
        print(f"Reasoning: {response.additional_kwargs['reasoning']}")

        json_obj = json.loads(response.text())

        with open(CFG_JSON_OUTPUT, "w", encoding="utf-8") as f:
            json.dump(json_obj, f, indent=4, ensure_ascii=False)

        return response.text()

    except Exception as e:
        error_trace = traceback.format_exc()
        current_function_name = inspect.currentframe().f_code.co_name
        print(f"Error in function '{current_function_name}': {e}")
        print("Full traceback:")
        print(error_trace)
        raise HTTPException(status_code=500, detail=f"Error in {current_function_name}: {str(e)}")


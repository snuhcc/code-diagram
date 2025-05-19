import logging
import inspect
import traceback
import os
from fastapi import HTTPException
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, HumanMessagePromptTemplate
from llm.prompt_util import *
from llm.utils import get_source_files
from typing import Optional
import json

OPENAI_O3 = "o3-2025-04-16"
OPENAI_O4_MINI = "o4-mini-2025-04-16"

BACKEND_ROOT_DIR = os.getcwd()
ARTIFACTS_REPO_PROMPT_TXT = os.path.join(BACKEND_ROOT_DIR, "artifacts", "repo_prompt.txt")
CFG_JSON_OUTPUT = os.path.join(BACKEND_ROOT_DIR, "artifacts", "cfg_json_output_all.json")

reasoning = {
    "effort": "low",  # 'low', 'medium', or 'high'
    # Reasoning Summary 사용하려면 조직인증 해야함.
    # "summary": "None",  # 'detailed', 'auto', or None
}



def create_messages(path: str):

    repo_prompt = generate_repo_prompt_for_file(path)
    print(repo_prompt)

    chat_prompt = ChatPromptTemplate.from_messages(
        [HumanMessagePromptTemplate.from_template(PROMPT_CODE_TO_CFG),]
        )  
    
    messages = chat_prompt.format_messages(
        repo_prompt=repo_prompt, 
        diagram_example=json.dumps(DIAGRAM_EXAMPLE)
        )
    return messages

async def generate_control_flow_graphs_for_directory(root_path: str, file_type: Optional[str]):
    """
    Generate a control flow graph for each file in the directory.
    Returns a dict mapping file paths to their generated graph JSON.
    """
    source_files = get_source_files(root_path, file_type)
    print(f"Source files found: {source_files}")
    results = {}
    for file_path in source_files:
        try:
            output_json = await generate_control_flow_graph_for_file(root_path, file_path)
            results[file_path] = output_json
            #Test
            # break
        except Exception as e:
            # Optionally log or collect errors per file
            results[file_path] = {"error": str(e)}
    return results

async def generate_control_flow_graph_for_file(root_path: str, file_path: str):
    """
    Generate a control flow graph for a single file.
    """
    try:
        llm = ChatOpenAI(
            model=OPENAI_O4_MINI,
            use_responses_api=True,
            model_kwargs={"reasoning": reasoning}
        )
        messages = create_messages(file_path)
        response = llm.invoke(messages)
        print(f"Output for {file_path}: {response.text()}")
        # print(f"Reasoning: {response.additional_kwargs['reasoning']}")
        text = response.text().strip()
        # JSON 파싱 전, ```json ... ``` 블록 처리
        if text.startswith("```json"):
            text = text[len("```json"):].strip()
            if text.endswith("```"):
                text = text[:-3].strip()
        if not text:
            raise ValueError("LLM 응답이 비어 있습니다.")
        try:
            json_obj = json.loads(text)
        except json.JSONDecodeError as e:
            print("LLM 응답:", text)
            raise ValueError(f"LLM 응답이 올바른 JSON이 아닙니다: {e}")
        # Save each file's output separately
        rel_path = os.path.relpath(file_path, root_path)
        rel_path_flat = rel_path.replace(os.sep, "_")
        output_path = os.path.join(BACKEND_ROOT_DIR, "artifacts", f"cfg_{rel_path_flat}.json")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(json_obj, f, indent=4, ensure_ascii=False)
        return json_obj
    except Exception as e:
        error_trace = traceback.format_exc()
        current_function_name = inspect.currentframe().f_code.co_name
        print(f"Error in function '{current_function_name}' for file '{file_path}': {e}")
        print("Full traceback:")
        print(error_trace)
        raise HTTPException(status_code=500, detail=f"Error in {current_function_name} for {file_path}: {str(e)}")

async def generate_control_flow_graph(root_path: str, file_type: Optional[str]):
    try:
        # path 내의 .., . 등 정규화
        abs_path = os.path.abspath(os.path.normpath(root_path))
        print(f"Path: {abs_path}, File Type: {file_type}")
        results = await generate_control_flow_graphs_for_directory(abs_path, file_type)
        # Save the results to a JSON file
        results_str = ""
        with open(CFG_JSON_OUTPUT, "w", encoding="utf-8") as f:
            results_str = json.dump(results, f, indent=4, ensure_ascii=False)
        print(f"Control flow graphs saved to {CFG_JSON_OUTPUT}")
        #results should be json string
        return results_str

    except Exception as e:
        error_trace = traceback.format_exc()
        current_function_name = inspect.currentframe().f_code.co_name
        print(f"Error in function '{current_function_name}': {e}")
        print("Full traceback:")
        print(error_trace)
        raise HTTPException(status_code=500, detail=f"Error in {current_function_name}: {str(e)}")



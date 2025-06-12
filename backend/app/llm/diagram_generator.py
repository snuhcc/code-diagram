import logging
import inspect
import traceback
import os
import asyncio
from fastapi import HTTPException
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, HumanMessagePromptTemplate
from llm.prompt_util import *
from llm.utils import (
    get_all_source_files,
    extract_function_code_from_file_with_line_numbers,
    log_exception,
    extract_json_from_response,
    save_json_and_return_str,
)
from typing import Optional
import json
from llm.constants import (
    OPENAI_O4_MINI,
    OPENAI_GPT_4_1,
    BACKEND_ROOT_DIR,
    CG_JSON_OUTPUT,
    WORKSPACE_ROOT_DIR
)

reasoning_high = {
    "effort": "high",  # 'low', 'medium', or 'high'
    # Reasoning Summary 사용하려면 조직인증 해야함.
    # "summary": "None",  # 'detailed', 'auto', or None
}

reasoning_medium = {
    "effort": "medium",  # 'low', 'medium', or 'high'
    # Reasoning Summary 사용하려면 조직인증 해야함.
    # "summary": "None",  # 'detailed', 'auto', or None
}

reasoning_low = {
    "effort": "low",  # 'low', 'medium', or 'high'
    # Reasoning Summary 사용하려면 조직인증 해야함.
    # "summary": "None",  # 'detailed', 'auto', or None
}

def create_messages(root_path: str, file_path: str):

    print(f"Creating messages for root_path: {root_path}, file_path: {file_path}")
    # Convert str to Path
    root_dir = Path(root_path)
    repo_tree = build_repo_tree(root_dir)
    print(f"Repo tree: {repo_tree}")

    code_from_file = get_codes_from_file(file_path)
    print(f"code_from_file: {code_from_file}")

    chat_prompt = ChatPromptTemplate.from_messages(
        [HumanMessagePromptTemplate.from_template(PROMPT_CODE_TO_CG),]
        )  
    
    messages = chat_prompt.format_messages(
        repo_tree=repo_tree,
        code_from_file=code_from_file, 
        diagram_example=json.dumps(DIAGRAM_EXAMPLE)
        )
    return messages


async def generate_call_graphs_for_directory(root_path: str, file_type: Optional[str]):
    """
    Generate a call graph for each file in the directory.
    Returns a dict mapping file paths to their generated graph JSON.
    """
    source_files = get_all_source_files(root_path, file_type)
    print(f"Source files found: {source_files}")
    results = {}

    async def process_file(file_path):
        # print(f"Processing file: {file_path}")
        try:
            output_json = await generate_call_graph_for_file(root_path, file_path)
            return (file_path, output_json)
        except Exception as e:
            return (file_path, {"error": str(e)})

    tasks = [process_file(file_path) for file_path in source_files]
    results_list = await asyncio.gather(*tasks)
    # print(f"Results: {results_list}")
    for file_path, output in results_list:
        results[file_path] = output
    return results

async def generate_call_graph_for_file(root_path: str, file_path: str):
    """
    Generate a call graph for a single file.
    """
    try:
        llm = ChatOpenAI(
            model=OPENAI_O4_MINI,
            use_responses_api=True,
            model_kwargs={"reasoning": reasoning_low}
        )
        messages = create_messages(root_path, file_path)
        response = await llm.ainvoke(messages)
        print(f"Output for {file_path}: {response.text()}")
        # Use helper function for JSON extraction/parsing
        json_obj = extract_json_from_response(response.text())
        # Save each file's output separately
        rel_path = os.path.relpath(file_path, root_path)
        rel_path_flat = rel_path.replace(os.sep, "_")
        output_path = os.path.join(BACKEND_ROOT_DIR, "artifacts", f"cg_{rel_path_flat}.json")
        save_json_and_return_str(json_obj, output_path)
        return json_obj
    except Exception as e:
        log_exception(e, inspect.currentframe().f_code.co_name, f" for file '{file_path}'")
        raise HTTPException(status_code=500, detail=f"Error in {inspect.currentframe().f_code.co_name} for {file_path}: {str(e)}")

async def generate_call_graph(root_path: str, file_type: Optional[str]):
    try:
        # path 내의 .., . 등 정규화
        abs_path = os.path.abspath(os.path.normpath(root_path))
        print(f"Path: {abs_path}, File Type: {file_type}")

        # ⭐️ 이미 결과 파일이 있으면 바로 반환
        if os.path.exists(CG_JSON_OUTPUT):
            print(f"Call graph file already exists: {CG_JSON_OUTPUT}")
            with open(CG_JSON_OUTPUT, "r", encoding="utf-8") as f:
                return f.read()

        results = await generate_call_graphs_for_directory(abs_path, file_type)
        # Save the results to a JSON file
        results_str = ""
        with open(CG_JSON_OUTPUT, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=4, ensure_ascii=False)
            results_str = json.dumps(results, indent=4, ensure_ascii=False)
        print(f"Call graphs saved to {CG_JSON_OUTPUT}")
        #results should be json string
        return results_str

    except Exception as e:
        log_exception(e, inspect.currentframe().f_code.co_name)
        raise HTTPException(status_code=500, detail=f"Error in {inspect.currentframe().f_code.co_name}: {str(e)}")
    
async def generate_control_flow_graph(file_path: str, function_name: str):
    """
    Generate a control flow graph for the given code.
    """
    print(f"Generating control flow graph for {file_path} function {function_name}")
    try:
        # Use helper function to extract function code
        file_path = os.path.join(WORKSPACE_ROOT_DIR, file_path)
        function_code = extract_function_code_from_file_with_line_numbers(file_path, function_name)
        file_name = os.path.splitext(os.path.basename(file_path))[0]
        output_path = os.path.join(BACKEND_ROOT_DIR, "artifacts", f"cfg_{file_name}_{function_name}.json")

        # ⭐️ 이미 결과 파일이 있으면 바로 반환
        if os.path.exists(output_path):
            print(f"Control flow graph file already exists: {output_path}")
            with open(output_path, "r", encoding="utf-8") as f:
                return f.read()

        print(f"Extracted function code for {function_name}:\n{function_code}")

        llm = ChatOpenAI(
            model=OPENAI_GPT_4_1,
            use_responses_api=True,
            # model_kwargs={"reasoning": reasoning_medium}
        )

        chat_prompt = ChatPromptTemplate.from_messages(
            [HumanMessagePromptTemplate.from_template(PROMPT_CODE_TO_CFG),]
        )  
    
        messages = chat_prompt.format_messages(
            function_code=function_code,
            file_name=os.path.basename(file_path),
        )

        response = await llm.ainvoke(messages)
        print(f"Output for {function_name} in {file_path}: {response.text()}")
        json_obj = extract_json_from_response(response.text())

        results_str = save_json_and_return_str(json_obj, output_path)
        print(f"Control flow graph saved to {output_path}")
        return results_str

    except Exception as e:
        log_exception(e, inspect.currentframe().f_code.co_name)
        raise HTTPException(status_code=500, detail=f"Error in {inspect.currentframe().f_code.co_name}: {str(e)}")
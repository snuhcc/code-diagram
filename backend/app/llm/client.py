import logging
import inspect
import traceback
import os
import glob
from fastapi import HTTPException
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, HumanMessagePromptTemplate
from llm.prompt_util import *
from llm.utils import get_source_files
from typing import Optional
import json
from langgraph.graph import StateGraph, START, END
from typing_extensions import TypedDict
import uuid

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

# 세션별 엔진/히스토리 저장소 (메모리 기반, 프로덕션에서는 Redis 등 외부 저장소 권장)
session_store = {}

class SessionData(TypedDict):
    engine: 'LangGraphChatbotEngine'
    history: list

def create_session() -> str:
    """
    새로운 세션을 생성하고 세션 ID를 반환.
    """
    session_id = str(uuid.uuid4())
    session_store[session_id] = {
        "engine": LangGraphChatbotEngine(),
        "history": [],
    }
    return session_id

def get_session(session_id: str) -> SessionData:
    """
    세션 ID로 세션 데이터 반환. 없으면 KeyError.
    """
    return session_store[session_id]

def remove_session(session_id: str):
    """
    세션 종료 및 데이터 삭제.
    """
    if session_id in session_store:
        del session_store[session_id]

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

class ChatbotState(TypedDict, total=False):
    """
    LangGraph에서 사용할 상태 클래스.
    """
    code: str
    query: str
    diagram: str | None
    history: list
    answer: str | None
    highlight: list

def llm_node(state: ChatbotState, llm=None):
    """
    LLM을 호출해 답변을 생성하는 LangGraph 노드 함수.
    """
    if llm is None:
        llm = ChatOpenAI(
            model=OPENAI_O4_MINI,
            use_responses_api=True,
            model_kwargs={"reasoning": reasoning}
        )
    prompt = f"""아래 코드를 참고해서 사용자의 질문에 답변해 주세요.
            <code>
            {state['code']}
            </code>
            """
    if state.get('diagram'):
        prompt += f"\n<diagram>\n{state['diagram']}\n</diagram>\n"
    prompt += f"\n[질문]: {state['query']}"

    response = llm.invoke(prompt)
    # Extract only the answer text from the response
    if hasattr(response, "content") and isinstance(response.content, list) and response.content and "text" in response.content[0]:
        state['answer'] = response.content[0]["text"]
    else:
        state['answer'] = str(response)
    # 하이라이트 추출 로직은 추후 추가
    state['highlight'] = []
    # 대화 이력 갱신
    if 'history' not in state or state['history'] is None:
        state['history'] = []
    state['history'].append({"role": "user", "content": prompt})
    state['history'].append({"role": "assistant", "content": state['answer']})
    print(f"State after LLM: {state}")
    return state

# LangGraph 챗봇 엔진 클래스
class LangGraphChatbotEngine:
    def __init__(self):
        self.llm = ChatOpenAI(
            model=OPENAI_O4_MINI,
            use_responses_api=True,
            model_kwargs={"reasoning": reasoning}
        )
        # StateGraph 정의
        self.graph = StateGraph(ChatbotState)
        self.graph.add_node("llm", lambda state: llm_node(state, self.llm))
        self.graph.add_edge(START, "llm")
        self.graph.add_edge("llm", END)
        self.app = self.graph.compile()

    async def ask(self, code: str, query: str, diagram: str = None, history: list = None):
        """
        LangGraph를 통해 답변 생성. history를 인자로 받아 이어붙임.
        """
        state: ChatbotState = {
            "code": code,
            "query": query,
            "diagram": diagram,
            "history": history if history is not None else [],
            "answer": None,
            "highlight": [],
        }
        result = await self.app.ainvoke(state)
        return result['answer'], result['highlight'], result['history']

async def generate_chatbot_answer_with_session(session_id: str, code: str, diagram: str, query: str):
    """
    세션 기반 챗봇 답변 생성. 세션별 history를 서버에서 관리.
    """
    session = get_session(session_id)
    engine = session["engine"]
    history = session["history"]
    answer, highlight, updated_history = await engine.ask(code, query, diagram, history)
    session["history"] = updated_history  # 서버에 최신 history 저장
    return answer, highlight


from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from typing_extensions import TypedDict
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate
import uuid
import json
import os
from typing import AsyncGenerator
from llm.constants import OPENAI_GPT_4_1
from llm.prompt_util import *
from llm.utils import *

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
    print(f"Session {session_id} opened.")
    return session_id

def get_session(session_id: str) -> SessionData:
    """
    세션 ID로 세션 데이터 반환. 없으면 KeyError.
    """
    return session_store[session_id]

def get_session_history(session_id: str) -> list:
    """
    세션 ID로 세션 히스토리 반환. 없으면 KeyError.
    """
    session = get_session(session_id)
    return session["history"]

def remove_session(session_id: str):
    """
    세션 종료 및 데이터 삭제.
    """
    if session_id in session_store:
        print(f"Session {session_id} closed.")
        del session_store[session_id]

class ChatbotState(TypedDict, total=False):
    graph_mode: bool
    target_path: str
    code: str
    query: str
    diagram: str | None
    history: list
    answer: str | None
    highlight: list

SYSTEM_PROMPT = "당신은 친절하고 유능한 Python 소프트웨어 전문가 입니다. 사용자의 질문에 정확하고 간결하게 한국어로 답변하세요."

GRAPH_SYSTEM_PROMPT = """당신은 코드 분석 전문가입니다. 주어진 Call Graph 데이터를 분석하여 사용자의 질문에 맞는 함수들을 찾아주세요.

사용자가 함수의 호출 관계나 특정 함수에 대해 질문하면:
1. 질문과 관련된 함수들을 Call Graph에서 찾아주세요
2. 함수들 간의 호출 관계를 설명해주세요
3. 관련된 함수의 ID들을 정확히 식별해서 답변에 포함해주세요

Call Graph 데이터 형식:
- nodes: 각 함수의 정보 (id, function_name, file, line_start, line_end, description)
- edges: 함수 간 호출 관계 (source -> target)

답변은 한국어로 작성하고, 찾은 함수들의 ID는 반드시 정확히 기재해주세요."""

def load_call_graph_data():
    """
    Call Graph JSON 데이터를 로드하는 함수.
    """
    try:
        json_path = os.path.join(os.path.dirname(__file__), '..', 'artifacts', 'cg_json_output_all.json')
        with open(json_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Call Graph 데이터 로드 실패: {e}")
        return None

def process_chat_mode(state: ChatbotState, llm):
    """
    일반 채팅 모드에서 LLM 호출 및 응답 처리를 담당하는 함수.
    """
    human_prompt = """아래 INPUT 정보를 참고해서 충분히 고민한 후 사용자의 질문에 정확하고 간결하게 답변하세요.
    INPUT: 질문, 채팅 히스토리, 코드[Optional], 다이어그램[Optional]"""
    human_prompt += f"\n[질문]: {state['query']}"
    
    if state.get('history'):
        human_prompt += f"\n[채팅 히스토리]: {state['history']}"
    if state.get('code'):
        human_prompt += f"\n<code>\n{state['code']}\n</code>\n"
    if state.get('diagram'):
        human_prompt += f"\n<diagram>\n{state['diagram']}\n</diagram>\n"
    
    system_message = SystemMessage(content=SYSTEM_PROMPT)
    human_message = HumanMessage(content=human_prompt)
    messages = [system_message] + [human_message]
    
    response = llm.invoke(messages)
    
    # 응답 파싱
    if hasattr(response, "content") and isinstance(response.content, list) and response.content and "text" in response.content[0]:
        answer = response.content[0]["text"]
    else:
        answer = str(response)
    
    return answer

def extract_function_ids_from_response(answer: str, call_graph_data: dict) -> list:
    """
    LLM 응답에서 함수 ID들을 추출하는 함수.
    """
    if not call_graph_data:
        return []
    
    # 모든 함수 ID 수집
    all_function_ids = set()
    for file_path, file_data in call_graph_data.items():
        for node in file_data.get('nodes', []):
            all_function_ids.add(node['id'])
    
    # 응답에서 언급된 함수 ID들 찾기
    mentioned_ids = []
    for func_id in all_function_ids:
        if func_id in answer:
            mentioned_ids.append(func_id)
    
    # 함수명으로도 검색 (더 유연한 매칭)
    for file_path, file_data in call_graph_data.items():
        for node in file_data.get('nodes', []):
            function_name = node['function_name']
            if function_name in answer and node['id'] not in mentioned_ids:
                mentioned_ids.append(node['id'])
    
    return mentioned_ids

def process_graph_mode(state: ChatbotState, llm):
    """
    그래프 검색 모드에서 Call Graph 분석 및 응답 처리를 담당하는 함수.
    """
    # Call Graph 데이터 로드
    call_graph_data = load_call_graph_data()
    if not call_graph_data:
        return "Call Graph 데이터를 로드할 수 없습니다. 일반 채팅 모드로 전환해주세요.", []
    
    target_path = os.path.join(WORKSPACE_ROOT_DIR, state['target_path'])
    target_path = os.path.abspath(target_path)
    # print(f"target_path: {target_path}")
    
    repo_tree = build_repo_tree(Path(target_path))
    # print(f"repo_tree: {repo_tree}")
    all_codes = get_all_source_files_with_line_numbers(target_path)
    print(f"all_codes: {all_codes}")

    # Call Graph 데이터를 프롬프트에 포함
    human_prompt = """아래 Call Graph 데이터를 분석하여 사용자의 질문에 답변해주세요.
사용자가 특정 함수에 대해 찾아달라고 요청하면, 해당 함수와 연결 된 모든 함수들을 찾아주세요.
관련된 함수의 ID들을 정확히 식별해서 답변에 포함해주세요.

INPUT:
<call_graph_data>
{call_graph_json}
</call_graph_data>

<directory_tree>
{repo_tree}
</directory_tree>

<code>
{all_codes}
</code>

[사용자 질문]: {query}

OUTPUT:
- 답변은 Markdown 형식으로 간결하고 명확하게 작성해주세요.
- 사용자의 질문에 대한 답변은 한국어로 작성해주세요.
- 사용자가 이유를 묻거나 설명을 요청하지 않는다면, 관련된 함수들의 ID들만 정확하게 나열해주세요.
""".format(
        call_graph_json=json.dumps(call_graph_data, ensure_ascii=False, indent=2),
        repo_tree=repo_tree,
        all_codes=all_codes,
        query=state['query']
    )
    
    print(f"human_prompt: {human_prompt}")

    if state.get('history'):
        human_prompt += f"\n[채팅 히스토리]: {state['history']}"
    if state.get('code'):
        human_prompt += f"\n<code>\n{state['code']}\n</code>\n"
    if state.get('diagram'):
        human_prompt += f"\n<diagram>\n{state['diagram']}\n</diagram>\n"
    
    system_message = SystemMessage(content=GRAPH_SYSTEM_PROMPT)
    human_message = HumanMessage(content=human_prompt)
    messages = [system_message] + [human_message]
    
    response = llm.invoke(messages)
    
    # 응답 파싱
    if hasattr(response, "content") and isinstance(response.content, list) and response.content and "text" in response.content[0]:
        answer = response.content[0]["text"]
    else:
        answer = str(response)
    
    # 응답에서 관련 함수 ID들 추출
    highlighted_function_ids = extract_function_ids_from_response(answer, call_graph_data)
    
    return answer, highlighted_function_ids

def llm_node(state: ChatbotState, llm):
    """
    LLM을 호출해 답변을 생성하는 LangGraph 노드 함수.
    """
    graph_mode = state.get('graph_mode', False)
    
    if graph_mode:
        # 그래프 검색 모드
        answer, highlight_list = process_graph_mode(state, llm)
        state['highlight'] = highlight_list
    else:
        # 일반적인 LLM 대화 모드
        answer = process_chat_mode(state, llm)
        state['highlight'] = []
    
    # 상태 업데이트
    state['answer'] = answer
    
    # 히스토리 업데이트
    if 'history' not in state or state['history'] is None:
        state['history'] = []
    state['history'].append({"USER": state['query']})
    state['history'].append({"AI": state['answer']})

    return state

class LangGraphChatbotEngine:
    def __init__(self):
        self.llm = ChatOpenAI(
            model=OPENAI_GPT_4_1,
            use_responses_api=True,
            temperature=0.1,
        )
        self.streaming_llm = ChatOpenAI(
            model=OPENAI_GPT_4_1,
            temperature=0.1,
            streaming=True
        )
        self.graph = StateGraph(ChatbotState)
        self.graph.add_node("llm", lambda state: llm_node(state, self.llm))
        self.graph.add_edge(START, "llm")
        self.graph.add_edge("llm", END)
        self.app = self.graph.compile()

    async def ask(self, query: str, graph_mode: bool, target_path: str, code: str = None, diagram: str = None, history: list = None):
        state: ChatbotState = {
            "graph_mode": graph_mode,
            "target_path": target_path,
            "code": code,
            "query": query,
            "diagram": diagram,
            "history": history if history is not None else [],
            "answer": None,
            "highlight": []
        }
        result = await self.app.ainvoke(state)
        return result['answer'], result['highlight'], result['history']

    async def ask_stream(self, query: str, graph_mode: bool, target_path: str, code: str = None, diagram: str = None, history: list = None) -> AsyncGenerator[str, None]:
        """
        스트리밍 방식으로 챗봇 답변을 생성합니다.
        """
        # 기본 프롬프트 생성
        if graph_mode:
            # 그래프 검색 모드
            call_graph_data = load_call_graph_data()
            if not call_graph_data:
                yield "Call Graph 데이터를 로드할 수 없습니다. 일반 채팅 모드로 전환해주세요."
                return
            
            target_path_abs = os.path.join(WORKSPACE_ROOT_DIR, target_path)
            target_path_abs = os.path.abspath(target_path_abs)
            
            repo_tree = build_repo_tree(Path(target_path_abs))
            all_codes = get_all_source_files_with_line_numbers(target_path_abs)

            human_prompt = """아래 Call Graph 데이터를 분석하여 사용자의 질문에 답변해주세요.
사용자가 특정 함수에 대해 질문하면, 해당 함수와 관련된 모든 함수들을 찾아서 설명해주세요.
관련된 함수의 ID들을 정확히 식별해서 답변에 포함해주세요.

<call_graph_data>
{call_graph_json}
</call_graph_data>

<directory_tree>
{repo_tree}
</directory_tree>

<code>
{all_codes}
</code>

[사용자 질문]: {query}
""".format(
                call_graph_json=json.dumps(call_graph_data, ensure_ascii=False, indent=2),
                repo_tree=repo_tree,
                all_codes=all_codes,
                query=query
            )
            
            system_message = SystemMessage(content=GRAPH_SYSTEM_PROMPT)
        else:
            # 일반 채팅 모드
            human_prompt = """아래 INPUT 정보를 참고해서 충분히 고민한 후 사용자의 질문에 정확하고 간결하게 답변하세요.
INPUT: 질문, 채팅 히스토리, 코드[Optional], 다이어그램[Optional]"""
            human_prompt += f"\n[질문]: {query}"
            
            system_message = SystemMessage(content=SYSTEM_PROMPT)
        
        if history:
            human_prompt += f"\n[채팅 히스토리]: {history}"
        if code:
            human_prompt += f"\n<code>\n{code}\n</code>\n"
        if diagram:
            human_prompt += f"\n<diagram>\n{diagram}\n</diagram>\n"
        
        human_message = HumanMessage(content=human_prompt)
        messages = [system_message, human_message]
        
        # 스트리밍 응답 생성
        async for chunk in self.streaming_llm.astream(messages):
            if chunk.content:
                yield chunk.content

async def generate_chatbot_answer_with_session(session_id: str, graph_mode: bool, target_path: str, query: str, code: str = None, diagram: str = None):
    """
    세션 기반 챗봇 답변 생성. 세션별 history를 서버에서 관리.
    """
    session = get_session(session_id)
    engine = session["engine"]
    history = session["history"]
    answer, highlight, updated_history = await engine.ask(query, graph_mode, target_path, code, diagram, history)
    session["history"] = updated_history  # 서버에 최신 history 저장
    return answer, highlight

async def generate_chatbot_answer_with_session_stream(session_id: str, graph_mode: bool, target_path: str, query: str, code: str = None, diagram: str = None) -> AsyncGenerator[str, None]:
    """
    세션 기반 챗봇 답변을 스트리밍 방식으로 생성합니다.
    """
    session = get_session(session_id)
    engine = session["engine"]
    history = session["history"]
    
    # 스트리밍 응답 수집 및 히스토리 업데이트를 위한 버퍼
    response_buffer = ""
    
    async for chunk in engine.ask_stream(query, graph_mode, target_path, code, diagram, history):
        response_buffer += chunk
        yield chunk
    
    # 응답이 완료되면 히스토리 업데이트
    if response_buffer:
        if 'history' not in session or session['history'] is None:
            session['history'] = []
        session['history'].append({"USER": query})
        session['history'].append({"AI": response_buffer})

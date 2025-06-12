from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from typing_extensions import TypedDict
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate
import uuid
from llm.constants import OPENAI_GPT_4_1

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
    code: str
    query: str
    diagram: str | None
    history: list
    answer: str | None
    highlight: list

SYSTEM_PROMPT = "당신은 친절하고 유능한 Python 소프트웨어 전문가 입니다. 사용자의 질문에 정확하고 간결하게 한국어로 답변하세요."

def llm_node(state: ChatbotState, llm):
    """
    LLM을 호출해 답변을 생성하는 LangGraph 노드 함수.
    """
    graph_mode = state.get('graph_mode')
    if graph_mode:
        pass
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
    if hasattr(response, "content") and isinstance(response.content, list) and response.content and "text" in response.content[0]:
        state['answer'] = response.content[0]["text"]
    else:
        state['answer'] = str(response)
    state['highlight'] = []
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
        self.graph = StateGraph(ChatbotState)
        self.graph.add_node("llm", lambda state: llm_node(state, self.llm))
        self.graph.add_edge(START, "llm")
        self.graph.add_edge("llm", END)
        self.app = self.graph.compile()

    async def ask(self, query: str, graph_mode: bool, code: str = None, diagram: str = None, history: list = None):
        state: ChatbotState = {
            "graph_mode": graph_mode,
            "code": code,
            "query": query,
            "diagram": diagram,
            "history": history if history is not None else [],
            "answer": None,
            "highlight": []
        }
        result = await self.app.ainvoke(state)
        return result['answer'], result['highlight'], result['history']

async def generate_chatbot_answer_with_session(session_id: str, graph_mode: bool, query: str, code: str = None, diagram: str = None):
    """
    세션 기반 챗봇 답변 생성. 세션별 history를 서버에서 관리.
    """
    session = get_session(session_id)
    engine = session["engine"]
    history = session["history"]
    answer, highlight, updated_history = await engine.ask(query, graph_mode, code, diagram, history)
    session["history"] = updated_history  # 서버에 최신 history 저장
    return answer, highlight

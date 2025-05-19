from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from typing_extensions import TypedDict
import uuid

OPENAI_GPT_4_1 = "gpt-4.1-2025-04-14"

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

class ChatbotState(TypedDict, total=False):
    code: str
    query: str
    diagram: str | None
    history: list
    answer: str | None
    highlight: list

def llm_node(state: ChatbotState, llm):
    """
    LLM을 호출해 답변을 생성하는 LangGraph 노드 함수.
    """
    prompt = f"""아래 코드를 참고해서 사용자의 질문에 답변해 주세요.
            <code>
            {state['code']}
            </code>
            """
    if state.get('diagram'):
        prompt += f"\n<diagram>\n{state['diagram']}\n</diagram>\n"
    prompt += f"\n[질문]: {state['query']}"

    response = llm.invoke(prompt)
    if hasattr(response, "content") and isinstance(response.content, list) and response.content and "text" in response.content[0]:
        state['answer'] = response.content[0]["text"]
    else:
        state['answer'] = str(response)
    state['highlight'] = []
    if 'history' not in state or state['history'] is None:
        state['history'] = []
    state['history'].append({"role": "user", "content": prompt})
    state['history'].append({"role": "assistant", "content": state['answer']})
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

    async def ask(self, code: str, query: str, diagram: str = None, history: list = None):
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

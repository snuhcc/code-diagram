from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pathlib import Path
from schemas.common import *
from llm.diagram_generator import generate_call_graph
from llm.chatbot import create_session, remove_session, generate_chatbot_answer_with_session, get_session_history
from llm.utils import get_source_file_with_line_number
from fastapi.responses import JSONResponse
from llm.constants import SAMPLE_CFG_JSON

import json

# .env file loading
load_dotenv()

# FastAPI app initialization
app = FastAPI(title="Code-Diagram API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 프론트엔드 도메인으로 제한 가능
    allow_credentials=True,
    allow_methods=["*"],  # 모든 HTTP 메서드 허용
    allow_headers=["*"],  # 모든 헤더 허용
)

# Define the path to the HTML template
HTML_PATH = Path(__file__).parent / "html" / "root.html"

# API Endpoint
@app.get("/", response_class=HTMLResponse)
async def root():
    try:
        # Read the HTML content from the file
        html_content = HTML_PATH.read_text(encoding="utf-8")
        return HTMLResponse(content=html_content)
    except FileNotFoundError:
        return HTMLResponse(content="<h1>Template not found</h1>", status_code=404)

@app.post("/api/generate_call_graph", response_model=CGDiagramResponse)
async def api_generate_call_graph(request: CGDiagramResponse):
    """
    Generate a call graph for the given code.
    """
    try:

        json_data = await generate_call_graph(request.path, request.file_type)
        result = {
            "data": json_data
        }
        print(f'result in main.py: \\{result}')
        return CGDiagramResponse(**result)
    except Exception as e:
        return CGDiagramResponse(status=500, data=str(e))

@app.post("/api/generate_control_flow_graph", response_model=CFGDiagramResponse)
async def api_generate_control_flow_graph(request: CFGDiagramRequest):
    """
    Generate a control flow graph for the given code.
    """
    try:
        json_data = ""
        with open(SAMPLE_CFG_JSON, "r", encoding="utf-8") as f:
            json_data = json.load(f)
        result = {
            "data": json_data
        }
        print(f'result in main.py: \\{result}')
        return CFGDiagramResponse(**result)
    except Exception as e:
        return CFGDiagramResponse(status=500, data=str(e))

@app.get("/api/chatbot/session/open")
async def api_open_session():
    try:
        session_id = create_session()
        return SessionResponse(session_id=session_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chatbot/session/close")
async def api_close_session(req: SessionRequest):
    try:
        if not req.session_id:
            raise HTTPException(status_code=400, detail="Session ID is required")
        remove_session(req.session_id)
        return {"status": "closed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chatbot/session/chat", response_model=ChatbotQueryResponse)
async def api_session_chat(req: ChatbotQueryRequest):
    try:
        if not req.session_id:
            raise HTTPException(status_code=400, detail="Session ID is required")
        if not req.query:
            raise HTTPException(status_code=400, detail="Query is required")
        
        # Handle Context Files
        context = ""
        if hasattr(req, 'context_files') and req.context_files:
            context += "Below is the context from the provided files:\n"
            for file_path in req.context_files:
                context += get_source_file_with_line_number(file_path)
            context += "Please answer the question based on the above context.\n"


        print(f"Session ID: {req.session_id}")
        print(f"Query: {req.query}")
        print(f"Code: {req.code}")
        print(f"Diagram: {req.diagram}")
        print(f"Context Files: {req.context_files}")
        print(f"Context: {context}")
        answer, highlight = await generate_chatbot_answer_with_session(
            req.session_id, req.query + context, req.code, req.diagram
        )
        print(f"Answer: {answer}")
        print(f"Highlight: {highlight}")
        return ChatbotQueryResponse(answer=answer, highlight=highlight)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.get("/api/chatbot/session/get_history")
async def api_get_session_history(session_id: str):
    try:
        if not session_id:
            raise HTTPException(status_code=400, detail="Session ID is required")
        history = get_session_history(session_id)
        return {"session_id": session_id, "history": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
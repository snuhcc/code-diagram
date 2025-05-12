from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from pathlib import Path
from schemas.common import DiagramRequest, DiagramResponse
from llm.client import generate_control_flow_graph
import json

# .env file loading
load_dotenv()

# FastAPI app initialization
app = FastAPI(title="Code-Diagram API")

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

@app.post("/api/generate_control_flow_graph", response_model=DiagramResponse)
async def api_generate_control_flow_graph(request: DiagramRequest):
    """
    Generate a control flow graph (CFG) for the given code.
    """
    try:

        json_data = await generate_control_flow_graph(request.path, request.file_type)
        result = {
            # "status": 0, # Success
            "data": json_data
        }
        print(result)
        return DiagramResponse(**result)
    except Exception as e:
        return DiagramResponse(status=500, data=str(e))
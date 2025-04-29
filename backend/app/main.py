from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from pathlib import Path


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
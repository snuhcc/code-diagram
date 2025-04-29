from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv


# .env file loading
load_dotenv()

# FastAPI app initialization
app = FastAPI(title="Code-Diagram API")


# API Endpoint
@app.get("/", response_class=HTMLResponse)
async def root():
    html_content = """
    <html>
        <head>
            <title>Code-Diagram API</title>
        </head>
        <body>
            <h1>Welcome to the Code-Diagram API</h1>
            <p>This API provides endpoints for generating and interacting with code diagrams.</p>

            <h2>Useful Links:</h2>
            <ul>
                <li><a href="/docs">Swagger UI</a> - Interactive API documentation</li>
                <li><a href="/redoc">ReDoc</a> - Static API documentation</li>
            </ul>
            
            <p>API Version: 0.0.1</p>
            <p>For more information or support, contact: <a href="mailto:artechne@snu.ac.kr">artechne@snu.ac.kr</a></p>
        </body>
    </html>
    """

    return html_content
from pydantic import BaseModel
from typing import Optional
import os

backend_root_dir = os.getcwd()
poc_path = os.path.join(backend_root_dir, "../..", "poc")

# 요청 모델 정의
class CGDiagramRequest(BaseModel):
    path: str = poc_path #Local File Absolute Path or Github URL
    file_type: Optional[str] = None #File Type to render CFG

# 응답 모델 정의
class CGDiagramResponse(BaseModel):
    data: str #Json Str Format or Error Message

class CFGDiagramRequest(BaseModel):
    file_path: str  # 파일 이름
    function_name: str # 함수 이름

class CFGDiagramResponse(BaseModel):
    data: str  # JSON 문자열 형식의 제어 흐름 그래프 데이터

# 세션 요청 모델 정의
class SessionRequest(BaseModel):
    session_id: str

# 세션 응답 모델 정의
class SessionResponse(BaseModel):
    session_id: str

# 챗봇 쿼리 요청 모델
class ChatbotQueryRequest(BaseModel):
    session_id: str # 세션 ID
    query: str  # 사용자의 자연어 질문
    code: Optional[str] = None # 사용자가 탐색하고자 하는 코드 블락 
    diagram: Optional[str] = None # 관련 다이어그램 정보 (json string 등)
    context_files: Optional[list] = [] # 관련 파일 목록 (예: 코드 파일 경로들)]
    
# 챗봇 응답 모델
class ChatbotQueryResponse(BaseModel):
    answer: str  # 챗봇의 자연어 답변
    # 아직 아래는 어떻게 처리할지 모르겟음, 
    highlight: Optional[list] = None  # 강조할 코드/다이어그램 부분 (예: 라인 번호, 노드 id 등)

# Inline Code Explanation 요청 모델
class InlineCodeExplanationRequest(BaseModel):
    file_path: str  # 파일 경로
    line_start: int  # 시작 라인 번호
    line_end: int  # 끝 라인 번호
    context: Optional[str] = None  # 추가적인 컨텍스트 정보 (예: 함수 설명, 변수 설명 등)
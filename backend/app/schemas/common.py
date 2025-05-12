from pydantic import BaseModel
from typing import Optional
import os

backend_root_dir = os.getcwd()
poc_path = os.path.join(backend_root_dir, "../..", "poc")

# 요청 모델 정의
class DiagramRequest(BaseModel):
    path: str = poc_path #Local File Absolute Path or Github URL
    file_type: Optional[str] = None #File Type to render CFG

# 응답 모델 정의
class DiagramResponse(BaseModel):
    data: str #Json Str Format or Error Message
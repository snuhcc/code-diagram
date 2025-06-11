import os

OPENAI_O3 = "o3-2025-04-16"
OPENAI_O4_MINI = "o4-mini-2025-04-16"
OPENAI_GPT_4_1 = "gpt-4.1-2025-04-14"
BACKEND_ROOT_DIR = os.getcwd()
WORKSPACE_ROOT_DIR = os.path.join(BACKEND_ROOT_DIR, "..", "..")
ARTIFACTS_REPO_PROMPT_TXT = os.path.join(BACKEND_ROOT_DIR, "artifacts", "repo_prompt.txt")
CG_JSON_OUTPUT = os.path.join(BACKEND_ROOT_DIR, "artifacts", "cg_json_output_all.json")

SAMPLE_CFG_JSON = os.path.join(BACKEND_ROOT_DIR, "artifacts", "cfg_main.py_func_main.json")
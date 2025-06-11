import os
import glob
import traceback
import json

# 프로젝트 루트의 poc 디렉토리 경로
POC_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'poc'))

STUDY_1_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'study_1'))

SEPARATOR = "-------------------------------------------------------------------"

def get_all_source_files(directory: str, file_type: str = "py"):
    """
    Recursively collect all source files in the directory.
    If file_type is specified, filter by extension (e.g., 'py').
    __init__.py 등 특정 파일은 제외한다.
    """

    pattern = f"**/*.{file_type}" if file_type else "**/*"
    files = [f for f in glob.glob(os.path.join(directory, pattern), recursive=True) if os.path.isfile(f)]
    # __init__.py 등 제외
    files = [f for f in files if os.path.basename(f) != "__init__.py"]
    return files

def get_source_file_with_line_number(file_path: str):
    """
    Get the source file content with line numbers.
    Returns a string with line numbers prepended to each line.
    """
    # file_path = os.path.join(POC_ROOT, file_path)
    file_path = os.path.join(STUDY_1_ROOT, file_path)
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    
    file_context = ""
    try:
        with open(file_path, 'r') as f:
            lines = f.readlines()
            numbered_lines = [
                f"{i+1:4}: {line.rstrip()}" for i, line in enumerate(lines)
            ]
            file_context += f"\n\nFile: {file_path}\n" + f"{SEPARATOR}\n" + "\n".join(numbered_lines) + "\n"
    except Exception as e:
        file_context += f"\n\nFile: {file_path}\n{SEPARATOR}\n(Error: {str(e)})"

    return file_context

def extract_specific_code_from_file_with_line_numbers(file_path: str, line_start: int, line_end: int) -> str:
    """
    Extract specific lines from a file with line numbers.
    Raises FileNotFoundError if the file does not exist.
    Raises ValueError if the specified lines are out of range.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    
    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    if line_start < 1 or line_end > len(lines) or line_start > line_end:
        raise ValueError(f"Invalid line range: {line_start}-{line_end} for file '{file_path}'")
    
    extracted_code = ""
    for idx in range(line_start - 1, line_end):
        extracted_code += f"{idx + 1:4}: {lines[idx]}"
    
    return extracted_code

def extract_function_code_from_file_with_line_numbers(file_path: str, function_name: str) -> str:
    """
    Extract the source code of a function with the given name from the specified file,
    including original line numbers.
    Raises FileNotFoundError or ValueError if not found.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    with open(file_path, "r", encoding="utf-8") as f:
        code = f.read()
    lines = code.splitlines()
    function_code = ""
    in_function = False
    func_indent = None
    start_line = None
    for idx, line in enumerate(lines):
        stripped = line.lstrip()
        if stripped.startswith(f"def {function_name}("):
            in_function = True
            func_indent = len(line) - len(stripped)
            start_line = idx
            function_code += f"{idx+1:4}: {line}\n"
            continue
        if in_function:
            # Check for end of function by indentation
            if line.strip() == "":
                function_code += f"{idx+1:4}: {line}\n"
                continue
            curr_indent = len(line) - len(line.lstrip())
            if curr_indent > func_indent:
                function_code += f"{idx+1:4}: {line}\n"
            else:
                break
    if not function_code:
        raise ValueError(f"Function '{function_name}' not found in file '{file_path}'")
    return function_code

def log_exception(e: Exception, function_name: str, extra_info: str = ""):
    error_trace = traceback.format_exc()
    print(f"Error in function '{function_name}'{extra_info}: {e}")
    print("Full traceback:")
    print(error_trace)

def extract_json_from_response(text: str) -> dict:
    """
    Extract and parse JSON object from LLM response text.
    Handles ```json ... ``` blocks and parses the JSON.
    Raises ValueError if parsing fails.
    """
    text = text.strip()
    if text.startswith("```json"):
        text = text[len("```json"):].strip()
        if text.endswith("```"):
            text = text[:-3].strip()
    if not text:
        raise ValueError("LLM 응답이 비어 있습니다.")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        print("LLM 응답:", text)
        raise ValueError(f"LLM 응답이 올바른 JSON이 아닙니다: {e}")

def save_json_and_return_str(obj, output_path: str) -> str:
    """
    Save the given object as JSON to the specified path and return its JSON string.
    """
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=4, ensure_ascii=False)
        results_str = json.dumps(obj, indent=4, ensure_ascii=False)
    return results_str
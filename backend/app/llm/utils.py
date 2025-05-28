import os
import glob

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
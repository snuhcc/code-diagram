import os
import hashlib
from typing import Optional, AsyncGenerator, Dict, Tuple
from llm.constants import OPENAI_GPT_4_1, WORKSPACE_ROOT_DIR
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate
from llm.prompt_util import *
from llm.utils import get_source_file_with_line_number

# In-memory cache for inline code explanations
_explanation_cache: Dict[str, str] = {}

def _generate_cache_key(file_path: str, line_start: int, line_end: int, level: int) -> str:
    """Generate a unique cache key based on file_path, line_start, line_end, and level."""
    # Create a hash from the parameters to ensure uniqueness
    key_string = f"{file_path}:{line_start}:{line_end}:{level}"
    return hashlib.md5(key_string.encode()).hexdigest()

async def generate_inline_code_explanation(file_path: str, line_start: int, line_end: int, explanation_level: int = 5
):
    """
    Generate inline code explanation for a given file and line range."""
    
    # Generate cache key
    cache_key = _generate_cache_key(file_path, line_start, line_end, explanation_level)
    
    # Check if result is already in cache
    if cache_key in _explanation_cache:
        print(f"Cache hit for file: {file_path}, lines: {line_start}-{line_end}, level: {explanation_level}")
        return _explanation_cache[cache_key]

    llm = ChatOpenAI(
        model=OPENAI_GPT_4_1,
        temperature=0.0,
        max_retries=2
    )

    chat_prompt = ChatPromptTemplate.from_messages(
        [
            SystemMessagePromptTemplate.from_template("YOU ARE A SOFTWARE ENGINEERING EXPERT. You are given a Python code snippet. Please generate an inline code explanation for the provided code."),
            HumanMessagePromptTemplate.from_template(PROMPT_INLINE_CODE_EXPLANATION),
        ]
    )
    file_path = os.path.join(WORKSPACE_ROOT_DIR, file_path)
    print(f"Generating inline code explanation for file: {file_path}, lines: {line_start}-{line_end}, level: {explanation_level}")
    code_snippet = get_source_file_with_line_number(file_path)
    print(code_snippet)

    messages = chat_prompt.format_messages(
        code_snippet=code_snippet,
        line_start=line_start,
        line_end=line_end,
        explanation_level=explanation_level,
    )

    response = await llm.ainvoke(messages)
    print(f"Response: {response}")
    # Extract and return only the 'content' field from the response
    if not response or not hasattr(response, "content"):
        raise ValueError("Invalid response from LLM")
    
    # Cache the result
    result = response.content
    _explanation_cache[cache_key] = result
    print(f"Cached result for key: {cache_key}")
    
    return result

async def generate_inline_code_explanation_stream(file_path: str, line_start: int, line_end: int, explanation_level: int = 5
) -> AsyncGenerator[str, None]:
    """
    Generate inline code explanation for a given file and line range with streaming response."""
    
    # Generate cache key
    cache_key = _generate_cache_key(file_path, line_start, line_end, explanation_level)
    
    # Check if result is already in cache
    if cache_key in _explanation_cache:
        print(f"Cache hit for streaming request - file: {file_path}, lines: {line_start}-{line_end}, level: {explanation_level}")
        yield _explanation_cache[cache_key]
        return

    llm = ChatOpenAI(
        model=OPENAI_GPT_4_1,
        temperature=0.0,
        max_retries=2,
        streaming=True  # Enable streaming
    )

    chat_prompt = ChatPromptTemplate.from_messages(
        [
            SystemMessagePromptTemplate.from_template("YOU ARE A SOFTWARE ENGINEERING EXPERT. You are given a Python code snippet. Please generate an inline code explanation for the provided code."),
            HumanMessagePromptTemplate.from_template(PROMPT_INLINE_CODE_EXPLANATION),
        ]
    )
    file_path = os.path.join(WORKSPACE_ROOT_DIR, file_path)
    print(f"Generating streaming inline code explanation for file: {file_path}, lines: {line_start}-{line_end}, level: {explanation_level}")
    code_snippet = get_source_file_with_line_number(file_path)

    messages = chat_prompt.format_messages(
        code_snippet=code_snippet,
        line_start=line_start,
        line_end=line_end,
        explanation_level=explanation_level,
    )
    
    # Collect streaming response and cache it
    full_response = ""
    async for chunk in llm.astream(messages):
        if chunk.content:
            full_response += chunk.content
            yield chunk.content
    
    # Cache the complete response
    if full_response:
        _explanation_cache[cache_key] = full_response
        print(f"Cached streaming result for key: {cache_key}")

def clear_explanation_cache():
    """Clear all cached explanations."""
    global _explanation_cache
    _explanation_cache.clear()
    print("Explanation cache cleared")

def get_cache_size() -> int:
    """Get the current number of cached explanations."""
    return len(_explanation_cache)

def get_cache_info() -> Dict[str, int]:
    """Get information about the cache."""
    return {
        "cache_size": len(_explanation_cache),
        "total_entries": len(_explanation_cache)
    }
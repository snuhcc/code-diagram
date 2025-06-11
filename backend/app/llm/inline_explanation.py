import os
from typing import Optional
from llm.constants import OPENAI_GPT_4_1, OPENAI_GPT_4_1_MINI, WORKSPACE_ROOT_DIR
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate
from llm.prompt_util import *
from llm.utils import get_source_file_with_line_number

async def generate_inline_code_explanation(file_path: str, line_start: int, line_end: int, context: Optional[str] = None
):
    """
    Generate inline code explanation for a given file and line range."""

    llm = ChatOpenAI(
        model=OPENAI_GPT_4_1_MINI,
        temperature=0.1,
        max_retries=2
    )

    chat_prompt = ChatPromptTemplate.from_messages(
        [
            SystemMessagePromptTemplate.from_template("YOU ARE A SOFTWARE ENGINEERING EXPERT. You are given a Python code snippet. Please generate an inline code explanation for the provided code."),
            HumanMessagePromptTemplate.from_template(PROMPT_INLINE_CODE_EXPLANATION),
        ]
    )
    file_path = os.path.join(WORKSPACE_ROOT_DIR, file_path)
    code_snippet = get_source_file_with_line_number(file_path)

    print(code_snippet)

    messages = chat_prompt.format_messages(
        code_snippet=code_snippet,
        line_start=line_start,
        line_end=line_end,
    )
    

    response = await llm.ainvoke(messages)
    print(f"Response: {response}")
    # Extract and return only the 'content' field from the response
    if not response or not hasattr(response, "content"):
        raise ValueError("Invalid response from LLM")
    return response.content
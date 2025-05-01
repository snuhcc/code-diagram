# Test

import streamlit as st
from dotenv import load_dotenv
import os
from streamlit_elements import elements, dashboard, editor, mui, html
from streamlit_file_browser import st_file_browser

# Load environment variables
load_dotenv()

# Configurations
st.set_page_config(
    page_title="Code-Diagram",
    page_icon=":bar_chart:",
    layout="wide",
    initial_sidebar_state="collapsed",
)

with elements("dashboard"):
    layout = [
        dashboard.Item("explorer", x=0, y=0, w=2, h=10),
        dashboard.Item("editor", x=2, y=0, w=10, h=10),
        dashboard.Item("diagram", x=0, y=10, w=12, h=10),
        dashboard.Item("chat", x=0, y=20, w=12, h=10)
    ]

    with dashboard.Grid(layout):
        
        # with elements("explorer"):
        #     current_dir = os.getcwd()
        #     event = st_file_browser(os.path.join(current_dir, "..", "poc"),
        #                             key="explorer")
            
        # # mui.Paper("Explorer", key="explorer")
        # with elements("editor"):
        #     editor.Monaco(
        #         width="100%",
        #         height="100%",
        #         defaultValue="// Write your code here...",
        #         language="python",
        #         LineNumbersType="on",
        #         theme="vs-dark",
        #         minimap={
        #             "enabled": True,
        #             "showSlider": "always",
        #             "scale": 5,
        #             "size": "fill",
        #             "side": "right",
        #         },
        #         options={"fontSize": 14, "wordWrap": "on", "automaticLayout": True},
        #         key="editor",
        #     )
        # mui.Paper("Diagram", key="diagram")
        # mui.Paper("Chat", key="chat")

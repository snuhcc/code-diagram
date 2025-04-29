# File: poc/main.py
from fetcher import fetch_data
from processor import process_data
from analyzer import analyze_data
from reporter import generate_report

def main():
    try:
        data = fetch_data()
        processed = process_data(data)
        analysis = analyze_data(processed)
        generate_report(analysis)
    except Exception as e:
        print(f"Error in workflow: {e}")

if __name__ == "__main__":
    main()
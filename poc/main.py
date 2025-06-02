# File: poc/main.py
from fetcher import fetch_data
from processor import process_data
from analyzer import analyze_data
from reporter import generate_report
import validator
import transformer
import filterer
import aggregator

def main():
    try:
        data = fetch_data()
        print("Select operation:")
        print("1: Basic processing")
        print("2: Validate → Process → Analyze → Aggregate")
        print("3: Filter even → Process → Analyze")
        print("4: Special transform → Analyze")
        choice = input("Enter choice: ").strip()

        if choice == '1':
            # basic pipeline
            processed = process_data(data)
            analysis = analyze_data(processed)
            generate_report(analysis)
        elif choice == '2':
            # validation + aggregation
            valid = validator.validate_data(data)
            processed = process_data(valid)
            analysis = analyze_data(processed)
            aggregated = aggregator.aggregate_data(analysis)
            generate_report(aggregated)
        elif choice == '3':
            # filter evens first
            filtered = filterer.filter_even(data)
            processed = process_data(filtered)
            analysis = analyze_data(processed)
            generate_report(analysis)
        elif choice == '4':
            # special transform path
            special = transformer.transform_special(data)
            analysis = analyze_data(special)
            generate_report(analysis)
        else:
            print("Invalid choice.")
    except Exception as e:
        print(f"Error in workflow: {e}")

if __name__ == "__main__":
    main()
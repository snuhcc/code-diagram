# File: poc/processor.py
def process_data(data):
    print("Processing data...")
    result = []
    for num in data:
        if num % 2 == 0:
            transformed = num / 2
        else:
            transformed = num * 3 + 1
        result.append(transformed)
    print("Data processed")
    return result

# File: poc/processor.py

def process_data(data):
    print("Processing data with branching handlers...")
    result = []
    for num in data:
        if num % 3 == 0:
            transformed = handle_div3(num)
        elif num % 2 == 0:
            transformed = handle_even(num)
        else:
            transformed = handle_other(num)
        result.append(transformed)
    print("Data processed with branching handlers")
    return result

def handle_div3(num):
    print(f"Handling {num}: divisible by 3")
    return num // 3

def handle_even(num):
    print(f"Handling {num}: even number")
    return num / 2

def handle_other(num):
    print(f"Handling {num}: other case")
    return num * 3 + 1
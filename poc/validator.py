def validate_data(data):
    print("Validating data...")
    valid = [num for num in data if isinstance(num, int)]
    print(f"{len(valid)}/{len(data)} items valid")
    cleaned = remove_negatives(valid)
    final = check_range(cleaned, 0, 100)
    return final

def remove_negatives(data):
    print("Removing negatives...")
    return [x for x in data if x >= 0]

def check_range(data, min_v, max_v):
    print(f"Checking range {min_v}–{max_v}...")
    return [x for x in data if min_v <= x <= max_v]

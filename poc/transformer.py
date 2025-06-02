from processor import process_data

def transform_special(data):
    print("Transforming special data via process_data")
    norm = normalize(data)
    processed = process_data(norm)
    scaled = scale(processed, factor=10)
    return scaled

def normalize(data):
    print("Normalizing data...")
    mx = max(data) if data else 1
    return [x / mx for x in data]

def scale(data, factor):
    print(f"Scaling data by {factor}...")
    return [x * factor for x in data]

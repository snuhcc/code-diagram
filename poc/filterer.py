def filter_even(data):
    print("Filtering even numbers...")
    evens = remove_odd(data)
    return filter_gt(evens, 10)

def remove_odd(data):
    print("Removing odd numbers...")
    return [x for x in data if x % 2 == 0]

def filter_gt(data, threshold):
    print(f"Filtering > {threshold}...")
    return [x for x in data if x > threshold]

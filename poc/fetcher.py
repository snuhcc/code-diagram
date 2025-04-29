# File: poc/fetcher.py
import random

def fetch_data(retries=3):
    for attempt in range(1, retries+1):
        print(f"Attempt {attempt} to fetch data")
        if random.random() < 0.7:
            data = [random.randint(1, 100) for _ in range(10)]
            print("Data fetched successfully")
            return data
        else:
            print("Fetch failed, retrying...")
    raise ConnectionError("Failed to fetch data after 3 attempts")
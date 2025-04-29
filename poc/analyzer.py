# File: poc/analyzer.py
from statistics import mean, median

def analyze_data(data):
    print("Analyzing data...")
    avg = mean(data)
    med = median(data)
    high = [x for x in data if x > avg]
    low = [x for x in data if x <= avg]
    print("Data analysis complete")
    return {
        "average": avg,
        "median": med,
        "high_values": high,
        "low_values": low
    }
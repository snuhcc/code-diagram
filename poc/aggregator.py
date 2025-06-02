def aggregate_data(data):
    print("Aggregating data...")
    stats = {
        "count": len(data),
        "sum": sum(data),
        "max": max(data) if data else None,
        "min": min(data) if data else None
    }
    stats["avg"] = compute_average(data)
    print(format_summary(stats))
    return stats

def compute_average(data):
    print("Computing average...")
    return sum(data) / len(data) if data else 0

def format_summary(stats):
    print("Formatting summary...")
    return f"Count: {stats['count']}, Sum: {stats['sum']}, Avg: {stats['avg']:.2f}"

# File: poc/reporter.py
def generate_report(analysis):
    print("Generating report...")
    avg = analysis["average"]
    med = analysis["median"]
    high = analysis["high_values"]
    low = analysis["low_values"]

    print("---- Report ----")
    print(f"Average: {avg:.2f}")
    print(f"Median: {med:.2f}")
    print("High values count:", len(high))
    print("Low values count:", len(low))

    if len(high) > len(low):
        print("More high values than low values.")
    elif len(high) < len(low):
        print("More low values than high values.")
    else:
        print("High and low values are equal in count.")
    print("----------------")
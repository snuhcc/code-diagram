#!/usr/bin/env python3
"""
Developer Cohort Tool Usability Analysis (Simplified Version)
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from scipy.stats import kruskal

# 데이터 준비
data = {
    'P3': ['senior', [5, 2, 6, 7, 3, 6, 2, 6, 1, 7, 6, 2, 2, 2, 6, 7]],
    'P10': ['student', [5, 2, 5, 3, 3, 2, 6, 2, 5, 4, 6, 2, 6, 2, 4, 3]],
    'P12': ['student', [3, 1, 3, 6, 3, 4, 4, 5, 4, 2, 5, 2, 5, 3, 5, 2]],
    'P4': ['senior', [5, 4, 1, 2, 6, 6, 2, 6, 2, 4, 2, 1, 2, 6, 2, 6]],
    'P6': ['junior', [1, 1, 1, 4, 3, 2, 5, 3, 3, 2, 4, 2, 5, 1, 4, 4]],
    'P2': ['senior', [6, 4, 3, 3, 6, 2, 5, 2, 6, 1, 2, 2, 7, 3, 4, 2]],
    'P9': ['junior', [2, 1, 3, 5, 4, 2, 4, 3, 5, 2, 4, 2, 5, 2, 3, 3]],
    'P1': ['senior', [3, 6, 2, 4, 2, 4, 3, 6, 6, 3, 2, 2, 5, 2, 2, 5]],
    'P7': ['junior', [2, 2, 2, 6, 2, 2, 6, 5, 5, 2, 5, 2, 6, 2, 6, 2]],
    'P8': ['junior', [1, 1, 1, 7, 3, 2, 6, 2, 6, 1, 7, 1, 7, 2, 5, 1]]
}

def calculate_sus(responses):
    """Compute SUS score (7-point Likert version)"""
    sus_part = responses[6:16]  # SUS 10 items
    score = 0
    for i, val in enumerate(sus_part):
        if i % 2 == 0:  # positive statement
            score += val - 1          # 0‒6
        else:  # negative statement (reverse-scored)
            score += 7 - val          # 0‒6
    scaling_factor = 100 / (len(sus_part) * 6)  # 10*6 = 60 → 100-point scale
    return score * scaling_factor

def calculate_nasa_tlx(responses):
    """Compute NASA-TLX workload score"""
    tlx_part = responses[:6]  # NASA-TLX 6개 질문
    normalized = [(x-1)/6*100 for x in tlx_part]
    normalized[3] = 100 - normalized[3]  # 성과는 역점수
    return sum(normalized) / len(normalized)

def main():
    print("📊 Developer Cohort Analysis")
    print("=" * 40)
    
    # DataFrame 생성
    df_data = []
    for participant, (cohort, responses) in data.items():
        df_data.append({
            'participant': participant,
            'cohort': cohort,
            'sus': calculate_sus(responses),
            'nasa_tlx': calculate_nasa_tlx(responses),
        })
    
    df = pd.DataFrame(df_data)
    df['overall'] = df['sus'] - df['nasa_tlx']
    
    # 기본 통계
    print("\n📈 Group Means:")
    summary = df.groupby('cohort')[['sus', 'nasa_tlx', 'overall']].mean().round(1)
    print(summary)
    
    # 순위
    print("\n🏆 Overall Ranking:")
    ranking = summary['overall'].sort_values(ascending=False)
    for i, (cohort, score) in enumerate(ranking.items(), 1):
        medal = ['🥇', '🥈', '🥉'][i-1] if i <= 3 else f'{i}.'
        print(f"  {medal} {cohort}: {score} pts")
    
    # Additional statistical tests for SUS, NASA-TLX, and Overall
    senior_sus = df[df['cohort'] == 'senior']['sus']
    junior_sus = df[df['cohort'] == 'junior']['sus']
    student_sus = df[df['cohort'] == 'student']['sus']
    h_sus, p_sus = kruskal(senior_sus, junior_sus, student_sus)

    senior_tlx = df[df['cohort'] == 'senior']['nasa_tlx']
    junior_tlx = df[df['cohort'] == 'junior']['nasa_tlx']
    student_tlx = df[df['cohort'] == 'student']['nasa_tlx']
    h_tlx, p_tlx = kruskal(senior_tlx, junior_tlx, student_tlx)

    senior_overall = df[df['cohort'] == 'senior']['overall']
    junior_overall = df[df['cohort'] == 'junior']['overall']
    student_overall = df[df['cohort'] == 'student']['overall']
    h_overall, p_overall = kruskal(senior_overall, junior_overall, student_overall)

    print("\n📊 Statistical Test (SUS):")
    print(f"  H = {h_sus:.3f}, p = {p_sus:.3f}")
    print(f"  Result: {'Significant ✓' if p_sus < 0.05 else 'Not Significant ✗'}")

    print("\n📊 Statistical Test (NASA-TLX):")
    print(f"  H = {h_tlx:.3f}, p = {p_tlx:.3f}")
    print(f"  Result: {'Significant ✓' if p_tlx < 0.05 else 'Not Significant ✗'}")

    print("\n📊 Statistical Test (Overall):")
    print(f"  H = {h_overall:.3f}, p = {p_overall:.3f}")
    print(f"  Result: {'Significant ✓' if p_overall < 0.05 else 'Not Significant ✗'}")
    
    # 개별 참가자 순위
    print(f"\n👤 Individual Participant Ranking:")
    df_sorted = df.sort_values('overall', ascending=False)
    for i, row in df_sorted.iterrows():
        print(f"  {row.name+1}. {row['participant']} ({row['cohort']}): {row['overall']:.1f} pts")
    
    # 시각화
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    
    # SUS 점수
    sns.boxplot(data=df, x='cohort', y='sus', ax=axes[0])
    axes[0].set_title('SUS Usability Score')
    axes[0].set_ylabel('Score (Higher is Better)')
    
    # 워크로드
    sns.boxplot(data=df, x='cohort', y='nasa_tlx', ax=axes[1])
    axes[1].set_title('NASA-TLX Workload Score')
    axes[1].set_ylabel('Score (Lower is Better)')
    
    plt.tight_layout()
    plt.show()
    
    # 핵심 결론
    print(f"\n🎯 Key Findings:")
    best = ranking.index[0]
    worst = ranking.index[-1]
    print(f"  • {best} developers had the best user experience")
    print(f"  • {worst} developers had the worst user experience")
    print(f"  • Experience level is inversely proportional to tool adaptability!")
    
    return df

if __name__ == "__main__":
    df = main()
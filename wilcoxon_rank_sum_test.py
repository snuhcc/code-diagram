#!/usr/bin/env python3
"""
Developer Cohort Tool Usability Analysis - Wilcoxon Rank-Sum Test Version
Groups: student/junior vs senior
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from scipy.stats import ranksums

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
    print("📊 Developer Cohort Analysis - Wilcoxon Rank-Sum Test")
    print("=" * 50)
    
    # DataFrame 생성
    df_data = []
    for participant, (cohort, responses) in data.items():
        # student와 junior를 하나의 그룹으로 통합
        group = 'student/junior' if cohort in ['student', 'junior'] else 'senior'
        df_data.append({
            'participant': participant,
            'original_cohort': cohort,
            'group': group,
            'sus': calculate_sus(responses),
            'nasa_tlx': calculate_nasa_tlx(responses),
        })
    
    df = pd.DataFrame(df_data)
    
    # 기본 통계
    print("\n📈 Group Statistics:")
    print("Mean values:")
    summary_mean = df.groupby('group')[['sus', 'nasa_tlx']].mean().round(1)
    print(summary_mean)
    
    print("\nStandard Deviation values:")
    summary_std = df.groupby('group')[['sus', 'nasa_tlx']].std().round(2)
    print(summary_std)
    
    print("\n📊 Group Counts:")
    group_counts = df.groupby('group').size()
    for group, count in group_counts.items():
        print(f"  {group}: {count} participants")
    
    # 그룹별 데이터 분리
    student_junior_sus = df[df['group'] == 'student/junior']['sus']
    senior_sus = df[df['group'] == 'senior']['sus']
    
    student_junior_tlx = df[df['group'] == 'student/junior']['nasa_tlx']
    senior_tlx = df[df['group'] == 'senior']['nasa_tlx']
    
    # Wilcoxon Rank-Sum Test (Mann-Whitney U test)
    print("\n📊 Wilcoxon Rank-Sum Test Results:")
    print("-" * 35)
    
    # SUS 점수 비교
    stat_sus, p_sus = ranksums(student_junior_sus, senior_sus)
    print(f"\n🎯 SUS Usability Score:")
    print(f"  Student/Junior: mean={student_junior_sus.mean():.1f}, std={student_junior_sus.std():.2f}")
    print(f"  Senior: mean={senior_sus.mean():.1f}, std={senior_sus.std():.2f}")
    print(f"  Z-statistic: {stat_sus:.3f}")
    print(f"  p-value: {p_sus:.3f}")
    print(f"  Result: {'Significant ✓' if p_sus < 0.05 else 'Not Significant ✗'}")
    if p_sus < 0.05:
        winner = 'Student/Junior' if student_junior_sus.mean() > senior_sus.mean() else 'Senior'
        print(f"  Winner: {winner} group has significantly higher SUS scores")
    
    # NASA-TLX 점수 비교
    stat_tlx, p_tlx = ranksums(student_junior_tlx, senior_tlx)
    print(f"\n💪 NASA-TLX Workload Score:")
    print(f"  Student/Junior: mean={student_junior_tlx.mean():.1f}, std={student_junior_tlx.std():.2f}")
    print(f"  Senior: mean={senior_tlx.mean():.1f}, std={senior_tlx.std():.2f}")
    print(f"  Z-statistic: {stat_tlx:.3f}")
    print(f"  p-value: {p_tlx:.3f}")
    print(f"  Result: {'Significant ✓' if p_tlx < 0.05 else 'Not Significant ✗'}")
    if p_tlx < 0.05:
        winner = 'Student/Junior' if student_junior_tlx.mean() < senior_tlx.mean() else 'Senior'
        print(f"  Winner: {winner} group has significantly lower workload")
    
    # 개별 참가자 상세 정보
    print(f"\n👤 Individual Participant Details:")
    df_sorted = df.sort_values('sus', ascending=False)  # SUS 점수로 정렬
    for i, row in df_sorted.iterrows():
        emoji = "🎓" if row['group'] == 'student/junior' else "👔"
        print(f"  {i+1}. {row['participant']} {emoji} ({row['original_cohort']}) - SUS: {row['sus']:.1f}, NASA-TLX: {row['nasa_tlx']:.1f}")
    
    # 시각화
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    
    # SUS 점수
    sns.boxplot(data=df, x='group', y='sus', ax=axes[0])
    axes[0].set_title('SUS Usability Score')
    axes[0].set_ylabel('Score (Higher is Better)')
    axes[0].tick_params(axis='x', rotation=45)
    
    # NASA-TLX 워크로드
    sns.boxplot(data=df, x='group', y='nasa_tlx', ax=axes[1])
    axes[1].set_title('NASA-TLX Workload Score')
    axes[1].set_ylabel('Score (Lower is Better)')
    axes[1].tick_params(axis='x', rotation=45)
    
    plt.tight_layout()
    plt.show()
    
    # 핵심 결론
    print(f"\n🎯 Key Findings:")
    
    # SUS 기반 결론
    sus_better = 'Student/Junior' if student_junior_sus.mean() > senior_sus.mean() else 'Senior'
    sus_worse = 'Senior' if sus_better == 'Student/Junior' else 'Student/Junior'
    print(f"  • Usability (SUS): {sus_better} group had better usability scores")
    
    # NASA-TLX 기반 결론
    tlx_better = 'Student/Junior' if student_junior_tlx.mean() < senior_tlx.mean() else 'Senior'
    tlx_worse = 'Senior' if tlx_better == 'Student/Junior' else 'Student/Junior'
    print(f"  • Workload (NASA-TLX): {tlx_better} group had lower workload")
    
    # 통계적 유의성
    if p_sus < 0.05:
        print(f"  • SUS difference is statistically significant (p={p_sus:.3f})")
    else:
        print(f"  • SUS difference is not statistically significant (p={p_sus:.3f})")
        
    if p_tlx < 0.05:
        print(f"  • NASA-TLX difference is statistically significant (p={p_tlx:.3f})")
    else:
        print(f"  • NASA-TLX difference is not statistically significant (p={p_tlx:.3f})")
    
    return df

if __name__ == "__main__":
    df = main()

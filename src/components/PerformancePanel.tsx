type DailyStat = {
  overall_grade: number;
};

export const calculateGrowth = (stats: DailyStat[]) => {
  if (stats.length < 2) return 0;
  const today = stats[stats.length - 1].overall_grade;
  const yesterday = stats[stats.length - 2].overall_grade;
  return today - yesterday; // Masalan: 55 - 51 = 4
};

type PerformancePanelProps = {
  dailyStats: DailyStat[];
};

export default function PerformancePanel({ dailyStats }: PerformancePanelProps) {
  const growth = calculateGrowth(dailyStats);

  return (
    <section>
      <p>Growth: {growth}%</p>
    </section>
  );
}

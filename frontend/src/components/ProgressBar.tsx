export function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="progress">
      <div className="progress-track">
        <div
          className={`progress-fill${pct >= 100 ? " done" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="progress-label mono">{pct}%</span>
    </div>
  );
}

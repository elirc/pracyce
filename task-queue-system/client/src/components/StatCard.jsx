function StatCard({ title, value, tone = 'default' }) {
  return (
    <article className={`stat-card tone-${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

export default StatCard;
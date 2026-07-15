export default function Loading() {
  return (
    <div aria-label="Loading page" className="skeleton-layout" role="status">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-copy" />
      <div className="metric-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="skeleton skeleton-card" key={index} />
        ))}
      </div>
    </div>
  );
}

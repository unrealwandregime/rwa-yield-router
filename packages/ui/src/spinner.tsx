export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span aria-label={label} className="spinner" role="status" />;
}

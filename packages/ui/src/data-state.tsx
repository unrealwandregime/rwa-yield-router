import type { ReactNode } from "react";

export function DataState({
  action,
  description,
  eyebrow = "Data state",
  title
}: {
  action?: ReactNode;
  description: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <section className="data-state" role="status">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}

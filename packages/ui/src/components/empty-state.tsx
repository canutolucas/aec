import type { ReactNode } from "react";

/** An empty state that says what to do next, instead of just that there's nothing. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

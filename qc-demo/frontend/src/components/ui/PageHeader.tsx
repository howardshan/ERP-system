export function PageHeader({
  title,
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  if (!title && !description && !action) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
      <div>
        {title && <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>}
        {description && <p className="text-sm text-slate-600 mt-1 max-w-2xl">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

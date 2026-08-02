/** Colour tone for a workload/site status string. */
export function statusTone(status: string): "ok" | "error" | "warn" | "muted" {
  if (status === "Ready") return "ok";
  if (status === "Failed" || status === "Degraded") return "error";
  if (
    status === "Building" ||
    status === "Deploying" ||
    status === "Pending" ||
    status === "Terminating"
  )
    return "warn";
  return "muted";
}

/** A coloured status chip shared by the workload list and the detail view. */
export default function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill--${statusTone(status)}`}>{status}</span>;
}

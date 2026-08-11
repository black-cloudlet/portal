/**
 * Colour tone for a workload/region status string. The vocabulary is the API's
 * closed, Kubernetes-phase-style set (Pending | Building | Deploying | Ready |
 * Failed | Terminating, plus per-region Timeout) published on /info `statuses`;
 * anything unrecognized renders muted rather than breaking.
 */
export function statusTone(status: string): "ok" | "error" | "warn" | "muted" {
  if (status === "Ready") return "ok";
  if (status === "Failed") return "error";
  if (
    status === "Building" ||
    status === "Deploying" ||
    status === "Pending" ||
    status === "Terminating" ||
    status === "Timeout"
  )
    return "warn";
  return "muted";
}

/** A coloured status chip shared by the workload list and the detail view. */
export default function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill--${statusTone(status)}`}>{status}</span>;
}

/**
 * The machine-readable cause behind a Failed status (BuildFailed,
 * ImagePullFailed, CrashLooping, ...). The set on /info `statuses.reasons` is
 * additive, so any string renders as-is. `detail` (the paired human-readable
 * `message`, where the response carries one) becomes a hover tooltip.
 */
export function ReasonChip({
  reason,
  detail,
}: {
  reason: string | null | undefined;
  detail?: string | null;
}) {
  if (!reason) return null;
  return (
    <span className="pill pill--muted reason-chip" title={detail ?? undefined}>
      {reason}
    </span>
  );
}

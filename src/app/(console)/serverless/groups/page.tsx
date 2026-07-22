import Icon from "@/components/Icon";
import { auth } from "@/auth";
import { resolveActiveGroup } from "@/lib/session-group";

export const dynamic = "force-dynamic";
export const metadata = { title: "Groups" };

/**
 * The groups a workload can be deployed into: the caller's SSO group
 * membership. Every workload is owned by exactly one group (the active one,
 * chosen from the top-bar picker); this lists them and marks the active group.
 */
export default async function GroupsPage() {
  const session = await auth();
  const groups = session?.user.groups ?? [];
  const activeGroup = await resolveActiveGroup(groups);

  if (groups.length === 0) {
    return (
      <div className="notice notice--warn">
        Your account has no group membership yet. Ask an administrator to add you to a group.
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="field__hint">
        Workloads are owned by a group. Switch the active group from the picker in the top bar; new
        functions and containers deploy into it.
      </p>
      <div className="card-grid">
        {groups.map((g) => (
          <div key={g} className={`card ${g === activeGroup ? "card--current" : ""}`}>
            <div className="card__icon" aria-hidden="true">
              <Icon name="users" size={26} />
            </div>
            <div className="card__body">
              <div className="card__title">
                {g}
                {g === activeGroup && <span className="badge badge--active">Active</span>}
              </div>
              <p className="card__desc">Group workloads are isolated to this namespace.</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";

import GroupSwitcher from "@/components/GroupSwitcher";
import Icon from "@/components/Icon";
import ProfileMenu from "@/components/ProfileMenu";
import ThemeToggle from "@/components/ThemeToggle";

interface TopBarProps {
  productName: string;
  organization: string;
  user: { name: string; username: string; email: string; isAdmin: boolean };
  groups: string[];
  activeGroup: string | null;
}

/**
 * The top app bar. Left: product wordmark + the group ("project") switcher.
 * Right: the profile menu. Server component; the two interactive pieces are
 * their own client components.
 */
export default function TopBar({
  productName,
  organization,
  user,
  groups,
  activeGroup,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <Link href="/dashboard" className="topbar__brand">
          <span className="topbar__logo" aria-hidden="true">
            <Icon name="cloud" size={22} />
          </span>
          <span className="topbar__product">
            {organization} <strong>{productName}</strong>
          </span>
        </Link>
        <GroupSwitcher groups={groups} activeGroup={activeGroup} />
      </div>
      <div className="topbar__right">
        <ThemeToggle />
        <ProfileMenu user={user} activeGroup={activeGroup} groups={groups} />
      </div>
    </header>
  );
}

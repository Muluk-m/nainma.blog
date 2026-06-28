import { Link, useRouteContext } from "@tanstack/react-router";
import { Menu, Search, UserIcon } from "lucide-react";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import type { NavOption, UserInfo } from "@/features/theme/contract/layouts";
import { m } from "@/paraglide/messages";
import { LanguageSwitcher } from "./language-switcher";

interface NavbarProps {
  navOptions: Array<NavOption>;
  onMenuClick: () => void;
  isLoading?: boolean;
  user?: UserInfo;
}

const iconBtn =
  "h-9 w-9 flex items-center justify-center rounded-lg fuwari-text-50 hover:text-(--fuwari-primary) transition-colors active:scale-90";

export function Navbar({
  onMenuClick,
  user,
  navOptions,
  isLoading,
}: NavbarProps) {
  const { siteConfig } = useRouteContext({ from: "__root__" });

  return (
    <div className="backdrop-blur-md bg-(--fuwari-page-bg)/70">
      <div className="mx-auto flex items-center gap-4 h-16 px-6 max-w-(--fuwari-page-width)">
        <Link
          to="/"
          className="mr-auto text-base font-semibold tracking-tight text-(--fuwari-primary) hover:opacity-65 transition-opacity"
        >
          {siteConfig.title}
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm">
          {navOptions.map((option) => (
            <Link
              key={option.id}
              to={option.to}
              className="fuwari-text-50 hover:text-(--fuwari-primary) transition-colors"
              activeProps={{ className: "!text-[var(--fuwari-primary)]" }}
            >
              {option.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-0.5">
          <Link to="/search" className={iconBtn} aria-label={m.nav_search()}>
            <Search size={17} strokeWidth={1.5} />
          </Link>
          <ThemeToggle
            className={`${iconBtn} p-0! bg-transparent! [&_svg]:w-4.5! [&_svg]:h-4.5! [&_div]:w-auto! [&_div]:h-auto!`}
          />
          <LanguageSwitcher
            className={`${iconBtn} p-0! bg-transparent! [&_svg]:w-4.5! [&_svg]:h-4.5!`}
          />
          <div className="hidden md:flex items-center">
            {isLoading ? (
              <Skeleton className="w-9 h-9 rounded-lg" />
            ) : user ? (
              <Link to="/profile" className={iconBtn} aria-label={user.name}>
                {user.image ? (
                  <img
                    src={user.image}
                    alt={user.name}
                    className="w-7 h-7 rounded-md object-cover"
                  />
                ) : (
                  <UserIcon size={17} strokeWidth={1.5} />
                )}
              </Link>
            ) : (
              <Link to="/login" className={iconBtn} aria-label={m.nav_login()}>
                <UserIcon size={17} strokeWidth={1.5} />
              </Link>
            )}
          </div>
          <button
            className={`${iconBtn} md:hidden`}
            onClick={onMenuClick}
            aria-label={m.common_open_menu()}
            type="button"
          >
            <Menu size={17} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

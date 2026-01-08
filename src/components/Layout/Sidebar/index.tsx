import VersionStatus from "@app/components/Layout/VersionStatus";
import useClickOutside from "@app/hooks/useClickOutside";
import { Permission, useUser } from "@app/hooks/useUser";
import { Transition } from "@headlessui/react";
import {
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  CogIcon,
  ExclamationTriangleIcon,
  FilmIcon,
  PlayIcon,
  SparklesIcon,
  TvIcon,
  UsersIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { useRouter } from "next/router";
import { Fragment, useRef } from "react";
import { defineMessages, useIntl } from "react-intl";

export const menuMessages = defineMessages({
  dashboard: "Home",
  browsemovies: "Movies",
  browsetv: "Series",
  requests: "Manage",
  issues: "Issues",
  users: "Users",
  settings: "Settings",
  watch: "Watch",
  docs: "Docs",
  community: "Community",
});

interface SidebarProps {
  open?: boolean;
  setClosed: () => void;
}

interface SidebarLinkProps {
  href: string;
  svgIcon: React.ReactNode;
  messagesKey: keyof typeof menuMessages;
  activeRegExp: RegExp;
  as?: string;
  requiredPermission?: Permission | Permission[];
  permissionType?: "and" | "or";
  dataTestId?: string;
}

const SidebarLinks: SidebarLinkProps[] = [
  {
    href: "/",
    messagesKey: "dashboard",
    svgIcon: <SparklesIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/(discover\/?)?$/,
  },
  {
    href: "/discover/movies",
    messagesKey: "browsemovies",
    svgIcon: <FilmIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/discover\/movies$/,
  },
  {
    href: "/discover/tv",
    messagesKey: "browsetv",
    svgIcon: <TvIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/discover\/tv$/,
  },
  {
    href: "/requests",
    messagesKey: "requests",
    svgIcon: <ClockIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/requests/,
  },
  {
    href: "#", // We will dynamically handle the href
    messagesKey: "watch", // Add this to `menuMessages` below
    svgIcon: <PlayIcon className="mr-3 h-6 w-6" />, // Reuse an icon or replace with a relevant one
    activeRegExp: /^\/watch$/, // Optional – highlight current route if any
  },
  {
    href: "/docs",
    messagesKey: "docs",
    svgIcon: <BookOpenIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/docs/,
  },
  {
    href: "/community/board",
    messagesKey: "community",
    svgIcon: <ChatBubbleLeftRightIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/community/,
  },
  {
    href: "/issues",
    messagesKey: "issues",
    svgIcon: <ExclamationTriangleIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/issues/,
    requiredPermission: [
      Permission.MANAGE_ISSUES,
      Permission.CREATE_ISSUES,
      Permission.VIEW_ISSUES,
    ],
    permissionType: "or",
  },
  {
    href: "/users",
    messagesKey: "users",
    svgIcon: <UsersIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/users/,
    requiredPermission: Permission.MANAGE_USERS,
    dataTestId: "sidebar-menu-users",
  },
  {
    href: "/settings",
    messagesKey: "settings",
    svgIcon: <CogIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/settings/,
    requiredPermission: Permission.ADMIN,
    dataTestId: "sidebar-menu-settings",
  },
];
const Sidebar = ({ open, setClosed }: SidebarProps) => {
  const navRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const intl = useIntl();
  const { hasPermission, user, loading, error } = useUser();
  useClickOutside(navRef, () => setClosed());

  // Inside your Sidebar component, update the handler:
  const handlePlexLaunch = async () => {
    try {
      const response = await fetch("/api/v1/auth/plex/launch", {
        headers: {
          Accept: "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to launch Plex");
      }

      window.open(data.url, "_blank");
    } catch (error: any) {
      alert(error.message);
    }
  };

  return (
    <>
      <div className="lg:hidden">
        <Transition as={Fragment} show={open}>
          <div className="fixed inset-0 z-40 flex">
            <Transition.Child
              as="div"
              enter="transition-opacity ease-linear duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="transition-opacity ease-linear duration-300"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0">
                <div className="absolute inset-0 bg-gruvbox-bg opacity-95"></div>
              </div>
            </Transition.Child>
            <Transition.Child
              as="div"
              enter="transition-transform ease-in-out duration-300"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transition-transform ease-in-out duration-300"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <>
                <div className="sidebar relative flex h-full w-full max-w-xs flex-1 flex-col bg-gruvbox-bg-hard">
                  <div className="sidebar-close-button absolute right-0 -mr-14 p-1">
                    <button
                      className="flex h-12 w-12 items-center justify-center border-2 border-gruvbox-bg3 bg-gruvbox-bg focus:bg-gruvbox-bg1 focus:outline-none"
                      aria-label="Close sidebar"
                      onClick={() => setClosed()}
                    >
                      <XMarkIcon className="h-6 w-6 text-gruvbox-fg" />
                    </button>
                  </div>
                  <div
                    ref={navRef}
                    className="flex flex-1 flex-col overflow-y-auto pt-8 pb-8 sm:pb-4"
                  >
                    <div className="flex flex-shrink-0 items-center px-2">
                      <span className="px-4 text-xl font-bold uppercase tracking-wider text-gruvbox-green-bright">
                        <a href="/">
                          <img src="/logo_full.svg" alt="Logo" />
                        </a>
                      </span>
                    </div>
                    <nav className="mt-16 flex-1 space-y-4 px-4">
                      {SidebarLinks.filter((link) =>
                        link.requiredPermission
                          ? hasPermission(link.requiredPermission, {
                              type: link.permissionType ?? "and",
                            })
                          : true
                      ).map((sidebarLink) => {
                        if (sidebarLink.messagesKey === "watch") {
                          return (
                            <a
                              key={`mobile-${sidebarLink.messagesKey}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setClosed();
                                handlePlexLaunch();
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  setClosed();
                                  handlePlexLaunch();
                                }
                              }}
                              className={`flex items-center px-2 py-2 text-base font-bold uppercase tracking-wide leading-6 text-gruvbox-fg transition-none focus:outline-none
                              ${
                                router.pathname.match(sidebarLink.activeRegExp)
                                  ? "border-l-4 border-gruvbox-green-bright bg-gruvbox-bg1 text-gruvbox-green-bright"
                                  : "border-l-4 border-transparent hover:border-gruvbox-fg3 hover:bg-gruvbox-bg"
                              }`}
                            >
                              {sidebarLink.svgIcon}
                              {intl.formatMessage(
                                menuMessages[sidebarLink.messagesKey]
                              )}
                            </a>
                          );
                        }
                        return (
                          <Link
                            key={`mobile-${sidebarLink.messagesKey}`}
                            href={sidebarLink.href}
                            as={sidebarLink.as}
                          >
                            <a
                              onClick={() => setClosed()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  setClosed();
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              className={`flex items-center px-2 py-2 text-base font-bold uppercase tracking-wide leading-6 text-gruvbox-fg transition-none focus:outline-none
                              ${
                                router.pathname.match(sidebarLink.activeRegExp)
                                  ? "border-l-4 border-gruvbox-green-bright bg-gruvbox-bg1 text-gruvbox-green-bright"
                                  : "border-l-4 border-transparent hover:border-gruvbox-fg3 hover:bg-gruvbox-bg"
                              }`}
                              data-testid={`${sidebarLink.dataTestId}-mobile`}
                            >
                              {sidebarLink.svgIcon}
                              {intl.formatMessage(
                                menuMessages[sidebarLink.messagesKey]
                              )}
                            </a>
                          </Link>
                        );
                      })}
                    </nav>
                    {hasPermission(Permission.ADMIN) && (
                      <div className="px-2">
                        <VersionStatus onClick={() => setClosed()} />
                      </div>
                    )}
                  </div>
                </div>
                <div className="w-14 flex-shrink-0"></div>
              </>
            </Transition.Child>
          </div>
        </Transition>
      </div>
      <div className="fixed top-0 bottom-0 left-0 z-30 hidden lg:flex lg:flex-shrink-0">
        <div className="sidebar flex w-64 flex-col">
          <div className="flex h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col overflow-y-auto pt-8 pb-4">
              <div className="flex flex-shrink-0 items-center">
                <span className="px-4 text-2xl font-bold uppercase tracking-wider text-gruvbox-green-bright">
                  <a href="/">
                    <img src="/logo_full.svg" alt="Logo" />
                  </a>
                </span>
              </div>
              <nav className="mt-16 flex-1 space-y-4 px-4">
                {SidebarLinks.filter((link) =>
                  link.requiredPermission
                    ? hasPermission(link.requiredPermission, {
                        type: link.permissionType ?? "and",
                      })
                    : true
                ).map((sidebarLink) => {
                  if (sidebarLink.messagesKey === "watch") {
                    return (
                      <a
                        key={`desktop-${sidebarLink.messagesKey}`}
                        role="button"
                        tabIndex={0}
                        onClick={handlePlexLaunch}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handlePlexLaunch();
                          }
                        }}
                        className={`group flex items-center px-2 py-2 text-lg font-bold uppercase tracking-wide leading-6 text-gruvbox-fg transition-none focus:outline-none
                        ${
                          router.pathname.match(sidebarLink.activeRegExp)
                            ? "border-l-4 border-gruvbox-green-bright bg-gruvbox-bg1 text-gruvbox-green-bright"
                            : "border-l-4 border-transparent hover:border-gruvbox-fg3 hover:bg-gruvbox-bg"
                        }`}
                      >
                        {sidebarLink.svgIcon}
                        {intl.formatMessage(
                          menuMessages[sidebarLink.messagesKey]
                        )}
                      </a>
                    );
                  }
                  return (
                    <Link
                      key={`desktop-${sidebarLink.messagesKey}`}
                      href={sidebarLink.href}
                      as={sidebarLink.as}
                    >
                      <a
                        className={`group flex items-center px-2 py-2 text-lg font-bold uppercase tracking-wide leading-6 text-gruvbox-fg transition-none focus:outline-none
                        ${
                          router.pathname.match(sidebarLink.activeRegExp)
                            ? "border-l-4 border-gruvbox-green-bright bg-gruvbox-bg1 text-gruvbox-green-bright"
                            : "border-l-4 border-transparent hover:border-gruvbox-fg3 hover:bg-gruvbox-bg"
                        }`}
                        data-testid={sidebarLink.dataTestId}
                      >
                        {sidebarLink.svgIcon}
                        {intl.formatMessage(
                          menuMessages[sidebarLink.messagesKey]
                        )}
                      </a>
                    </Link>
                  );
                })}
              </nav>
              {hasPermission(Permission.ADMIN) && (
                <div className="px-2">
                  <VersionStatus />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;

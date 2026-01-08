import Link from 'next/link';
import React from 'react';

interface BadgeProps {
  badgeType?:
    | 'default'
    | 'primary'
    | 'danger'
    | 'warning'
    | 'success'
    | 'dark'
    | 'light';
  className?: string;
  href?: string;
  children: React.ReactNode;
}

const Badge = (
  { badgeType = 'default', className, href, children }: BadgeProps,
  ref?: React.Ref<HTMLElement>
) => {
  const badgeStyle = [
    'px-2 inline-flex text-xs leading-5 font-semibold rounded-full whitespace-nowrap',
  ];

  if (href) {
    badgeStyle.push('transition cursor-pointer !no-underline');
  } else {
    badgeStyle.push('cursor-default');
  }

  switch (badgeType) {
    case 'danger':
      badgeStyle.push(
        'bg-gruvbox-red bg-opacity-80 border-gruvbox-red border !text-gruvbox-fg'
      );
      if (href) {
        badgeStyle.push('hover:bg-gruvbox-red-bright hover:bg-opacity-100');
      }
      break;
    case 'warning':
      badgeStyle.push(
        'bg-gruvbox-yellow bg-opacity-80 border-gruvbox-yellow border !text-gruvbox-bg'
      );
      if (href) {
        badgeStyle.push('hover:bg-gruvbox-yellow-bright hover:bg-opacity-100');
      }
      break;
    case 'success':
      badgeStyle.push(
        'bg-gruvbox-green bg-opacity-80 border border-gruvbox-green !text-gruvbox-fg'
      );
      if (href) {
        badgeStyle.push('hover:bg-gruvbox-green-bright hover:bg-opacity-100');
      }
      break;
    case 'dark':
      badgeStyle.push('bg-gruvbox-bg-hard !text-gruvbox-fg3');
      if (href) {
        badgeStyle.push('hover:bg-gruvbox-bg1');
      }
      break;
    case 'light':
      badgeStyle.push('bg-gruvbox-bg2 !text-gruvbox-fg1');
      if (href) {
        badgeStyle.push('hover:bg-gruvbox-bg3');
      }
      break;
    default:
      badgeStyle.push(
        'bg-gruvbox-aqua bg-opacity-80 border border-gruvbox-aqua !text-gruvbox-fg'
      );
      if (href) {
        badgeStyle.push('hover:bg-gruvbox-aqua-bright hover:bg-opacity-100');
      }
  }

  if (className) {
    badgeStyle.push(className);
  }

  if (href?.includes('://')) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={badgeStyle.join(' ')}
        ref={ref as React.Ref<HTMLAnchorElement>}
      >
        {children}
      </a>
    );
  } else if (href) {
    return (
      <Link href={href}>
        <a
          className={badgeStyle.join(' ')}
          ref={ref as React.Ref<HTMLAnchorElement>}
        >
          {children}
        </a>
      </Link>
    );
  } else {
    return (
      <span
        className={badgeStyle.join(' ')}
        ref={ref as React.Ref<HTMLSpanElement>}
      >
        {children}
      </span>
    );
  }
};

export default React.forwardRef(Badge) as typeof Badge;

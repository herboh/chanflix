import type { ForwardedRef } from 'react';
import React from 'react';

export type ButtonType =
  | 'default'
  | 'primary'
  | 'danger'
  | 'warning'
  | 'success'
  | 'ghost';

// Helper type to override types (overrides onClick)
type MergeElementProps<
  T extends React.ElementType,
  P extends Record<string, unknown>
> = Omit<React.ComponentProps<T>, keyof P> & P;

type ElementTypes = 'button' | 'a';

type Element<P extends ElementTypes = 'button'> = P extends 'a'
  ? HTMLAnchorElement
  : HTMLButtonElement;

type BaseProps<P> = {
  buttonType?: ButtonType;
  buttonSize?: 'default' | 'lg' | 'md' | 'sm';
  // Had to do declare this manually as typescript would assume e was of type any otherwise
  onClick?: (
    e: React.MouseEvent<P extends 'a' ? HTMLAnchorElement : HTMLButtonElement>
  ) => void;
};

type ButtonProps<P extends React.ElementType> = {
  as?: P;
} & MergeElementProps<P, BaseProps<P>>;

function Button<P extends ElementTypes = 'button'>(
  {
    buttonType = 'default',
    buttonSize = 'default',
    as,
    children,
    className,
    ...props
  }: ButtonProps<P>,
  ref?: React.Ref<Element<P>>
): JSX.Element {
  const buttonStyle = [
    'inline-flex items-center justify-center border-2 leading-5 font-bold uppercase tracking-wide focus:outline-none transition-none cursor-pointer disabled:opacity-50 whitespace-nowrap',
  ];
  switch (buttonType) {
    case 'primary':
      buttonStyle.push(
        'text-gruvbox-green border-gruvbox-green bg-gruvbox-bg hover:bg-gruvbox-green hover:text-gruvbox-bg focus:bg-gruvbox-green focus:text-gruvbox-bg active:bg-gruvbox-green-bright'
      );
      break;
    case 'danger':
      buttonStyle.push(
        'text-gruvbox-red-bright border-gruvbox-red bg-gruvbox-bg hover:bg-gruvbox-red hover:text-gruvbox-fg focus:bg-gruvbox-red active:bg-gruvbox-red-bright'
      );
      break;
    case 'warning':
      buttonStyle.push(
        'text-gruvbox-yellow border-gruvbox-yellow bg-gruvbox-bg hover:bg-gruvbox-yellow hover:text-gruvbox-bg focus:bg-gruvbox-yellow active:bg-gruvbox-yellow-bright'
      );
      break;
    case 'success':
      buttonStyle.push(
        'text-gruvbox-green-bright border-gruvbox-green bg-gruvbox-bg hover:bg-gruvbox-green hover:text-gruvbox-bg focus:bg-gruvbox-green active:bg-gruvbox-green-bright'
      );
      break;
    case 'ghost':
      buttonStyle.push(
        'text-gruvbox-fg bg-transparent border-gruvbox-bg3 hover:border-gruvbox-fg3 hover:text-gruvbox-fg focus:border-gruvbox-fg active:border-gruvbox-fg'
      );
      break;
    default:
      buttonStyle.push(
        'text-gruvbox-fg bg-gruvbox-bg border-gruvbox-bg3 hover:border-gruvbox-fg3 hover:bg-gruvbox-bg1 group-hover:border-gruvbox-fg3 group-hover:bg-gruvbox-bg1 focus:border-gruvbox-aqua active:bg-gruvbox-bg2'
      );
  }

  switch (buttonSize) {
    case 'sm':
      buttonStyle.push('px-2.5 py-1.5 text-xs button-sm');
      break;
    case 'lg':
      buttonStyle.push('px-6 py-3 text-base button-lg');
      break;
    case 'md':
    default:
      buttonStyle.push('px-4 py-2 text-sm button-md');
  }

  buttonStyle.push(className ?? '');

  if (as === 'a') {
    return (
      <a
        className={buttonStyle.join(' ')}
        {...(props as React.ComponentProps<'a'>)}
        ref={ref as ForwardedRef<HTMLAnchorElement>}
      >
        <span className="flex items-center">{children}</span>
      </a>
    );
  } else {
    return (
      <button
        className={buttonStyle.join(' ')}
        {...(props as React.ComponentProps<'button'>)}
        ref={ref as ForwardedRef<HTMLButtonElement>}
      >
        <span className="flex items-center">{children}</span>
      </button>
    );
  }
}

export default React.forwardRef(Button) as typeof Button;

import useClickOutside from '@app/hooks/useClickOutside';
import { withProperties } from '@app/utils/typeHelpers';
import { Transition } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { Fragment, useRef, useState } from 'react';

interface DropdownItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  buttonType?: 'primary' | 'ghost';
}

const DropdownItem = ({
  children,
  buttonType = 'primary',
  ...props
}: DropdownItemProps) => {
  let styleClass = 'button-md text-white';

  switch (buttonType) {
    case 'ghost':
      styleClass +=
        ' bg-transparent rounded hover:bg-gruvbox-green text-white focus:border-gruvbox-bg3 focus:text-white';
      break;
    default:
      styleClass +=
        ' bg-gruvbox-green rounded hover:bg-gruvbox-green-bright focus:border-gruvbox-green focus:text-white';
  }
  return (
    <a
      className={`flex cursor-pointer items-center px-4 py-2 text-sm leading-5 focus:outline-none ${styleClass}`}
      {...props}
    >
      {children}
    </a>
  );
};

interface ButtonWithDropdownProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  text: React.ReactNode;
  dropdownIcon?: React.ReactNode;
  buttonType?: 'primary' | 'ghost';
}

const ButtonWithDropdown = ({
  text,
  children,
  dropdownIcon,
  className,
  buttonType = 'primary',
  ...props
}: ButtonWithDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useClickOutside(buttonRef, () => setIsOpen(false));

  const styleClasses = {
    mainButtonClasses: 'button-md text-white border',
    dropdownSideButtonClasses: 'button-md border',
    dropdownClasses: 'button-md',
  };

  switch (buttonType) {
    case 'ghost':
      styleClasses.mainButtonClasses +=
        ' bg-transparent border-gray-600 hover:border-gray-200 focus:border-gray-100 active:border-gray-100';
      styleClasses.dropdownSideButtonClasses = styleClasses.mainButtonClasses;
      styleClasses.dropdownClasses +=
        ' bg-gray-800 border border-gray-700 bg-opacity-80 p-1 backdrop-blur';
      break;
    default:
      styleClasses.mainButtonClasses +=
        ' bg-gruvbox-green border-gruvbox-green hover:bg-gruvbox-green-bright hover:border-gruvbox-green-bright active:bg-gruvbox-green active:border-gruvbox-green focus:ring-gruvbox-green';
      styleClasses.dropdownSideButtonClasses +=
        ' bg-gruvbox-green border-gruvbox-green hover:bg-gruvbox-green-bright active:bg-gruvbox-green focus:ring-gruvbox-green';
      styleClasses.dropdownClasses += ' bg-gruvbox-green p-1';
  }

  return (
    <span className="relative inline-flex h-full rounded-md shadow-sm">
      <button
        type="button"
        className={`relative z-10 inline-flex h-full items-center px-4 py-2 text-sm font-medium leading-5 transition duration-150 ease-in-out hover:z-20 focus:z-20 focus:outline-none ${
          styleClasses.mainButtonClasses
        } ${children ? 'rounded-l-md' : 'rounded-md'} ${className}`}
        ref={buttonRef}
        {...props}
      >
        {text}
      </button>
      {children && (
        <span className="relative -ml-px block">
          <button
            type="button"
            className={`relative z-10 inline-flex h-full items-center rounded-r-md px-2 py-2 text-sm font-medium leading-5 text-white transition duration-150 ease-in-out hover:z-20 focus:z-20 ${styleClasses.dropdownSideButtonClasses}`}
            aria-label="Expand"
            onClick={() => setIsOpen((state) => !state)}
          >
            {dropdownIcon ? dropdownIcon : <ChevronDownIcon />}
          </button>
          <Transition
            as={Fragment}
            show={isOpen}
            enter="transition ease-out duration-100"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <div className="absolute right-0 z-40 mt-2 -mr-1 w-56 origin-top-right rounded-md shadow-lg">
              <div
                className={`rounded-md ring-1 ring-black ring-opacity-5 ${styleClasses.dropdownClasses}`}
              >
                <div className="py-1">{children}</div>
              </div>
            </div>
          </Transition>
        </span>
      )}
    </span>
  );
};
export default withProperties(ButtonWithDropdown, { Item: DropdownItem });

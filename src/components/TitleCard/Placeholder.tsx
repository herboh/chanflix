interface PlaceholderProps {
  canExpand?: boolean;
}

const Placeholder = ({ canExpand = false }: PlaceholderProps) => {
  return (
    <div
      className={`relative animate-pulse rounded-xl bg-gruvbox-bg1 border-2 border-gruvbox-bg3 ${
        canExpand ? 'w-full' : 'w-36 sm:w-36 md:w-44'
      }`}
    >
      <div className="w-full" style={{ paddingBottom: '150%' }} />
      <div className="absolute inset-0 flex items-center justify-center">
        <svg
          className="h-8 w-8 text-gruvbox-bg3"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
    </div>
  );
};

export default Placeholder;

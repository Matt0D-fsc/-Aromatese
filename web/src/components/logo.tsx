// The ChatNab wordmark. Drawn as text, not an image, so it uses the app's own Instrument Sans and stays
// crisp at any size and in either theme. "chat" takes the foreground, "nab" the jade: the same split the
// accent colour makes everywhere else in the product.
//
// The square mark for a favicon or an app icon is app/icon.svg, where the n is a path rather than a letter,
// because that one is rendered by browsers and by Meta's dashboard, with no guarantee our font is loaded.

const SIZES = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-4xl sm:text-5xl',
} as const;

export function Logo({ size = 'md', className = '' }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <span className={`font-semibold tracking-tight ${SIZES[size]} ${className}`}>
      <span className="text-foreground">chat</span>
      <span className="text-accent">nab</span>
    </span>
  );
}

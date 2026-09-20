import Image from 'next/image';
import mark from '../../public/logo-mark.png';

// The ChatNab lockup: the drawn mark, and the name beside it as live text.
//
// The supplied artwork sets the name in white, which disappears on a light page, so only the mark is used as
// an image. Keeping the name as text means it takes the theme's foreground colour in both light and dark,
// stays sharp at any size, and can be read by anything that reads the page — a picture of a word cannot.

const SIZES = {
  sm: { mark: 22, text: 'text-lg' },
  md: { mark: 30, text: 'text-2xl' },
  lg: { mark: 46, text: 'text-4xl sm:text-5xl' },
} as const;

export function Logo({ size = 'md', markOnly = false, className = '' }: { size?: keyof typeof SIZES; markOnly?: boolean; className?: string }) {
  const { mark: height, text } = SIZES[size];

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Image src={mark} alt={markOnly ? 'ChatNab' : ''} height={height} style={{ height, width: 'auto' }} priority />
      {!markOnly && <span className={`font-semibold tracking-tight text-foreground ${text}`}>ChatNab</span>}
    </span>
  );
}

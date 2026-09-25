import { useIsDark } from '@/hooks/useTheme'
import { cn } from '@/lib/cn'
import { screenMeta, screenSrc, type ScreenName } from '../assets/screens'

/** Product screenshot that swaps its light/dark capture with the active theme. Lazy-loaded. */
export function Screenshot({ name, className, eager = false }: { name: ScreenName; className?: string; eager?: boolean }) {
  const dark = useIsDark()
  const meta = screenMeta[name]
  return (
    <img
      src={screenSrc(name, dark ? 'dark' : 'light')}
      width={meta.width}
      height={meta.height}
      alt={meta.alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={cn('block h-auto w-full select-none', className)}
      draggable={false}
    />
  )
}

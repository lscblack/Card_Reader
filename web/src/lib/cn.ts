import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}

/**
 * Form controls fill their container unless the caller sets a base width (`w-24`, `w-[112px]`…).
 * `cn` doesn't resolve conflicting utilities, so adding `w-full` next to `w-24` would let `w-full`
 * win and push the rest of a row out of view. Responsive widths (`sm:w-52`) keep the full-width base.
 */
export function defaultWidth(className: string | undefined): string {
  return className && /(^|\s)w-/.test(className) ? '' : 'w-full'
}

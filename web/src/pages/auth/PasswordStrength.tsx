import { cn } from '@/lib/cn'

function score(pw: string): number {
  if (!pw) return 0
  let s = 0
  if (pw.length >= 10) s++
  if (pw.length >= 14) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++
  return Math.max(1, s)
}

const labels = ['', 'Weak', 'Fair', 'Good', 'Strong']
const colors = ['', 'bg-red-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500']

export function PasswordStrength({ password }: { password: string }) {
  const s = score(password)
  if (!password) return null
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={cn('h-1 flex-1 rounded-full', i <= s ? colors[s] : 'bg-surface-3')} />
        ))}
      </div>
      <span className="w-12 text-right text-xs text-subtle">{labels[s]}</span>
    </div>
  )
}

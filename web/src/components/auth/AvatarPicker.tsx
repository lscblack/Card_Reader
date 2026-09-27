import { useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'

const TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** Local photo choice with a preview; the caller uploads it once an account exists. */
export function AvatarPicker({ file, onChange, name, email }: { file: File | null; onChange: (f: File | null) => void; name?: string; email?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  function set(f: File | null) {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(f ? URL.createObjectURL(f) : null)
    onChange(f)
  }

  function pick(f: File | undefined) {
    if (input.current) input.current.value = ''
    if (!f) return
    if (!TYPES.includes(f.type)) return setError('Use a PNG, JPEG or WebP image.')
    if (f.size > 2 * 1024 * 1024) return setError('The image must be 2 MB or smaller.')
    setError(null)
    set(f)
  }

  return (
    <div className="flex items-center gap-3.5">
      <Avatar src={file ? preview : null} name={name} email={email} size="lg" className="ring-2 ring-border" />
      <div className="min-w-0 space-y-1">
        <p className="text-[13px] font-medium">
          Profile photo <span className="font-normal text-subtle">(optional)</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" leftIcon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => input.current?.click()}>
            {file ? 'Change' : 'Choose photo'}
          </Button>
          {file && (
            <Button size="sm" variant="ghost" leftIcon={<X className="h-3.5 w-3.5" />} onClick={() => set(null)}>
              Remove
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <input ref={input} type="file" accept={TYPES.join(',')} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
    </div>
  )
}

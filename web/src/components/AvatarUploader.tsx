import { useRef, useState } from 'react'
import { Trash2, Upload } from 'lucide-react'
import { Avatar } from './ui/Avatar'
import { Button } from './ui/Button'

const TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** Avatar picker: preview before upload, PNG/JPEG/WebP ≤ 2 MB (server re-encodes to 256×256). */
export function AvatarUploader({
  src,
  name,
  email,
  onUpload,
  onRemove,
  uploading,
  removing,
}: {
  src: string | null | undefined
  name?: string | null
  email?: string | null
  onUpload: (file: File) => Promise<unknown>
  onRemove?: () => Promise<unknown>
  uploading?: boolean
  removing?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pick(file: File | undefined) {
    if (!file) return
    setError(null)
    if (!TYPES.includes(file.type)) return setError('Use a PNG, JPEG or WebP image.')
    if (file.size > 2 * 1024 * 1024) return setError('The image must be 2 MB or smaller.')
    const url = URL.createObjectURL(file)
    setPreview(url)
    try {
      await onUpload(file)
    } catch {
      setError('Upload failed — try again.')
    } finally {
      setPreview(null)
      URL.revokeObjectURL(url)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative">
        <Avatar src={preview ?? src} name={name} email={email} size="xl" className="ring-2 ring-border" />
        {uploading && <span className="absolute inset-0 animate-pulse rounded-full bg-black/30" aria-hidden="true" />}
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" leftIcon={<Upload className="h-3.5 w-3.5" />} onClick={() => input.current?.click()} loading={uploading}>
            {src ? 'Change photo' : 'Upload photo'}
          </Button>
          {src && onRemove && (
            <Button size="sm" variant="ghost" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void onRemove()} loading={removing}>
              Remove
            </Button>
          )}
        </div>
        <p className={error ? 'text-xs text-red-600 dark:text-red-400' : 'text-xs text-subtle'}>{error ?? 'PNG, JPEG or WebP, up to 2 MB. Cropped to a square.'}</p>
        <input ref={input} type="file" accept={TYPES.join(',')} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
    </div>
  )
}

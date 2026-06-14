import { type ReactNode } from 'react'
import { ShieldOff } from 'lucide-react'
import { usePermission, useAnyPermission, useAllPermissions } from '@/lib/authorization/use-access'
import type { PermissionKey } from '@/lib/authorization/permissions'

/** Render children only when the acting user holds the permission. */
export function Can({ permission, children, fallback = null }: {
  permission: PermissionKey
  children: ReactNode
  fallback?: ReactNode
}) {
  return usePermission(permission) ? <>{children}</> : <>{fallback}</>
}

export function CanAny({ permissions, children, fallback = null }: {
  permissions: PermissionKey[]
  children: ReactNode
  fallback?: ReactNode
}) {
  return useAnyPermission(permissions) ? <>{children}</> : <>{fallback}</>
}

export function CanAll({ permissions, children, fallback = null }: {
  permissions: PermissionKey[]
  children: ReactNode
  fallback?: ReactNode
}) {
  return useAllPermissions(permissions) ? <>{children}</> : <>{fallback}</>
}

/** Full-page restricted state — used by route guards. No resource disclosure. */
export function AccessDenied({ title = 'Access Restricted', message, onBack }: {
  title?: string
  message?: string
  onBack?: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-black/40">
        <ShieldOff size={20} className="text-white/40" />
      </div>
      <div>
        <h2 className="mono text-sm font-bold uppercase tracking-widest text-white/85">{title}</h2>
        <p className="mono mt-2 max-w-[320px] text-[11px] leading-relaxed text-white/40">
          {message ?? 'You do not have permission to view this section. Contact an administrator if you need access.'}
        </p>
      </div>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost mono px-4 py-2 text-[10px] uppercase tracking-widest"
        >
          Back to Fleet
        </button>
      )}
    </div>
  )
}

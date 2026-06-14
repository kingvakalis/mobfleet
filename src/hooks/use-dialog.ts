import { useEffect, useRef } from 'react'

/**
 * Accessible modal-dialog behavior, shared by every overlay (account editor,
 * CSV import, employee drawer, …):
 *  - Escape closes the dialog.
 *  - Focus moves into the dialog on open and is restored to the previously
 *    focused element on close (so keyboard users aren't dumped at the top of
 *    the page).
 *  - Tab is trapped within the dialog while it is open.
 *
 * Attach the returned ref to the dialog container (the element carrying
 * role="dialog"). The container is made programmatically focusable so it can
 * receive initial focus even when it has no focusable children yet.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose: () => void) {
  const ref = useRef<T | null>(null)
  // Keep the latest onClose without re-running the trap effect (callers often
  // pass an inline arrow function that changes identity every render). Updated
  // in an effect — never written during render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const node = ref.current
    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusable = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null || el === document.activeElement)
        : []

    // Initial focus: first focusable control, else the container itself.
    const first = focusable()[0]
    if (first) first.focus()
    else node?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !node) return
      const items = focusable()
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === firstEl || !node.contains(active))) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    node?.addEventListener('keydown', onKeyDown)
    return () => {
      node?.removeEventListener('keydown', onKeyDown)
      // Restore focus only if it still makes sense (element is still in the DOM).
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [])

  return ref
}

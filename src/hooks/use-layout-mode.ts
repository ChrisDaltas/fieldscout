'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

import { THEME_STORAGE_KEY, useThemeStore } from '@/stores/theme-store'
import { useUIStore } from '@/stores/ui-store'

/**
 * Layout mode (Chris, 2026-10-13): inside the app the layout follows the
 * DEVICE, not the window width.
 *
 * - Mouse / trackpad → `desktop`. The desktop layout holds at any width; below
 *   `DESKTOP_MIN_WIDTH` the window covers the app (the shell's `min-w-app`)
 *   instead of the layout degrading. Below `MOBILE_PROMPT_WIDTH` a prompt
 *   offers the mobile layout; widening back past the minimum returns to
 *   desktop on its own.
 * - Touch (phones, iPads) → `mobile`, at any size.
 *
 * The mode lives on `<html data-layout>` — tailwind.config.ts turns it into
 * the `desk:` variant and keeps `sm`/`md`/`lg` on in desktop mode.
 */
export const DESKTOP_MIN_WIDTH = 1024
export const MOBILE_PROMPT_WIDTH = 768
const DESKTOP_POINTER = '(hover: hover) and (pointer: fine)'

export type LayoutMode = 'desktop' | 'mobile'

/**
 * Runs in <head> before first paint so the right layout renders immediately on
 * a full load of an app page. App routes only — the landing and auth pages
 * stay plain width-responsive.
 */
export const LAYOUT_MODE_HEAD_SCRIPT = `(function(){try{var p=location.pathname;if(p==='/app'||p.indexOf('/app/')===0){var h=document.documentElement,d=window.matchMedia('${DESKTOP_POINTER}').matches;h.setAttribute('data-layout',d?'desktop':'mobile');if(!d&&localStorage.getItem('${THEME_STORAGE_KEY}')==='dark')h.setAttribute('data-theme','dark')}}catch(e){}})();`

function readViewport() {
  if (typeof window === 'undefined') return { desktopPointer: true, width: DESKTOP_MIN_WIDTH }
  return {
    desktopPointer: window.matchMedia(DESKTOP_POINTER).matches,
    width: window.innerWidth,
  }
}

export function useLayoutMode() {
  const forced = useUIStore((s) => s.forceMobileLayout)
  const setForced = useUIStore((s) => s.setForceMobileLayout)
  const [viewport, setViewport] = useState(readViewport)
  // The prompt depends on the window, which the server can't know — only
  // show it after mount so hydration matches.
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const query = window.matchMedia(DESKTOP_POINTER)
    const update = () => setViewport(readViewport())
    update()
    window.addEventListener('resize', update)
    query.addEventListener('change', update)
    return () => {
      window.removeEventListener('resize', update)
      query.removeEventListener('change', update)
    }
  }, [])

  // Back at the desktop minimum → back to the desktop layout.
  useEffect(() => {
    if (forced && viewport.width >= DESKTOP_MIN_WIDTH) setForced(false)
  }, [forced, viewport.width, setForced])

  const mode: LayoutMode = viewport.desktopPointer && !forced ? 'desktop' : 'mobile'

  useEffect(() => {
    document.documentElement.setAttribute('data-layout', mode)
  }, [mode])

  // Dark mode is mobile-only (Chris, 2026-10-15): the theme attribute follows
  // the stored preference in the mobile layout and is absent on desktop.
  const dark = useThemeStore((t) => t.dark)
  useEffect(() => {
    const html = document.documentElement
    if (mode === 'mobile' && dark) html.setAttribute('data-theme', 'dark')
    else html.removeAttribute('data-theme')
  }, [mode, dark])

  // Leaving the app (e.g. to the landing page) drops both attributes so
  // public pages are plain width-responsive and light again.
  useEffect(
    () => () => {
      document.documentElement.removeAttribute('data-layout')
      document.documentElement.removeAttribute('data-theme')
    },
    [],
  )

  return {
    mode,
    showMobilePrompt: mounted && mode === 'desktop' && viewport.width < MOBILE_PROMPT_WIDTH,
    switchToMobile: () => setForced(true),
  }
}

function subscribeLayout(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-layout'] })
  return () => observer.disconnect()
}

/**
 * The current layout mode as read from `<html data-layout>`, for components
 * that render a different TREE per mode (`ByLayout`). `null` on the server and
 * during hydration — callers must render something that is correct for both
 * until it resolves.
 */
export function useLayoutModeValue(): LayoutMode | null {
  return useSyncExternalStore(
    subscribeLayout,
    () => {
      const v = document.documentElement.getAttribute('data-layout')
      return v === 'mobile' || v === 'desktop' ? v : null
    },
    () => null,
  )
}

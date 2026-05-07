import { useCallback, useEffect, useRef } from 'react'
import type { HookResultMessage, Message } from '../types/message.js'

/**
 * Manages deferred SessionStart hook messages so the REPL can render
 * immediately instead of blocking on hook execution (~500ms).
 *
 * Hook messages are injected asynchronously when the promise resolves.
 * Returns a callback that onSubmit should call before the first API
 * request to ensure the model always sees hook context.
 *
 * Uses a single resolution mechanism (resolvePromise ref) to prevent
 * the double-injection race where both the useEffect and the callback
 * could interleave async paths and inject messages twice.
 */
export function useDeferredHookMessages(
  pendingHookMessages: Promise<HookResultMessage[]> | undefined,
  setMessages: (action: React.SetStateAction<Message[]>) => void,
): () => Promise<void> {
  const pendingRef = useRef(pendingHookMessages ?? null)
  const resolvePromiseRef = useRef<Promise<void> | null>(null)
  const injectMessages = useCallback(
    (msgs: HookResultMessage[]) => {
      if (msgs.length > 0) {
        setMessages(prev => [...msgs, ...prev])
      }
    },
    [setMessages],
  )

  useEffect(() => {
    const promise = pendingRef.current
    if (!promise) return
    let cancelled = false

    // Single resolution: only one caller (effect or callback) wins the race
    const resolution = promise.then(msgs => {
      if (!cancelled) {
        pendingRef.current = null
        injectMessages(msgs)
      }
    })

    resolvePromiseRef.current = resolution

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectMessages])

  return useCallback(async () => {
    const promise = pendingRef.current
    if (!promise) return

    // Wait for the same promise the effect is awaiting.
    // The effect's .then() callback will handle injection (or already did).
    // We just need to ensure it has resolved before the query proceeds.
    await resolvePromiseRef.current
  }, [])
}

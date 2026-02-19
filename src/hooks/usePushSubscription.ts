'use client'

import { useState, useEffect, useCallback } from 'react'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function usePushSubscription() {
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [debugError, setDebugError] = useState('')

  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

    // Defer state updates to avoid synchronous setState in effect
    requestAnimationFrame(() => {
      setIsSupported(supported)

      if (!supported) {
        setIsLoading(false)
        return
      }

      setPermission(Notification.permission)
    })

    if (!supported) return

    // Set a timeout to unblock loading if SW.ready takes too long (e.g. in TWA)
    const timeout = setTimeout(() => {
      setIsLoading(false)
    }, 3000)

    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        clearTimeout(timeout)
        setIsSubscribed(!!sub)
        setIsLoading(false)
      }).catch(() => {
        clearTimeout(timeout)
        setIsLoading(false)
      })
    }).catch(() => {
      clearTimeout(timeout)
      setIsLoading(false)
    })
  }, [])

  const subscribe = useCallback(async () => {
    if (!isSupported) { setDebugError('not supported'); return false }
    setDebugError('')

    try {
      setDebugError('requesting permission...')
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') { setDebugError(`perm=${perm}`); return false }

      setDebugError('waiting SW ready...')
      const reg = await navigator.serviceWorker.ready
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

      if (!vapidPublicKey) { setDebugError('no VAPID key'); return false }

      setDebugError('pushManager.subscribe...')
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
      })

      setDebugError('sending to server...')
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      })

      if (res.ok) {
        setIsSubscribed(true)
        setDebugError('OK!')
        return true
      }
      setDebugError(`server ${res.status}`)
      return false
    } catch (e) {
      setDebugError(`error: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }, [isSupported])

  const unsubscribe = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.getSubscription()

      if (subscription) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        await subscription.unsubscribe()
      }

      setIsSubscribed(false)
      return true
    } catch {
      return false
    }
  }, [])

  return { isSubscribed, isSupported, isLoading, permission, subscribe, unsubscribe, debugError }
}

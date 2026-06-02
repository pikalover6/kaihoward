import { useEffect, useState } from 'react'

const VAPID_PUBLIC_KEY = 'BE_Nq51fwZYwrKuHnV2CL_81qDU9P-X5HO2N4yFKF2UnTdDqm5oOt4suhc78DvLxzMp3u2aySImZQ1wC88GO6aI'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i)
  return arr
}

// "Enable reminders" control: registers the service worker, subscribes to web
// push, and stores the subscription (with the device timezone) on the server.
export default function PushControls() {
  const [status, setStatus] = useState('checking') // checking | unsupported | denied | off | on | working
  const [msg, setMsg] = useState('')

  const supported =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window

  useEffect(() => {
    if (!supported) {
      setStatus('unsupported')
      return
    }
    ;(async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js')
        const sub = await reg.pushManager.getSubscription()
        if (Notification.permission === 'denied') setStatus('denied')
        else setStatus(sub ? 'on' : 'off')
      } catch (e) {
        setStatus('off')
        setMsg(String(e?.message || e))
      }
    })()
  }, [supported])

  async function enable() {
    setStatus('working')
    setMsg('')
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setStatus(perm === 'denied' ? 'denied' : 'off')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const res = await fetch('/personal/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), timezone }),
      })
      if (!res.ok) throw new Error('Could not save subscription')
      setStatus('on')
    } catch (e) {
      setStatus('off')
      setMsg(String(e?.message || e))
    }
  }

  async function disable() {
    setStatus('working')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/personal/api/push', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setStatus('off')
    } catch (e) {
      setStatus('on')
      setMsg(String(e?.message || e))
    }
  }

  async function test() {
    try {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification('Kai Planner ✅', { body: 'Notifications are on.', icon: '/favicon.svg' })
    } catch (e) {
      setMsg(String(e?.message || e))
    }
  }

  if (status === 'unsupported') return null

  return (
    <div className="push-controls chrome-control">
      {status === 'on' ? (
        <>
          <button onClick={test} type="button">Test alert</button>
          <button onClick={disable} type="button">Reminders: on</button>
        </>
      ) : status === 'denied' ? (
        <span>Notifications blocked — enable them in your browser/site settings</span>
      ) : (
        <button onClick={enable} disabled={status === 'working' || status === 'checking'} type="button">
          {status === 'working' ? 'Enabling…' : 'Enable reminders'}
        </button>
      )}
      {msg ? <small>{msg}</small> : null}
    </div>
  )
}

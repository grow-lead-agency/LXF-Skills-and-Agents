# React Subscription Patterns for Realtime

## Core Rule: Always Clean Up

Every subscription must be unsubscribed in the useEffect cleanup function.
Failure to do so causes **memory leaks**, **duplicate event handlers**, and **stale closures**.

---

## Supabase Realtime in React

### Basic Postgres Changes Hook

```typescript
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

function useRealtimeTable<T extends Record<string, unknown>>(
  table: string,
  initialData: T[]
) {
  const [data, setData] = useState<T[]>(initialData)

  useEffect(() => {
    const channel = supabase
      .channel(`${table}-changes`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          switch (payload.eventType) {
            case 'INSERT':
              setData((prev) => [...prev, payload.new as T])
              break
            case 'UPDATE':
              setData((prev) =>
                prev.map((item) =>
                  (item as any).id === (payload.new as any).id
                    ? (payload.new as T)
                    : item
                )
              )
              break
            case 'DELETE':
              setData((prev) =>
                prev.filter(
                  (item) => (item as any).id !== (payload.old as any).id
                )
              )
              break
          }
        }
      )
      .subscribe()

    // CRITICAL: cleanup on unmount or dependency change
    return () => {
      supabase.removeChannel(channel)
    }
  }, [table])

  return data
}
```

### Filtered Subscription Hook

```typescript
function useRealtimeRow<T>(table: string, id: string) {
  const [row, setRow] = useState<T | null>(null)

  useEffect(() => {
    // Initial fetch
    supabase
      .from(table)
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data }) => setRow(data as T))

    const channel = supabase
      .channel(`${table}:${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `id=eq.${id}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setRow(null)
          } else {
            setRow(payload.new as T)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, id])

  return row
}
```

### Broadcast Hook

```typescript
function useBroadcast<T>(channelName: string, event: string) {
  const [messages, setMessages] = useState<T[]>([])
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const channel = supabase.channel(channelName)

    channel
      .on('broadcast', { event }, (payload) => {
        setMessages((prev) => [...prev, payload.payload as T])
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [channelName, event])

  const send = useCallback(
    (payload: T) => {
      channelRef.current?.send({
        type: 'broadcast',
        event,
        payload,
      })
    },
    [event]
  )

  return { messages, send }
}
```

### Presence Hook

```typescript
interface PresenceUser {
  userId: string
  name: string
  online_at: string
}

function usePresence(roomId: string, currentUser: PresenceUser) {
  const [users, setUsers] = useState<Record<string, PresenceUser[]>>({})
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const channel = supabase.channel(`presence:${roomId}`, {
      config: { presence: { key: currentUser.userId } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        setUsers(channel.presenceState() as Record<string, PresenceUser[]>)
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return
        await channel.track({
          ...currentUser,
          online_at: new Date().toISOString(),
        })
      })

    channelRef.current = channel

    return () => {
      channel.untrack()
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [roomId, currentUser.userId])

  return { users, onlineCount: Object.keys(users).length }
}
```

---

## WebSocket Client in React (for Durable Objects)

### Basic WebSocket Hook

```typescript
import { useEffect, useRef, useState, useCallback } from 'react'

type WSStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

interface UseWebSocketOptions {
  url: string
  onMessage?: (data: unknown) => void
  reconnect?: boolean
  maxRetries?: number
}

function useWebSocket({
  url,
  onMessage,
  reconnect = true,
  maxRetries = 5,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const [status, setStatus] = useState<WSStatus>('disconnected')

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    setStatus(retriesRef.current > 0 ? 'reconnecting' : 'connecting')
    const ws = new WebSocket(url)

    ws.onopen = () => {
      setStatus('connected')
      retriesRef.current = 0 // reset retries on success
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessage?.(data)
      } catch {
        onMessage?.(event.data)
      }
    }

    ws.onclose = (event) => {
      setStatus('disconnected')
      wsRef.current = null

      // Reconnect with exponential backoff
      if (reconnect && retriesRef.current < maxRetries && !event.wasClean) {
        const delay = Math.min(1000 * 2 ** retriesRef.current, 30_000)
        retriesRef.current++
        setTimeout(connect, delay)
      }
    }

    ws.onerror = () => {
      // onclose will fire after onerror — reconnection handled there
    }

    wsRef.current = ws
  }, [url, onMessage, reconnect, maxRetries])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  const disconnect = useCallback(() => {
    retriesRef.current = maxRetries // prevent reconnection
    wsRef.current?.close(1000, 'Client disconnect')
  }, [maxRetries])

  useEffect(() => {
    connect()
    return () => {
      retriesRef.current = maxRetries // prevent reconnection on unmount
      wsRef.current?.close(1000, 'Component unmount')
    }
  }, [connect, maxRetries])

  return { status, send, disconnect, reconnect: connect }
}
```

---

## Common Gotchas

### 1. Stale Closures

```typescript
// BAD — handler captures stale state
useEffect(() => {
  const channel = supabase.channel('x')
    .on('broadcast', { event: 'update' }, () => {
      console.log(count) // always the initial value!
    })
    .subscribe()
  return () => supabase.removeChannel(channel)
}, []) // missing count in deps

// GOOD — use ref for latest value
const countRef = useRef(count)
countRef.current = count

useEffect(() => {
  const channel = supabase.channel('x')
    .on('broadcast', { event: 'update' }, () => {
      console.log(countRef.current) // always current
    })
    .subscribe()
  return () => supabase.removeChannel(channel)
}, [])
```

### 2. Duplicate Subscriptions (Strict Mode)

React Strict Mode double-mounts components in dev. This creates two subscriptions.
The cleanup function runs between mounts, so with proper cleanup this is handled correctly.

**If you see duplicate events in dev but not prod:** your cleanup is correct.
**If you see duplicate events in prod:** your cleanup is broken.

### 3. Channel Name Uniqueness

```typescript
// BAD — reusing same channel name creates conflicts
supabase.channel('data') // component A
supabase.channel('data') // component B — shares the same channel!

// GOOD — unique channel names
supabase.channel('data:messages')
supabase.channel('data:users')
```

### 4. Subscribing Before Auth

```typescript
// For private channels / Realtime Authorization
useEffect(() => {
  // Set auth BEFORE subscribing
  supabase.realtime.setAuth().then(() => {
    const channel = supabase.channel('private:room', {
      config: { private: true },
    })
    // ...subscribe
  })
}, [])
```

### 5. Memory Leak from Missing Cleanup

```typescript
// BAD — no cleanup
useEffect(() => {
  supabase.channel('x').on('broadcast', { event: 'y' }, handler).subscribe()
  // no return — channel leaks on every re-render!
}, [dep])

// GOOD — always store reference and clean up
useEffect(() => {
  const channel = supabase.channel('x')
    .on('broadcast', { event: 'y' }, handler)
    .subscribe()
  return () => supabase.removeChannel(channel)
}, [dep])
```

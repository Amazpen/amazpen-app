import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

export async function POST(request: NextRequest) {
  const { userIds, title, message, url } = await request.json()

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return NextResponse.json({ error: 'Missing userIds' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY!
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:hello@amazpen.co.il'

  if (!serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return NextResponse.json({ error: 'Server config missing' }, { status: 500 })
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

  const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: subscriptions, error } = await adminSupabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, user_id')
    .in('user_id', userIds)

  if (error || !subscriptions) {
    return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 })
  }

  const payload = JSON.stringify({ title, message, url: url || '/' })

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload
      ).catch(async (err: { statusCode?: number }) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await adminSupabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint)
        }
        throw err
      })
    )
  )

  const sent = results.filter((r) => r.status === 'fulfilled').length
  const failed = results.filter((r) => r.status === 'rejected').length

  return NextResponse.json({ success: true, sent, failed })
}

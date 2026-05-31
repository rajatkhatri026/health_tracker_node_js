// Expo Push Notification helper — sends a push to a device via Expo's free push service
// Docs: https://docs.expo.dev/push-notifications/sending-notifications/

interface PushPayload {
  to:       string;   // Expo push token — e.g. ExponentPushToken[xxx]
  title:    string;
  body:     string;
  data?:    Record<string, unknown>;
  sound?:   'default' | null;
  badge?:   number;
  priority?: 'default' | 'normal' | 'high';
}

export async function sendExpoPush(payload: PushPayload): Promise<void> {
  // Only send to valid Expo push tokens
  if (!payload.to || !payload.to.startsWith('ExponentPushToken')) return;

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Encoding': 'gzip, deflate' },
      body: JSON.stringify({
        to:       payload.to,
        title:    payload.title,
        body:     payload.body,
        data:     payload.data   ?? {},
        sound:    payload.sound  ?? 'default',
        priority: payload.priority ?? 'high',
      }),
    });
  } catch (e) {
    // Non-critical — log but never throw, bell notification still saves to DB
    console.warn('[ExpoPush] Failed to send push:', e);
  }
}

import { Expo } from 'expo-server-sdk';

let expo = new Expo();

export const sendPushNotification = async (pushToken, title, body, data = {}, options = {}) => {
  if (!Expo.isExpoPushToken(pushToken)) {
    console.error(`Push token ${pushToken} is not a valid Expo push token`);
    return;
  }

  // If the device is offline, FCM/APNs may store the notification and deliver it
  // when the device comes back online, as long as it's within the TTL.
  // (Tune this to your product needs.)
  const ttlSeconds = 60 * 60 * 24; // 24 hours

  // Instagram-like behavior:
  // - Use collapseId/threadId so multiple messages for same chat collapse into a single notification.
  // - Optionally attach an image (sender avatar) for richer notification UI where supported.
  const collapseId = options?.collapseId;
  const threadId = options?.threadId;
  const categoryId = options?.categoryId;
  const image = options?.image;

  const messages = [{
    to: pushToken,
    sound: 'default',
    title: title,
    body: body,
    data: data,
    priority: 'high',
    channelId: 'chat-messages', // For Android 8.0+
    ...(collapseId ? { collapseId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(image ? { image } : {}),
    ttl: ttlSeconds,
    expiration: Math.floor(Date.now() / 1000) + ttlSeconds,
  }];

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        for (const ticket of ticketChunk) {
          if (ticket.status === 'error') {
            console.error('[push] Expo ticket error', {
              message: ticket.message,
              details: ticket.details,
            });
          }
        }
      } catch (error) {
        console.error('Error sending push chunk', error);
      }
    }
  } catch (error) {
    console.error('Error sending push notification', error);
  }
};

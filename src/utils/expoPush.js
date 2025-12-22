import { Expo } from 'expo-server-sdk';

let expo = new Expo();

export const sendPushNotification = async (pushToken, title, body, data = {}) => {
  if (!Expo.isExpoPushToken(pushToken)) {
    console.error(`Push token ${pushToken} is not a valid Expo push token`);
    return;
  }

  // If the device is offline, FCM/APNs may store the notification and deliver it
  // when the device comes back online, as long as it's within the TTL.
  // (Tune this to your product needs.)
  const ttlSeconds = 60 * 60 * 24; // 24 hours

  const messages = [{
    to: pushToken,
    sound: 'default',
    title: title,
    body: body,
    data: data,
    priority: 'high',
    channelId: 'chat-messages', // For Android 8.0+
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

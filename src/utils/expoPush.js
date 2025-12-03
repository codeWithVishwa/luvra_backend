import { Expo } from 'expo-server-sdk';

let expo = new Expo();

export const sendPushNotification = async (pushToken, title, body, data = {}) => {
  if (!Expo.isExpoPushToken(pushToken)) {
    console.error(`Push token ${pushToken} is not a valid Expo push token`);
    return;
  }

  const messages = [{
    to: pushToken,
    sound: 'default',
    title: title,
    body: body,
    data: data,
    priority: 'high',
    channelId: 'chat-messages', // For Android 8.0+
  }];

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        // console.log('Push ticket', ticketChunk);
        // In a real app, you'd handle errors here (e.g., invalid token)
      } catch (error) {
        console.error('Error sending push chunk', error);
      }
    }
  } catch (error) {
    console.error('Error sending push notification', error);
  }
};

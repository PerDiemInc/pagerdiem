// Leaving the app for Slack or the web.
import * as Clipboard from 'expo-clipboard';
import { Linking } from 'react-native';

import { toast } from '@/components/toast';

/** Opens Slack (D13: the #on-call channel's thread links come later); Slack on the web if the app isn't installed. */
export async function openSlack(channelName: string) {
  try {
    await Linking.openURL('slack://open');
  } catch {
    await Linking.openURL(`https://slack.com/app_redirect?channel=${encodeURIComponent(channelName)}`);
  }
}

export async function copyLink(url: string, message = 'Link copied') {
  await Clipboard.setStringAsync(url);
  toast.show({ text: message });
}

/** Subscribes the phone's calendar to the team's on-call weekends. */
export const addToCalendar = (feedUrl: string) => Linking.openURL(feedUrl.replace(/^https?:/, 'webcal:'));

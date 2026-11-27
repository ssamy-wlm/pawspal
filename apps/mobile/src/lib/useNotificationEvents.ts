// Listens for notifications while signed in: shows the small in-app banner for one that arrives while the app is open, and
// opens the right screen when one is tapped (also when the tap is what started the app). Text is shown but never logged.
import React from 'react';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useToast } from '../components/Toast';
import { useAuth } from './auth';
import { installForegroundHandler, notificationRoute, notificationsAvailable, refreshPushToken } from './notifications';

installForegroundHandler();

export function useNotificationEvents(): void {
  const toast = useToast();
  const { session } = useAuth();
  const signedIn = !!session;

  React.useEffect(() => {
    if (!notificationsAvailable() || !signedIn) return;
    refreshPushToken().catch(() => {});
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const route = notificationRoute(response.notification.request.content.data);
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
      if (route) router.push(route as never);
    };
    Notifications.getLastNotificationResponseAsync().then(open, () => {});
    const received = Notifications.addNotificationReceivedListener((n) => {
      const body = n.request.content.body ?? n.request.content.title;
      if (body) toast.show(body, 'info');
    });
    const tapped = Notifications.addNotificationResponseReceivedListener(open);
    return () => { received.remove(); tapped.remove(); };
  }, [signedIn, toast]);
}

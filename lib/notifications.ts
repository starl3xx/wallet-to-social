/**
 * Browser notification utilities using the Web Notifications API
 */

export function canNotify(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getPermissionStatus(): NotificationPermission | 'unsupported' {
  if (!canNotify()) return 'unsupported';
  return Notification.permission;
}

export async function requestPermission(): Promise<boolean> {
  if (!canNotify()) return false;

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    return false;
  }

  const result = await Notification.requestPermission();
  return result === 'granted';
}

interface NotifyOptions {
  body?: string;
  icon?: string;
  tag?: string;
}

export function sendNotification(title: string, options?: NotifyOptions): void {
  if (!canNotify() || Notification.permission !== 'granted') {
    return;
  }

  const notification = new Notification(title, {
    body: options?.body,
    icon: options?.icon || '/favicon.ico',
    tag: options?.tag || 'wallet-lookup',
  });

  // Focus the window when notification is clicked
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

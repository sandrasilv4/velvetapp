// service-worker.js
const CACHE_NAME = 'velvet-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// ← ESTE É O HANDLER QUE MOSTRA A NOTIFICAÇÃO
self.addEventListener('push', e => {
  if (!e.data) return;

  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Nova mensagem', body: e.data.text() }; }

  const options = {
    body: data.body || 'Você recebeu uma nova mensagem.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
    requireInteraction: false,
    tag: 'nova-mensagem', // agrupa notificações do mesmo tipo
    renotify: true
  };

  e.waitUntil(
    self.registration.showNotification(data.title || 'Velvet', options)
  );
});

// Ao clicar na notificação, abre a URL correta
self.addEventListener('notificationclick', e => {
  e.notification.close();

  const url = e.notification.data?.url || '/';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
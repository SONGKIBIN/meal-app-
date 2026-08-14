// 최소 서비스 워커: PWA 설치(홈 화면에 추가)를 가능하게 하기 위한 용도입니다.
// 데이터는 항상 최신 상태가 중요하므로 API 응답은 캐시하지 않습니다.
const CACHE_NAME = "meal-app-shell-v1";
const SHELL_FILES = [
  "/",
  "/css/style.css",
  "/js/i18n.js",
  "/js/api.js",
  "/js/app.js",
  "/js/admin.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // API 요청은 캐시하지 않고 항상 네트워크로 전달
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// 서버(관리자 일일 집계 알림 / 신청 마감 임박 알림)에서 보낸 웹 푸시 메시지를 화면에 표시합니다.
self.addEventListener("push", (event) => {
  let data = { title: "알림", body: "" };
  try {
    if (event.data) data = event.data.json();
  } catch (err) {
    data.body = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "알림", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

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

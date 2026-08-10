var CACHE_NAME = 'contactprint-v4'; // ← меняйте число при каждом обновлении

var URLS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json'
];

// Установка — кэшируем новые файлы
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(URLS_TO_CACHE);
        })
    );
    // Сразу активировать новый SW, не ждать закрытия вкладок
    self.skipWaiting();
});

// Активация — удаляем старые кэши
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(names) {
            return Promise.all(
                names.map(function(name) {
                    if (name !== CACHE_NAME) {
                        return caches.delete(name);
                    }
                })
            );
        })
    );
    // Перехватить все открытые вкладки
    self.clients.claim();
});

// Запросы — сначала сеть, потом кэш
self.addEventListener('fetch', function(event) {
    event.respondWith(
        fetch(event.request).then(function(response) {
            // Обновляем кэш свежей копией
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
                cache.put(event.request, clone);
            });
            return response;
        }).catch(function() {
            // Нет сети — берём из кэша
            return caches.match(event.request);
        })
    );
});

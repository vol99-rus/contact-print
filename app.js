// ============================================================
// CONTACT PRINT — PWA для контактной фотопечати
// ============================================================

(function () {
    'use strict';

    // ============ STATE ============
    const state = {
        originalImage: null,
        imageData: null,
        invertedImageData: null,
        redImageData: null,
        exposureTime: 10.0,
        waitTime: 10.0,
        phase: 'idle',
        timer: null,
        timeRemaining: 0,
        presets: [],
        imageLoaded: false,
        imageWidth: 0,
        imageHeight: 0,
        wakeLock: null,
    };

    // ============ DOM ============
    const $ = (sel) => document.querySelector(sel);
    const mainScreen = $('#mainScreen');
    const exposureScreen = $('#exposureScreen');
    const previewCanvas = $('#previewCanvas');
    const previewCtx = previewCanvas.getContext('2d');
    const exposureCanvas = $('#exposureCanvas');
    const exposureCtx = exposureCanvas.getContext('2d');
    const previewPlaceholder = $('#previewPlaceholder');
    const fileInput = $('#fileInput');
    const timeDisplay = $('#timeDisplay');
    const timeSlider = $('#timeSlider');
    const btnLoadPhoto = $('#btnLoadPhoto');
    const btnStart = $('#btnStart');
    const btnStop = $('#btnStop');
    const btnPresets = $('#btnPresets');
    const presetModal = $('#presetModal');
    const presetList = $('#presetList');
    const btnClosePresets = $('#btnClosePresets');
    const btnSavePreset = $('#btnSavePreset');
    const presetForm = $('#presetForm');
    const presetNameInput = $('#presetNameInput');
    const btnConfirmPreset = $('#btnConfirmPreset');
    const btnCancelPreset = $('#btnCancelPreset');
    const phaseIndicator = $('#phaseIndicator');

    // ============ AUDIO ============
    let audioCtx = null;

    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playTone(frequency, duration) {
        try {
            const ctx = getAudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(frequency, ctx.currentTime);
            gain.gain.setValueAtTime(0.5, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + duration);
        } catch (e) {
            console.warn('Audio error:', e);
        }
    }

    function playStartBeep() {
        playTone(1000, 0.25);
    }

    function playEndBeep() {
        playTone(880, 0.15);
        setTimeout(() => playTone(660, 0.4), 300);
    }

    // ============ WAKE LOCK ============
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                state.wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (e) {
            console.warn('WakeLock not available:', e);
        }
    }

    function releaseWakeLock() {
        try {
            if (state.wakeLock) {
                state.wakeLock.release();
                state.wakeLock = null;
            }
        } catch (e) {
            console.warn('WakeLock release error:', e);
        }
    }

    // ============ FULLSCREEN ============
    function tryFullscreen() {
        try {
            const el = document.documentElement;
            if (el.requestFullscreen) {
                el.requestFullscreen();
            } else if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen();
            }
        } catch (e) { }
    }

    function exitFullscreen() {
        try {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        } catch (e) { }
    }

    // ============ HELPERS ============
    function formatTime(seconds) {
        if (seconds >= 60) {
            const min = Math.floor(seconds / 60);
            const sec = seconds - min * 60;
            if (sec % 1 === 0) {
                return min + ':' + String(Math.round(sec)).padStart(2, '0');
            } else {
                return min + ':' + sec.toFixed(1).padStart(4, '0');
            }
        } else {
            if (seconds % 1 === 0) {
                return seconds.toFixed(0) + ' сек';
            } else {
                return seconds.toFixed(1) + ' сек';
            }
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function generateId() {
        return 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    }

    function updateTimeDisplay() {
        timeDisplay.textContent = formatTime(state.exposureTime);
        timeSlider.value = state.exposureTime;
    }

    // ============ PRESETS ============
    const DEFAULT_PRESETS = [
        { id: 'p1', name: 'RC бумага — тест', time: 3.0 },
        { id: 'p2', name: 'RC бумага — норма', time: 8.0 },
        { id: 'p3', name: 'Баритовая — мягко', time: 12.0 },
        { id: 'p4', name: 'Баритовая — норма', time: 20.0 },
        { id: 'p5', name: 'Баритовая — контраст', time: 30.0 },
        { id: 'p6', name: 'Цианотипия', time: 120.0 },
        { id: 'p7', name: 'Соляная печать', time: 300.0 },
    ];

    function loadPresets() {
        try {
            const saved = localStorage.getItem('contactprint_presets');
            if (saved) {
                state.presets = JSON.parse(saved);
            } else {
                state.presets = DEFAULT_PRESETS.map(p => ({ ...p }));
                savePresets();
            }
        } catch (e) {
            state.presets = DEFAULT_PRESETS.map(p => ({ ...p }));
        }
    }

    function savePresets() {
        try {
            localStorage.setItem('contactprint_presets', JSON.stringify(state.presets));
        } catch (e) { }
    }

    function renderPresets() {
        presetList.innerHTML = '';
        state.presets.forEach((preset) => {
            const item = document.createElement('div');
            item.className = 'preset-item';
            item.innerHTML = `
                <div>
                    <div class="preset-name">${escapeHtml(preset.name)}</div>
                    <div class="preset-time">${formatTime(preset.time)}</div>
                </div>
                <button class="preset-delete" data-id="${preset.id}" title="Удалить">🗑</button>
            `;
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('preset-delete')) return;
                state.exposureTime = preset.time;
                updateTimeDisplay();
                presetModal.classList.remove('active');
            });
            item.querySelector('.preset-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                state.presets = state.presets.filter(p => p.id !== preset.id);
                savePresets();
                renderPresets();
            });
            presetList.appendChild(item);
        });
    }

    // ============ IMAGE PROCESSING ============
    function processImage(img) {
        const MAX_SIZE = 2048;
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;

        if (w > MAX_SIZE || h > MAX_SIZE) {
            const ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
        }

        const offCanvas = document.createElement('canvas');
        offCanvas.width = w;
        offCanvas.height = h;
        const offCtx = offCanvas.getContext('2d');
        offCtx.drawImage(img, 0, 0, w, h);
        const originalData = offCtx.getImageData(0, 0, w, h);

        // Негатив
        const invertedData = new ImageData(new Uint8ClampedArray(originalData.data), w, h);
        for (let i = 0; i < invertedData.data.length; i += 4) {
            invertedData.data[i] = 255 - invertedData.data[i];
            invertedData.data[i + 1] = 255 - invertedData.data[i + 1];
            invertedData.data[i + 2] = 255 - invertedData.data[i + 2];
        }

        // Красный негатив
        const redData = new ImageData(new Uint8ClampedArray(originalData.data), w, h);
        for (let i = 0; i < redData.data.length; i += 4) {
            const invR = 255 - redData.data[i];
            const invG = 255 - redData.data[i + 1];
            const invB = 255 - redData.data[i + 2];
            const lum = 0.299 * invR + 0.587 * invG + 0.114 * invB;
            redData.data[i] = Math.round(lum * 0.55);
            redData.data[i + 1] = 0;
            redData.data[i + 2] = 0;
        }

        state.imageData = originalData;
        state.invertedImageData = invertedData;
        state.redImageData = redData;
        state.imageLoaded = true;
        state.imageWidth = w;
        state.imageHeight = h;

        showPreview(invertedData, w, h);
        btnStart.disabled = false;
    }

    function showPreview(imageData, w, h) {
        previewCanvas.width = w;
        previewCanvas.height = h;
        previewCtx.putImageData(imageData, 0, 0);
        previewCanvas.style.display = 'block';
        previewPlaceholder.style.display = 'none';
    }

    // ============ DRAW IMAGE ON EXPOSURE CANVAS ============
    function drawExposureImage(imageData, backgroundColor) {
        const canvas = exposureCanvas;
        const ctx = exposureCtx;
        const dpr = window.devicePixelRatio || 1;

        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';

        // Заливаем фон
        ctx.fillStyle = backgroundColor || '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Рисуем изображение с сохранением пропорций
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = state.imageWidth;
        tmpCanvas.height = state.imageHeight;
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.putImageData(imageData, 0, 0);

        const cw = canvas.width;
        const ch = canvas.height;
        const iw = state.imageWidth;
        const ih = state.imageHeight;
        const scale = Math.min(cw / iw, ch / ih);
        const drawW = iw * scale;
        const drawH = ih * scale;
        const offsetX = (cw - drawW) / 2;
        const offsetY = (ch - drawH) / 2;

        ctx.drawImage(tmpCanvas, offsetX, offsetY, drawW, drawH);
    }

    // ============ EXPOSURE PROCESS ============
    function startExposure() {
        if (!state.imageLoaded) return;

        // Инициализируем аудио по жесту
        getAudioContext();

        mainScreen.classList.remove('active');
        exposureScreen.classList.add('active');

        // Фаза ожидания
        state.phase = 'waiting';
        state.timeRemaining = state.waitTime;

        phaseIndicator.textContent = '● ПОДГОТОВКА';
        phaseIndicator.style.display = 'block';
        phaseIndicator.onclick = null;

        // Красное изображение, тёмный фон
        drawExposureImage(state.redImageData, '#000000');
        document.body.style.background = '#000';

        requestWakeLock();

        // Таймер 100мс
        state.timer = setInterval(() => {
            state.timeRemaining -= 0.1;

            if (state.phase === 'waiting') {
                if (state.timeRemaining <= 0) {
                    beginExposing();
                }
            } else if (state.phase === 'exposing') {
                if (state.timeRemaining <= 0) {
                    finishExposure();
                }
            }
        }, 100);
    }

    function beginExposing() {
        state.phase = 'exposing';
        state.timeRemaining = state.exposureTime;

        playStartBeep();

        // Белый фон + негатив = максимальная яркость
        drawExposureImage(state.invertedImageData, '#ffffff');
        document.body.style.background = '#ffffff';

        phaseIndicator.style.display = 'none';
    }

    function finishExposure() {
        state.phase = 'finished';
        clearInterval(state.timer);
        state.timer = null;

        playEndBeep();

        // Обратно красное изображение
        drawExposureImage(state.redImageData, '#000000');
        document.body.style.background = '#000';

        phaseIndicator.textContent = '● ГОТОВО — НАЖМИТЕ ДЛЯ ВЫХОДА';
        phaseIndicator.style.display = 'block';
        phaseIndicator.onclick = stopExposure;
    }

    function stopExposure() {
        clearInterval(state.timer);
        state.timer = null;
        state.phase = 'idle';

        document.body.style.background = '#0a0a0a';

        exposureScreen.classList.remove('active');
        mainScreen.classList.add('active');

        phaseIndicator.onclick = null;
        releaseWakeLock();
        exitFullscreen();
    }

    // ============ RESIZE HANDLER ============
    function handleResize() {
        if (state.phase === 'waiting' || state.phase === 'finished') {
            drawExposureImage(state.redImageData, '#000000');
        } else if (state.phase === 'exposing') {
            drawExposureImage(state.invertedImageData, '#ffffff');
        }
    }

    // ============ EVENT LISTENERS ============
    function init() {
        loadPresets();

        // Загрузка фото
        btnLoadPhoto.addEventListener('click', () => fileInput.click());
        $('#previewContainer').addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    state.originalImage = img;
                    processImage(img);
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
            fileInput.value = '';
        });

        // Время экспонирования — кнопки
        document.querySelectorAll('.btn-time').forEach(btn => {
            btn.addEventListener('click', () => {
                const delta = parseFloat(btn.dataset.delta);
                state.exposureTime = Math.max(0.5, Math.min(600,
                    Math.round((state.exposureTime + delta) * 10) / 10
                ));
                updateTimeDisplay();
            });
        });

        // Слайдер
        timeSlider.addEventListener('input', (e) => {
            state.exposureTime = parseFloat(e.target.value);
            updateTimeDisplay();
        });

        // Старт
        btnStart.addEventListener('click', startExposure);

        // Стоп
        btnStop.addEventListener('click', stopExposure);

        // Пресеты — открыть
        btnPresets.addEventListener('click', () => {
            renderPresets();
            presetModal.classList.add('active');
        });

        // Пресеты — закрыть
        btnClosePresets.addEventListener('click', () => {
            presetModal.classList.remove('active');
            presetForm.style.display = 'none';
        });

        // Пресеты — сохранить текущие
        btnSavePreset.addEventListener('click', () => {
            presetNameInput.value = '';
            presetForm.style.display = 'flex';
            presetNameInput.focus();
        });

        // Пресеты — подтвердить
        btnConfirmPreset.addEventListener('click', () => {
            const name = presetNameInput.value.trim();
            if (!name) {
                presetNameInput.style.borderColor = 'red';
                return;
            }
            state.presets.push({
                id: generateId(),
                name: name,
                time: state.exposureTime
            });
            savePresets();
            renderPresets();
            presetForm.style.display = 'none';
            presetNameInput.style.borderColor = '';
        });

        // Пресеты — отмена
        btnCancelPreset.addEventListener('click', () => {
            presetForm.style.display = 'none';
        });

        // Закрытие модалки по клику на фон
        presetModal.addEventListener('click', (e) => {
            if (e.target === presetModal) {
                presetModal.classList.remove('active');
                presetForm.style.display = 'none';
            }
        });

        // Ресайз
        window.addEventListener('resize', () => {
            if (state.phase !== 'idle') {
                handleResize();
            }
        });

        // Обновляем отображение времени
        updateTimeDisplay();

        // Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(err => {
                console.warn('SW registration failed:', err);
            });
        }
    }

    // Запуск
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

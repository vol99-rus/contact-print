// ============================================================
// CONTACT PRINT — PWA для контактной фотопечати
// v3: Исправлена засветка красным фоном
// ============================================================

(function () {
    'use strict';

    // ============ STATE ============
    const state = {
        originalImage: null,
        imageData: null,
        invertedImageData: null,
        invertedBWImageData: null,
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
        bwMode: false,
        fillMode: false,
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
    const optionBW = $('#optionBW');
    const optionFill = $('#optionFill');

    // ============ AUDIO ============
    let audioCtx = null;

    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
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
        } catch (e) {}
    }

    function playStartBeep() { playTone(1000, 0.25); }
    function playEndBeep() {
        playTone(880, 0.15);
        setTimeout(() => playTone(660, 0.4), 300);
    }

    // ============ WAKE LOCK ============
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator)
                state.wakeLock = await navigator.wakeLock.request('screen');
        } catch (e) {}
    }
    function releaseWakeLock() {
        try { if (state.wakeLock) { state.wakeLock.release(); state.wakeLock = null; } } catch (e) {}
    }

    // ============ FULLSCREEN ============
    function tryFullscreen() {
        try {
            const el = document.documentElement;
            if (el.requestFullscreen) el.requestFullscreen();
            else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        } catch (e) {}
    }
    function exitFullscreen() {
        try {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } catch (e) {}
    }

    // ============ HELPERS ============
    function formatTime(seconds) {
        if (seconds >= 60) {
            const min = Math.floor(seconds / 60);
            const sec = seconds - min * 60;
            return sec % 1 === 0
                ? min + ':' + String(Math.round(sec)).padStart(2, '0')
                : min + ':' + sec.toFixed(1).padStart(4, '0');
        }
        return seconds % 1 === 0
            ? seconds.toFixed(0) + ' сек'
            : seconds.toFixed(1) + ' сек';
    }

    function escapeHtml(t) {
        const d = document.createElement('div');
        d.textContent = t;
        return d.innerHTML;
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
            const s = localStorage.getItem('contactprint_presets');
            state.presets = s ? JSON.parse(s) : DEFAULT_PRESETS.map(p => ({...p}));
        } catch (e) {
            state.presets = DEFAULT_PRESETS.map(p => ({...p}));
        }
        if (!localStorage.getItem('contactprint_presets')) savePresets();
    }

    function savePresets() {
        try { localStorage.setItem('contactprint_presets', JSON.stringify(state.presets)); } catch (e) {}
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
                <button class="preset-delete" data-id="${preset.id}">🗑</button>
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
        const MAX = 2048;
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;

        if (w > MAX || h > MAX) {
            const r = Math.min(MAX / w, MAX / h);
            w = Math.round(w * r);
            h = Math.round(h * r);
        }

        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const original = ctx.getImageData(0, 0, w, h);

        // Цветной негатив
        const invColor = new ImageData(new Uint8ClampedArray(original.data), w, h);
        for (let i = 0; i < invColor.data.length; i += 4) {
            invColor.data[i]     = 255 - invColor.data[i];
            invColor.data[i + 1] = 255 - invColor.data[i + 1];
            invColor.data[i + 2] = 255 - invColor.data[i + 2];
        }

        // Ч/Б негатив
        const invBW = new ImageData(new Uint8ClampedArray(original.data), w, h);
        for (let i = 0; i < invBW.data.length; i += 4) {
            const lum = Math.round(
                0.299 * (255 - invBW.data[i]) +
                0.587 * (255 - invBW.data[i + 1]) +
                0.114 * (255 - invBW.data[i + 2])
            );
            invBW.data[i]     = lum;
            invBW.data[i + 1] = lum;
            invBW.data[i + 2] = lum;
        }

        // ★ ИСПРАВЛЕНО: Красный негатив — яркость снижена до 3%
        // Было 0.55 — засвечивало бумагу
        const red = new ImageData(new Uint8ClampedArray(original.data), w, h);
        for (let i = 0; i < red.data.length; i += 4) {
            const lum = 0.299 * (255 - red.data[i]) +
                        0.587 * (255 - red.data[i + 1]) +
                        0.114 * (255 - red.data[i + 2]);
            red.data[i]     = Math.round(lum * 0.03);  // ★ было 0.55
            red.data[i + 1] = 0;
            red.data[i + 2] = 0;
        }

        state.imageData = original;
        state.invertedImageData = invColor;
        state.invertedBWImageData = invBW;
        state.redImageData = red;
        state.imageLoaded = true;
        state.imageWidth = w;
        state.imageHeight = h;

        updatePreview();
        btnStart.disabled = false;
    }

    function getActiveNegative() {
        return state.bwMode ? state.invertedBWImageData : state.invertedImageData;
    }

    function updatePreview() {
        if (!state.imageLoaded) return;
        const imgData = getActiveNegative();
        previewCanvas.width = state.imageWidth;
        previewCanvas.height = state.imageHeight;
        previewCtx.putImageData(imgData, 0, 0);
        previewCanvas.style.display = 'block';
        previewPlaceholder.style.display = 'none';
    }

    // ============ DRAW ON EXPOSURE CANVAS ============

    function imageDataToCanvas(imageData, w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').putImageData(imageData, 0, 0);
        return c;
    }

    function drawExposureImage(imageData) {
        const canvas = exposureCanvas;
        const ctx = exposureCtx;
        const dpr = window.devicePixelRatio || 1;

        const screenW = window.innerWidth;
        const screenH = window.innerHeight;

        canvas.width = screenW * dpr;
        canvas.height = screenH * dpr;
        canvas.style.width = screenW + 'px';
        canvas.style.height = screenH + 'px';

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const tmpCanvas = imageDataToCanvas(imageData, state.imageWidth, state.imageHeight);

        const iw = state.imageWidth;
        const ih = state.imageHeight;
        const cw = canvas.width;
        const ch = canvas.height;

        let scale;
        if (state.fillMode) {
            scale = Math.max(cw / iw, ch / ih);
        } else {
            scale = Math.min(cw / iw, ch / ih);
        }

        const drawW = iw * scale;
        const drawH = ih * scale;
        const offsetX = (cw - drawW) / 2;
        const offsetY = (ch - drawH) / 2;

        ctx.drawImage(tmpCanvas, offsetX, offsetY, drawW, drawH);
    }

    // ★ Безопасный экран — тёмно-красный вместо чёрного
    // Фотобумага (включая мультиконтрастную) нечувствительна к красному >600нм
    // LCD подсветка при "чёрном" экране даёт утечку белого света — это засвечивает
    // Тёмно-красный заливает экран красными субпикселями, блокируя синий и зелёный
    
    function drawSafeScreen() {
        const canvas = exposureCanvas;
        const ctx = exposureCtx;
        const dpr = window.devicePixelRatio || 1;
    
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
    
        canvas.width = screenW * dpr;
        canvas.height = screenH * dpr;
        canvas.style.width = screenW + 'px';
        canvas.style.height = screenH + 'px';
    
        // Тёмно-красный — безопасен для фотобумаги
        // Значение 10-15 достаточно чтобы LCD включил красные субпиксели
        // и погасил синие/зелёные, но не засвечивал бумагу
        ctx.fillStyle = '#0a0000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }


    // ============ EXPOSURE PROCESS ============

    function startExposure() {
        if (!state.imageLoaded) return;
        getAudioContext();
        tryFullscreen();

        mainScreen.classList.remove('active');
        exposureScreen.classList.add('active');

        state.phase = 'waiting';
        state.timeRemaining = state.waitTime;
        phaseIndicator.textContent = '● ПОДГОТОВКА';
        phaseIndicator.style.display = 'block';
        phaseIndicator.onclick = null;

        // ★ ИСПРАВЛЕНО: во время ожидания — ЧЁРНЫЙ экран, не красный!
        // Бумага уже лежит под телефоном, любой свет = засветка
        drawBlackScreen();
        document.body.style.background = '#000';

        requestWakeLock();

        state.timer = setInterval(() => {
            state.timeRemaining -= 0.1;

            if (state.phase === 'waiting' && state.timeRemaining <= 0) {
                beginExposing();
            } else if (state.phase === 'exposing' && state.timeRemaining <= 0) {
                finishExposure();
            }
        }, 100);
    }

    function beginExposing() {
        state.phase = 'exposing';
        state.timeRemaining = state.exposureTime;
        playStartBeep();

        // Рисуем негатив — это единственный момент когда экран светит
        const neg = getActiveNegative();
        drawExposureImage(neg);

        document.body.style.background = '#000';
        phaseIndicator.style.display = 'none';
    }

    function finishExposure() {
        state.phase = 'finished';
        clearInterval(state.timer);
        state.timer = null;
        playEndBeep();

        // ★ ИСПРАВЛЕНО: после экспонирования — ЧЁРНЫЙ экран, не красный!
        // Бумага всё ещё под телефоном, красный свет = дополнительная засветка
        drawBlackScreen();
        document.body.style.background = '#000';

        phaseIndicator.textContent = '● ГОТОВО — НАЖМИТЕ ДЛЯ ВЫХОДА';
        phaseIndicator.style.display = 'block';
        phaseIndicator.style.color = '#00ff00';  // зелёный текст на чёрном фоне
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
        phaseIndicator.style.color = '';  // сброс цвета
        releaseWakeLock();
        exitFullscreen();
    }

    // ============ RESIZE ============
    function handleResize() {
        if (state.phase === 'waiting' || state.phase === 'finished') {
            // ★ ИСПРАВЛЕНО: при ожидании/завершении — чёрный
            drawBlackScreen();
        } else if (state.phase === 'exposing') {
            drawExposureImage(getActiveNegative());
        }
    }

    // ============ TOGGLE OPTIONS ============

    function loadOptions() {
        try {
            state.bwMode = localStorage.getItem('cp_bw') === 'true';
            state.fillMode = localStorage.getItem('cp_fill') === 'true';
        } catch (e) {}

        if (state.bwMode) optionBW.classList.add('active');
        if (state.fillMode) optionFill.classList.add('active');
    }

    function saveOptions() {
        try {
            localStorage.setItem('cp_bw', state.bwMode);
            localStorage.setItem('cp_fill', state.fillMode);
        } catch (e) {}
    }

    function toggleBW() {
        state.bwMode = !state.bwMode;
        optionBW.classList.toggle('active', state.bwMode);
        saveOptions();
        updatePreview();
    }

    function toggleFill() {
        state.fillMode = !state.fillMode;
        optionFill.classList.toggle('active', state.fillMode);
        saveOptions();
    }

    // ============ INIT ============

    function init() {
        loadPresets();
        loadOptions();

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

        // Опции
        optionBW.addEventListener('click', toggleBW);
        optionFill.addEventListener('click', toggleFill);

        // Время — кнопки
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

        // ★ ИСПРАВЛЕНО: тап по всему экрану экспонирования для остановки
        // (вместо отдельной кнопки stop)
        exposureScreen.addEventListener('click', function(e) {
            if (e.target === phaseIndicator) return;
            if (state.phase === 'idle') return;
            stopExposure();
        });

        // Пресеты
        btnPresets.addEventListener('click', () => {
            renderPresets();
            presetModal.classList.add('active');
        });
        btnClosePresets.addEventListener('click', () => {
            presetModal.classList.remove('active');
            presetForm.style.display = 'none';
        });
        btnSavePreset.addEventListener('click', () => {
            presetNameInput.value = '';
            presetForm.style.display = 'flex';
            presetNameInput.focus();
        });
        btnConfirmPreset.addEventListener('click', () => {
            const name = presetNameInput.value.trim();
            if (!name) { presetNameInput.style.borderColor = 'red'; return; }
            state.presets.push({ id: generateId(), name, time: state.exposureTime });
            savePresets();
            renderPresets();
            presetForm.style.display = 'none';
            presetNameInput.style.borderColor = '';
        });
        btnCancelPreset.addEventListener('click', () => {
            presetForm.style.display = 'none';
        });
        presetModal.addEventListener('click', (e) => {
            if (e.target === presetModal) {
                presetModal.classList.remove('active');
                presetForm.style.display = 'none';
            }
        });

        // Ресайз
        window.addEventListener('resize', () => {
            if (state.phase !== 'idle') handleResize();
        });

        updateTimeDisplay();

        // Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

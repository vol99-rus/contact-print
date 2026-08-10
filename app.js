// ============================================================
// CONTACT PRINT — PWA для контактной фотопечати
// v2: Ч/Б негатив, заполнение экрана, чёрные края
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

        // Новые опции
        bwMode: false,       // Ч/Б негатив
        fillMode: false,     // Заполнить экран (cover vs contain)
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
        } catch (e) { }
    }

    function releaseWakeLock() {
        try {
            if (state.wakeLock) {
                state.wakeLock.release();
                state.wakeLock = null;
            }
        } catch (e) { }
    }

    // ============ FULLSCREEN ============
    function tryFullscreen() {
        try {
            const el = document.documentElement;
            if (el.requestFullscreen) el.requestFullscreen();
            else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        } catch (e) { }
    }

    function exitFullscreen() {
        try {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
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

    /**
     * Преобразует ImageData в оттенки серого (Ч/Б)
     */
    function toGrayscale(srcData, w, h) {
        const result = new ImageData(new Uint8ClampedArray(srcData.data), w, h);
        for (let i = 0; i < result.data.length; i += 4) {
            const lum = Math.round(
                0.299 * result.data[i] +
                0.587 * result.data[i + 1] +
                0.114 * result.data[i + 2]
            );
            result.data[i] = lum;
            result.data[i + 1] = lum;
            result.data[i + 2] = lum;
        }
        return result;
    }

    /**
     * Инвертирует ImageData (создаёт негатив)
     */
    function invertImageData(srcData, w, h) {
        const result = new ImageData(new Uint8ClampedArray(srcData.data), w, h);
        for (let i = 0; i < result.data.length; i += 4) {
            result.data[i] = 255 - result.data[i];
            result.data[i + 1] = 255 - result.data[i + 1];
            result.data[i + 2] = 255 - result.data[i + 2];
        }
        return result;
    }

    /**
     * Создаёт красный негатив для безопасного света
     */
    function toRedSafelight(srcData, w, h) {
        const result = new ImageData(new Uint8ClampedArray(srcData.data), w, h);
        for (let i = 0; i < result.data.length; i += 4) {
            const invR = 255 - result.data[i];
            const invG = 255 - result.data[i + 1];
            const invB = 255 - result.data[i + 2];
            const lum = 0.299 * invR + 0.587 * invG + 0.114 * invB;
            result.data[i] = Math.round(lum * 0.55);
            result.data[i + 1] = 0;
            result.data[i + 2] = 0;
        }
        return result;
    }

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
        offCtx.draw

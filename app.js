(function () {
    'use strict';

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
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function playTone(freq, dur) {
        try {
            const ctx = getAudioContext();
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            g.gain.setValueAtTime(0.5, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + dur);
        } catch (e) {}
    }

    function playStartBeep() { playTone(1000, 0.25); }
    function playEndBeep() { playTone(880, 0.15); setTimeout(() => playTone(660, 0.4), 300); }

    // ============ WAKE LOCK ============
    async function requestWakeLock() {
        try { if ('wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
    }
    function releaseWakeLock() {
        try { if (state.wakeLock) { state.wakeLock.release(); state.wakeLock = null; } } catch (e) {}
    }

    // ============ HELPERS ============
    function formatTime(s) {
        if (s >= 60) {
            const m = Math.floor(s / 60), sec = s - m * 60;
            return sec % 1 === 0
                ? m + ':' + String(Math.round(sec)).padStart(2, '0')
                : m + ':' + sec.toFixed(1).padStart(4, '0');
        }
        return s % 1 === 0 ? s.toFixed(0) + ' сек' : s.toFixed(1) + ' сек';
    }

    function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
    function generateId() { return 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5); }
    function updateTimeDisplay() { timeDisplay.textContent = formatTime(state.exposureTime); timeSlider.value = state.exposureTime; }

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
        } catch (e) { state.presets = DEFAULT_PRESETS.map(p => ({...p})); }
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
            item.innerHTML = `<div><div class="preset-name">${escapeHtml(preset.name)}</div><div class="preset-time">${formatTime(preset.time)}</div></div><button class="preset-delete" data-id="${preset.id}">🗑</button>`;
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('preset-delete')) return;
                state.exposureTime = preset.time;
                updateTimeDisplay();
                presetModal.classList.remove('active');
            });
            item.querySelector('.preset-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                state.presets = state.presets.filter(p => p.id !== preset.id);
                savePresets(); renderPresets();
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
            w = Math.round(w * r); h = Math.round(h * r);
        }

        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const original = ctx.getImageData(0, 0, w, h);

        // Цветной негатив
        const invColor = new ImageData(new Uint8ClampedArray(original.data), w, h);
        for (let i = 0; i < invColor.data.length; i += 4) {
            invColor.data[i] = 255 - invColor.data[i];
            invColor.data[i+1] = 255 - invColor.data[i+1];
            invColor.data[i+2] = 255 - invColor.data[i+2];
        }

        // Ч/Б негатив
        const invBW = new ImageData(new Uint8ClampedArray(original.data), w, h);
        for (let i = 0; i < invBW.data.length; i += 4) {
            const l = Math.round(0.299*(255-invBW.data[i]) + 0.587*(255-invBW.data[i+1]) + 0.114*(255-invBW.data[i+2]));
            invBW.data[i] = l; invBW.data[i+1] = l; invBW.data[i+2] = l;
        }

        // Красный
        const red = new ImageData(new Uint8ClampedArray(original.data), w, h);
        for (let i = 0; i < red.data.length; i += 4) {
            const l = 0.299*(255-red.data[i]) + 0.587*(255-red.data[i+1]) + 0.114*(255-red.data[i+2]);
            red.data[i] = Math.round(l * 0.55); red.data[i+1] = 0; red.data[i+2] = 0;
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
        const d = getActiveNegative();
        previewCanvas.width = state.imageWidth;
        previewCanvas.height = state.imageHeight;
        previewCtx.putImageData(d, 0, 0);
        previewCanvas.style.display = 'block';
        previewPlaceholder.style.display = 'none';
    }

    // ============ DRAW EXPOSURE ============
    function imageDataToCanvas(data, w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').putImageData(data, 0, 0);
        return c;
    }

    function drawExposureImage(imageData) {
        const canvas = exposureCanvas;
        const ctx = exposureCtx;
        const dpr = window.devicePixelRatio || 1;
        const sw = window.innerWidth, sh = window.innerHeight;

        canvas.width = sw * dpr;
        canvas.height = sh * dpr;
        

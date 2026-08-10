(function () {
    'use strict';

    var state = {
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
        fillMode: false
    };

    function $(sel) { return document.querySelector(sel); }

    var mainScreen = $('#mainScreen');
    var exposureScreen = $('#exposureScreen');
    var previewCanvas = $('#previewCanvas');
    var previewCtx = previewCanvas.getContext('2d');
    var exposureCanvas = $('#exposureCanvas');
    var exposureCtx = exposureCanvas.getContext('2d');
    var previewPlaceholder = $('#previewPlaceholder');
    var fileInput = $('#fileInput');
    var timeDisplay = $('#timeDisplay');
    var timeSlider = $('#timeSlider');
    var btnLoadPhoto = $('#btnLoadPhoto');
    var btnStart = $('#btnStart');
    var btnStop = $('#btnStop');
    var btnPresets = $('#btnPresets');
    var presetModal = $('#presetModal');
    var presetList = $('#presetList');
    var btnClosePresets = $('#btnClosePresets');
    var btnSavePreset = $('#btnSavePreset');
    var presetForm = $('#presetForm');
    var presetNameInput = $('#presetNameInput');
    var btnConfirmPreset = $('#btnConfirmPreset');
    var btnCancelPreset = $('#btnCancelPreset');
    var phaseIndicator = $('#phaseIndicator');
    var optionBW = $('#optionBW');
    var optionFill = $('#optionFill');

    // ======== AUDIO ========
    var audioCtx = null;

    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playTone(freq, dur) {
        try {
            var ctx = getAudioContext();
            var osc = ctx.createOscillator();
            var g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            g.gain.setValueAtTime(0.5, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);
            osc.connect(g);
            g.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + dur);
        } catch (e) {}
    }

    function playStartBeep() { playTone(1000, 0.25); }
    function playEndBeep() {
        playTone(880, 0.15);
        setTimeout(function() { playTone(660, 0.4); }, 300);
    }

    // ======== WAKE LOCK ========
    function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                navigator.wakeLock.request('screen').then(function(lock) {
                    state.wakeLock = lock;
                });
            }
        } catch (e) {}
    }

    function releaseWakeLock() {
        try {
            if (state.wakeLock) {
                state.wakeLock.release();
                state.wakeLock = null;
            }
        } catch (e) {}
    }

    // ======== HELPERS ========
    function formatTime(s) {
        if (s >= 60) {
            var m = Math.floor(s / 60);
            var sec = s - m * 60;
            if (sec % 1 === 0) {
                return m + ':' + String(Math.round(sec)).padStart(2, '0');
            }
            return m + ':' + sec.toFixed(1).padStart(4, '0');
        }
        if (s % 1 === 0) return s.toFixed(0) + ' сек';
        return s.toFixed(1) + ' сек';
    }

    function escapeHtml(t) {
        var d = document.createElement('div');
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

    // ======== PRESETS ========
    var DEFAULT_PRESETS = [
        { id: 'p1', name: 'RC бумага — тест', time: 3.0 },
        { id: 'p2', name: 'RC бумага — норма', time: 8.0 },
        { id: 'p3', name: 'Баритовая — мягко', time: 12.0 },
        { id: 'p4', name: 'Баритовая — норма', time: 20.0 },
        { id: 'p5', name: 'Баритовая — контраст', time: 30.0 },
        { id: 'p6', name: 'Цианотипия', time: 120.0 },
        { id: 'p7', name: 'Соляная печать', time: 300.0 }
    ];

    function loadPresets() {
        try {
            var s = localStorage.getItem('contactprint_presets');
            if (s) {
                state.presets = JSON.parse(s);
            } else {
                state.presets = DEFAULT_PRESETS.slice();
                savePresets();
            }
        } catch (e) {
            state.presets = DEFAULT_PRESETS.slice();
        }
    }

    function savePresets() {
        try {
            localStorage.setItem('contactprint_presets', JSON.stringify(state.presets));
        } catch (e) {}
    }

    function renderPresets() {
        presetList.innerHTML = '';
        state.presets.forEach(function(preset) {
            var item = document.createElement('div');
            item.className = 'preset-item';
            item.innerHTML =
                '<div><div class="preset-name">' + escapeHtml(preset.name) + '</div>' +
                '<div class="preset-time">' + formatTime(preset.time) + '</div></div>' +
                '<button class="preset-delete" data-id="' + preset.id + '">🗑</button>';

            item.addEventListener('click', function(e) {
                if (e.target.classList.contains('preset-delete')) return;
                state.exposureTime = preset.time;
                updateTimeDisplay();
                presetModal.classList.remove('active');
            });

            item.querySelector('.preset-delete').addEventListener('click', function(e) {
                e.stopPropagation();
                state.presets = state.presets.filter(function(p) { return p.id !== preset.id; });
                savePresets();
                renderPresets();
            });

            presetList.appendChild(item);
        });
    }

    // ======== IMAGE PROCESSING ========
    function processImage(img) {
        var MAX = 2048;
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;

        if (w > MAX || h > MAX) {
            var r = Math.min(MAX / w, MAX / h);
            w = Math.round(w * r);
            h = Math.round(h * r);
        }

        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        var original = ctx.getImageData(0, 0, w, h);
        var d = original.data;

        // Цветной негатив
        var invColorArr = new Uint8ClampedArray(d.length);
        for (var i = 0; i < d.length; i += 4) {
            invColorArr[i]     = 255 - d[i];
            invColorArr[i + 1] = 255 - d[i + 1];
            invColorArr[i + 2] = 255 - d[i + 2];
            invColorArr[i + 3] = d[i + 3];
        }
        var invColor = new ImageData(invColorArr, w, h);

        // Ч/Б негатив
        var invBWArr = new Uint8ClampedArray(d.length);
        for (var i = 0; i < d.length; i += 4) {
            var l = Math.round(
                0.299 * (255 - d[i]) +
                0.587 * (255 - d[i + 1]) +
                0.114 * (255 - d[i + 2])
            );
            invBWArr[i] = l;
            invBWArr[i + 1] = l;
            invBWArr[i + 2] = l;
            invBWArr[i + 3] = d[i + 3];
        }
        var invBW = new ImageData(invBWArr, w, h);

        // Красный (безопасный свет)
        var redArr = new Uint8ClampedArray(d.length);
        for (var i = 0; i < d.length; i += 4) {
            var lum = 0.299 * (255 - d[i]) +
                      0.587 * (255 - d[i + 1]) +
                      0.114 * (255 - d[i + 2]);
            redArr[i] = Math.round(lum * 0.55);
            redArr[i + 1] = 0;
            redArr[i + 2] = 0;
            redArr[i + 3] = d[i + 3];
        }
        var redData = new ImageData(redArr, w, h);

        state.imageData = original;
        state.invertedImageData = invColor;
        state.invertedBWImageData = invBW;
        state.redImageData = redData;
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
        var d = getActiveNegative();
        previewCanvas.width = state.imageWidth;
        previewCanvas.height = state.imageHeight;
        previewCtx.putImageData(d, 0, 0);
        previewCanvas.style.display = 'block';
        previewPlaceholder.style.display = 'none';
    }

    // ======== DRAW ON EXPOSURE CANVAS ========
    function imageDataToCanvas(data, w, h) {
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').putImageData(data, 0, 0);
        return c;
    }

    function drawExposureImage(imageData) {
        var canvas = exposureCanvas;
        var ctx = exposureCtx;
        var dpr = window.devicePixelRatio || 1;
        var sw = window.innerWidth;
        var sh = window.innerHeight;

        canvas.width = sw * dpr;
        canvas.height = sh * dpr;
        canvas.style.width = sw + 'px';
        canvas.style.height = sh + 'px';

        // Всегда чёрный фон
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        var tmpCanvas = imageDataToCanvas(imageData, state.imageWidth, state.imageHeight);

        var iw = state.imageWidth;
        var ih = state.imageHeight;
        var cw = canvas.width;
        var ch = canvas.height;

        var scale;
        if (state.fillMode) {
            // Cover — заполнить весь экран
            scale = Math.max(cw / iw, ch / ih);
        } else {
            // Contain — вписать целиком
            scale = Math.min(cw / iw, ch / ih);
        }

        var drawW = iw * scale;
        var drawH = ih * scale;
        var offsetX = (cw - drawW) / 2;
        var offset

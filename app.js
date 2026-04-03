/* ========================================
   Retro OS Arcade — Application Logic
   (CDN-backed deployment version)
   ======================================== */

(function () {
  'use strict';

  // --- CDN Base URL (jsDelivr serving from GitHub) ---
  var CDN = 'https://cdn.jsdelivr.net/gh/trenbolone1122/retro-os-arcade@cb7927786f6e417809f11d200c77bc810ea0ff5b';

  // --- GitHub Pages URL (serves HTML with correct content-type) ---
  var PAGES = 'https://trenbolone1122.github.io/retro-os-arcade';

  // --- State ---
  var currentEmulator = null; // v86 emulator instance
  var currentMacCanvas = null; // MinivMac canvas element

  // --- DOM refs ---
  var launcher = document.getElementById('launcher');
  var emulatorView = document.getElementById('emulator-view');
  var emulatorContainer = document.getElementById('emulator-container');
  var emulatorTitle = document.getElementById('emulator-title');
  var btnBack = document.getElementById('btn-back');

  // --- OS Configurations ---
  var osConfigs = {
    macos: {
      name: 'Classic Mac OS',
      type: 'macos',
    },
    kolibri: {
      name: 'KolibriOS',
      type: 'v86',
      config: {
        wasm_path: CDN + '/v86/v86.wasm',
        memory_size: 32 * 1024 * 1024,
        vga_memory_size: 2 * 1024 * 1024,
        bios: { url: CDN + '/bios/seabios.bin' },
        vga_bios: { url: CDN + '/bios/vgabios.bin' },
        fda: { url: CDN + '/images/kolibri.img', size: 1474560 },
        autostart: true,
      },
    },
    windows30: {
      name: 'Windows 3.0',
      type: 'v86',
      config: {
        wasm_path: CDN + '/v86/v86.wasm',
        memory_size: 128 * 1024 * 1024,
        vga_memory_size: 2 * 1024 * 1024,
        bios: { url: CDN + '/bios/seabios.bin' },
        vga_bios: { url: CDN + '/bios/vgabios.bin' },
        hda: { url: PAGES + '/images/windows30.img', size: 25165824, async: false },
        autostart: true,
      },
    },
  };

  // --- Boot an OS ---
  function bootOS(osId) {
    var os = osConfigs[osId];
    if (!os) return;

    // Show emulator view
    launcher.style.display = 'none';
    emulatorView.classList.add('active');
    emulatorTitle.textContent = os.name;
    showLoading('Booting ' + os.name + '...');

    if (os.type === 'macos') {
      bootMacOS(os);
    } else if (os.type === 'v86') {
      bootV86(os);
    }
  }

  // --- Helper: convert base64 string to ArrayBuffer ---
  function base64ToArrayBuffer(b64) {
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // --- Helper: convert ArrayBuffer to base64 string ---
  function arrayBufferToBase64(buffer) {
    var binary = '';
    var bytes = new Uint8Array(buffer);
    var chunkSize = 8192;
    for (var i = 0; i < bytes.byteLength; i += chunkSize) {
      var chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  // --- Helper: load a script dynamically, returns a Promise ---
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Failed to load script: ' + src)); };
      document.head.appendChild(script);
    });
  }

  // --- Boot Classic Mac OS inline via MinivMac + BrowserFS ---
  function bootMacOS(os) {
    var loadingText = document.getElementById('loading-text');

    // Create the canvas MinivMac will render into
    var canvas = document.createElement('canvas');
    canvas.id = 'containerminivmac';
    // Canvas styling handled by CSS
    emulatorContainer.appendChild(canvas);
    currentMacCanvas = canvas;

    // Step 1: Load BrowserFS from CDN
    loadingText.textContent = 'Loading filesystem library...';

    var bfsLoaded = (typeof BrowserFS !== 'undefined')
      ? Promise.resolve()
      : loadScript('https://cdnjs.cloudflare.com/ajax/libs/BrowserFS/2.0.0/browserfs.min.js');

    bfsLoaded
      .then(function () {
        loadingText.textContent = 'Downloading Mac ROM...';
        // Step 2: Fetch ROM (base64 text)
        return fetch(PAGES + '/minivmac/vMACROM.b64')
          .then(function (res) {
            if (!res.ok) throw new Error('ROM fetch failed: ' + res.status);
            return res.text();
          });
      })
      .then(function (romB64) {
        // Strip any whitespace from the base64 string
        var vMACROM = romB64.replace(/\s+/g, '');
        loadingText.textContent = 'Downloading Mac disk image...';

        // Step 3: Fetch disk image as ArrayBuffer
        return fetch(PAGES + '/minivmac/MinivMac.dsk')
          .then(function (res) {
            if (!res.ok) throw new Error('Disk fetch failed: ' + res.status);
            return res.arrayBuffer();
          })
          .then(function (diskBuffer) {
            var diskBase64 = arrayBufferToBase64(diskBuffer);
            return { vMACROM: vMACROM, diskBase64: diskBase64 };
          });
      })
      .then(function (data) {
        loadingText.textContent = 'Initialising virtual filesystem...';

        // Step 4: Set up BrowserFS InMemory filesystem (no storage APIs needed)
        var inMemoryFS = new BrowserFS.FileSystem.InMemory();
        BrowserFS.initialize(inMemoryFS);

        loadingText.textContent = 'Starting Mac emulator...';

          // Step 5: Create Emscripten Module config before loading MinivMac.js
          var macCanvas = document.getElementById('containerminivmac');
          // Emscripten needs widthNative/heightNative to be preset
          macCanvas.widthNative = macCanvas.width = 512;
          macCanvas.heightNative = macCanvas.height = 342;
          window.Module = {
            arguments: ['/disk.dsk'],
            screenIsReadOnly: false,
            print: function() {},
            canvas: macCanvas,
            waitAfterDownloading: false,
            noInitialRun: false,
            locateFile: function (path) {
              return PAGES + '/minivmac/' + path;
            },
            setWindowTitle: function() {},
            preRun: [],
            postRun: [],
            preInit: function () {
              // Mount BrowserFS into the Emscripten virtual FS
              var emFS = new BrowserFS.EmscriptenFS();
              // eslint-disable-next-line no-undef
              FS.mkdir('/minivmac');
              // eslint-disable-next-line no-undef
              FS.mount(emFS, { root: '/' }, '/minivmac');

              // Write ROM file
              var romData = new Uint8Array(base64ToArrayBuffer(data.vMACROM));
              // eslint-disable-next-line no-undef
              FS.writeFile('/vMac.ROM', romData, { encoding: 'binary' });

              // Write disk image
              var diskData = new Uint8Array(base64ToArrayBuffer(data.diskBase64));
              // eslint-disable-next-line no-undef
              FS.writeFile('/disk.dsk', diskData, { encoding: 'binary' });
            },
            onRuntimeInitialized: function () {
              hideLoading();
            },
          };

          // Step 6: Load MinivMac.js (Emscripten runtime) — boots the emulator
          loadScript(PAGES + '/minivmac/MinivMac.js')
            .then(function () {
              // Fallback: hide loading after 30 seconds if onRuntimeInitialized never fires
              setTimeout(hideLoading, 30000);
            })
            .catch(function (err) {
              console.error('MinivMac.js load error:', err);
              if (loadingText) loadingText.textContent = 'Failed to load Mac emulator. Please try again.';
            });
      })
      .catch(function (err) {
        console.error('Mac OS boot error:', err);
        if (loadingText) loadingText.textContent = 'Error: ' + err.message;
      });
  }

  // --- Boot v86 OS ---
  function bootV86(os) {
    // Dynamically load libv86.js from CDN if not already loaded
    if (typeof V86 === 'undefined') {
      document.getElementById('loading-text').textContent = 'Loading emulator engine...';
      var script = document.createElement('script');
      script.src = CDN + '/v86/libv86.js';
      script.onload = function () {
        startV86(os);
      };
      script.onerror = function () {
        document.getElementById('loading-text').textContent = 'Failed to load emulator. Please try again.';
      };
      document.head.appendChild(script);
    } else {
      startV86(os);
    }
  }

  function startV86(os) {
    document.getElementById('loading-text').textContent = 'Booting ' + os.name + '...';

    // Create screen container structure
    var screenContainer = document.createElement('div');
    screenContainer.id = 'screen_container';

    var serialDiv = document.createElement('div');
    serialDiv.style.whiteSpace = 'pre';
    serialDiv.style.font = '14px monospace';
    serialDiv.style.lineHeight = '14px';

    var canvas = document.createElement('canvas');
    canvas.style.display = 'none';

    screenContainer.appendChild(serialDiv);
    screenContainer.appendChild(canvas);
    emulatorContainer.appendChild(screenContainer);

    // Build v86 config
    var config = {};
    var keys = Object.keys(os.config);
    for (var i = 0; i < keys.length; i++) {
      config[keys[i]] = os.config[keys[i]];
    }
    config.screen_container = screenContainer;

    try {
      currentEmulator = new V86(config);

      // Hide loading when screen becomes active
      currentEmulator.add_listener('screen-set-mode', function () {
        hideLoading();
      });

      currentEmulator.add_listener('serial0-output-byte', function () {
        hideLoading();
      });

      // Fallback: hide loading after 8 seconds
      setTimeout(hideLoading, 8000);
    } catch (err) {
      console.error('v86 boot error:', err);
      document.getElementById('loading-text').textContent = 'Error: ' + err.message;
    }
  }

  // --- Back to launcher ---
  function goBack() {
    // Destroy v86 emulator
    if (currentEmulator) {
      try {
        currentEmulator.destroy();
      } catch (e) {
        console.warn('Emulator destroy error:', e);
      }
      currentEmulator = null;
    }

    // Remove MinivMac canvas and shut down audio
    if (currentMacCanvas) {
      currentMacCanvas.remove();
      currentMacCanvas = null;
    }
    if (window.Module) {
      // Close SDL2 audio context to stop callbacks
      try {
        if (typeof SDL2 !== 'undefined' && SDL2.audioContext) {
          SDL2.audioContext.close();
          SDL2.audioContext = undefined;
        }
        if (SDL2 && SDL2.audio && SDL2.audio.scriptProcessorNode) {
          SDL2.audio.scriptProcessorNode.disconnect();
          SDL2.audio.scriptProcessorNode.onaudioprocess = null;
          SDL2.audio = undefined;
        }
      } catch (e) { /* ignore */ }
      // Replace Module with a no-op stub so lingering callbacks don't crash
      window.Module = { dynCall_vi: function(){}, dynCall_v: function(){}, noExitRuntime: true };
    }

    // Clear container
    emulatorContainer.innerHTML = '';

    // Re-add loading overlay
    var overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.className = 'loading-overlay hidden';
    overlay.innerHTML = '<div class="loading-spinner"></div><div id="loading-text" class="loading-text">Booting...</div>';
    emulatorContainer.appendChild(overlay);

    // Switch views
    emulatorView.classList.remove('active');
    launcher.style.display = '';
  }

  // --- Loading helpers ---
  function showLoading(text) {
    var overlay = document.getElementById('loading-overlay');
    var textEl = document.getElementById('loading-text');
    if (overlay) {
      overlay.classList.remove('hidden');
      if (textEl && text) textEl.textContent = text;
    }
  }

  function hideLoading() {
    var overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  // --- Event Listeners ---
  btnBack.addEventListener('click', goBack);

  // Delegate click on Run buttons
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-boot]');
    if (btn) {
      bootOS(btn.dataset.boot);
    }
  });

  // Keyboard: Escape goes back
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && emulatorView.classList.contains('active')) {
      goBack();
    }
  });
})();

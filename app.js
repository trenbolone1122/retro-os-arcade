/* ========================================
   Retro OS Arcade — Application Logic
   ======================================== */

(function () {
  'use strict';

  // --- State ---
  let currentEmulator = null; // v86 emulator instance
  let currentIframe = null;   // Mac OS iframe

  // --- DOM refs ---
  const launcher = document.getElementById('launcher');
  const emulatorView = document.getElementById('emulator-view');
  const emulatorContainer = document.getElementById('emulator-container');
  const emulatorTitle = document.getElementById('emulator-title');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');
  const btnBack = document.getElementById('btn-back');

  // --- OS Configurations ---
  const osConfigs = {
    macos: {
      name: 'Classic Mac OS',
      type: 'iframe',
      src: 'minivmac/MinivMac.htm',
    },
    kolibri: {
      name: 'KolibriOS',
      type: 'v86',
      config: {
        wasm_path: 'v86/v86.wasm',
        memory_size: 32 * 1024 * 1024,
        vga_memory_size: 2 * 1024 * 1024,
        bios: { url: 'bios/seabios.bin' },
        vga_bios: { url: 'bios/vgabios.bin' },
        fda: { url: 'images/kolibri.img', size: 1474560 },
        autostart: true,
      },
    },
    linux: {
      name: 'Buildroot Linux',
      type: 'v86',
      config: {
        wasm_path: 'v86/v86.wasm',
        memory_size: 32 * 1024 * 1024,
        vga_memory_size: 2 * 1024 * 1024,
        bios: { url: 'bios/seabios.bin' },
        vga_bios: { url: 'bios/vgabios.bin' },
        bzimage: { url: 'images/buildroot-bzimage.bin', size: 5166352, async: false },
        cmdline: 'tsc=reliable mitigations=off random.trust_cpu=on',
        filesystem: {},
        autostart: true,
      },
    },
  };

  // --- Boot an OS ---
  function bootOS(osId) {
    const os = osConfigs[osId];
    if (!os) return;

    // Show emulator view
    launcher.style.display = 'none';
    emulatorView.classList.add('active');
    emulatorTitle.textContent = os.name;
    showLoading('Booting ' + os.name + '...');

    if (os.type === 'iframe') {
      bootIframe(os);
    } else if (os.type === 'v86') {
      bootV86(os);
    }
  }

  // --- Boot Mac OS via iframe ---
  function bootIframe(os) {
    const iframe = document.createElement('iframe');
    iframe.src = os.src;
    iframe.allow = 'autoplay';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.onload = function () {
      hideLoading();
    };
    // Fallback: hide loading after 5s even if onload doesn't fire
    setTimeout(hideLoading, 5000);
    emulatorContainer.appendChild(iframe);
    currentIframe = iframe;
  }

  // --- Boot v86 OS ---
  function bootV86(os) {
    // Dynamically load libv86.js if not already loaded
    if (typeof V86 === 'undefined') {
      loadingText.textContent = 'Loading emulator engine...';
      const script = document.createElement('script');
      script.src = 'v86/libv86.js';
      script.onload = function () {
        startV86(os);
      };
      script.onerror = function () {
        loadingText.textContent = 'Failed to load emulator. Please try again.';
      };
      document.head.appendChild(script);
    } else {
      startV86(os);
    }
  }

  function startV86(os) {
    loadingText.textContent = 'Booting ' + os.name + '...';

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
    var config = Object.assign({}, os.config, {
      screen_container: screenContainer,
    });

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
      loadingText.textContent = 'Error: ' + err.message;
    }
  }

  // --- Back to launcher ---
  function goBack() {
    // Destroy emulator
    if (currentEmulator) {
      try {
        currentEmulator.destroy();
      } catch (e) {
        console.warn('Emulator destroy error:', e);
      }
      currentEmulator = null;
    }

    // Remove iframe
    if (currentIframe) {
      currentIframe.remove();
      currentIframe = null;
    }

    // Clear container
    emulatorContainer.innerHTML = '';

    // Re-add loading overlay
    var overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.className = 'loading-overlay hidden';
    overlay.innerHTML = '<div class="loading-spinner"></div><div id="loading-text" class="loading-text">Booting...</div>';
    emulatorContainer.appendChild(overlay);

    // Update refs
    // (loadingOverlay and loadingText are re-queried on next boot via show/hideLoading)

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

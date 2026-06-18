import { useEffect, useState } from 'preact/hooks';
import { INSTALL_BANNER_STORAGE_KEY } from '../lib/config.js';
import { getInstallPlatform, isStandaloneMode } from '../lib/platform.js';
import { loadJson, saveJson } from '../lib/storage.js';

const PLATFORM_CONTENT = {
  ios: {
    title: 'ホーム画面に追加しよう',
    description: '共有ボタン（□↑）から「ホーム画面に追加」を選ぶと、アプリのように使えます。',
    actionLabel: null,
  },
  android: {
    title: 'アプリをインストールしよう',
    description: 'ホーム画面に追加すると、オフラインでもすぐ瞑想を始められます。',
    actionLabel: 'インストール',
  },
  desktop: {
    title: 'アプリとしてインストール',
    description: 'ブラウザから独立したウィンドウで使えます。',
    actionLabel: 'インストール',
  },
};

function shouldShowBanner() {
  if (isStandaloneMode()) return false;
  const stored = loadJson(INSTALL_BANNER_STORAGE_KEY);
  return !stored?.dismissed;
}

export function InstallBanner() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState('desktop');
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    if (!shouldShowBanner()) return undefined;

    const detectedPlatform = getInstallPlatform();
    setPlatform(detectedPlatform);
    setVisible(true);

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
      setPlatform(getInstallPlatform());
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    };
  }, []);

  const dismiss = () => {
    saveJson(INSTALL_BANNER_STORAGE_KEY, { dismissed: true });
    setVisible(false);
    setDeferredPrompt(null);
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      dismiss();
      return;
    }
    setDeferredPrompt(null);
  };

  if (!visible) return null;

  const content = PLATFORM_CONTENT[platform] || PLATFORM_CONTENT.desktop;
  const canInstall = Boolean(deferredPrompt && content.actionLabel);

  return (
    <aside class="install-banner" role="dialog" aria-label="アプリのインストール案内">
      <div class="install-banner__content">
        <p class="install-banner__title">{content.title}</p>
        <p class="install-banner__description">{content.description}</p>
        <div class="install-banner__actions">
          {canInstall && (
            <button type="button" class="install-banner__primary" onClick={handleInstall}>
              {content.actionLabel}
            </button>
          )}
          <button type="button" class="install-banner__dismiss" onClick={dismiss}>
            あとで
          </button>
        </div>
      </div>
      <button
        type="button"
        class="install-banner__close"
        aria-label="閉じる"
        onClick={dismiss}
      >
        ×
      </button>
    </aside>
  );
}

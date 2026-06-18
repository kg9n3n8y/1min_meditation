import { useState } from 'preact/hooks';
import { PUBLIC_URL } from '../lib/config.js';

export function Footer() {
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(PUBLIC_URL);
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = PUBLIC_URL;
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <footer class="app-footer">
      <div class="footer-actions">
        <button type="button" class="copy-btn" aria-label="公開URLをコピー" onClick={copyUrl}>
          {copied ? 'コピーしたよ!' : 'URLをコピー'}
        </button>
      </div>
    </footer>
  );
}

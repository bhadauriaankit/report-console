import { useState, useEffect, useRef } from 'react';
import { getPgFileUrl } from './api.js';

/* ── Icons ── */
const IconX = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const IconDownload = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

const IconMaximize = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
    <polyline points="15 3 21 3 21 9"/>
    <polyline points="9 21 3 21 3 15"/>
    <line x1="21" y1="3" x2="14" y2="10"/>
    <line x1="3" y1="21" x2="10" y2="14"/>
  </svg>
);

const IconCode = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="15" height="15">
    <polyline points="16 18 22 12 16 6"/>
    <polyline points="8 6 2 12 8 18"/>
  </svg>
);

const IconEye = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="15" height="15">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

export default function MediaModal({ media, onClose, onDownload }) {
  const [tab, setTab]                 = useState('visual'); // 'visual' | 'code'
  const [fullscreen, setFullscreen]   = useState(false);
  const [copied, setCopied]           = useState(false);
  const [fetchedCode, setFetchedCode] = useState('');
  const [loadingCode, setLoadingCode] = useState(false);
  const [imgError, setImgError]       = useState(false);

  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);

  // Focus restoration: save previous active element and restore on unmount
  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    return () => {
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus();
      }
    };
  }, []);

  // Focus trap inside the modal + Esc key handler
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;
        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!media) return null;

  const { title, kind, type, content, dataUri, url, path, filename } = media;

  // Determine if content is audio
  const isAudio =
    type === 'audio' ||
    /\.(mp3|wav|ogg|m4a|aac)(\?|$)/i.test(filename || path || url || '');

  // Compute preview source URL
  let previewSrc = null;
  if (kind === 'data-uri' || kind === 'base64') {
    previewSrc = dataUri;
  } else if (kind === 'url') {
    previewSrc = url;
  } else if (kind === 'path') {
    previewSrc = getPgFileUrl(path, false);
  }

  // Fetch raw HTML text if path-based and user inspects 'code' tab
  useEffect(() => {
    if (type === 'html' && !content && previewSrc && tab === 'code' && !fetchedCode) {
      setLoadingCode(true);
      fetch(previewSrc)
        .then((r) => r.text())
        .then((t) => setFetchedCode(t))
        .catch((e) => setFetchedCode(`<!-- Error loading HTML source: ${e.message} -->`))
        .finally(() => setLoadingCode(false));
    }
  }, [type, content, previewSrc, tab, fetchedCode]);

  const activeSource = content || fetchedCode;

  const handleCopyCode = () => {
    if (!activeSource) return;
    navigator.clipboard.writeText(activeSource).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="lm-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lm-modal-title"
    >
      <div
        ref={modalRef}
        className={`lm-modal-window ${fullscreen ? 'lm-modal-fullscreen' : ''}`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="lm-modal-header">
          <div className="lm-modal-title-box">
            <span className={`lm-type-badge lm-type-${type || 'file'}`}>
              {(type || 'file').toUpperCase()}
            </span>
            <div id="lm-modal-title" className="lm-modal-title">
              {title || filename || 'Media Preview'}
            </div>
          </div>

          <div className="lm-modal-actions">
            {type === 'html' && (
              <div className="lm-modal-tabs" role="tablist" aria-label="Preview Mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'visual'}
                  className={`lm-modal-tab ${tab === 'visual' ? 'lm-modal-tab--active' : ''}`}
                  onClick={() => setTab('visual')}
                >
                  <IconEye /> Visual
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'code'}
                  className={`lm-modal-tab ${tab === 'code' ? 'lm-modal-tab--active' : ''}`}
                  onClick={() => setTab('code')}
                >
                  <IconCode /> Source
                </button>
              </div>
            )}

            {onDownload && (
              <button
                type="button"
                className="lm-modal-btn lm-modal-btn-download"
                onClick={() => onDownload(media)}
                title="Download file"
                aria-label="Download file"
              >
                <IconDownload />
                <span>Download</span>
              </button>
            )}

            <button
              type="button"
              className="lm-modal-btn"
              onClick={() => setFullscreen((f) => !f)}
              title={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              aria-label={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              <IconMaximize />
            </button>

            <button
              type="button"
              className="lm-modal-btn lm-modal-btn-close"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close dialog"
            >
              <IconX />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="lm-modal-body">
          {/* HTML Preview */}
          {type === 'html' && tab === 'visual' && (
            content ? (
              <iframe
                title="HTML Visual Preview"
                srcDoc={content}
                className="lm-html-iframe"
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            ) : previewSrc ? (
              <iframe
                title="HTML Visual Preview"
                src={previewSrc}
                className="lm-html-iframe"
              />
            ) : (
              <div className="lm-placeholder">No HTML content available.</div>
            )
          )}

          {type === 'html' && tab === 'code' && (
            <div className="lm-code-container">
              {loadingCode ? (
                <div className="lm-placeholder" style={{ color: '#94a3b8' }}>
                  <span className="lm-spinner" /> Loading source code…
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="lm-btn-copy"
                    onClick={handleCopyCode}
                  >
                    {copied ? '✓ Copied' : 'Copy Code'}
                  </button>
                  <pre className="lm-code-pre">
                    <code>{activeSource || '<!-- No source code available -->'}</code>
                  </pre>
                </>
              )}
            </div>
          )}

          {/* Audio Player Preview */}
          {isAudio && previewSrc && (
            <div className="lm-audio-wrapper">
              <div className="lm-audio-icon" aria-hidden="true">🎵</div>
              <h3 className="lm-audio-title">{filename || 'Audio Media'}</h3>
              <audio controls src={previewSrc} className="lm-audio-player" aria-label="Audio file playback">
                Your browser does not support HTML5 audio playback.
              </audio>
            </div>
          )}

          {/* PDF Preview */}
          {type === 'pdf' && previewSrc && !isAudio && (
            <iframe
              title="PDF Preview"
              src={previewSrc}
              className="lm-pdf-iframe"
            />
          )}

          {/* Image Preview */}
          {type === 'image' && previewSrc && !isAudio && (
            <div className="lm-image-wrapper">
              {imgError ? (
                <div className="lm-placeholder lm-empty" role="alert">
                  Failed to load image preview. Use the download button above.
                </div>
              ) : (
                <img
                  src={previewSrc}
                  alt={filename || 'Attachment'}
                  className="lm-preview-img"
                  onError={() => setImgError(true)}
                />
              )}
            </div>
          )}

          {/* Text preview */}
          {type === 'text' && (content || activeSource) && !isAudio && (
            <div className="lm-code-container">
              <pre className="lm-code-pre">
                <code>{content || activeSource}</code>
              </pre>
            </div>
          )}

          {/* Fallback for other file types */}
          {type !== 'html' && type !== 'pdf' && type !== 'image' && !isAudio && !content && (
            <div className="lm-binary-fallback">
              <div className="lm-binary-icon">📎</div>
              <h3>Attachment Available for Download</h3>
              <p className="lm-binary-filename">{filename || path || 'Attachment file'}</p>
              {path && <small className="lm-binary-path">File path: {path}</small>}
              {onDownload && (
                <button
                  type="button"
                  className="lm-btn-primary"
                  onClick={() => onDownload(media)}
                >
                  <IconDownload /> Download Attachment
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

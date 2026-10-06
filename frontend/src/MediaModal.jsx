import { useState, useEffect } from 'react';
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
  const [tab, setTab] = useState('visual'); // 'visual' | 'code'
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!media) return null;

  const { title, kind, type, content, dataUri, url, path, filename } = media;

  const handleCopyCode = () => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Compute preview source URL if applicable
  let previewSrc = null;
  if (kind === 'data-uri' || kind === 'base64') {
    previewSrc = dataUri;
  } else if (kind === 'url') {
    previewSrc = url;
  } else if (kind === 'path') {
    previewSrc = getPgFileUrl(path, false);
  }

  return (
    <div className="lm-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={`lm-modal-window ${fullscreen ? 'lm-modal-fullscreen' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="lm-modal-header">
          <div className="lm-modal-title-box">
            <span className={`lm-type-badge lm-type-${type || 'file'}`}>
              {(type || 'file').toUpperCase()}
            </span>
            <div className="lm-modal-title">{title || filename || 'Media Preview'}</div>
          </div>

          <div className="lm-modal-actions">
            {kind === 'html' && (
              <div className="lm-modal-tabs">
                <button
                  type="button"
                  className={`lm-modal-tab ${tab === 'visual' ? 'lm-modal-tab--active' : ''}`}
                  onClick={() => setTab('visual')}
                >
                  <IconEye /> Visual
                </button>
                <button
                  type="button"
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
            >
              <IconMaximize />
            </button>

            <button
              type="button"
              className="lm-modal-btn lm-modal-btn-close"
              onClick={onClose}
              title="Close (Esc)"
            >
              <IconX />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="lm-modal-body">
          {/* HTML Preview */}
          {kind === 'html' && tab === 'visual' && (
            <iframe
              title="HTML Visual Preview"
              srcDoc={content}
              className="lm-html-iframe"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          )}

          {kind === 'html' && tab === 'code' && (
            <div className="lm-code-container">
              <button
                type="button"
                className="lm-btn-copy"
                onClick={handleCopyCode}
              >
                {copied ? '✓ Copied' : 'Copy Code'}
              </button>
              <pre className="lm-code-pre">
                <code>{content}</code>
              </pre>
            </div>
          )}

          {/* PDF Preview */}
          {type === 'pdf' && previewSrc && (
            <iframe
              title="PDF Preview"
              src={previewSrc}
              className="lm-pdf-iframe"
            />
          )}

          {/* Image Preview */}
          {type === 'image' && previewSrc && (
            <div className="lm-image-wrapper">
              <img src={previewSrc} alt={filename || 'Attachment'} className="lm-preview-img" />
            </div>
          )}

          {/* Text preview */}
          {type === 'text' && content && (
            <div className="lm-code-container">
              <pre className="lm-code-pre">
                <code>{content}</code>
              </pre>
            </div>
          )}

          {/* Fallback for binary / path where direct inline preview is not supported */}
          {(!previewSrc && kind !== 'html' && !content) && (
            <div className="lm-binary-fallback">
              <div className="lm-binary-icon">📎</div>
              <h3>Attachment Available for Download</h3>
              <p className="lm-binary-filename">{filename || path || 'Attachment file'}</p>
              {path && <small className="lm-binary-path">Stored at: {path}</small>}
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

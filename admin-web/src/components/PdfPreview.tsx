import { useEffect } from 'react';

// Full-screen PDF viewer for report previews. Takes an object URL the caller
// created and revokes it on close.
export function PdfPreview({ url, title, onClose, footer }: { url: string; title: string; onClose: () => void; footer?: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="bg-paper rounded-lg shadow-xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-rule">
          <p className="font-display font-semibold text-ink truncate">{title}</p>
          <button onClick={onClose} className="text-sm text-ink-soft hover:text-ink" aria-label="Close preview">
            Close ✕
          </button>
        </div>
        <iframe src={url} title={title} className="flex-1 w-full bg-ground" />
        {footer && <div className="px-4 py-3 border-t border-rule">{footer}</div>}
      </div>
    </div>
  );
}

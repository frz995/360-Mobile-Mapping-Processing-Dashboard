import { Camera, Copy } from 'lucide-react';
import { toast } from './common/toast';
import { generateImageFilenamesList } from '../utils/subgrid';

interface SubgridImagesListModalData {
  isOpen: boolean;
  subgrid: string;
  count: number;
  poiCount?: number;
  baseFilename?: string;
  customFilenames?: string[];
}

interface SubgridImagesListModalProps {
  modal: SubgridImagesListModalData | null;
  onClose: () => void;
}

export function SubgridImagesListModal({ modal, onClose }: SubgridImagesListModalProps) {
  if (!modal || !modal.isOpen) return null;

  const filenames = (modal.customFilenames && modal.customFilenames.length > 0)
    ? modal.customFilenames
    : generateImageFilenamesList(modal.subgrid, modal.count > 0 ? modal.count : (modal.poiCount || 1), modal.baseFilename);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Subgrid ${modal.subgrid} image filenames`}
      className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000] p-4 backdrop-blur-sm"
    >
      <div className="bg-card border border-subtle rounded-xl p-5 max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex justify-between items-center pb-3 mb-3 border-b border-subtle shrink-0">
          <div>
            <h2 className="text-sm font-bold text-text-base tracking-wide flex items-center gap-2">
              <Camera size={16} className="text-sky-400" />
              Subgrid {modal.subgrid} Filenames
            </h2>
            <span className="text-[11px] text-text-muted font-sans">
              {modal.poiCount !== undefined ? `POI: ${modal.poiCount.toLocaleString()}  •  ` : ''}
              Available Frames: <strong className="text-sky-400 font-bold">{filenames.length.toLocaleString()}</strong>
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-base text-lg p-1 cursor-pointer transition-colors"
            aria-label="Close image filenames popup dialog"
          >
            &times;
          </button>
        </div>
        <div className="flex-1 overflow-y-auto font-sans text-xs text-text-base space-y-1 p-2 bg-card rounded-lg border border-subtle max-h-96">
          {filenames.map((name, idx) => (
            <div key={idx} className="flex items-center justify-between px-2.5 py-1 hover:bg-inner rounded transition-colors">
              <span className="text-text-muted text-[10px] w-10 shrink-0">{idx + 1}.</span>
              <span className="text-text-base font-semibold flex-1 truncate">{name}</span>
            </div>
          ))}
        </div>
        <div className="pt-3 border-t border-subtle flex items-center justify-between shrink-0">
          <button
            onClick={() => {
              navigator.clipboard.writeText(filenames.join('\n'));
              toast.success(`Copied ${filenames.length} image filenames to clipboard!`);
            }}
            className="px-3 py-1.5 bg-inner hover:bg-inner text-text-base border border-subtle rounded-lg text-xs font-medium cursor-pointer transition-colors flex items-center gap-1.5"
          >
            <Copy size={13} /> Copy List ({filenames.length})
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-text-base rounded-lg text-xs font-medium cursor-pointer transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

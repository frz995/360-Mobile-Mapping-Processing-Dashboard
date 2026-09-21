import React, { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Maximize2,
  Minimize2,
  PanelRightClose,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useDialogEscape } from './dialog';

export type DrawerWidthMode = 'compact' | 'expanded' | 'fullscreen';
export type DrawerDisplayMode = 'docked' | 'modal';

export interface InspectorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;

  /**
   * Display mode:
   * - 'docked': Non-blocking overlay docked on the right side.
   *             Leaves the 2D Map & 360 viewer interactive beside the drawer.
   * - 'modal': Traditional blocking overlay with darkened backdrop.
   */
  mode?: DrawerDisplayMode;

  /**
   * Current width mode:
   * - 'compact': w-[420px] (standard inspection & scanning)
   * - 'expanded': w-[680px] (side-by-side photo comparison & studio)
   * - 'fullscreen': w-full (full gallery overview)
   */
  widthMode?: DrawerWidthMode;
  onWidthModeChange?: (mode: DrawerWidthMode) => void;
  allowWidthToggle?: boolean;

  /** Keyboard navigation shortcuts (J/K or ArrowUp/ArrowDown) */
  onNavigateNext?: () => void;
  onNavigatePrev?: () => void;

  /** Custom class overrides */
  className?: string;
  bodyClassName?: string;

  /** Accessibility */
  ariaLabel?: string;
  zIndex?: number;
}

const WIDTH_CLASSES: Record<DrawerWidthMode, string> = {
  compact: 'w-full sm:w-[420px]',
  expanded: 'w-full sm:w-[680px]',
  fullscreen: 'w-full'
};

export const InspectorDrawer: React.FC<InspectorDrawerProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  badge,
  headerActions,
  footer,
  children,
  mode = 'docked',
  widthMode = 'compact',
  onWidthModeChange,
  allowWidthToggle = true,
  onNavigateNext,
  onNavigatePrev,
  className = '',
  bodyClassName = '',
  ariaLabel = 'Spatial Inspector Drawer',
  zIndex = 50
}) => {
  // Close drawer on Escape
  useDialogEscape(onClose, isOpen);

  // Keyboard navigation shortcuts: J / K / ArrowUp / ArrowDown
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;

    // Ignore hotkeys when typing in input, textarea, or contentEditable
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.tagName === 'SELECT')
    ) {
      return;
    }

    if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
      if (onNavigateNext) {
        e.preventDefault();
        onNavigateNext();
      }
    } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
      if (onNavigatePrev) {
        e.preventDefault();
        onNavigatePrev();
      }
    }
  }, [isOpen, onNavigateNext, onNavigatePrev]);

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  const cycleWidthMode = () => {
    if (!onWidthModeChange) return;
    if (widthMode === 'compact') onWidthModeChange('expanded');
    else if (widthMode === 'expanded') onWidthModeChange('fullscreen');
    else onWidthModeChange('compact');
  };

  const toggleFullscreen = () => {
    if (!onWidthModeChange) return;
    if (widthMode === 'fullscreen') {
      onWidthModeChange('compact');
    } else {
      onWidthModeChange('fullscreen');
    }
  };

  const isModal = mode === 'modal';
  const widthClass = WIDTH_CLASSES[widthMode] || WIDTH_CLASSES.compact;

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className={`fixed inset-0 select-none ${
            isModal ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
          style={{ zIndex }}
        >
          {/* Modal Backdrop (Only shown in 'modal' mode) */}
          {isModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
              className="absolute inset-0 bg-black/75 backdrop-blur-sm pointer-events-auto"
              aria-hidden="true"
            />
          )}

          {/* Slide-out Drawer Surface */}
          <motion.aside
            role="dialog"
            aria-modal={isModal}
            aria-label={ariaLabel}
            initial={{ x: '100%', opacity: 0.4 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className={`pointer-events-auto absolute top-0 right-0 bottom-0 flex flex-col bg-card/95 backdrop-blur-2xl border-l border-subtle shadow-2xl transition-[width] duration-300 ease-out overflow-hidden text-text-base ${widthClass} ${className}`}
          >
            {/* DRAWER HEADER */}
            <div className="px-4 py-3.5 sm:px-5 sm:py-4 border-b border-subtle bg-inner/60 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {badge && <div className="shrink-0">{badge}</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm sm:text-base font-bold text-text-base tracking-tight truncate">
                      {title}
                    </h2>
                  </div>
                  {subtitle && (
                    <p className="text-[11px] sm:text-xs text-text-muted mt-0.5 truncate">
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>

              {/* ACTION & RESIZE CONTROLS */}
              <div className="flex items-center gap-1.5 shrink-0">
                {headerActions}

                {/* Hotkey Indicator for J / K Navigation */}
                {(onNavigateNext || onNavigatePrev) && (
                  <div className="hidden md:flex items-center gap-1 text-[10px] font-mono text-text-muted px-1.5 py-0.5 bg-inner rounded border border-subtle/80" title="Use J / K or Up / Down arrows to cycle items">
                    <span className="text-sky-400 font-bold">J</span>
                    <span>/</span>
                    <span className="text-sky-400 font-bold">K</span>
                  </div>
                )}

                {/* Width Toggle */}
                {allowWidthToggle && onWidthModeChange && (
                  <div className="flex items-center border-l border-subtle/80 pl-1.5 ml-1 gap-1">
                    {/* Stepped expander */}
                    <button
                      type="button"
                      onClick={cycleWidthMode}
                      className="hidden sm:inline-flex p-1.5 rounded-lg text-text-muted hover:text-text-base hover:bg-inner transition-colors cursor-pointer"
                      title={`Width: ${widthMode} (Click to toggle compact/expanded)`}
                      aria-label="Toggle width mode"
                    >
                      {widthMode === 'compact' ? (
                        <ChevronLeft size={15} />
                      ) : widthMode === 'expanded' ? (
                        <ChevronRight size={15} />
                      ) : (
                        <Minimize2 size={14} />
                      )}
                    </button>

                    {/* Maximize / Restore */}
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      className="p-1.5 rounded-lg text-text-muted hover:text-text-base hover:bg-inner transition-colors cursor-pointer"
                      title={widthMode === 'fullscreen' ? 'Restore side drawer' : 'Maximize to fullscreen'}
                      aria-label={widthMode === 'fullscreen' ? 'Restore side drawer' : 'Maximize to fullscreen'}
                    >
                      {widthMode === 'fullscreen' ? (
                        <Minimize2 size={14} />
                      ) : (
                        <Maximize2 size={14} />
                      )}
                    </button>
                  </div>
                )}

                {/* Close Button */}
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-text-muted hover:text-rose-400 hover:bg-rose-950/30 transition-colors cursor-pointer ml-1"
                  title="Close Inspector (Esc)"
                  aria-label="Close"
                >
                  <PanelRightClose size={16} className="hidden sm:block" />
                  <X size={16} className="sm:hidden" />
                </button>
              </div>
            </div>

            {/* DRAWER BODY (SCROLLABLE) */}
            <div className={`flex-1 overflow-y-auto min-h-0 ${bodyClassName}`}>
              {children}
            </div>

            {/* DRAWER FOOTER (OPTIONAL FIXED) */}
            {footer && (
              <div className="px-4 py-3 sm:px-5 border-t border-subtle bg-inner/80 shrink-0">
                {footer}
              </div>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
};

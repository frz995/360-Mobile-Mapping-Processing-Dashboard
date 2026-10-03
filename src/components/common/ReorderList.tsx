import React, { createContext, useContext, useState, useMemo } from 'react';
import { Reorder, useDragControls, type DragControls } from 'framer-motion';
import { GripVertical, ArrowUp, ArrowDown } from 'lucide-react';

/**
 * Customizable Reorder List Primitive (Framer Motion)
 *
 * Provides:
 * - Fluid, physics-based vertical drag-and-drop reordering
 * - Dedicated drag handle isolation (via useDragControls) so nested sliders,
 *   inputs, and buttons never accidentally trigger a drag
 * - Raised visual elevation (shadow-xl, scale, border glow) while dragging
 * - Accessible keyboard & button fallbacks (Move Up / Move Down)
 */

interface ReorderItemContextValue {
  dragControls: DragControls;
  isDragging: boolean;
  setIsDragging: (dragging: boolean) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

const ReorderItemContext = createContext<ReorderItemContextValue | null>(null);

/**
 * Element tags this primitive renders. Framer Motion types its `as` prop as
 * `keyof HTMLElements`, but that map is internal to the library and not exported,
 * so we narrow to the tags that make sense for a reorderable list.
 */
export type ReorderTag = 'div' | 'ul' | 'ol' | 'li';

/**
 * The `as` of the enclosing ReorderList, so items render a matching element
 * (`li` inside `ul`/`ol`, `div` otherwise). Without this the default `div`
 * group would wrap `li` items in invalid HTML.
 */
const ReorderListContext = createContext<ReorderTag>('div');

export function useReorderItemContext() {
  const ctx = useContext(ReorderItemContext);
  if (!ctx) {
    throw new Error('ReorderHandle must be used within a <ReorderItem>.');
  }
  return ctx;
}

export interface ReorderListProps<T> {
  values: T[];
  onReorder: (newValues: T[]) => void;
  children: React.ReactNode;
  className?: string;
  axis?: 'y' | 'x';
  as?: ReorderTag;
}

export function ReorderList<T>({
  values,
  onReorder,
  children,
  className = '',
  axis = 'y',
  as = 'div'
}: ReorderListProps<T>) {
  return (
    <ReorderListContext.Provider value={as}>
      <Reorder.Group
        axis={axis}
        values={values}
        onReorder={onReorder}
        className={className}
        as={as}
        layoutScroll
      >
        {children}
      </Reorder.Group>
    </ReorderListContext.Provider>
  );
}

export interface ReorderItemProps<T> {
  value: T;
  id?: string;
  children: React.ReactNode;
  className?: string;
  /** Override the rendered element. Defaults to match the enclosing ReorderList's `as`. */
  as?: ReorderTag;
  dragHandleOnly?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  dragElevationClassName?: string;
}

export function ReorderItem<T>({
  value,
  id,
  children,
  className = '',
  as,
  dragHandleOnly = true,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  dragElevationClassName = 'shadow-2xl scale-[1.01] border-sky-400/80 bg-card z-30 ring-1 ring-sky-400/40'
}: ReorderItemProps<T>) {
  const dragControls = useDragControls();
  const [isDragging, setIsDragging] = useState(false);
  const groupAs = useContext(ReorderListContext);
  const itemAs = as ?? (groupAs === 'div' ? 'div' : 'li');

  const contextValue = useMemo<ReorderItemContextValue>(
    () => ({
      dragControls,
      isDragging,
      setIsDragging,
      onMoveUp,
      onMoveDown,
      canMoveUp,
      canMoveDown
    }),
    [dragControls, isDragging, onMoveUp, onMoveDown, canMoveUp, canMoveDown]
  );

  return (
    <ReorderItemContext.Provider value={contextValue}>
      <Reorder.Item
        value={value}
        id={id}
        as={itemAs}
        dragListener={!dragHandleOnly}
        dragControls={dragControls}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={() => setIsDragging(false)}
        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        whileDrag={{
          scale: 1.015,
          zIndex: 40
        }}
        className={`relative transition-shadow duration-150 ${className} ${
          isDragging ? dragElevationClassName : ''
        }`}
      >
        {children}
      </Reorder.Item>
    </ReorderItemContext.Provider>
  );
}

export interface ReorderHandleProps {
  className?: string;
  iconSize?: number;
  title?: string;
  showKeyboardShortcuts?: boolean;
  'aria-label'?: string;
}

export function ReorderHandle({
  className = '',
  iconSize = 14,
  title = 'Drag to reorder',
  showKeyboardShortcuts = false,
  'aria-label': ariaLabel = 'Drag to reorder'
}: ReorderHandleProps) {
  const { dragControls, isDragging, onMoveUp, onMoveDown } = useReorderItemContext();

  const handlePointerDown = (event: React.PointerEvent) => {
    // Only respond to primary mouse button or touch
    if (event.button !== 0) return;
    dragControls.start(event);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      onMoveUp?.();
    } else if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      onMoveDown?.();
    }
  };

  const hint = ' (Alt+Up / Alt+Down)';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-keyshortcuts={showKeyboardShortcuts && (onMoveUp || onMoveDown) ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
      title={showKeyboardShortcuts && (onMoveUp || onMoveDown) ? `${title}${hint}` : title}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className={`touch-none select-none flex items-center justify-center p-1 rounded text-text-muted hover:text-text-base transition-colors cursor-grab active:cursor-grabbing shrink-0 ${
        isDragging ? 'text-sky-400 cursor-grabbing' : ''
      } ${className}`}
      data-testid="reorder-drag-handle"
    >
      <GripVertical size={iconSize} className="pointer-events-none" />
    </div>
  );
}

export interface ReorderActionButtonsProps {
  className?: string;
  size?: number;
}

/**
 * Accessible Up / Down action buttons for one-click reordering
 */
export function ReorderActionButtons({
  className = '',
  size = 12
}: ReorderActionButtonsProps) {
  const { onMoveUp, onMoveDown, canMoveUp, canMoveDown } = useReorderItemContext();

  if (!onMoveUp && !onMoveDown) return null;

  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      {onMoveUp && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMoveUp();
          }}
          disabled={canMoveUp === false}
          className="p-1 rounded text-text-muted hover:text-sky-400 hover:bg-inner disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          title="Move layer up"
          aria-label="Move layer up"
        >
          <ArrowUp size={size} />
        </button>
      )}
      {onMoveDown && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMoveDown();
          }}
          disabled={canMoveDown === false}
          className="p-1 rounded text-text-muted hover:text-sky-400 hover:bg-inner disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          title="Move layer down"
          aria-label="Move layer down"
        >
          <ArrowDown size={size} />
        </button>
      )}
    </div>
  );
}

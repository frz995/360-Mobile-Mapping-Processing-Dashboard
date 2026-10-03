import React from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';

/**
 * Standard Tabs System with Physics-based Animated Indicator & Content Transitions
 *
 * Designed to provide:
 * - Fluid sliding indicator line across active triggers via Framer Motion `layoutId`
 * - Roving tabindex keyboard navigation (ArrowLeft, ArrowRight, Home, End)
 * - Silk (fade & subtle lift) or Slide content transitions
 * - Seamless integration with design token CSS variables
 */

interface TabsContextValue<T extends string = string> {
  value: T;
  onValueChange: (value: T) => void;
  groupId: string;
  tabsRef: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
  tabKeysRef: React.MutableRefObject<string[]>;
}

const TabsContext = React.createContext<TabsContextValue<any> | null>(null);

function useTabsContext<T extends string = string>() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) {
    throw new Error('Tabs compound components must be rendered within a <Tabs> parent.');
  }
  return ctx as TabsContextValue<T>;
}

export interface TabsProps<T extends string = string> {
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export function Tabs<T extends string = string>({
  value: controlledValue,
  defaultValue,
  onValueChange,
  children,
  className = '',
  id
}: TabsProps<T>) {
  const autoId = React.useId();
  const groupId = id || `tabs-group-${autoId.replace(/:/g, '')}`;

  const [uncontrolledValue, setUncontrolledValue] = React.useState<T>(() => {
    return defaultValue !== undefined ? defaultValue : ('' as T);
  });

  const isControlled = controlledValue !== undefined;
  const activeValue = isControlled ? controlledValue : uncontrolledValue;

  const tabsRef = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const tabKeysRef = React.useRef<string[]>([]);

  const handleValueChange = React.useCallback(
    (newValue: T) => {
      if (!isControlled) {
        setUncontrolledValue(newValue);
      }
      onValueChange?.(newValue);
    },
    [isControlled, onValueChange]
  );

  const contextValue = React.useMemo<TabsContextValue<T>>(
    () => ({
      value: activeValue,
      onValueChange: handleValueChange,
      groupId,
      tabsRef,
      tabKeysRef
    }),
    [activeValue, handleValueChange, groupId]
  );

  return (
    <TabsContext.Provider value={contextValue}>
      <LayoutGroup id={groupId}>
        <div className={`flex flex-col ${className}`} data-tabs-root={groupId}>
          {children}
        </div>
      </LayoutGroup>
    </TabsContext.Provider>
  );
}

export interface TabsListProps {
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function TabsList({
  children,
  className = '',
  ariaLabel = 'Navigation tabs'
}: TabsListProps) {
  const { value: activeValue, onValueChange, tabsRef, tabKeysRef } = useTabsContext();

  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys = tabKeysRef.current;
    if (keys.length === 0) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;

    const focusedKey = Object.entries(tabsRef.current).find(([, el]) => el === document.activeElement)?.[0] || activeValue;
    const currentIndex = focusedKey ? keys.indexOf(focusedKey) : 0;
    if (currentIndex < 0) return;

    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + keys.length) % keys.length;
    else if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % keys.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = keys.length - 1;

    const nextKey = keys[nextIndex];
    onValueChange(nextKey);
    tabsRef.current[nextKey]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`relative flex items-stretch gap-1 border-b border-divider overflow-x-auto select-none ${className}`}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps<T extends string = string> {
  value: T;
  children: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function TabsTrigger<T extends string = string>({
  value,
  children,
  icon,
  badge,
  className = '',
  disabled = false
}: TabsTriggerProps<T>) {
  const { value: activeValue, onValueChange, groupId, tabsRef, tabKeysRef } = useTabsContext<T>();
  const isSelected = activeValue === value;

  React.useEffect(() => {
    if (!tabKeysRef.current.includes(value)) {
      tabKeysRef.current.push(value);
    }
    return () => {
      tabKeysRef.current = tabKeysRef.current.filter((k) => k !== value);
    };
  }, [value, tabKeysRef]);

  return (
    <button
      type="button"
      ref={(el) => {
        tabsRef.current[value] = el;
      }}
      role="tab"
      id={`tab-${groupId}-${value}`}
      aria-controls={`panel-${groupId}-${value}`}
      aria-selected={isSelected}
      tabIndex={isSelected ? 0 : -1}
      disabled={disabled}
      onClick={() => onValueChange(value)}
      className={`relative flex items-center gap-1.5 px-3.5 py-2.5 text-[11px] font-semibold tracking-wide whitespace-nowrap transition-colors duration-150 ease-out cursor-pointer ${
        isSelected ? 'text-text-base' : 'text-text-muted hover:text-text-base'
      } ${disabled ? 'opacity-50 pointer-events-none' : ''} ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
      {badge && <span className="shrink-0">{badge}</span>}

      {/* Physics-based animated indicator line */}
      {isSelected && (
        <motion.span
          layoutId={`tab-active-indicator-${groupId}`}
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
          className="absolute inset-x-2 bottom-0 h-[2px] rounded-full z-10 pointer-events-none"
          style={{
            backgroundColor: 'var(--text-primary)',
            boxShadow: '0 0 10px color-mix(in srgb, var(--text-primary) 70%, transparent)'
          }}
          data-testid="tabs-animated-indicator"
        />
      )}
    </button>
  );
}

export interface TabsContentProps<T extends string = string> {
  value: T;
  children: React.ReactNode;
  className?: string;
  variant?: 'silk' | 'slide';
}

export function TabsContent<T extends string = string>({
  value,
  children,
  className = '',
  variant = 'silk'
}: TabsContentProps<T>) {
  const { value: activeValue, groupId } = useTabsContext<T>();
  const isSelected = activeValue === value;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {isSelected && (
        <motion.div
          key={value}
          role="tabpanel"
          id={`panel-${groupId}-${value}`}
          aria-labelledby={`tab-${groupId}-${value}`}
          initial={
            variant === 'slide'
              ? { opacity: 0, x: 12 }
              : { opacity: 0, y: 7 }
          }
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={
            variant === 'slide'
              ? { opacity: 0, x: -12 }
              : { opacity: 0, y: -7 }
          }
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className={`w-full flex-1 flex flex-col min-h-0 ${className}`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

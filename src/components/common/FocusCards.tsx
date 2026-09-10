import React, { createContext, useCallback, useContext, useState } from 'react';
import { motion } from 'framer-motion';

/* ============================================================================
   FocusCards — Aceternity-style "hover-to-focus" card grid wrapper.
   When a card is hovered the siblings blur + dim; the hovered card pops.
   Touch devices are left unaffected (no sticky blur).
   ============================================================================ */

// ---------------------------------------------------------------------------
// Context that carries the currently hovered card index through the tree.
// ---------------------------------------------------------------------------
interface FocusCtx {
  hoveredIndex: number | null;
  setHoveredIndex: (idx: number | null) => void;
}

const FocusContext = createContext<FocusCtx>({
  hoveredIndex: null,
  setHoveredIndex: () => {},
});

// ---------------------------------------------------------------------------
// FocusCardGrid — drop-in replacement for the outer <div className="grid …">
// ---------------------------------------------------------------------------
interface FocusCardGridProps {
  children: React.ReactNode;
  className?: string;
}

export function FocusCardGrid({ children, className = '' }: FocusCardGridProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const handleMouseLeave = useCallback(() => setHoveredIndex(null), []);

  return (
    <FocusContext.Provider value={{ hoveredIndex, setHoveredIndex }}>
      <div className={className} onMouseLeave={handleMouseLeave}>
        {children}
      </div>
    </FocusContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// FocusCard — wraps each individual card with the focus/blur animation.
// ---------------------------------------------------------------------------
interface FocusCardProps {
  children: React.ReactNode;
  index: number;
}

export function FocusCard({ children, index }: FocusCardProps) {
  const { hoveredIndex, setHoveredIndex } = useContext(FocusContext);

  // Determine visual state
  const isAnyHovered = hoveredIndex !== null;
  const isThisHovered = hoveredIndex === index;

  return (
    <motion.div
      onMouseEnter={() => setHoveredIndex(index)}
      // Smooth spring-less transition
      animate={{
        opacity: isAnyHovered ? (isThisHovered ? 1 : 0.45) : 1,
        scale: isAnyHovered ? (isThisHovered ? 1.02 : 0.98) : 1,
        filter: isAnyHovered
          ? isThisHovered
            ? 'blur(0px) brightness(1)'
            : 'blur(3px) brightness(0.7)'
          : 'blur(0px) brightness(1)',
      }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="will-change-transform"
    >
      {children}
    </motion.div>
  );
}

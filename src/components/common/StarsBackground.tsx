import React, { useEffect, useState, useRef, useCallback } from 'react';

export interface StarsBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  factor?: number;
  speed?: number;
  starColor?: string;
  pointerEvents?: boolean;
}

interface StarLayerConfig {
  count: number;
  size: number;
  duration: number;
}

function generateStars(count: number, color: string): string {
  const shadows: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * 4000) - 2000;
    const y = Math.floor(Math.random() * 4000) - 2000;
    shadows.push(`${x}px ${y}px ${color}`);
  }
  return shadows.join(', ');
}

export const StarsBackground: React.FC<StarsBackgroundProps> = ({
  children,
  className = '',
  factor = 0.05,
  speed = 45,
  starColor = '#ffffff',
  pointerEvents = false,
  ...props
}) => {
  const [shadows, setShadows] = useState<[string, string, string]>(['', '', '']);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const targetOffset = useRef({ x: 0, y: 0 });
  const animFrameId = useRef<number>(0);

  // Generate 3 layers of stars (depth hierarchy)
  useEffect(() => {
    const layer1 = generateStars(900, starColor);
    const layer2 = generateStars(350, starColor);
    const layer3 = generateStars(160, starColor);
    setShadows([layer1, layer2, layer3]);
  }, [starColor]);

  // Spring mouse parallax animation
  useEffect(() => {
    let currentX = 0;
    let currentY = 0;

    const animate = () => {
      // Smooth lerp / spring easing
      currentX += (targetOffset.current.x - currentX) * 0.08;
      currentY += (targetOffset.current.y - currentY) * 0.08;
      setOffset({ x: currentX, y: currentY });
      animFrameId.current = requestAnimationFrame(animate);
    };

    animFrameId.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameId.current);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (typeof window === 'undefined') return;
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      targetOffset.current = {
        x: -(e.clientX - centerX) * factor,
        y: -(e.clientY - centerY) * factor,
      };
    },
    [factor]
  );

  const layers: StarLayerConfig[] = [
    { count: 900, size: 1, duration: speed },
    { count: 350, size: 1.8, duration: speed * 1.8 },
    { count: 160, size: 2.6, duration: speed * 2.8 },
  ];

  return (
    <div
      data-slot="stars-background"
      className={`relative w-full h-full overflow-hidden ${className}`}
      onMouseMove={handleMouseMove}
      {...props}
    >
      <style>{`
        @keyframes animate-ui-stars-float {
          0% {
            transform: translateY(0px);
          }
          100% {
            transform: translateY(-2000px);
          }
        }
      `}</style>

      {/* Parallax Container reacting to mouse */}
      <div
        className={`absolute inset-0 ${pointerEvents ? '' : 'pointer-events-none'}`}
        style={{
          transform: `translate3d(${offset.x.toFixed(2)}px, ${offset.y.toFixed(2)}px, 0)`,
          willChange: 'transform',
        }}
      >
        {layers.map((layer, idx) => {
          const shadow = shadows[idx];
          if (!shadow) return null;

          return (
            <div
              key={idx}
              className="absolute top-0 left-0 w-full h-[2000px] pointer-events-none"
              style={{
                animation: `animate-ui-stars-float ${layer.duration}s linear infinite`,
                willChange: 'transform',
              }}
            >
              {/* Primary Star Field */}
              <div
                className="absolute bg-transparent rounded-full"
                style={{
                  width: `${layer.size}px`,
                  height: `${layer.size}px`,
                  boxShadow: shadow,
                  opacity: idx === 0 ? 0.75 : idx === 1 ? 0.85 : 0.95,
                }}
              />
              {/* Seamless Loop Duplicate at top 2000px */}
              <div
                className="absolute bg-transparent rounded-full top-[2000px]"
                style={{
                  width: `${layer.size}px`,
                  height: `${layer.size}px`,
                  boxShadow: shadow,
                  opacity: idx === 0 ? 0.75 : idx === 1 ? 0.85 : 0.95,
                }}
              />
            </div>
          );
        })}
      </div>

      {children}
    </div>
  );
};

export default StarsBackground;
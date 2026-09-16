import React, { useId } from 'react';

export interface GeoSphereIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  className?: string;
  colorful?: boolean;
}

export interface GeoSphereFullLogoProps extends GeoSphereIconProps {
  /**
   * If true, renders only the standalone icon mark without text.
   */
  iconOnly?: boolean;
  /**
   * Color for the "360°" text (defaults to '#FFFFFF' in colorful mode).
   */
  degreesColor?: string;
}

/**
 * GeoSphere 360 Standalone Icon Mark.
 * Ideal for square avatars, badges, mobile collapsed headers, and favicons.
 */
export const GeoSphereIcon: React.FC<GeoSphereIconProps> = ({
  size = 24,
  className = '',
  style,
  colorful = true,
  ...props
}) => {
  const uniqueId = useId().replace(/:/g, '');
  const wingGradFront = `gs-icon-wf-${uniqueId}`;
  const stemGradFront = `gs-icon-sf-${uniqueId}`;
  const wingGradBack = `gs-icon-wb-${uniqueId}`;
  const stemGradBack = `gs-icon-sb-${uniqueId}`;

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      fill="none"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <defs>
        {/* Front Wing: Sunburst Gold to Warm Amber */}
        <linearGradient id={wingGradFront} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFEA00" />
          <stop offset="35%" stopColor="#FFB300" />
          <stop offset="100%" stopColor="#F57C00" />
        </linearGradient>

        {/* Front Stem: Fiery Tangerine to Burnt Copper */}
        <linearGradient id={stemGradFront} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#FB8C00" />
          <stop offset="55%" stopColor="#E65100" />
          <stop offset="100%" stopColor="#BF360C" />
        </linearGradient>

        {/* Rear Wing: Radiant Light Amber */}
        <linearGradient id={wingGradBack} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFF176" />
          <stop offset="35%" stopColor="#FFC107" />
          <stop offset="100%" stopColor="#FB8C00" />
        </linearGradient>

        {/* Rear Stem: Deep Tangerine Amber */}
        <linearGradient id={stemGradBack} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#FFA000" />
          <stop offset="55%" stopColor="#F57C00" />
          <stop offset="100%" stopColor="#D84315" />
        </linearGradient>
      </defs>

      {/* Rear Chevron Unit */}
      <path
        d="M 189 11 C 145.3 24.9, 77.7 15.0, 62 67 C 89.0 65.7, 118.7 56.0, 147 52 Z"
        fill={colorful ? '#FFFFFF' : 'currentColor'}
        opacity={colorful ? 1 : 0.65}
      />
      <path
        d="M 189 11 L 147 52 C 145.6 80.5, 135.4 109.0, 132 138 C 186.3 122.4, 175.4 54.6, 189 11 Z"
        fill={colorful ? '#FFFFFF' : 'currentColor'}
        stroke="none"
        opacity={colorful ? 1 : 0.45}
      />

      {/* Front Chevron Unit */}
      <path
        d="M 137 63 C 93.3 76.9, 25.7 67.0, 10 119 C 37.0 117.7, 66.7 108.0, 95 104 Z"
        fill={colorful ? '#FFFFFF' : 'currentColor'}
        stroke="none"
        opacity={colorful ? 1 : 1.0}
      />
      <path
        d="M 137 63 L 95 104 C 93.6 132.5, 83.4 161.0, 80 190 C 134.3 174.4, 123.4 106.6, 137 63 Z"
        fill={colorful ? '#FFFFFF' : 'currentColor'}
        stroke="none"
        opacity={colorful ? 1 : 0.8}
      />
    </svg>
  );
};

/**
 * GeoSphere 360 Full Logo.
 * Includes the dynamic flight vector mark and the brand text "GeoSphere 360°".
 * - "GeoSphere" rendered in a grey → white gradient.
 * - Mark filled white (clean, no outer stroke).
 * - "360°" rendered in crisp white with the degree symbol.
 * - ViewBox: 0 0 820 200 (aspect ratio 4.1:1).
 */
export const GeoSphereFullLogo: React.FC<GeoSphereFullLogoProps> = ({
  size = 32,
  className = '',
  style,
  colorful = true,
  iconOnly = false,
  degreesColor = '#FFFFFF',
  ...props
}) => {
  if (iconOnly) {
    return <GeoSphereIcon size={size} className={className} style={style} colorful={colorful} {...props} />;
  }

  const uniqueId = useId().replace(/:/g, '');
  const wingGradFront = `gs-full-wf-${uniqueId}`;
  const stemGradFront = `gs-full-sf-${uniqueId}`;
  const wingGradBack = `gs-full-wb-${uniqueId}`;
  const stemGradBack = `gs-full-sb-${uniqueId}`;
  const textGrad = `gs-full-text-${uniqueId}`;

  const numericHeight = typeof size === 'number' ? size : parseInt(size as string, 10) || 32;
  const computedWidth = numericHeight * 4.1;

  return (
    <svg
      viewBox="0 0 820 200"
      width={computedWidth}
      height={size}
      fill="none"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <defs>
        {/* Front Wing Gradients */}
        <linearGradient id={wingGradFront} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFEA00" />
          <stop offset="35%" stopColor="#FFB300" />
          <stop offset="100%" stopColor="#F57C00" />
        </linearGradient>
        <linearGradient id={stemGradFront} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#FB8C00" />
          <stop offset="55%" stopColor="#E65100" />
          <stop offset="100%" stopColor="#BF360C" />
        </linearGradient>

        {/* Rear Wing Gradients */}
        <linearGradient id={wingGradBack} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFF176" />
          <stop offset="35%" stopColor="#FFC107" />
          <stop offset="100%" stopColor="#FB8C00" />
        </linearGradient>
        <linearGradient id={stemGradBack} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#FFA000" />
          <stop offset="55%" stopColor="#F57C00" />
          <stop offset="100%" stopColor="#D84315" />
        </linearGradient>

        {/* Text Gradient: grey → white monochrome brand */}
        <linearGradient id={textGrad} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#9CA3AF" />
          <stop offset="55%" stopColor="#D4D4D8" />
          <stop offset="100%" stopColor="#FFFFFF" />
        </linearGradient>
      </defs>

      {/* Aerodynamic Dual-Chevron Flight Mark */}
      <g id="flight-mark">
        {/* Rear Chevron Unit */}
        <path
          d="M 189 11 C 145.3 24.9, 77.7 15.0, 62 67 C 89.0 65.7, 118.7 56.0, 147 52 Z"
          fill={colorful ? '#FFFFFF' : 'currentColor'}
          opacity={colorful ? 1 : 0.65}
        />
        <path
          d="M 189 11 L 147 52 C 145.6 80.5, 135.4 109.0, 132 138 C 186.3 122.4, 175.4 54.6, 189 11 Z"
          fill={colorful ? '#FFFFFF' : 'currentColor'}
          opacity={colorful ? 1 : 0.45}
        />

        {/* Front Chevron Unit */}
        <path
          d="M 137 63 C 93.3 76.9, 25.7 67.0, 10 119 C 37.0 117.7, 66.7 108.0, 95 104 Z"
          fill={colorful ? '#FFFFFF' : 'currentColor'}
          opacity={colorful ? 1 : 1.0}
        />
        <path
          d="M 137 63 L 95 104 C 93.6 132.5, 83.4 161.0, 80 190 C 134.3 174.4, 123.4 106.6, 137 63 Z"
          fill={colorful ? '#FFFFFF' : 'currentColor'}
          opacity={colorful ? 1 : 0.8}
        />
      </g>

      {/* Integrated Logo Text: "GeoSphere 360°" */}
      <g transform="translate(220, 108)">
        <text
          y="0"
          dominantBaseline="central"
          alignmentBaseline="central"
          fontFamily="'Outfit', 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
          fontWeight="800"
          fontSize="78"
          letterSpacing="-1"
        >
          <tspan fill={colorful ? `url(#${textGrad})` : 'currentColor'}>
            GeoSphere
          </tspan>
          <tspan
            fontWeight="700"
            fontSize="70"
            dx="14"
            fill={colorful ? degreesColor : 'currentColor'}
          >
            360°
          </tspan>
        </text>
      </g>
    </svg>
  );
};

export default GeoSphereFullLogo;

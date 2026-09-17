import React from 'react';
import { fontFamily } from '../fonts';

interface BrandLogoProps {
    height?: number;
    style?: React.CSSProperties;
    /** Render only the white dual-chevron flight mark (no wordmark). */
    iconOnly?: boolean;
}

/**
 * White GeoSphere lockup that mirrors the app header's GeoSphereFullLogo:
 * pure-white dual-chevron flight mark + "GeoSphere" in a grey→white
 * gradient + crisp-white "360°". Drawn inline so it stays razor-sharp at
 * any scale and matches the header exactly (no raster PNG involved).
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({ height = 28, style, iconOnly = false }) => {
    const uid = React.useId().replace(/:/g, '');
    const textGrad = `bl-text-${uid}`;
    const width = iconOnly ? height : height * 4.1;

    return (
        <svg
            viewBox={iconOnly ? '0 0 200 200' : '0 0 820 200'}
            width={width}
            height={height}
            fill="none"
            preserveAspectRatio="xMidYMid meet"
            style={style}
            xmlns="http://www.w3.org/2000/svg"
        >
            {!iconOnly && (
                <defs>
                    <linearGradient id={textGrad} x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#9CA3AF" />
                        <stop offset="55%" stopColor="#D4D4D8" />
                        <stop offset="100%" stopColor="#FFFFFF" />
                    </linearGradient>
                </defs>
            )}
            {/* Aerodynamic dual-chevron flight mark (white, like the header) */}
            <path d="M 189 11 C 145.3 24.9, 77.7 15.0, 62 67 C 89.0 65.7, 118.7 56.0, 147 52 Z" fill="#FFFFFF" />
            <path d="M 189 11 L 147 52 C 145.6 80.5, 135.4 109.0, 132 138 C 186.3 122.4, 175.4 54.6, 189 11 Z" fill="#FFFFFF" />
            <path d="M 137 63 C 93.3 76.9, 25.7 67.0, 10 119 C 37.0 117.7, 66.7 108.0, 95 104 Z" fill="#FFFFFF" />
            <path d="M 137 63 L 95 104 C 93.6 132.5, 83.4 161.0, 80 190 C 134.3 174.4, 123.4 106.6, 137 63 Z" fill="#FFFFFF" />

            {!iconOnly && (
                <g transform="translate(220, 108)">
                    <text
                        y="0"
                        dominantBaseline="central"
                        alignmentBaseline="central"
                        fontFamily={`${fontFamily}, 'Outfit', system-ui, -apple-system, sans-serif`}
                        fontWeight="800"
                        fontSize="78"
                        letterSpacing="-1"
                    >
                        <tspan fill={`url(#${textGrad})`}>GeoSphere</tspan>
                        <tspan fontWeight="700" fontSize="70" dx="14" fill="#FFFFFF">
                            360°
                        </tspan>
                    </text>
                </g>
            )}
        </svg>
    );
};

import React from 'react';

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div aria-hidden="true" className={`animate-pulse rounded-md bg-inner ${className}`} />
);

export const SkeletonLine: React.FC<{ className?: string }> = ({ className = '' }) => (
  <Skeleton className={`h-3 ${className}`} />
);

export const SkeletonLabel: React.FC<{ className?: string }> = ({ className = '' }) => (
  <Skeleton className={`h-4 w-24 ${className}`} />
);

export const SkeletonValue: React.FC<{ className?: string }> = ({ className = '' }) => (
  <Skeleton className={`h-7 w-28 ${className}`} />
);

export const SkeletonTableRows: React.FC<{ rows?: number; cols?: number; className?: string }> = ({
  rows = 6,
  cols = 5,
  className = ''
}) => (
  <div aria-hidden="true" className={`space-y-2.5 ${className}`}>
    {Array.from({ length: rows }).map((_, r) => (
      <div key={r} className="flex gap-3">
        {Array.from({ length: cols }).map((_, c) => (
          <Skeleton key={c} className={`h-3.5 flex-1 ${c === 0 ? 'w-24 flex-none' : ''}`} />
        ))}
      </div>
    ))}
  </div>
);
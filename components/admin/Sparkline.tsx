'use client';

import { memo, useMemo } from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
}

export const Sparkline = memo(function Sparkline({
  data,
  width = 100,
  height = 24,
  color = 'currentColor',
  fillOpacity = 0.1,
}: SparklineProps) {
  const path = useMemo(() => {
    if (data.length === 0) return '';

    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;

    const points = data.map((value, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    });

    return `M${points.join(' L')}`;
  }, [data, width, height]);

  const areaPath = useMemo(() => {
    if (data.length === 0) return '';

    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;

    const points = data.map((value, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    });

    return `M0,${height} L${points.join(' L')} L${width},${height} Z`;
  }, [data, width, height]);

  if (data.length < 2) {
    return <div style={{ width, height }} className="bg-muted/20 rounded" />;
  }

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={areaPath} fill={color} fillOpacity={fillOpacity} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
});

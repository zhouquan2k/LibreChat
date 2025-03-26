import React from 'react';
import { cn } from '~/utils';

export const DifyIcon = ({ className = '' }: { className?: string }) => {
  return (
    <svg 
      className={cn('icon-md shrink-0', className)} 
      viewBox="0 0 24 24" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <path 
        d="M8.778 19.5A7.47 7.47 0 0 1 4.5 12.778v-6.5l7.5-3.778 7.5 3.778v6.5A7.47 7.47 0 0 1 15.222 19.5l-3.222 3.222-3.222-3.222Z" 
        stroke="currentColor" 
        strokeWidth="1.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      <path 
        d="M10 14.778C10 15.253 11.075 16 12 16s2-.747 2-1.222c0-.476-.23-.92-.597-1.222v-4c.366-.302.597-.746.597-1.222 0-.476-1.075-.778-2-.778s-2 .302-2 .778c0 .476.23.92.597 1.222v4A1.67 1.67 0 0 0 10 14.778Z"
        stroke="currentColor" 
        strokeWidth="1.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  );
}; 
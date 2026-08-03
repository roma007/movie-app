import { useState } from 'react';

interface PosterImageProps {
  src?: string | null;
  alt?: string;
  className?: string;
}

export function PosterImage({ src, alt = '', className }: PosterImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={`flex items-center justify-center text-muted-foreground text-xs ${className || ''}`}>
        无封面
      </div>
    );
  }

  return <img src={src} alt={alt} className={className} loading="lazy" onError={() => setFailed(true)} />;
}

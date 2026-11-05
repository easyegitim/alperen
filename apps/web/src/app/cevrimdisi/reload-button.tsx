'use client';

import { RotateCw } from 'lucide-react';
import { Button } from '@/ds';

export function ReloadButton() {
  return (
    <Button variant="primary" icon={<RotateCw size={18} />} onClick={() => window.location.reload()}>
      Yeniden dene
    </Button>
  );
}

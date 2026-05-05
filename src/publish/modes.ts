export type PublishMode = 'shadow' | 'soft' | 'full';

export interface ModePolicy {
  canPublish(now: Date): boolean;
  dailyCap: number;
  delaySeconds: number;
  description: string;
}

function hourArg(d: Date): number {
  return (d.getUTCHours() + 24 - 3) % 24;
}

const SHADOW: ModePolicy = {
  canPublish: () => false,
  dailyCap: 6,
  delaySeconds: 0,
  description: 'Shadow: no publica. Drafts quedan en queue para review manual.',
};

const SOFT: ModePolicy = {
  canPublish: (now) => {
    const h = hourArg(now);
    return h >= 9 && h < 22;
  },
  dailyCap: 3,
  delaySeconds: 60,
  description: 'Soft launch: publica 9-22 ARG, cap 3/día, delay 60s post-approve para permitir kill.',
};

const FULL: ModePolicy = {
  canPublish: () => true,
  dailyCap: 6,
  delaySeconds: 0,
  description: 'Full autonomous: cap 6/día, 24/7 con quiet hours 1-7am ARG (manejados en caps.ts).',
};

export function policyForMode(mode: PublishMode): ModePolicy {
  switch (mode) {
    case 'shadow':
      return SHADOW;
    case 'soft':
      return SOFT;
    case 'full':
      return FULL;
  }
}

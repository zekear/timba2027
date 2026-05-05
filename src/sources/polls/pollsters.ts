/**
 * Lista curada de cuentas X de encuestadoras argentinas (la lista canónica
 * que el bot monitorea). Se siembra a la DB en boot.
 *
 * Para desactivar una sin removerla del seed: SET active=false manualmente,
 * o quitarla de este array y correr `pnpm tsx scripts/seed-pollsters.ts` —
 * el seed marca como inactive a todas las que no aparecen acá.
 */

export interface PollsterSeed {
  slug: string;
  displayName: string;
  xHandle: string;       // sin @
  notes?: string;
}

export const POLLSTERS: PollsterSeed[] = [
  {
    slug: 'cb_consultora',
    displayName: 'CB Consultora',
    xHandle: 'CBglobaldata',
    notes: 'Activa en imagen presidencial y proyecciones electorales.',
  },
  {
    slug: 'atlas_intel',
    displayName: 'Atlas Intel',
    xHandle: 'AtlasIntelESP',
    notes: 'Brasileña, fuerte presencia en AR, destacada en 2023.',
  },
  {
    slug: 'management_fit',
    displayName: 'Management & Fit',
    xHandle: 'MyFconsultora',
  },
  {
    slug: 'trespuntozero',
    displayName: 'Trespuntozero',
    xHandle: 'trespuntozero_',
    notes: 'Dirigida por Shila Vilker.',
  },
  {
    slug: 'giacobbe',
    displayName: 'Giacobbe & Asociados',
    xHandle: 'JorgeGiacobbe',
    notes: 'Cuenta personal del director — comparte encuestas allí.',
  },
  {
    slug: 'zentrix',
    displayName: 'Zentrix Consultora',
    xHandle: 'ZXConsultora',
  },
  {
    slug: 'nueva_comunicacion',
    displayName: 'Nueva Comunicación',
    xHandle: 'Nuevacomar',
    notes: 'Buen desempeño en bonaerenses recientes.',
  },
];

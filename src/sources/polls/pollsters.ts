/**
 * Lista curada de cuentas X de encuestadoras y analistas argentinos.
 * Se siembra a la DB en boot (idempotente). Después de seed, podés desactivar
 * cualquiera con UPDATE pollsters SET active = false WHERE slug = '...'.
 */

export interface PollsterSeed {
  slug: string;
  displayName: string;
  xHandle: string;       // sin @
  notes?: string;
}

export const POLLSTERS: PollsterSeed[] = [
  // Encuestadoras formales
  { slug: 'opinaia',         displayName: 'Opinaia',                   xHandle: 'opinaiagency' },
  { slug: 'cb_consultora',   displayName: 'CB Consultora',             xHandle: 'cb_consultora' },
  { slug: 'synopsis',        displayName: 'Synopsis Consultores',      xHandle: 'SynopsisCons' },
  { slug: 'atlas_intel',     displayName: 'Atlas Intel',               xHandle: 'AtlasIntel' },
  { slug: 'zuban_cordoba',   displayName: 'Zuban Córdoba',             xHandle: 'ZubanCordoba' },
  { slug: 'management_fit',  displayName: 'Management & Fit',          xHandle: 'Manage_Fit' },
  // Analistas que publican datos de encuestas
  { slug: 'fede_gonzalez',   displayName: 'Federico González',         xHandle: 'fede_gonzalez_ok' },
  { slug: 'carlos_fara',     displayName: 'Carlos Fara',               xHandle: 'CarlosFara' },
  { slug: 'shila_vilker',    displayName: 'Shila Vilker',              xHandle: 'ShilaVilker' },
  { slug: 'lucas_romero',    displayName: 'Lucas Romero (Synopsis)',   xHandle: 'lucasrome',     notes: 'Director de Synopsis' },
];

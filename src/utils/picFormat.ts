/**
 * Pure helper for formatting a "PIC" (photo intake coordinator) name.
 * Extracted verbatim from src/services/supabase.ts (Phase 2 of the monolith
 * split — see implementation_plan_v12.md). Stateless and side-effect free.
 */
export function formatPIC(name?: string | null, fallback: string = 'Fariz.farhan95'): string {
  if (!name) return fallback;
  const clean = name.trim();
  if (!clean || clean.toLowerCase() === 'unassigned' || clean.toLowerCase() === 'operator') return fallback;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
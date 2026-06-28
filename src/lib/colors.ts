// Shift-cell colour tokens. Each shift code maps to a paired light/dark
// background-text-border triple so the schedule grid stays semantic in
// either theme — pre-2.6 the dark theme washed every cell to near-white
// because the global `bg-blue-50` override mapped to a soft tint that
// fought the cell text. Now each cell ships its own dark variant.
//
// Tailwind v4 picks up the `dark:` prefix via the variant defined in
// `index.css`. Keep the colour pairs semantic (blue=field, emerald=hall,
// amber=mixed, rose=maternity, …) so the shift code reads at a glance.
export function getShiftColor(code: string) {
  switch (code) {
    case 'FS': return "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-500/30";
    case 'HS': return "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30";
    case 'MX': return "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30";
    // v5.41.0 — part-time tiers (P1/P2/P3) are real shift codes in the library
    // but previously had no colour, so their grid cells + the new painter
    // swatch rendered uncoloured. A distinct sky→indigo→fuchsia family keeps
    // them readable and clear of the nine codes above.
    case 'P1': return "bg-sky-50 text-sky-700 border-sky-100 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/30";
    case 'P2': return "bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-200 dark:border-indigo-500/30";
    case 'P3': return "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100 dark:bg-fuchsia-500/15 dark:text-fuchsia-200 dark:border-fuchsia-500/30";
    case 'OFF': return "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-700/50 dark:text-slate-300 dark:border-slate-600";
    case 'AL': return "bg-purple-50 text-purple-700 border-purple-100 dark:bg-purple-500/15 dark:text-purple-200 dark:border-purple-500/30";
    case 'SL': return "bg-yellow-50 text-yellow-700 border-yellow-100 dark:bg-yellow-500/15 dark:text-yellow-200 dark:border-yellow-500/30";
    case 'PH': return "bg-red-50 text-red-700 border-red-100 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/30";
    case 'MAT': return "bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-500/30";
    case 'CP': return "bg-teal-50 text-teal-700 border-teal-100 dark:bg-teal-500/15 dark:text-teal-200 dark:border-teal-500/30";
    default: return "";
  }
}

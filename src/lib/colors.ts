export function getShiftColor(code: string) {
  switch (code) {
    case 'FS': return "bg-blue-50 text-blue-700 border-blue-100";
    case 'HS': return "bg-emerald-50 text-emerald-700 border-emerald-100";
    case 'MX': return "bg-amber-50 text-amber-700 border-amber-100";
    case 'OFF': return "bg-slate-100 text-slate-500 border-slate-200";
    case 'AL': return "bg-purple-50 text-purple-700 border-purple-100";
    case 'SL': return "bg-yellow-50 text-yellow-700 border-yellow-100";
    case 'PH': return "bg-red-50 text-red-700 border-red-100";
    case 'MAT': return "bg-rose-50 text-rose-700 border-rose-100";
    default: return "";
  }
}

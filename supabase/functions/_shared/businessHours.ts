// Horários: seg-sex 8-18h, sáb 8-13h, dom fechado (America/Sao_Paulo)
export function isWithinBusinessHours(): boolean {
  const spTime = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
  );
  const day  = spTime.getDay();
  const hour = spTime.getHours();

  if (day === 0) return false;                      // domingo
  if (day === 6) return hour >= 8 && hour < 13;     // sábado
  return hour >= 8 && hour < 18;                    // seg-sex
}

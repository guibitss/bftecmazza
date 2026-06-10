/**
 * Camada de fundo ambiente: bolhas borradas em movimento lento + grid sutil.
 * Sem cor — só sombra/luz. Apple-feel.
 */
export function Ambient() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
    >
      {/* Grid sutil com mask radial */}
      <div className="absolute inset-0 ambient-grid" />

      {/* Bolhas borradas com drift lento */}
      <div
        className="absolute -top-32 -left-24 w-[560px] h-[560px] rounded-full animate-drift-a"
        style={{
          background: 'radial-gradient(closest-side, var(--blob-1), transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
      <div
        className="absolute top-1/3 -right-32 w-[640px] h-[640px] rounded-full animate-drift-b"
        style={{
          background: 'radial-gradient(closest-side, var(--blob-2), transparent 70%)',
          filter: 'blur(50px)',
        }}
      />
      <div
        className="absolute -bottom-40 left-1/3 w-[720px] h-[720px] rounded-full animate-drift-c"
        style={{
          background: 'radial-gradient(closest-side, var(--blob-3), transparent 70%)',
          filter: 'blur(60px)',
        }}
      />
    </div>
  );
}

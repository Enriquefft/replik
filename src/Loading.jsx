// SCREEN 1.5 — Loading State
// Animated activity log with morphing purple orb.

const Loading = ({ onDone, productLabel }) => {
  const lines = [
    'Cargando la página del producto…',
    'Extrayendo palabras clave…',
    'Buscando en Facebook Ad Library…',
    'Buscando creativos en TikTok…',
    'Identificando ángulos de venta…',
    'Generando template para Shopify…',
  ];
  const [shown, setShown] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (shown >= lines.length) {
      const t = setTimeout(() => onDone && onDone(), 800);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShown(shown + 1), 700);
    return () => clearTimeout(t);
  }, [shown]);

  React.useEffect(() => {
    const i = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const m = MODE.system;
  const total = 45;
  const remaining = Math.max(0, total - elapsed);

  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <style>{`
        @keyframes morph { 0%,100%{border-radius:42% 58% 50% 50% / 50% 50% 42% 58%;} 25%{border-radius:60% 40% 60% 40% / 40% 60% 40% 60%;} 50%{border-radius:50% 50% 35% 65% / 65% 35% 50% 50%;} 75%{border-radius:40% 60% 50% 50% / 55% 45% 60% 40%;} }
        @keyframes pulse { 0%,100%{transform:scale(0.95);opacity:.85;} 50%{transform:scale(1.05);opacity:1;} }
        .liquid-orb { animation: morph 4s ease-in-out infinite, pulse 2s ease-in-out infinite; }
        @keyframes line-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .log-line { animation: line-in 300ms cubic-bezier(0.16, 1, 0.3, 1) both; }
        @keyframes blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        .cursor { animation: blink 1s steps(2) infinite; }
      `}</style>

      <div style={{ width: '100%', maxWidth: 640, position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
        <div className="liquid-orb" style={{ width: 130, height: 130, background: 'radial-gradient(circle at 35% 30%, #dab8ff 0%, #bf5af2 80%)', boxShadow: '0 12px 48px rgba(191,90,242,0.45), 0 0 80px rgba(191,90,242,0.4)' }} />

        <div style={{ textAlign: 'center' }}>
          <ModeBadge mode="system" dot>Sistema · Trabajando</ModeBadge>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.4, color: '#1d1d1f', marginTop: 14 }}>Replik está analizando tu producto</div>
          <div style={{ fontSize: 14, color: '#6e6e73', marginTop: 6 }}>{productLabel || 'Tu producto'} · ~{remaining}s restantes</div>
        </div>

        <GlassCard padding={24} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Eyebrow>Registro de actividad</Eyebrow>
            <span style={{ fontSize: 11, fontFamily: '"SF Mono", monospace', color: m.badgeFg, padding: '3px 8px', borderRadius: 100, background: m.badgeBg }}>{shown}/{lines.length}</span>
          </div>
          <div style={{ fontFamily: '"SF Mono", monospace', fontSize: 13, lineHeight: 1.9, color: '#1d1d1f' }}>
            {lines.slice(0, shown).map((l, i) => (
              <div key={i} className="log-line" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: m.accent, width: 14 }}>→</span>
                <span style={{ flex: 1 }}>{l}</span>
                <i data-lucide="check" style={{ width: 14, height: 14, color: MODE.web.accent, strokeWidth: 2 }}/>
              </div>
            ))}
            {shown < lines.length && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: m.accent }}>
                <span style={{ width: 14 }}>→</span>
                <span>{lines[shown]}</span>
                <span className="cursor" style={{ color: m.accent }}>▌</span>
              </div>
            )}
          </div>
        </GlassCard>

        <div style={{ fontSize: 11, color: '#aeaeb2', fontFamily: '"SF Mono", monospace' }}>
          Puedes salir de esta página — Replik sigue trabajando en segundo plano.
        </div>
      </div>
    </div>
  );
};

window.Loading = Loading;

// SCREEN 0 — Onboarding (proceso visual paso a paso, animado)
// Muestra los 5 pasos del flujo + 3 modos. Tono coloquial.

const Onboarding = ({ onContinue }) => {
  const STEPS = [
    { n: '01', mode: 'web',      title: 'Tú me das el producto',         sub: 'Pega el link de la competencia o sube una foto. En 1 minuto.', graphic: 'url' },
    { n: '02', mode: 'creative', title: 'Yo busco los creativos',         sub: 'Saco videos ganadores de Facebook Ad Library y TikTok.',       graphic: 'crawl' },
    { n: '03', mode: 'creative', title: 'Edito y subtitulo',              sub: 'Subtítulos automáticos en español. Variaciones para esquivar duplicados.', graphic: 'edit' },
    { n: '04', mode: 'web',      title: 'Armo tu landing en Shopify',     sub: 'Eliges el template que más te gusta. Yo lo subo a tu tienda.', graphic: 'landing' },
    { n: '05', mode: 'traffic',  title: 'Lanzo tu campaña en Meta',       sub: 'CBO o ABO, con copies por ángulo. Tú solo apruebas y corre.',  graphic: 'launch' },
  ];

  // Mini animated graphic per step (96×80)
  const Graphic = ({ kind, mode }) => {
    const m = MODE[mode];
    const W = 130, H = 86;
    if (kind === 'url') {
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          {/* browser chrome */}
          <rect x="6" y="14" width={W-12} height={H-28} rx="8" fill="#fff" stroke="rgba(0,0,0,0.10)"/>
          <circle cx="14" cy="22" r="2" fill="#ff453a" opacity="0.5"/>
          <circle cx="22" cy="22" r="2" fill="#ff9f0a" opacity="0.5"/>
          <circle cx="30" cy="22" r="2" fill="#30d158" opacity="0.5"/>
          {/* url bar with caret */}
          <rect x="40" y="18" width={W-50} height="9" rx="4.5" fill="rgba(0,0,0,0.04)"/>
          <rect x="44" y="20.5" width="50" height="4" rx="1" fill={m.accent}>
            <animate attributeName="width" values="0;58;58" keyTimes="0;0.6;1" dur="2.4s" repeatCount="indefinite"/>
          </rect>
          {/* product card */}
          <rect x="14" y="36" width="32" height="34" rx="4" fill={m.badgeBg}/>
          <circle cx="30" cy="50" r="6" fill={m.accent} opacity="0.6"/>
          <rect x="52" y="38" width={W-66} height="3" rx="1.5" fill="rgba(0,0,0,0.18)"/>
          <rect x="52" y="46" width={W-80} height="3" rx="1.5" fill="rgba(0,0,0,0.10)"/>
          <rect x="52" y="56" width="34" height="6" rx="2" fill={m.accent}>
            <animate attributeName="opacity" values="0;1;1" keyTimes="0;0.7;1" dur="2.4s" repeatCount="indefinite"/>
          </rect>
        </svg>
      );
    }
    if (kind === 'crawl') {
      // Replik bot scanning a feed of video tiles
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <linearGradient id="scan" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={m.accent} stopOpacity="0"/>
              <stop offset="50%" stopColor={m.accent} stopOpacity="0.45"/>
              <stop offset="100%" stopColor={m.accent} stopOpacity="0"/>
            </linearGradient>
          </defs>
          {[0,1,2,3].map((i) => (
            <g key={i}>
              <rect x={10 + i*30} y="14" width="22" height="36" rx="3" fill={m.badgeBg}/>
              <polygon points={`${10 + i*30 + 9},${26} ${10 + i*30 + 17},${32} ${10 + i*30 + 9},${38}`} fill={m.accent} opacity="0.7"/>
            </g>
          ))}
          {/* scanning line */}
          <rect x="6" y="10" width={W-12} height="44" fill="url(#scan)">
            <animate attributeName="y" values="10;54;10" dur="2.2s" repeatCount="indefinite"/>
          </rect>
          {/* found pill */}
          <rect x="20" y="62" width="60" height="14" rx="7" fill="#fff" stroke={m.accent} strokeWidth="1"/>
          <circle cx="28" cy="69" r="2.5" fill={m.accent}>
            <animate attributeName="opacity" values="0.4;1;0.4" dur="1.4s" repeatCount="indefinite"/>
          </circle>
          <text x="34" y="72" fontSize="7" fontWeight="700" fill={m.badgeFg} fontFamily="ui-monospace, monospace">14 videos</text>
          <circle cx={W-22} cy="68" r="8" fill={m.accent} opacity="0.18"/>
          <text x={W-25} y="71" fontSize="9" fontWeight="700" fill={m.badgeFg}>R</text>
        </svg>
      );
    }
    if (kind === 'edit') {
      // Phone with subtitles being typed
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <rect x="46" y="6" width="38" height="74" rx="6" fill="#1d1d1f"/>
          <rect x="49" y="9" width="32" height="68" rx="4" fill={m.badgeBg}/>
          <circle cx="65" cy="35" r="9" fill={m.accent} opacity="0.6"/>
          <polygon points="62,31 62,39 70,35" fill="#fff"/>
          {/* subtitle line */}
          <rect x="51" y="56" width="28" height="14" rx="2" fill="#1d1d1f" opacity="0.85"/>
          <rect x="53" y="60" width="6" height="2" rx="1" fill="#fff">
            <animate attributeName="width" values="0;6;14;22;6;14" keyTimes="0;0.2;0.4;0.6;0.8;1" dur="2.4s" repeatCount="indefinite"/>
          </rect>
          <rect x="53" y="64" width="14" height="2" rx="1" fill="#fff" opacity="0.7"/>
          {/* sparkle */}
          <g transform="translate(20, 30)">
            <path d="M0,-6 L1.5,-1.5 L6,0 L1.5,1.5 L0,6 L-1.5,1.5 L-6,0 L-1.5,-1.5 Z" fill={m.accent}>
              <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="4s" repeatCount="indefinite"/>
              <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite"/>
            </path>
          </g>
          <g transform="translate(108, 22)">
            <path d="M0,-4 L1,-1 L4,0 L1,1 L0,4 L-1,1 L-4,0 L-1,-1 Z" fill={m.accent} opacity="0.7">
              <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="3s" repeatCount="indefinite"/>
            </path>
          </g>
          <g transform="translate(105, 60)">
            <path d="M0,-3 L0.8,-0.8 L3,0 L0.8,0.8 L0,3 L-0.8,0.8 L-3,0 L-0.8,-0.8 Z" fill={m.accent} opacity="0.5">
              <animate attributeName="opacity" values="0.2;0.7;0.2" dur="1.6s" repeatCount="indefinite"/>
            </path>
          </g>
        </svg>
      );
    }
    if (kind === 'landing') {
      // 3 templates and a checkmark on the chosen one
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          {[0,1,2].map((i) => {
            const x = 8 + i*40;
            const sel = i === 1;
            return (
              <g key={i}>
                <rect x={x} y={sel ? 8 : 14} width="36" height={sel ? 64 : 56} rx="6"
                      fill={sel ? '#fff' : 'rgba(255,255,255,0.7)'}
                      stroke={sel ? m.accent : 'rgba(0,0,0,0.10)'}
                      strokeWidth={sel ? 2 : 1}>
                  {sel && <animate attributeName="y" values="14;8;8" keyTimes="0;0.4;1" dur="2.6s" repeatCount="indefinite"/>}
                  {sel && <animate attributeName="height" values="56;64;64" keyTimes="0;0.4;1" dur="2.6s" repeatCount="indefinite"/>}
                </rect>
                <rect x={x+4} y={sel ? 12 : 18} width="28" height="22" rx="3" fill={m.badgeBg}/>
                <circle cx={x+18} cy={sel ? 23 : 29} r="6" fill={m.accent} opacity="0.55"/>
                <rect x={x+4} y={sel ? 38 : 44} width="22" height="2" rx="1" fill="rgba(0,0,0,0.18)"/>
                <rect x={x+4} y={sel ? 43 : 49} width="16" height="2" rx="1" fill="rgba(0,0,0,0.12)"/>
                {sel && <rect x={x+4} y="50" width="14" height="6" rx="2" fill={m.accent}/>}
                {sel && (
                  <g>
                    <circle cx={x+30} cy={14} r="6" fill={m.accent}>
                      <animate attributeName="r" values="0;6;6" keyTimes="0;0.4;1" dur="2.6s" repeatCount="indefinite"/>
                    </circle>
                    <path d={`M${x+27} ${14} L${x+29.5} ${16.5} L${x+33} ${12.5}`} stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <animate attributeName="opacity" values="0;1;1" keyTimes="0;0.4;1" dur="2.6s" repeatCount="indefinite"/>
                    </path>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      );
    }
    if (kind === 'launch') {
      // Rocket flying with trailing campaign cards
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <linearGradient id="trail" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={m.accent} stopOpacity="0"/>
              <stop offset="100%" stopColor={m.accent} stopOpacity="0.5"/>
            </linearGradient>
          </defs>
          {/* dotted path */}
          <path d="M 8 70 Q 50 60 80 30 T 120 12" stroke={m.accent} strokeWidth="1.2" strokeDasharray="2 3" fill="none" opacity="0.45"/>
          {/* meta-style ad cards stacked */}
          <g>
            <rect x="6" y="50" width="32" height="28" rx="4" fill="#fff" stroke="rgba(0,0,0,0.08)"/>
            <rect x="9" y="53" width="14" height="14" rx="2" fill={m.badgeBg}/>
            <polygon points="13,57 13,63 19,60" fill={m.accent} opacity="0.7"/>
            <rect x="25" y="55" width="11" height="2" rx="1" fill="rgba(0,0,0,0.20)"/>
            <rect x="25" y="59" width="8"  height="2" rx="1" fill="rgba(0,0,0,0.14)"/>
            <rect x="9"  y="70" width="20" height="4" rx="1.5" fill={m.accent}/>
          </g>
          {/* rocket */}
          <g>
            <animateTransform attributeName="transform" type="translate"
              values="0,0; 6,-3; 0,0; -3,2; 0,0"
              keyTimes="0;0.25;0.5;0.75;1" dur="2.6s" repeatCount="indefinite"/>
            <ellipse cx="92" cy="22" rx="14" ry="6" fill="url(#trail)"/>
            <path d="M105 22 L92 16 L80 18 L80 26 L92 28 Z" fill={m.accent}/>
            <circle cx="98" cy="22" r="2" fill="#fff"/>
            <path d="M80 18 L74 16 L76 22 L74 28 L80 26 Z" fill={m.accent} opacity="0.7"/>
            {/* flame */}
            <path d="M73 22 L66 19 L68 22 L66 25 Z" fill="#ff9f0a">
              <animate attributeName="opacity" values="0.4;1;0.4" dur="0.4s" repeatCount="indefinite"/>
            </path>
          </g>
          {/* sparkle */}
          <circle cx="118" cy="14" r="1.5" fill={m.accent}>
            <animate attributeName="opacity" values="0;1;0" dur="1.2s" repeatCount="indefinite"/>
          </circle>
          <circle cx="60" cy="40" r="1" fill={m.accent} opacity="0.6">
            <animate attributeName="opacity" values="0;0.8;0" dur="1.6s" begin="0.4s" repeatCount="indefinite"/>
          </circle>
        </svg>
      );
    }
    return null;
  };

  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, overflow: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 980, position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Hero */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 28, padding: '0 12px', borderRadius: 100, background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.06)', fontSize: 11, fontWeight: 600, color: '#6e6e73', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 18 }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: '#30d158' }}/>Bienvenido a Replik
          </div>
          <h1 style={{ fontSize: 42, fontWeight: 700, letterSpacing: -1, color: '#1d1d1f', margin: 0, lineHeight: 1.1, maxWidth: 720, marginInline: 'auto' }}>
            Tú me dices el producto.<br/>
            <span style={{ background: 'linear-gradient(135deg,#30d158 0%, #ff9f0a 50%, #ff453a 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Yo me encargo del resto.</span>
          </h1>
          <p style={{ fontSize: 16, color: '#6e6e73', marginTop: 14, maxWidth: 540, marginInline: 'auto', lineHeight: 1.5 }}>
            Así funciona Replik — 5 pasos, sin que tengas que pelearte con Shopify ni con Meta Ads.
          </p>
        </div>

        {/* Steps timeline */}
        <GlassCard padding={28}>
          <Eyebrow>Cómo trabajamos juntos</Eyebrow>
          <div style={{ marginTop: 18, position: 'relative' }}>
            {STEPS.map((s, i) => {
              const m = MODE[s.mode];
              const isLast = i === STEPS.length - 1;
              return (
                <div key={s.n} style={{ display: 'flex', gap: 18, alignItems: 'flex-start', paddingBottom: isLast ? 0 : 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: m.badgeBg, border: `1.5px solid ${m.accent}33`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: m.badgeFg, fontFamily: '"SF Mono", monospace' }}>{s.n}</div>
                    {!isLast && <div style={{ width: 2, flex: 1, minHeight: 64, background: `linear-gradient(180deg, ${m.accent}40, ${MODE[STEPS[i+1].mode].accent}40)`, marginTop: 4, marginBottom: -4 }}/>}
                  </div>
                  <div style={{ flex: 1, paddingTop: 6, display: 'flex', gap: 18, alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16, fontWeight: 600, color: '#1d1d1f', letterSpacing: -0.2 }}>{s.title}</span>
                        <ModeBadge mode={s.mode} />
                      </div>
                      <div style={{ fontSize: 13, color: '#6e6e73', marginTop: 4, lineHeight: 1.5 }}>{s.sub}</div>
                    </div>
                    <div style={{ flexShrink: 0, width: 130, height: 86, borderRadius: 12, background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      <Graphic kind={s.graphic} mode={s.mode}/>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>

        {/* CTA */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Button variant="primary" mode="web" icon="arrow-right" onClick={onContinue} style={{ height: 54, padding: '0 30px', fontSize: 16 }}>
            Ya entendí — vamos a testear
          </Button>
          <span style={{ fontSize: 12, color: '#6e6e73' }}>Conectarás Shopify y Meta más adelante. Por ahora solo conoce la plataforma.</span>
        </div>
      </div>
    </div>
  );
};

window.Onboarding = Onboarding;

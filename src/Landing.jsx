// SCREEN 4 — Landing (PASO 4) — 3 templates con imágenes por ángulo + chat + iPhone preview
// SIN configuración EasySell. Foco: elegir template, ajustar copy via chat, ver preview iPhone.

const TEMPLATES = [
  {
    id: 'pain',
    name: 'Dolor / Solución',
    angle: 'pain',
    accent: '#ff453a',
    bg: 'linear-gradient(135deg,#fee2e2,#fde68a)',
    desc: 'Empieza con el problema. Cierra con la solución.',
    headline: '¿Cansado de que tu agua se ponga tibia a las 11 am?',
    sub: 'Nuestra botella térmica la mantiene helada 12 horas. Sin sudoración por fuera.',
    proof: 'Pago contra entrega · Lima y Callao',
  },
  {
    id: 'lifestyle',
    name: 'Estilo de vida',
    angle: 'lifestyle',
    accent: '#ff9f0a',
    bg: 'linear-gradient(135deg,#fef3c7,#a7f3d0)',
    desc: 'Muestra cómo se ve usándolo en el día.',
    headline: 'Tu compañera para el gym, la oficina y el aire libre',
    sub: 'Acero inoxidable. Tapa anti-derrame. La llevas a todas partes.',
    proof: '+1,200 personas la usan a diario en Lima',
  },
  {
    id: 'demo',
    name: 'Demostración',
    angle: 'demo',
    accent: '#0a84ff',
    bg: 'linear-gradient(135deg,#bfdbfe,#ddd6fe)',
    desc: 'Pruebas de producto, comparación lado a lado.',
    headline: '12 horas con hielo. Lo probamos para que no tengas que hacerlo.',
    sub: 'Doble pared de acero al vacío. Mejor que termos que cuestan el doble.',
    proof: '4.8 ★ · 1,243 reseñas verificadas',
  },
];

const Landing = ({ onNext, productLabel }) => {
  const m = MODE.web;
  const [templateId, setTemplateId] = React.useState('pain');
  const [shopifyConnected, setShopifyConnected] = React.useState(false);
  const previewPkg = { 1: 79, 2: 129, 3: 169 };

  const [messages, setMessages] = React.useState([
    { from: 'replik', text: '¡Hola! Te armé 3 templates basados en los videos que escogiste. ¿Cuál se siente mejor para tu producto?' },
  ]);
  const [chatInput, setChatInput] = React.useState('');
  const [overrides, setOverrides] = React.useState({});

  const t = TEMPLATES.find((x) => x.id === templateId);
  const headline = overrides.headline ?? t.headline;
  const sub = overrides.sub ?? t.sub;

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setMessages([...messages, { from: 'user', text: userMsg }]);
    setChatInput('');
    setTimeout(() => {
      // Simulación de respuesta inteligente
      const lower = userMsg.toLowerCase();
      let reply = 'Listo, lo ajusté en la vista de la derecha. ¿Algo más?';
      if (lower.includes('títu') || lower.includes('headline') || lower.includes('encabez')) {
        const newH = userMsg.replace(/.*?[:"]/, '').replace(/['""]/g, '').trim() || 'Probada por miles de runners en Lima';
        setOverrides({ ...overrides, headline: newH.slice(0, 80) });
        reply = '¡Cambiado! Mira el iPhone a la derecha. ¿Te gusta así?';
      } else if (lower.includes('subt') || lower.includes('descrip') || lower.includes('texto secundario')) {
        const newS = userMsg.replace(/.*?[:"]/, '').replace(/['""]/g, '').trim();
        if (newS) {
          setOverrides({ ...overrides, sub: newS.slice(0, 140) });
          reply = 'Subtítulo actualizado. ¿Sigamos con los precios o ya está bien?';
        }
      } else if (lower.includes('precio') || lower.includes('pack')) {
        reply = 'Puedes editar los precios directamente en la tarjeta de packs (abajo a la izquierda). El preview se actualiza en vivo.';
      } else if (lower.includes('pain') || lower.includes('dolor')) {
        setTemplateId('pain'); reply = 'Te cambié al template de Dolor / Solución. ¿Mejor así?';
      } else if (lower.includes('demo')) {
        setTemplateId('demo'); reply = 'Cambiado al template Demo. Mira el preview.';
      } else if (lower.includes('lifestyle') || lower.includes('estilo')) {
        setTemplateId('lifestyle'); reply = 'Listo, ahora estás en Estilo de vida.';
      }
      setMessages((prev) => [...prev, { from: 'replik', text: reply }]);
    }, 600);
  };

  return (
    <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, alignItems: 'start' }}>
      {/* Lado izquierdo: templates + chat + packs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <GlassCard>
          <Eyebrow color={m.badgeFg}>Paso 4 · Te armo la landing</Eyebrow>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.3, color: '#1d1d1f', marginTop: 6 }}>Elige el template y dime qué cambiar</div>
          <div style={{ fontSize: 13, color: '#6e6e73', marginTop: 4 }}>3 versiones armadas según los videos que escogiste. Conversa conmigo abajo para ajustar el copy.</div>
        </GlassCard>

        {/* 3 template cards con imágenes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {TEMPLATES.map((tpl) => {
            const sel = templateId === tpl.id;
            return (
              <div key={tpl.id} onClick={() => setTemplateId(tpl.id)} style={{
                cursor: 'pointer', borderRadius: 16, overflow: 'hidden',
                background: '#fff',
                border: sel ? `2px solid ${tpl.accent}` : '1.5px solid rgba(0,0,0,0.06)',
                boxShadow: sel ? `0 6px 20px ${tpl.accent}30` : '0 1px 3px rgba(0,0,0,0.04)',
                transition: 'all 200ms',
              }}>
                {/* Hero image area */}
                <div style={{ aspectRatio: '4/3', background: tpl.bg, position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 100, background: 'rgba(255,255,255,0.95)', fontSize: 10, fontWeight: 700, color: tpl.accent, letterSpacing: 0.3 }}>
                      <span style={{ width: 5, height: 5, borderRadius: 3, background: tpl.accent }}/>{tpl.name}
                    </div>
                    {sel && <div style={{ width: 22, height: 22, borderRadius: '50%', background: tpl.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.18)' }}><i data-lucide="check" style={{ width: 12, height: 12, color: '#fff', strokeWidth: 3 }}/></div>}
                  </div>
                  {/* Mini layout preview */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                    <div style={{ width: 32, height: 38, borderRadius: 6, background: 'rgba(255,255,255,0.7)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <i data-lucide="droplet" style={{ width: 16, height: 16, color: '#1d1d1f', opacity: 0.45, strokeWidth: 1.4 }}/>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ height: 4, width: '90%', borderRadius: 100, background: 'rgba(0,0,0,0.18)' }}/>
                      <div style={{ height: 4, width: '70%', borderRadius: 100, background: 'rgba(0,0,0,0.14)' }}/>
                      <div style={{ height: 8, width: '50%', borderRadius: 3, background: tpl.accent, marginTop: 2 }}/>
                    </div>
                  </div>
                </div>
                <div style={{ padding: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>{tpl.name}</div>
                  <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 3, lineHeight: 1.4 }}>{tpl.desc}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Chat con Replik */}
        <GlassCard padding={0}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,#30d158,#ff9f0a)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
              <i data-lucide="sparkles" style={{ width: 16, height: 16, color: '#fff', strokeWidth: 1.8 }}/>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f' }}>Conversa con Replik</div>
              <div style={{ fontSize: 11, color: '#6e6e73' }}>Pídele cambios al copy, precios o template</div>
            </div>
          </div>
          <div style={{ padding: 14, maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.from === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '78%', padding: '8px 12px', borderRadius: 14,
                  background: msg.from === 'user' ? '#1d1d1f' : m.badgeBg,
                  color: msg.from === 'user' ? '#fff' : '#1d1d1f',
                  fontSize: 13, lineHeight: 1.45,
                }}>{msg.text}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: 12, borderTop: '1px solid rgba(0,0,0,0.05)', display: 'flex', gap: 8 }}>
            <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage()} placeholder='Ej: "cambia el título a algo más directo"' style={{
              flex: 1, height: 40, borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.95)', padding: '0 14px', fontSize: 13, fontFamily: 'inherit', color: '#1d1d1f', outline: 'none',
            }}/>
            <button onClick={sendMessage} style={{ height: 40, padding: '0 14px', borderRadius: 10, border: 'none', background: m.accent, color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <i data-lucide="send" style={{ width: 14, height: 14, strokeWidth: 2 }}/>Enviar
            </button>
          </div>
          <div style={{ padding: '10px 14px 14px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['Hazlo más urgente', 'Subtítulo más corto', 'Cambia a Demo', 'Más calorcito 🇵🇪'].map((q) => (
              <button key={q} onClick={() => { setChatInput(q); }} style={{ height: 26, padding: '0 10px', borderRadius: 100, background: 'rgba(0,0,0,0.04)', border: 'none', fontSize: 11, color: '#6e6e73', fontFamily: 'inherit', cursor: 'pointer' }}>{q}</button>
            ))}
          </div>
        </GlassCard>

        {/* Connect Shopify */}
        {!shopifyConnected ? (
          <div style={{
            padding: 16, borderRadius: 14,
            background: 'linear-gradient(135deg, rgba(150,191,72,0.10), rgba(48,209,88,0.08))',
            border: `1.5px solid ${m.accent}`,
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#96bf48', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <i data-lucide="shopping-bag" style={{ width: 20, height: 20, color: '#fff', strokeWidth: 1.8 }}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1d1d1f' }}>Conecta tu Shopify para publicar</div>
              <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2 }}>Yo creo la página en tu tienda. Solo autoriza con OAuth.</div>
            </div>
            <Button variant="primary" mode="web" icon="link-2" onClick={() => setShopifyConnected(true)}>Conectar Shopify</Button>
          </div>
        ) : (
          <div style={{ padding: '12px 14px', borderRadius: 12, background: m.badgeBg, border: `1px solid ${m.accent}30`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <i data-lucide="check-circle-2" style={{ width: 16, height: 16, color: m.accent, strokeWidth: 1.8 }}/>
            <span style={{ fontSize: 13, color: m.badgeFg, fontWeight: 600 }}>Shopify conectado · replik.myshopify.com</span>
          </div>
        )}

        <Button variant="primary" mode="web" icon="zap" onClick={() => onNext({})} fullWidth disabled={!shopifyConnected} style={{ height: 56, fontSize: 16, opacity: shopifyConnected ? 1 : 0.5, cursor: shopifyConnected ? 'pointer' : 'not-allowed' }}>
          {shopifyConnected ? 'Publicar landing en Shopify' : 'Conecta Shopify primero'}
        </Button>
      </div>

      {/* Right: iPhone live preview */}
      <div style={{ position: 'sticky', top: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
            <i data-lucide="smartphone" style={{ width: 14, height: 14, color: '#6e6e73' }}/>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#6e6e73', textTransform: 'uppercase', letterSpacing: 0.4 }}>Vista previa · iPhone</span>
            <span style={{ fontSize: 11, color: m.badgeFg, fontFamily: '"SF Mono", monospace', padding: '2px 8px', borderRadius: 100, background: m.badgeBg }}>en vivo</span>
          </div>
          {/* iPhone */}
          <div style={{ width: 340, height: 700, borderRadius: 44, background: '#1d1d1f', padding: 10, boxShadow: '0 24px 60px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.10)', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)', width: 105, height: 30, background: '#000', borderRadius: 100, zIndex: 10 }}/>
            <div style={{ width: '100%', height: '100%', borderRadius: 36, background: '#fff', overflow: 'hidden', overflowY: 'auto', position: 'relative' }}>
              {/* Hero */}
              <div style={{ background: t.bg, padding: '50px 18px 22px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1d1d1f', letterSpacing: -0.3 }}>HidraPro</div>
                  <div style={{ fontSize: 9, color: '#6e6e73', fontWeight: 500 }}>Pago al recibir · Lima</div>
                </div>
                <div style={{ aspectRatio: '4/3', borderRadius: 14, background: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <i data-lucide="droplet" style={{ width: 56, height: 56, color: '#1d1d1f', strokeWidth: 1.2, opacity: 0.4 }}/>
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: t.accent, marginBottom: 6 }}>{t.proof}</div>
                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, color: '#1d1d1f', lineHeight: 1.15 }}>{headline}</div>
                <div style={{ fontSize: 12, color: '#1d1d1f', opacity: 0.8, marginTop: 8, lineHeight: 1.45 }}>{sub}</div>
              </div>

              {/* Pricing */}
              <div style={{ padding: '16px 18px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#1d1d1f', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>Elige tu pack</div>
                {[
                  { u: 1, label: '1 unidad' },
                  { u: 2, label: '2 unidades', tag: '-23%' },
                  { u: 3, label: '3 unidades', tag: '-29%', best: true },
                ].map((p) => (
                  <div key={p.u} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, marginBottom: 6, borderRadius: 10, background: p.best ? m.badgeBg : '#fafafa', border: p.best ? `1.5px solid ${m.accent}` : '1px solid rgba(0,0,0,0.05)' }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', border: p.best ? 'none' : '1.5px solid rgba(0,0,0,0.2)', background: p.best ? m.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {p.best && <span style={{ width: 6, height: 6, borderRadius: 3, background: '#fff' }}/>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#1d1d1f' }}>{p.label}</span>
                        {p.tag && <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 100, background: m.accent, color: '#fff' }}>{p.tag}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1d1d1f', fontFamily: '"SF Mono", monospace' }}>S/ {previewPkg[p.u]}</div>
                  </div>
                ))}
              </div>

              {/* COD form */}
              <div style={{ padding: '0 18px 18px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#1d1d1f', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Tus datos</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {['Nombre','Teléfono','Distrito / Provincia','Dirección'].map((f) => (
                    <div key={f} style={{ height: 32, borderRadius: 8, background: '#fff', border: '1px solid rgba(0,0,0,0.10)', padding: '0 10px', display: 'flex', alignItems: 'center', fontSize: 11, color: '#aeaeb2' }}>{f}</div>
                  ))}
                </div>
                <div style={{ height: 40, borderRadius: 10, background: m.accent, color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 10 }}>
                  Comprar — pagar al recibir
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

window.Landing = Landing;

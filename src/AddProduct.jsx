// SCREEN 1 — Add Product (PASO 1)
// Tab URL: solo url. Tab Manual: foto + nombre + precios opcionales.

const AddProduct = ({ onAnalyze, initial }) => {
  const m = MODE.web;
  const [tab, setTab] = React.useState('url'); // url | manual
  const [url, setUrl] = React.useState(initial?.url ?? 'https://hidrabottle.pe/products/botella-termica-750ml');
  const [name, setName] = React.useState(initial?.name ?? 'Botella térmica 750 ml');
  const [hasImage, setHasImage] = React.useState(false);

  const productLabel = tab === 'url' ? (() => { try { return new URL(url).hostname.replace('www.',''); } catch { return url; } })() : name;

  const submit = () => {
    onAnalyze({ tab, url, name, label: productLabel, hasImage });
  };

  const TabBtn = ({ id, icon, label }) => {
    const active = tab === id;
    return (
      <button onClick={() => setTab(id)} style={{
        flex: 1, height: 44, borderRadius: 10, border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
        background: active ? '#fff' : 'transparent',
        color: active ? '#1d1d1f' : '#6e6e73',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9)' : 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        transition: 'all 200ms ease',
      }}>
        <i data-lucide={icon} style={{ width: 16, height: 16, strokeWidth: 1.5 }}/>{label}
      </button>
    );
  };

  return (
    <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <GlassCard>
          <Eyebrow color={m.badgeFg}>Paso 1 · Cuéntame del producto</Eyebrow>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.4, color: '#1d1d1f', marginTop: 8 }}>¿Qué vas a testear hoy?</div>
          <div style={{ fontSize: 15, color: '#6e6e73', marginTop: 6, lineHeight: 1.5 }}>
            Pega el link de un competidor en Shopify — yo lo analizo. O sube una foto y dale nombre, lo armamos juntos.
          </div>

          <div style={{ marginTop: 20, padding: 4, background: 'rgba(0,0,0,0.04)', borderRadius: 12, display: 'flex', gap: 4 }}>
            <TabBtn id="url" icon="link" label="Pegar URL de la competencia"/>
            <TabBtn id="manual" icon="image" label="Subir foto + nombre"/>
          </div>

          <div style={{ marginTop: 16 }}>
            {tab === 'url' ? (
              <div>
                <Input value={url} onChange={setUrl} icon="link" mode="web" placeholder="https://tienda.com/products/..." />
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#aeaeb2', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 4 }}>Ejemplos:</span>
                  {['hidrabottle.pe', 'gozme.pe', 'kuromart.pe', 'wonderpe.com'].map((s) => (
                    <button key={s} onClick={() => setUrl(`https://${s}/products/`)} style={{ height: 28, padding: '0 12px', borderRadius: 100, background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.06)', fontSize: 12, color: '#6e6e73', fontFamily: '"SF Mono", monospace', cursor: 'pointer' }}>{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#6e6e73', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 6 }}>Foto del producto</div>
                  <label htmlFor="prod-photo" style={{ display: 'block', cursor: 'pointer' }}>
                    <input id="prod-photo" type="file" accept="image/*" style={{ display: 'none' }} onChange={() => setHasImage(true)}/>
                    <div style={{
                      height: 180, borderRadius: 14,
                      background: hasImage ? 'linear-gradient(135deg,#dbeafe,#a7f3d0)' : 'rgba(255,255,255,0.65)',
                      border: hasImage ? `1.5px solid ${m.accent}` : '2px dashed rgba(0,0,0,0.12)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                      transition: 'all 200ms',
                    }}>
                      {hasImage ? (
                        <>
                          <div style={{ width: 60, height: 60, borderRadius: 14, background: 'rgba(255,255,255,0.7)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                            <i data-lucide="image" style={{ width: 28, height: 28, color: '#1d1d1f', opacity: 0.5, strokeWidth: 1.4 }}/>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: m.badgeFg, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <i data-lucide="check-circle-2" style={{ width: 14, height: 14, strokeWidth: 1.8 }}/>
                            Foto cargada · botella-termica.jpg
                          </div>
                          <div style={{ fontSize: 11, color: '#6e6e73' }}>Toca para cambiar</div>
                        </>
                      ) : (
                        <>
                          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(0,0,0,0.05)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <i data-lucide="upload" style={{ width: 22, height: 22, color: '#6e6e73', strokeWidth: 1.5 }}/>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f' }}>Sube una foto del producto</div>
                          <div style={{ fontSize: 12, color: '#6e6e73' }}>JPG o PNG · al menos 800×800</div>
                        </>
                      )}
                    </div>
                  </label>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#6e6e73', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 6 }}>Nombre del producto</div>
                  <Input value={name} onChange={setName} icon="package" mode="web" placeholder="Ej. Botella térmica 750 ml" />
                </div>
              </div>
            )}
          </div>
        </GlassCard>

        <Button variant="primary" mode="web" icon="sparkles" onClick={submit} fullWidth style={{ height: 56, fontSize: 16 }}>
          Empezar el análisis
        </Button>

        <div style={{ textAlign: 'center', fontSize: 12, color: '#6e6e73' }}>
          Voy a buscar creativos, armar una landing y dejar todo listo. Toma como 45 segundos.
        </div>
      </div>
    </div>
  );
};

window.AddProduct = AddProduct;

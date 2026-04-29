// Main app — orchestrates onboarding, the 5-step flow, and the dashboard.

const App = () => {
  const [screen, setScreen] = React.useState('onboarding'); // onboarding|dashboard|add-product|loading|creatives|editing|landing|launch|launching|live
  const [product, setProduct] = React.useState(null);
  const [selectedCreatives, setSelectedCreatives] = React.useState([]);

  React.useEffect(() => { if (window.lucide) window.lucide.createIcons(); });

  // Map screen to step index in the 4-step flow (0..3) — null for non-flow screens
  const STEP_FOR = {
    'add-product': 0,
    'loading':     0,
    'creatives':   1,
    'editing':     1,
    'landing':     2,
    'launch':      3,
    'launching':   3,
  };
  const MODE_FOR = {
    'add-product': 'web',
    'loading':     'system',
    'creatives':   'creative',
    'editing':     'creative',
    'landing':     'web',
    'launch':      'traffic',
    'launching':   'traffic',
    'live':        'live',
    'dashboard':   'live',
  };
  const CRUMB_FOR = {
    'add-product': 'Nuevo test de producto',
    'loading':     `${product?.label || 'Producto'} · analizando`,
    'creatives':   `${product?.label || 'Producto'} · descubrir creativos`,
    'editing':     `${product?.label || 'Producto'} · editar creativos`,
    'landing':     `${product?.label || 'Producto'} · armar landing`,
    'launch':      `${product?.label || 'Producto'} · lanzar`,
    'dashboard':   'Mis tests de producto',
  };

  const goto = (s) => setScreen(s);

  const renderMain = () => {
    switch (screen) {
      case 'onboarding': return <Onboarding onContinue={() => goto('dashboard')} />;
      case 'dashboard':  return <Dashboard onAddProduct={() => goto('add-product')} onSelectProduct={(p, t) => { setProduct({ label: p.name, name: p.name, pkg: { 1: 79, 2: 129, 3: 169 } }); goto(t); }} />;
      case 'add-product':return <AddProduct initial={product} onAnalyze={(p) => { setProduct(p); goto('loading'); }} />;
      case 'loading':    return <Loading productLabel={product?.label} onDone={() => goto('creatives')} />;
      case 'creatives':  return <Creatives productLabel={product?.label} onNext={(sel) => { setSelectedCreatives(sel); goto('editing'); }} />;
      case 'editing':    return <Editing selectedIds={selectedCreatives} onNext={() => goto('landing')} />;
      case 'landing':    return <Landing productLabel={product?.label} pkg={product?.pkg} onNext={() => goto('launch')} />;
      case 'launch':     return <Launch productLabel={product?.label} onNext={() => goto('dashboard')} />;
      default: return null;
    }
  };

  const onOnboarding = screen === 'onboarding';
  const mode = MODE_FOR[screen] || 'live';
  const stepIdx = STEP_FOR[screen];
  const crumb = CRUMB_FOR[screen];

  // Secondary orb cycles through modes for visual variety
  const secondaryOrb = mode === 'web' ? 'creative' : mode === 'creative' ? 'web' : mode === 'traffic' ? 'system' : mode === 'system' ? 'creative' : 'web';

  if (onOnboarding) {
    return (
      <div style={{ height: '100vh', background: '#f5f5f7', position: 'relative', overflow: 'hidden', fontFamily: '-apple-system, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif' }}>
        <Orbs mode="web" secondary="creative" />
        <Onboarding onContinue={() => goto('dashboard')} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#f5f5f7', position: 'relative', overflow: 'hidden', fontFamily: '-apple-system, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif' }}>
      <Orbs mode={mode} secondary={secondaryOrb} />
      <Sidebar
        activeMode={mode}
        currentScreen={screen}
        productName={product?.label}
        onNavigate={(target) => {
          if (target === 'dashboard' || target === 'add-product' || target === 'integrations' || target === 'settings') return goto(target);
          // Mode shortcuts only allowed when product exists
          if (target === 'creatives' && product) return goto('creatives');
          if (target === 'landing' && product) return goto('landing');
          if (target === 'launch' && product) return goto('launch');
        }}
      />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1, minWidth: 0 }}>
        <TopBar
          crumb={crumb}
          mode={mode}
          currentStepIdx={stepIdx}
        />
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {renderMain()}
        </div>
      </main>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 50);

import { Sparkles } from "lucide-react"
import Link from "next/link"

const MODES = [
  {
    key: "web",
    label: "Website Mode",
    title: "Te creo tu landing en Shopify.",
    description:
      "Te muestro 3 templates ya armados, escoges el que va con tu producto y lo subo a tu tienda.",
    bullets: [
      "Templates por ángulo de venta",
      "Optimizado para móvil — el 90% de tu tráfico",
      "Listo para EasySell (pago contra entrega)",
    ],
    accentClass: "text-mode-web",
    glowClass: "bg-mode-web",
    badgeClass: "bg-mode-web-badge-bg text-mode-web-badge-fg",
    dotClass: "bg-mode-web",
  },
  {
    key: "creative",
    label: "Creative Mode",
    title: "Te encuentro los videos.",
    description:
      "Busco creativos ganadores en Facebook Ad Library y TikTok. Los agrupo por ángulo de venta para que escojas.",
    bullets: [
      "Solo videos performers de los últimos 30 días",
      "Subtitulado automático en español",
      "Variaciones para esquivar duplicados",
    ],
    accentClass: "text-mode-creative",
    glowClass: "bg-mode-creative",
    badgeClass: "bg-mode-creative-badge-bg text-mode-creative-badge-fg",
    dotClass: "bg-mode-creative",
  },
  {
    key: "traffic",
    label: "Trafficker Mode",
    title: "Te lanzo la campaña en Meta.",
    description:
      "Subo tus creativos, escribo los copies, configuro objetivo, conjunto y anuncios. Tú solo apruebas.",
    bullets: [
      "CBO o ABO — el que mejor te sirva",
      "Copies generados por ángulo",
      "Pixel + landing verificados antes de salir",
    ],
    accentClass: "text-mode-traffic",
    glowClass: "bg-mode-traffic",
    badgeClass: "bg-mode-traffic-badge-bg text-mode-traffic-badge-fg",
    dotClass: "bg-mode-traffic",
  },
] as const

const STEPS = [
  {
    num: "PASO 01",
    title: "Pegas el producto",
    description: "URL de la competencia o nombre + foto.",
    dotClass: "bg-mode-web",
  },
  {
    num: "PASO 02",
    title: "Eliges creativos",
    description: "Te muestro los videos por ángulo de venta.",
    dotClass: "bg-mode-creative",
  },
  {
    num: "PASO 03",
    title: "Edito los videos",
    description: "Subtítulos automáticos. Tú decides cuáles.",
    dotClass: "bg-mode-creative",
  },
  {
    num: "PASO 04",
    title: "Armo la landing",
    description: "3 templates. El que prefieras va a Shopify.",
    dotClass: "bg-mode-web",
  },
  {
    num: "PASO 05",
    title: "Lanzo la campaña",
    description: "Meta Ads configurada y publicada por mí.",
    dotClass: "bg-mode-traffic",
  },
] as const

interface MarketingHomeProps {
  /**
   * When true, the global Nav (rendered by app/layout.tsx) is already on
   * screen, so we suppress the marketing component's internal nav and route
   * CTAs to in-app destinations (/new, /dashboard) instead of /sign-up.
   */
  signedIn: boolean
}

export function MarketingHome({ signedIn }: MarketingHomeProps) {
  const primaryCta = signedIn
    ? { href: "/new", label: "Crear nuevo producto →" }
    : { href: "/sign-up", label: "Empezar a testear gratis →" }
  const navCta = signedIn
    ? { href: "/dashboard", label: "Ir al dashboard →" }
    : { href: "/sign-in", label: "Entrar a la app →" }
  const footerCta = signedIn
    ? { href: "/dashboard", label: "Ir a mi dashboard →" }
    : { href: "/sign-up", label: "Probar Replik gratis →" }

  return (
    <main className="min-h-screen bg-page-alt text-fg-1">
      <div className="mx-auto w-full max-w-[1100px] px-6">
        {/* Marketing nav — hidden when signed-in (global Nav from layout takes over). */}
        {!signedIn && (
          <header className="flex items-center justify-between py-[22px]">
            <Link
              href="/"
              className="flex items-center gap-2 text-fg-1 transition-opacity hover:opacity-75"
            >
              <Sparkles className="size-5 text-mode-live" strokeWidth={1.8} />
              <span className="text-headline font-semibold tracking-tight">Replik AI</span>
            </Link>

            <Link
              href={navCta.href}
              className="inline-flex h-10 items-center rounded-pill bg-fg-1 px-[18px] text-[14px] font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
            >
              {navCta.label}
            </Link>
          </header>
        )}

        {/* Hero */}
        <section className="relative pt-16 pb-20 text-center">
          <span className="inline-flex h-[30px] items-center gap-2 rounded-pill bg-mode-web-badge-bg px-[14px] text-[12px] font-semibold tracking-[0.3px] text-mode-web-badge-fg">
            <span className="size-2 rounded-full bg-mode-web ring-4 ring-mode-web/20" />
            Hecho para dropshippers de LATAM
          </span>

          <h1
            className="mx-auto mt-[22px] max-w-[880px] font-bold"
            style={{
              fontSize: "clamp(40px, 6vw, 64px)",
              lineHeight: 1.05,
              letterSpacing: "-1.5px",
            }}
          >
            Tú me dices el producto.{" "}
            <span className="bg-grad-hero bg-clip-text text-transparent">
              Yo me encargo del resto.
            </span>
          </h1>

          <p className="mx-auto mt-[22px] max-w-[640px] text-[19px] leading-[1.55] text-fg-2">
            Replik testea productos por ti. Construye la landing, encuentra los videos, lanza la
            campaña en Meta — todo en automático. Tú solo decides qué ganador escalar.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href={primaryCta.href}
              className="inline-flex h-[52px] items-center gap-2 rounded-[14px] bg-fg-1 px-[26px] text-[15px] font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
            >
              {primaryCta.label}
            </Link>
            {signedIn ? (
              <Link
                href="/dashboard"
                className="inline-flex h-[52px] items-center gap-2 rounded-[14px] border-[1.5px] border-border-input bg-surface-solid px-[26px] text-[15px] font-semibold text-fg-1 transition-colors hover:bg-page"
              >
                Ver mi dashboard
              </Link>
            ) : (
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Próximamente"
                className="inline-flex h-[52px] cursor-not-allowed items-center gap-2 rounded-[14px] border-[1.5px] border-border-input bg-surface-solid px-[26px] text-[15px] font-semibold text-fg-1 opacity-60"
              >
                Ver demo · 90 segundos
              </button>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-6">
            <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-2">
              <span className="text-fg-1">●</span> Sin tarjeta
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-2">
              <span className="text-fg-1">●</span> Conecta Shopify y Meta
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-2">
              <span className="text-fg-1">●</span> Soporte en español
            </span>
          </div>
        </section>

        {/* Mode cards */}
        <section className="py-15">
          <h2
            className="max-w-[740px] font-bold"
            style={{
              fontSize: "clamp(32px, 4.4vw, 44px)",
              lineHeight: 1.1,
              letterSpacing: "-1px",
            }}
          >
            Lo que Replik hace por ti.
          </h2>
          <p className="mt-3 max-w-[560px] text-[17px] leading-[1.55] text-fg-2">
            Tres modos que trabajan en cadena. Tú das el producto, Replik entrega la prueba lista
            para correr.
          </p>

          <div className="mt-9 grid grid-cols-1 gap-[18px] md:grid-cols-3">
            {MODES.map((mode) => (
              <article
                key={mode.key}
                className="relative overflow-hidden rounded-[22px] border border-border bg-surface-solid p-7"
              >
                <div
                  aria-hidden
                  className={`pointer-events-none absolute -top-15 -right-15 size-[180px] rounded-full opacity-[0.16] blur-[40px] ${mode.glowClass}`}
                />
                <span
                  className={`relative inline-flex h-[26px] items-center gap-1.5 rounded-pill px-[11px] text-[11px] font-semibold uppercase tracking-[0.4px] ${mode.badgeClass}`}
                >
                  <span className={`size-1.5 rounded-full ${mode.dotClass}`} />
                  {mode.label}
                </span>

                <h3
                  className="relative mt-4 font-semibold"
                  style={{ fontSize: 22, letterSpacing: "-0.4px" }}
                >
                  {mode.title}
                </h3>
                <p className="relative mt-2 text-[14px] leading-[1.5] text-fg-2">
                  {mode.description}
                </p>

                <ul className="relative mt-[18px] flex flex-col gap-2">
                  {mode.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2 text-[13px] text-fg-1">
                      <span className={`font-bold ${mode.accentClass}`}>✓</span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* Steps */}
        <section className="my-10 rounded-[32px] bg-fg-1 px-10 py-20 text-fg-on-accent">
          <h2
            className="font-bold"
            style={{
              fontSize: "clamp(32px, 4.4vw, 44px)",
              lineHeight: 1.1,
              letterSpacing: "-1px",
            }}
          >
            De producto a campaña corriendo en 5 pasos.
          </h2>
          <p className="mt-3 max-w-[560px] text-[17px] leading-[1.55] text-fg-on-accent/60">
            Sin pelearte con Shopify, sin buscar creativos a mano, sin armar campañas a las 2 am.
          </p>

          <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step) => (
              <div key={step.num} className="relative pt-5 pr-4">
                <span
                  aria-hidden
                  className={`absolute top-3.5 -left-2 size-2 rounded-full ${step.dotClass}`}
                />
                <p
                  className="font-mono font-semibold tracking-[1px] text-fg-on-accent/40"
                  style={{ fontSize: 11 }}
                >
                  {step.num}
                </p>
                <h4
                  className="mt-2 mb-1.5 font-semibold text-fg-on-accent"
                  style={{ fontSize: 16, letterSpacing: "-0.2px" }}
                >
                  {step.title}
                </h4>
                <p className="text-[12px] leading-[1.5] text-fg-on-accent/55">{step.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer CTA */}
        <section className="py-20 text-center">
          <h2
            className="mx-auto font-bold"
            style={{
              fontSize: "clamp(34px, 5vw, 48px)",
              lineHeight: 1.05,
              letterSpacing: "-1.2px",
            }}
          >
            Tú no sabes de Shopify.
            <br />
            Tampoco de Meta Ads.{" "}
            <span className="bg-grad-hero bg-clip-text text-transparent">No importa.</span>
          </h2>
          <p className="mx-auto mt-4 mb-7 text-[17px] text-fg-2">
            Replik se encarga. Tú solo testea más productos.
          </p>
          <Link
            href={footerCta.href}
            className="inline-flex h-[52px] items-center gap-2 rounded-[14px] bg-fg-1 px-[26px] text-[15px] font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
          >
            {footerCta.label}
          </Link>
        </section>

        {/* Footer */}
        <footer className="flex flex-col items-start justify-between gap-3 py-[30px] pb-[50px] text-[12px] text-fg-3 sm:flex-row sm:items-center">
          <span>© 2026 Replik AI · Lima, Perú</span>
          <span className="flex gap-[18px]">
            <span>Términos</span>
            <Link href="/privacy" className="transition-colors hover:text-fg-1">
              Privacidad
            </Link>
            <span>Soporte</span>
          </span>
        </footer>
      </div>
    </main>
  )
}

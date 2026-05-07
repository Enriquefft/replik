import { Sparkles } from "lucide-react"
import Link from "next/link"

const SECTIONS = [
  {
    heading: "1. Quiénes somos",
    body: [
      "Replik.ai es una plataforma SaaS dirigida a emprendedores de dropshipping en Latinoamérica para automatizar el testeo de productos. A partir de la URL de un competidor, Replik analiza anuncios públicos de Meta Ad Library, genera páginas de aterrizaje en la tienda Shopify del usuario y prepara campañas borrador en su cuenta de Meta Ads.",
      "Esta política describe cómo recopilamos, usamos y protegemos la información personal de quienes interactúan con replik.ai y con la aplicación, incluyendo a quienes acceden a través de anuncios en Facebook e Instagram.",
      {
        type: "p-with-link",
        prefix: "Para consultas relacionadas con esta política, puedes contactarnos en: ",
        link: { href: "mailto:hola@replik.ai", label: "hola@replik.ai" },
      },
    ],
  },
  {
    heading: "2. Información que recopilamos",
    body: [
      "Podemos recopilar los siguientes tipos de información:",
      {
        type: "list",
        items: [
          {
            term: "Información de contacto:",
            text: " nombre, dirección de correo electrónico y número de teléfono cuando completas un formulario o nos contactas directamente.",
          },
          {
            term: "Información de cuenta:",
            text: " cuando creas una cuenta en Replik, recopilamos tu correo electrónico y tu número de WhatsApp, que usamos para que tus clientes finales puedan coordinar entregas contigo.",
          },
          {
            term: "Información de uso:",
            text: " páginas visitadas, tiempo en el sitio, clics y otras interacciones con nuestra plataforma, recopiladas mediante cookies y tecnologías similares.",
          },
          {
            term: "Datos de conversión:",
            text: " acciones completadas en nuestro sitio (como envíos de formularios o solicitudes de demo) que se transmiten a Meta mediante el Píxel de Meta y la API de Conversiones de Meta (Meta CAPI).",
          },
          {
            term: "Información del dispositivo:",
            text: " tipo de navegador, sistema operativo, dirección IP y otros identificadores técnicos.",
          },
          {
            term: "Datos de Meta:",
            text: " si interactúas con nosotros a través de anuncios de Facebook o Instagram, Meta puede compartir con nosotros información limitada sobre esa interacción conforme a sus propias políticas.",
          },
        ],
      },
    ],
  },
  {
    heading: "3. Cuentas conectadas: Meta y Shopify",
    body: [
      "Para que Replik pueda generar páginas de aterrizaje y preparar campañas en tu nombre, necesitas conectar tu cuenta de Meta y tu tienda Shopify. Cuando lo haces:",
      {
        type: "list",
        items: [
          {
            term: "Meta:",
            text: " solicitamos un access token con permisos de Marketing API junto con tu Ad Account ID y Page ID. Usamos estas credenciales únicamente para crear campañas, conjuntos de anuncios y anuncios en tu cuenta — siempre en estado pausado por defecto, listos para que tú los revises y actives. No publicamos contenido orgánico en tu nombre, no enviamos mensajes desde tus páginas y no leemos tu información personal de Meta más allá de lo necesario para validar la conexión y operar la Marketing API.",
          },
          {
            term: "Shopify:",
            text: " solicitamos un Admin API access token de tu tienda. Lo usamos para crear productos, variantes y páginas de aterrizaje. No leemos información de tus clientes ni de pedidos preexistentes en tu tienda.",
          },
        ],
      },
      {
        type: "p-rich",
        nodes: [
          { strong: "Almacenamiento:" },
          " los tokens de acceso a Meta y Shopify se cifran en reposo en nuestra base de datos y se transmiten siempre por HTTPS. Solo los procesos del servidor de Replik pueden descifrarlos para realizar las llamadas que tú autorizas. No los compartimos con terceros distintos a las plataformas correspondientes.",
        ],
      },
      {
        type: "p-rich",
        nodes: [
          { strong: "Revocación:" },
          " puedes revocar el acceso en cualquier momento desde tu cuenta de Meta (Configuración de empresa → Integraciones de empresa) o desde Shopify (Configuración → Apps y canales de venta). Al recibir notificación de revocación, eliminamos los tokens correspondientes de nuestra base de datos.",
        ],
      },
    ],
  },
  {
    heading: "4. Uso de tecnologías de Meta",
    body: [
      {
        type: "p-rich",
        nodes: [
          "Utilizamos el ",
          { strong: "Píxel de Meta" },
          " y la ",
          { strong: "API de Conversiones de Meta (CAPI)" },
          " para medir la efectividad de nuestra publicidad en Facebook e Instagram. Estas herramientas nos permiten:",
        ],
      },
      {
        type: "list",
        items: [
          { text: "Medir conversiones derivadas de anuncios en Meta." },
          { text: "Optimizar la entrega de anuncios a audiencias relevantes." },
          { text: "Crear audiencias personalizadas para campañas publicitarias." },
          { text: "Reportar el rendimiento de anuncios a Meta." },
        ],
      },
      {
        type: "p-rich",
        nodes: [
          "Como resultado, cierta información sobre tu comportamiento en nuestro sitio (como visitas a páginas o envíos de formularios) puede compartirse con Meta Platforms, Inc. Esta información se procesa conforme a la ",
          {
            link: {
              href: "https://www.facebook.com/privacy/policy/",
              label: "Política de Datos de Meta",
              external: true,
            },
          },
          ".",
        ],
      },
      {
        type: "p-rich",
        nodes: [
          "Para gestionar tus preferencias de publicidad en Facebook e Instagram, visita ",
          {
            link: {
              href: "https://www.facebook.com/ads/preferences/",
              label: "facebook.com/ads/preferences",
              external: true,
            },
          },
          ".",
        ],
      },
    ],
  },
  {
    heading: "5. Cómo usamos tu información",
    body: [
      "Usamos la información recopilada para:",
      {
        type: "list",
        items: [
          { text: "Responder a tus consultas y solicitudes de demo." },
          { text: "Prestarte los servicios contratados." },
          { text: "Mejorar nuestro sitio web y nuestros servicios." },
          {
            text: "Enviarte comunicaciones sobre nuestros servicios, si nos has dado tu consentimiento.",
          },
          { text: "Medir y optimizar el rendimiento de nuestras campañas publicitarias en Meta." },
          { text: "Cumplir con obligaciones legales aplicables." },
        ],
      },
    ],
  },
  {
    heading: "6. Bases legales para el tratamiento",
    body: [
      "Tratamos tus datos personales con las siguientes bases legales:",
      {
        type: "list",
        items: [
          {
            term: "Consentimiento:",
            text: " cuando aceptas el uso de cookies o te suscribes a comunicaciones.",
          },
          {
            term: "Interés legítimo:",
            text: " para medir y mejorar nuestros servicios y campañas publicitarias.",
          },
          {
            term: "Ejecución de contrato:",
            text: " para prestarte los servicios que has solicitado.",
          },
          { term: "Obligación legal:", text: " cuando sea requerido por la ley aplicable." },
        ],
      },
    ],
  },
  {
    heading: "7. Cookies y tecnologías de seguimiento",
    body: [
      "Utilizamos cookies propias y de terceros para el funcionamiento del sitio y para fines analíticos y publicitarios. Entre ellas:",
      {
        type: "list",
        items: [
          {
            term: "Cookies de sesión:",
            text: " necesarias para el funcionamiento básico del sitio.",
          },
          {
            term: "Cookies analíticas:",
            text: " para entender cómo los usuarios interactúan con el sitio.",
          },
          {
            term: "Cookies de Meta:",
            text: " instaladas por el Píxel de Meta para medir conversiones y personalizar anuncios en Facebook e Instagram.",
          },
        ],
      },
      "Puedes controlar o deshabilitar las cookies desde la configuración de tu navegador. Ten en cuenta que desactivarlas puede afectar la funcionalidad del sitio.",
    ],
  },
  {
    heading: "8. Compartición de datos con terceros",
    body: [
      "No vendemos tu información personal. Podemos compartirla con:",
      {
        type: "list",
        items: [
          {
            term: "Meta Platforms, Inc.:",
            text: " a través del Píxel de Meta y la API de Conversiones para los fines publicitarios descritos en la sección 4, y de la Marketing API cuando lanzas campañas con tu propia cuenta de Meta conectada según la sección 3.",
          },
          {
            term: "Shopify:",
            text: " cuando publicas páginas de aterrizaje o productos en tu propia tienda usando el Admin API access token que conectaste, según la sección 3.",
          },
          {
            term: "Proveedores de servicios:",
            text: " empresas que nos ayudan a operar el sitio y prestar nuestros servicios (hosting, base de datos, autenticación, procesamiento), bajo acuerdos contractuales que los obligan a proteger tus datos.",
          },
          {
            term: "Autoridades legales:",
            text: " cuando sea requerido por ley o para proteger nuestros derechos legales.",
          },
        ],
      },
    ],
  },
  {
    heading: "9. Tus derechos",
    body: [
      "Dependiendo de tu ubicación, puedes tener los siguientes derechos sobre tu información:",
      {
        type: "list",
        items: [
          {
            term: "Acceso:",
            text: " solicitar una copia de los datos personales que tenemos sobre ti.",
          },
          { term: "Rectificación:", text: " corregir datos inexactos o incompletos." },
          { term: "Eliminación:", text: " solicitar que eliminemos tus datos personales." },
          {
            term: "Oposición:",
            text: " oponerte al tratamiento de tus datos para fines de marketing.",
          },
          {
            term: "Portabilidad:",
            text: " recibir tus datos en un formato estructurado y legible.",
          },
          {
            term: "Retirada del consentimiento:",
            text: " en cualquier momento, sin afectar la licitud del tratamiento previo.",
          },
        ],
      },
      {
        type: "p-with-link",
        prefix: "Para ejercer cualquiera de estos derechos, contáctanos en ",
        link: { href: "mailto:hola@replik.ai", label: "hola@replik.ai" },
        suffix: ". Responderemos en un plazo de 30 días.",
      },
    ],
  },
  {
    heading: "10. Retención de datos",
    body: [
      "Conservamos tu información personal mientras sea necesaria para los fines descritos en esta política, o según lo exija la ley. Los datos de conversión transmitidos a Meta se rigen por las políticas de retención de Meta.",
    ],
  },
  {
    heading: "11. Seguridad",
    body: [
      "Implementamos medidas técnicas y organizativas razonables para proteger tu información contra acceso no autorizado, pérdida o alteración. Sin embargo, ningún sistema de transmisión de datos por Internet es completamente seguro.",
    ],
  },
  {
    heading: "12. Menores de edad",
    body: [
      "Nuestros servicios no están dirigidos a menores de 18 años. No recopilamos conscientemente información personal de menores. Si crees que hemos recopilado datos de un menor, contáctanos para que podamos eliminarlos.",
    ],
  },
  {
    heading: "13. Cambios a esta política",
    body: [
      "Podemos actualizar esta política periódicamente. Publicaremos la versión actualizada en esta página con la nueva fecha de vigencia. Te recomendamos revisarla regularmente.",
    ],
  },
] as const

type LinkSpec = { href: string; label: string; external?: boolean }
type RichNode = string | { strong: string } | { link: LinkSpec }
type ListItem = { term?: string; text: string }
type BodyBlock =
  | string
  | { type: "p-with-link"; prefix: string; link: LinkSpec; suffix?: string }
  | { type: "p-rich"; nodes: readonly RichNode[] }
  | { type: "list"; items: readonly ListItem[] }

function renderRichNode(node: RichNode, key: number) {
  if (typeof node === "string") return <span key={key}>{node}</span>
  if ("strong" in node)
    return (
      <strong key={key} className="font-semibold text-fg-1">
        {node.strong}
      </strong>
    )
  return (
    <a
      key={key}
      href={node.link.href}
      {...(node.link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="text-mode-live underline decoration-mode-live/30 underline-offset-4 transition-colors hover:decoration-mode-live"
    >
      {node.link.label}
    </a>
  )
}

function renderBody(block: BodyBlock, key: number) {
  if (typeof block === "string") {
    return (
      <p key={key} className="text-[15px] leading-[1.75] text-fg-2">
        {block}
      </p>
    )
  }
  if (block.type === "p-with-link") {
    return (
      <p key={key} className="text-[15px] leading-[1.75] text-fg-2">
        {block.prefix}
        <a
          href={block.link.href}
          className="text-mode-live underline decoration-mode-live/30 underline-offset-4 transition-colors hover:decoration-mode-live"
        >
          {block.link.label}
        </a>
        {block.suffix ?? ""}
      </p>
    )
  }
  if (block.type === "p-rich") {
    return (
      <p key={key} className="text-[15px] leading-[1.75] text-fg-2">
        {block.nodes.map((node, i) => renderRichNode(node, i))}
      </p>
    )
  }
  return (
    <ul key={key} className="flex flex-col gap-2 pl-5">
      {block.items.map((item) => (
        <li
          key={`${item.term ?? ""}${item.text}`}
          className="list-disc text-[15px] leading-[1.7] text-fg-2 marker:text-fg-3"
        >
          {item.term ? <strong className="font-semibold text-fg-1">{item.term}</strong> : null}
          {item.text}
        </li>
      ))}
    </ul>
  )
}

export const metadata = {
  title: "Política de Privacidad — Replik.ai",
  description:
    "Cómo Replik.ai recopila, usa y protege tu información personal, incluyendo el uso del Píxel de Meta y la API de Conversiones.",
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-page-alt text-fg-1">
      <div className="mx-auto w-full max-w-[1100px] px-6">
        <header className="flex items-center justify-between py-[22px]">
          <Link
            href="/"
            className="flex items-center gap-2 text-fg-1 transition-opacity hover:opacity-75"
          >
            <Sparkles className="size-5 text-mode-live" strokeWidth={1.8} />
            <span className="text-headline font-semibold tracking-tight">Replik.ai</span>
          </Link>
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-pill border-[1.5px] border-border-input bg-surface-solid px-[18px] text-[14px] font-semibold text-fg-1 transition-colors hover:bg-page"
          >
            ← Volver al inicio
          </Link>
        </header>

        <article className="mx-auto max-w-[760px] pt-12 pb-20 sm:pt-16">
          <div className="border-b border-border pb-10">
            <span className="inline-flex h-[26px] items-center gap-1.5 rounded-pill bg-mode-live-badge-bg px-[11px] text-[11px] font-semibold uppercase tracking-[0.4px] text-mode-live-badge-fg">
              <span className="size-1.5 rounded-full bg-mode-live" />
              Legal
            </span>
            <h1
              className="mt-4 font-bold"
              style={{
                fontSize: "clamp(34px, 5vw, 48px)",
                lineHeight: 1.05,
                letterSpacing: "-1.2px",
              }}
            >
              Política de Privacidad
            </h1>
            <p className="mt-3 text-[14px] text-fg-3">Última actualización: abril de 2026</p>
          </div>

          <div className="mt-12 flex flex-col gap-12">
            {SECTIONS.map((section) => (
              <section key={section.heading} className="flex flex-col gap-3">
                <h2
                  className="font-semibold text-fg-1"
                  style={{ fontSize: 18, letterSpacing: "-0.2px" }}
                >
                  {section.heading}
                </h2>
                <div className="flex flex-col gap-3">
                  {section.body.map((block, i) => renderBody(block as BodyBlock, i))}
                </div>
              </section>
            ))}

            <section className="flex flex-col gap-3">
              <h2
                className="font-semibold text-fg-1"
                style={{ fontSize: 18, letterSpacing: "-0.2px" }}
              >
                14. Contacto
              </h2>
              <p className="text-[15px] leading-[1.75] text-fg-2">
                Si tienes preguntas sobre esta política o sobre el tratamiento de tus datos
                personales, puedes contactarnos en:
              </p>
              <div className="rounded-card border border-border bg-surface-solid px-6 py-5 text-[15px] leading-[1.7] text-fg-2 shadow-tight">
                <p className="font-semibold text-fg-1">Replik.ai</p>
                <a
                  href="mailto:hola@replik.ai"
                  className="text-mode-live underline decoration-mode-live/30 underline-offset-4 transition-colors hover:decoration-mode-live"
                >
                  hola@replik.ai
                </a>
              </div>
            </section>
          </div>
        </article>

        <footer className="flex flex-col items-start justify-between gap-3 py-[30px] pb-[50px] text-[12px] text-fg-3 sm:flex-row sm:items-center">
          <span>© 2026 Replik.ai · Lima, Perú</span>
          <span className="flex gap-[18px]">
            <span>Términos</span>
            <Link href="/privacy" className="text-fg-2 transition-colors hover:text-fg-1">
              Privacidad
            </Link>
            <span>Soporte</span>
          </span>
        </footer>
      </div>
    </main>
  )
}

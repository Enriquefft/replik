import "server-only"

/**
 * Shopify Online Store 2.0 page-template sections.
 *
 * Strategy: prefer Dawn-stock section types (`image-banner`, `multicolumn`,
 * `collapsible-content`, `rich-text`) so each setting maps to a friendly form
 * field in the customizer UI, and merchants can edit copy without seeing raw
 * HTML. `custom-liquid` is reserved for sections whose markup cannot be
 * expressed via stock schemas:
 *   - Hero (1–3 product images stacked + single LLM-picked video tile)
 *   - COD form (third-party form with inlined JS, pixel, WhatsApp redirect)
 *
 * Token substitution: `replaceTokens` (render.ts) walks the JSON tree and
 * replaces `{{token}}` placeholders against `TemplateVars` BEFORE upload, so
 * tokens may appear inside any string leaf — section settings, block settings,
 * or `custom_liquid` blobs. Liquid output tags such as `{{ block.settings.x }}`
 * use filter pipes / dots that the token regex never matches, so they pass
 * through unchanged for Shopify to render server-side.
 *
 * Section keys (`type`) MUST match Dawn's exact schema — unknown keys are
 * silently stripped on upload, leaving the section blank on the storefront.
 */

type Scalar = string | number | boolean | null
type SettingsRecord = Record<string, Scalar>

export interface BlockDef {
  type: string
  settings: SettingsRecord
}

export interface SectionDef {
  type: string
  settings: SettingsRecord
  blocks?: Record<string, BlockDef>
  block_order?: string[]
}

export type TemplateVariant = "clean" | "urgency" | "lifestyle"

const SECTION_HEADINGS: Record<
  TemplateVariant,
  { benefits: string; faq: string; objections: string; cod: string; codSubtitle: string }
> = {
  clean: {
    benefits: "Por qué te va a gustar",
    faq: "Preguntas frecuentes",
    objections: "Lo que la gente nos pregunta antes de comprar",
    cod: "Pedido contra entrega",
    codSubtitle: "",
  },
  urgency: {
    benefits: "Razones para pedirlo HOY",
    faq: "Lo que tienes que saber antes de pedir",
    objections: "Sin riesgo, sin letra chica",
    cod: "Pide ahora — paga al recibir",
    codSubtitle: "Oferta válida solo por hoy",
  },
  lifestyle: {
    benefits: "Cómo se siente tenerlo en casa",
    faq: "Preguntas que te puedes estar haciendo",
    objections: "Antes de pedir, ten esto claro",
    cod: "Recíbelo en casa",
    codSubtitle: "Pago contra entrega. Sin compromisos.",
  },
}

const BUNDLE_LABELS: Record<TemplateVariant, [string, string, string]> = {
  clean: ["1 unidad", "2 pack", "3 pack"],
  urgency: ["1 unidad", "2 pack", "3 pack — máximo ahorro"],
  lifestyle: ["Para mí", "Para compartir", "Para regalar"],
}

const CTA_BUTTON: Record<TemplateVariant, string> = {
  clean: "Confirmar pedido",
  urgency: "¡Quiero mi oferta!",
  lifestyle: "Quiero el mío",
}

const HERO_TITLE_PREFIX: Record<TemplateVariant, string> = {
  clean: "",
  urgency: "OFERTA LIMITADA: ",
  lifestyle: "",
}

const HERO_CSS = [
  '.replik-hero{padding:48px 20px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;line-height:1.5}',
  ".replik-hero-wrap{max-width:920px;margin:0 auto;display:flex;flex-direction:column;align-items:center}",
  ".replik-hero h1{font-size:clamp(28px,5vw,46px);margin:0 0 16px;line-height:1.15;font-weight:700;letter-spacing:-.01em}",
  ".replik-hero-main{width:100%;max-width:560px;height:auto;max-height:480px;aspect-ratio:1/1;border-radius:12px;display:block;margin:0 auto;object-fit:cover;background:#f3f3f3}",
  ".replik-hero-thumbs{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:12px;width:100%;max-width:560px}",
  ".replik-hero-thumbs img{width:160px;height:160px;max-width:48%;border-radius:8px;object-fit:cover;background:#f3f3f3;display:block}",
  ".replik-hero-video{width:100%;max-width:320px;aspect-ratio:9/16;object-fit:cover;border-radius:12px;background:#000;display:block;margin:24px auto 0}",
  ".replik-hero-subtitle{font-size:clamp(16px,2.2vw,19px);color:#555;margin:24px auto 0;max-width:640px}",
  ".replik-hero-tpl-urgency h1{color:#c9472f}",
  '.replik-hero-tpl-lifestyle{font-family:Georgia,Cambria,"Times New Roman",serif;background:linear-gradient(180deg,#fdf6f0 0%,#fff 100%)}',
].join("")

const COD_CSS = [
  '.replik-cod{max-width:480px;margin:0 auto;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1a1a1a}',
  ".replik-cod h2{font-size:26px;text-align:center;margin:0 0 24px;font-weight:700}",
  ".replik-cod form{display:flex;flex-direction:column;gap:12px}",
  ".replik-cod input,.replik-cod select{padding:14px 16px;border:1px solid #d4d4d4;border-radius:8px;font-size:16px;font-family:inherit;background:#fff;color:#1a1a1a;width:100%}",
  ".replik-cod input:focus,.replik-cod select:focus{outline:0;border-color:#1a1a1a}",
  ".replik-cod button{padding:16px;border:0;border-radius:8px;background:#1a1a1a;color:#fff;font-size:17px;font-weight:600;cursor:pointer;transition:background .15s;font-family:inherit;margin-top:4px}",
  ".replik-cod button:hover{background:#000}",
  ".replik-cod-subtitle{text-align:center;color:#c9472f;font-weight:600;margin:0 0 16px;font-size:14px;text-transform:uppercase;letter-spacing:.08em}",
  ".replik-cod-tpl-urgency button{background:#c9472f}",
  ".replik-cod-tpl-urgency button:hover{background:#a83925}",
  '.replik-cod-tpl-lifestyle{font-family:Georgia,Cambria,"Times New Roman",serif}',
  ".replik-cod-tpl-lifestyle button{background:#7a5d4f}",
  ".replik-cod-tpl-lifestyle button:hover{background:#5e483d}",
].join("")

function customLiquid(html: string): SectionDef {
  return { type: "custom-liquid", settings: { custom_liquid: html } }
}

/**
 * Hero section. Custom-liquid because the multi-image gallery and per-product
 * video tile cannot round-trip through Dawn's `image-banner` (which expects a
 * Shopify image_picker reference, not arbitrary URLs).
 *
 * Layout (mobile-first stacked, no media queries needed):
 *   1. `<h1>` headline (with per-variant prefix).
 *   2. Main product image (`hero_image_urls_csv[0]`) — full-width, max 560px.
 *   3. Thumbnail strip (`hero_image_urls_csv[1..2]`) — flex-row, wraps on
 *      narrow viewports. Skipped entirely when only one image is present.
 *   4. Single video tile (`hero_video_url`) — 9:16 portrait, 320px max,
 *      autoplay+muted+loop. Skipped entirely when the URL is empty.
 *   5. Subtitle paragraph below the gallery.
 *
 * The token regex in `render.ts` substitutes
 * `{{hero_image_urls_csv}}` / `{{hero_video_url}}` / `{{title}}` /
 * `{{subtitle}}` at upload time. Liquid-internal vars (`replik_hero_imgs`,
 * `img`, etc.) are NOT in `TemplateVars`, so the regex leaves them intact for
 * Shopify's Liquid engine to resolve at request time. `arr[0]` is not valid
 * Liquid; we use `replik_hero_imgs.first` to read the first element.
 */
export function heroSection(variant: TemplateVariant): SectionDef {
  const prefix = HERO_TITLE_PREFIX[variant]
  const cls = `replik-hero-tpl-${variant}`
  const html =
    `<style>${HERO_CSS}</style>` +
    `<section class="replik-hero ${cls}"><div class="replik-hero-wrap">` +
    `<h1>${prefix}{{title}}</h1>` +
    `{% assign replik_hero_imgs = "{{hero_image_urls_csv}}" | split: "," %}` +
    `{% assign replik_hero_main = replik_hero_imgs.first | strip %}` +
    `{% if replik_hero_main != "" %}` +
    `<img class="replik-hero-main" src="{{ replik_hero_main }}" alt="{{title}}">` +
    `{% endif %}` +
    `{% if replik_hero_imgs.size > 1 %}` +
    `<div class="replik-hero-thumbs">` +
    `{% for img in replik_hero_imgs offset:1 limit:2 %}` +
    `{% assign u = img | strip %}` +
    `{% if u != "" %}<img src="{{ u }}" alt="{{title}}">{% endif %}` +
    `{% endfor %}` +
    `</div>` +
    `{% endif %}` +
    `{% assign replik_hero_video = "{{hero_video_url}}" | strip %}` +
    `{% if replik_hero_video != "" %}` +
    `<video class="replik-hero-video" src="{{ replik_hero_video }}" controls muted playsinline loop autoplay preload="metadata"></video>` +
    `{% endif %}` +
    `<p class="replik-hero-subtitle">{{subtitle}}</p>` +
    `</div></section>`
  return customLiquid(html)
}

/**
 * Bundle pricing — Dawn `multicolumn` with 3 column blocks. Title carries the
 * tier label + price in plain text (richtext sanitization strips inline styles
 * but preserves <strong>). Featured (middle) tier surfaces "Más popular" via
 * its title since multicolumn has no per-column featured flag.
 */
export function bundleSection(variant: TemplateVariant): SectionDef {
  const [l1, l2, l3] = BUNDLE_LABELS[variant]
  return {
    type: "multicolumn",
    settings: {
      title: "Elige tu pack",
      heading_size: "h2",
      image_ratio: "adapt",
      columns_desktop: 3,
      column_alignment: "center",
      background_style: "none",
      button_label: "",
      button_link: "",
      color_scheme: "background-1",
      columns_mobile: "1",
      swipe_on_mobile: false,
      padding_top: 36,
      padding_bottom: 36,
    },
    blocks: {
      bundle_1: {
        type: "column",
        settings: {
          title: l1,
          text: "<p><strong>S/ {{price}}</strong></p>",
        },
      },
      bundle_2: {
        type: "column",
        settings: {
          title: `${l2} — Más popular`,
          text: "<p><strong>S/ {{bundle_2_price}}</strong></p>",
        },
      },
      bundle_3: {
        type: "column",
        settings: {
          title: l3,
          text: "<p><strong>S/ {{bundle_3_price}}</strong></p>",
        },
      },
    },
    block_order: ["bundle_1", "bundle_2", "bundle_3"],
  }
}

/**
 * Benefits — Dawn `multicolumn` with 3 column blocks. Each column's title is
 * the benefit headline; the body is a richtext paragraph. AI-generated values
 * are HTML-escaped at substitution time (see render.ts HTML_ESCAPE_FIELDS).
 */
export function benefitsSection(variant: TemplateVariant): SectionDef {
  return {
    type: "multicolumn",
    settings: {
      title: SECTION_HEADINGS[variant].benefits,
      heading_size: "h2",
      image_ratio: "adapt",
      columns_desktop: 3,
      column_alignment: "left",
      background_style: "primary",
      button_label: "",
      button_link: "",
      color_scheme: "background-1",
      columns_mobile: "1",
      swipe_on_mobile: false,
      padding_top: 36,
      padding_bottom: 36,
    },
    blocks: {
      benefit_1: {
        type: "column",
        settings: {
          title: "{{benefit_1_title}}",
          text: "<p>{{benefit_1_body}}</p>",
        },
      },
      benefit_2: {
        type: "column",
        settings: {
          title: "{{benefit_2_title}}",
          text: "<p>{{benefit_2_body}}</p>",
        },
      },
      benefit_3: {
        type: "column",
        settings: {
          title: "{{benefit_3_title}}",
          text: "<p>{{benefit_3_body}}</p>",
        },
      },
    },
    block_order: ["benefit_1", "benefit_2", "benefit_3"],
  }
}

/**
 * FAQ — Dawn `collapsible-content` with 3 collapsible_row blocks. Question
 * lives on `heading` (inline_richtext); answer on `row_content` (richtext).
 * `icon: "question_mark"` matches the FAQ semantic.
 */
export function faqSection(variant: TemplateVariant): SectionDef {
  return {
    type: "collapsible-content",
    settings: {
      heading: SECTION_HEADINGS[variant].faq,
      heading_size: "h2",
      heading_alignment: "center",
      color_scheme: "background-1",
      container_color_scheme: "background-1",
      layout: "section",
      open_first_collapsible_row: false,
      padding_top: 36,
      padding_bottom: 36,
    },
    blocks: {
      faq_1: {
        type: "collapsible_row",
        settings: {
          heading: "{{faq_1_q}}",
          icon: "question_mark",
          row_content: "<p>{{faq_1_a}}</p>",
        },
      },
      faq_2: {
        type: "collapsible_row",
        settings: {
          heading: "{{faq_2_q}}",
          icon: "question_mark",
          row_content: "<p>{{faq_2_a}}</p>",
        },
      },
      faq_3: {
        type: "collapsible_row",
        settings: {
          heading: "{{faq_3_q}}",
          icon: "question_mark",
          row_content: "<p>{{faq_3_a}}</p>",
        },
      },
    },
    block_order: ["faq_1", "faq_2", "faq_3"],
  }
}

/**
 * Objections — Dawn `rich-text` with one heading + two text blocks (one per
 * objection). Plain richtext renders centered by default; the leading "✓"
 * mirrors the original card visual cue without requiring custom CSS.
 */
export function objectionsSection(variant: TemplateVariant): SectionDef {
  return {
    type: "rich-text",
    settings: {
      color_scheme: "background-1",
      full_width: true,
      padding_top: 40,
      padding_bottom: 52,
    },
    blocks: {
      heading: {
        type: "heading",
        settings: {
          heading: SECTION_HEADINGS[variant].objections,
          heading_size: "h2",
        },
      },
      objection_1: {
        type: "text",
        settings: {
          text: "<p>✓ {{objection_1_text}}</p>",
        },
      },
      objection_2: {
        type: "text",
        settings: {
          text: "<p>✓ {{objection_2_text}}</p>",
        },
      },
    },
    block_order: ["heading", "objection_1", "objection_2"],
  }
}

/**
 * Pixel + COD form. Custom-liquid because Shopify ships no stock section that
 * embeds a third-party form, FB pixel, and a WhatsApp redirect. Token
 * substitution fills pixel id / page handle / prices; the inlined <script>
 * handles fetch + WhatsApp redirect at runtime.
 */
export function formCodSection(variant: TemplateVariant): SectionDef {
  const cls = `replik-cod-tpl-${variant}`
  const heading = SECTION_HEADINGS[variant].cod
  const subtitle = SECTION_HEADINGS[variant].codSubtitle
  const cta = CTA_BUTTON[variant]
  const subtitleHtml = subtitle === "" ? "" : `<p class="replik-cod-subtitle">${subtitle}</p>`
  const html =
    `<style>${COD_CSS}</style>` +
    `<section class="replik-cod ${cls}" id="replik-cod"><h2>${heading}</h2>${subtitleHtml}` +
    `<form id="replik-order-form">` +
    `<input name="customer_name" placeholder="Nombre completo" required>` +
    `<input name="phone" placeholder="Teléfono" pattern="\\+?\\d{8,15}" required>` +
    `<input name="address" placeholder="Dirección" required>` +
    `<input name="city" placeholder="Ciudad" required>` +
    `<select name="qty" id="replik-qty">` +
    `<option value="1" data-cents="{{price}}">${BUNDLE_LABELS[variant][0]} — S/ {{price}}</option>` +
    `<option value="2" data-cents="{{bundle_2_price}}">${BUNDLE_LABELS[variant][1]} — S/ {{bundle_2_price}}</option>` +
    `<option value="3" data-cents="{{bundle_3_price}}">${BUNDLE_LABELS[variant][2]} — S/ {{bundle_3_price}}</option>` +
    `</select>` +
    `<button type="submit">${cta}</button>` +
    `</form></section>` +
    `<script>` +
    `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
    `var pid='{{pixel_id}}';if(pid){fbq('init',pid);fbq('track','PageView');}` +
    `document.getElementById('replik-order-form').addEventListener('submit',async function(ev){ev.preventDefault();var f=ev.target;var qtySel=f.qty;var qty=parseInt(qtySel.value,10);var totalCents=parseInt(qtySel.options[qtySel.selectedIndex].getAttribute('data-cents'),10);var payload={shopify_page_handle:'{{shopify_page_handle}}',customer_name:f.customer_name.value,phone:f.phone.value,address:f.address.value,city:f.city.value,qty:qty,total_cents:totalCents};var res=await fetch('https://replik.app/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!res.ok){alert('Error al enviar el pedido');return}var data=await res.json();if(pid){fbq('track','Purchase',{value:(data.total_cents/100).toFixed(2),currency:'PEN'});}var msg=encodeURIComponent('Hola, soy '+f.customer_name.value+'. Acabo de pedir '+data.product_name+' (qty '+qty+', total S/ '+(data.total_cents/100).toFixed(2)+').');window.location='https://wa.me/'+data.whatsapp_number+'?text='+msg});` +
    `</script>`
  return customLiquid(html)
}

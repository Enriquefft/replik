# Replik.ai

Automated product testing platform for LATAM dropshippers. Connect your Shopify store and Meta Ads account — Replik handles landing pages, creative sourcing, and campaign launches.

## Features

### 🌐 Website Mode
- Auto-generate Shopify landing pages from product URLs
- 3 responsive templates optimized for mobile (90% of traffic)
- Built-in EasySell integration for cash-on-delivery sales

### 🎬 Creative Mode
- Source performing videos from Facebook Ad Library & TikTok
- Group creatives by sales angle
- Auto-add Spanish subtitles
- Generate variations to avoid duplicate detection

### 📊 Trafficker Mode
- Launch Meta Ads campaigns (CBO or ABO)
- Auto-generated ad copy by sales angle
- Pre-verify pixel + landing before publishing
- Complete campaign setup in minutes

## Workflow

1. **Paste Product** → URL from competitor or product name + image
2. **Pick Creatives** → Videos grouped by sales angle
3. **Auto-Edit** → Add subtitles, variations
4. **Build Landing** → Choose template, deploy to Shopify
5. **Launch Campaign** → Publish to Meta Ads

## Stack

- **Frontend**: React (JSX), CSS Grid
- **Target**: LATAM dropshippers (Spanish UI)
- **Integrations**: Shopify, Meta Ads, Facebook Ad Library, TikTok API

## Getting Started

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build
```

## Project Structure

```
├── src/
│   ├── App.jsx              # Main app component
│   ├── Dashboard.jsx        # Product overview
│   ├── AddProduct.jsx       # Product input form
│   ├── Creatives.jsx        # Video sourcing & selection
│   ├── Landing.jsx          # Landing page builder
│   ├── Launch.jsx           # Campaign configuration
│   ├── Onboarding.jsx       # Setup flow
│   ├── Chrome.jsx           # Browser connector
│   ├── Editing.jsx          # Video editing interface
│   ├── Loading.jsx          # Loading states
│   └── Primitives.jsx       # Reusable UI components
├── styles/
│   └── foundations.css      # Design system, typography, colors
├── assets/                  # Logos, icons, images
├── index.html              # Landing page
└── Replik App.html         # App entry point
```

## Configuration

- Spanish-first UI for LATAM market
- Mobile-optimized (responsive grid, touch-friendly)
- Cloud design system from Figma

## License

MIT

## Author

Created for dropshippers automating the testing phase of their e-commerce operations.

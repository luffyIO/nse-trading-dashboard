---
name: nse-dashboard-ux
description: "Use when designing, reviewing, or implementing the NSE market dashboard UI: stock-market visual design, Indian retail investor UX, charts, quote tables, market movers, themes, and responsive states."
---

# NSE Dashboard UX

Design this product as a practical Indian market-monitoring tool, not a generic fintech landing page. Prefer clear hierarchy, trustworthy data presentation, and fast scanning over decoration. Treat the guidance below as anti-patterns to check, not as a new fixed template.

## Avoid

- Reusing the default SaaS hero formula: oversized marketing headline, gradient wash, floating card collage, decorative dashboard preview, and repeated pill-shaped calls to action. This is a working dashboard; make the market information the content.
- Giving every metric equal weight or turning every value into a separate glowing card. Group related information and distinguish the primary quote from supporting context.
- Adding neon gradients, glass blur, shadows, borders, badges, or animation everywhere. Use effects sparingly and only when they clarify hierarchy or interaction.
- Decorative fake tickers, placeholder performance, invented charts, fabricated movers, simulated "live" states, or sample values that look like production data. Empty and error states must stay explicit.
- Calling prices "real time" or implying an authoritative NSE session unless the configured provider and entitlement actually establish it. Surface source, timestamp, delay uncertainty, and partial failures honestly.
- Presenting watchlist gainers as the whole-market top gainers. Name the scope the data supports.
- Using red and green as the only way to distinguish movement or state. Keep signs, values, and readable labels; retain sufficient contrast in both themes.
- Making charts visually impressive but hard to interpret: omit unexplained indicators, overloaded legends, misleading axes, tiny labels, or controls with unclear effects.
- Hiding essential data behind hover, using tiny low-contrast text, or creating controls that are difficult to operate by keyboard, touch, or assistive technology.
- Treating mobile as a scaled-down desktop. Prevent horizontal page overflow and preserve access to table columns and chart controls.

## Workflow

1. Inspect the existing page, styles, data contract, and nearby tests before changing the interface. Reuse its theme variables, components, and interaction patterns where appropriate.
2. Identify the user's task and the actual available data. Keep quote, chart, connection, and educational research states distinct; do not make a visual change imply a stronger data guarantee.
3. Make the smallest coherent visual change. Establish hierarchy through spacing, type, alignment, and restrained color before adding ornament or new components.
4. Preserve dark and light themes, responsive layouts, keyboard operation, visible focus, semantic labels, reduced-motion support, and honest loading, empty, stale, partial, and error states.
5. Verify behavior at desktop and narrow mobile widths. Exercise the relevant interactions and confirm that rapid changes cannot leave stale content on screen.
6. Run the smallest relevant tests or build checks. Report what was verified and call out any provider, entitlement, or sample-data limitations.

## Domain checks

- Use INR formatting for NSE-listed equities and identify the exchange where it matters.
- Distinguish watchlist-only summaries from broad NSE market claims.
- Keep market status unknown when the feed cannot establish it.
- Keep chat summaries grounded in the currently loaded dashboard data; do not imply generative intelligence or personalized investment advice when neither is provided.
- Keep strategy simulations and adaptive-agent output clearly labeled educational and paper-only.

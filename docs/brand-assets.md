# Reelencer logo assets

The supplied sailboat artwork is preserved in `assets/brand/logo-source.png`.
`app/_components/BrandLogo.tsx` displays the complete transparent mark through Next Image at the size required by each header, sidebar and navigation drawer. The surrounding link supplies the accessible name.

Run `npm run brand:generate` after replacing the source artwork. The generator requires Sharp and produces:

- A transparent WebP for the UI and PNG versions for structured data and email.
- Browser favicons at 16, 32 and 48 pixels, including a multi-size ICO.
- Install icons at 192 and 512 pixels, an Apple touch icon at 180 pixels, and a separate maskable icon with artwork inside its safe circle.
- A 1200 × 630 social sharing image with the logo and wordmark.
- Updated compatibility assets at the previous public logo URLs and Next's file-based icon paths.

The canonical paths in `public/brand/assets.json` include a hash of each file's contents. `lib/brand.ts` shares these paths with the UI, page metadata, install manifest and email template. Hashed images are served with immutable caching; new artwork receives a new URL. Keep previously published hashed assets available for emails and cached pages that still reference them.

The generator removes transparent padding around the visible artwork and fits the entire mark inside each output. It preserves the supplied colours and transparency. Install icons have a solid light background, while the UI mark remains transparent for light and dark surfaces.

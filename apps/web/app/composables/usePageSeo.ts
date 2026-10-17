// Title, description, canonical URL, Open Graph and Twitter card for one page. Every page calls this once;
// the image is the social card (docs/images/og-image.png, copied to public/ by prepare-assets).
export const SITE_ORIGIN = 'https://app.fugloy.dev';
export const HOME_TITLE = 'Fugløy — TRS-80 disassembler workbench';
export const CARD_ALT = 'Fugløy: a Z80 disassembler for the TRS-80. Disassemble, label, reassemble, byte for byte, beside a listing whose ROM, video, and DOS addresses are named.';

export interface PageSeo {
  title: string;
  description: string;
  /** The page's path, `/` for the home page. */
  path: string;
}

export function usePageSeo({ title, description, path }: PageSeo): void {
  const full = path === '/' ? HOME_TITLE : `${title} · Fugløy`;
  const url = `${SITE_ORIGIN}${path}`;
  const image = `${SITE_ORIGIN}/og-image.png`;
  useHead({ title: full, link: [{ rel: 'canonical', href: url }] });
  useSeoMeta({
    description,
    ogTitle: full,
    ogDescription: description,
    ogUrl: url,
    ogType: 'website',
    ogSiteName: 'Fugløy',
    ogImage: image,
    ogImageWidth: 1200,
    ogImageHeight: 630,
    ogImageAlt: CARD_ALT,
    twitterCard: 'summary_large_image',
    twitterTitle: full,
    twitterDescription: description,
    twitterImage: image,
    twitterImageAlt: CARD_ALT,
  });
}

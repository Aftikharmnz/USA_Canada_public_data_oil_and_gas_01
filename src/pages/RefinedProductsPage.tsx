import { UsaPage } from "./UsaPage";

/**
 * Backward-compatible entry for existing /products/ bookmarks. Refined
 * products now live inside the unified USA country page.
 */
export function RefinedProductsPage() {
  return <UsaPage initialSegment="refined" />;
}

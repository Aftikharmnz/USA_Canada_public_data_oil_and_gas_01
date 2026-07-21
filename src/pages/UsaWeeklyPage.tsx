import { UsaPage } from "./UsaPage";

/**
 * Trader-oriented entry over the verified weekly subset of the USA manifest.
 * Data, forecasts, geography, and refresh lineage remain shared with /usa/.
 */
export function UsaWeeklyPage() {
  return <UsaPage initialSegment="refined" weeklyOnly />;
}

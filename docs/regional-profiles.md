# Regional profiles

## Purpose and routes

The country dashboards have two local views:

- `/usa/` and `/canada/` remain the complete single-series explorers with seasonal statistics and forecasts;
- `/usa/profile/` and `/canada/profile/` are compact regional workspaces that put every compatible measure for one official region and product on one page.

USA, Canada, and Reference remain the only primary navigation pages. The profile is a country-local side page, not a third data source or a replacement for the explorer.

Profiles are manifest-backed, so registry activation and public availability are deliberately separate. The active Canada registry contains 81 definitions (32 Crude and 49 Refined), while the current promoted last-known-good manifest still contains 69 (31 Crude and 38 Refined). Until a complete expanded refresh passes and is promoted atomically, `/canada/profile/` continues to show only compatible assets from that 69-definition public generation.

## Selection order

The profile follows the same source-boundary order as the main dashboards:

1. Crude or Refined;
2. official geography level;
3. exact official region;
4. product family and product;
5. Weekly or Monthly graph view where that frequency can be represented honestly.

The USA defaults to PADD because it is the finest geography supporting a useful multi-measure profile for many products. Finer official nodes remain selectable: PADD 1 subdistricts for selected stock series, Cushing for commercial crude stocks, and state/producing-area nodes for monthly crude production. These finer profiles deliberately contain fewer cards. Canada defaults to province/territory. CER confidentiality regions remain separate official nodes and are never mapped to provinces.

## Page sections

### Product balance

Only the exact selected product and geography are shown. A national value is never substituted for a missing PADD or province value. Available imports, exports, production, refinery inputs, stocks, stock change, product supplied, and days supply appear as separate compact charts when the manifest publishes that exact coordinate. Once the first 78-definition USA generation is promoted, a PADD crude-oil profile also receives the exact monthly PSM ending-stocks, stock-change, imports, exports, refinery/blender-net-input, product-supplied, supply-adjustment, net-receipts, and transfers-to-supply cards. Once the first 81-definition Canada generation is promoted, exact provincial propane and residual-fuel measures appear only where the shared Statistics Canada `25100081` cube publishes that product/measure/geography coordinate; unavailable combinations remain absent or explicitly nonnumeric. Complete-coverage custom province/territory profiles are authorized for all four propane measures plus residual-fuel net production, imports, exports, stock change, and ending stocks. Residual product supplied remains national-only, and both transporter-stock definitions remain source-published-geography only.

### Related source boundary

Some market concepts are useful together but are not identical products. For example, EIA crude production is `Crude oil`, while PADD imports and stocks are `Commercial crude oil excluding SPR`. The profile may show these in a separate related-context section. The product labels remain visible and the series are never added or described as reconciled. The same rule applies to finished versus total gasoline and propane versus propane/propylene.

### Regional refinery context

Refinery utilization, crude runs, and crude inputs are system context, not selected refined-product balances. USA PADD utilization and crude inputs can appear beside a PADD profile. Canada province profiles may show exact Statistics Canada refinery inputs where published, but CER weekly runs/utilization cannot be allocated from Western Canada, Ontario, or Quebec & Eastern Canada to a province, refinery, or city.

### Logistics context

Movement charts use complete source-validated origin/destination models and filter them to routes touching the selected region:

- USA: monthly PADD-to-PADD gross movements for crude oil or the broader total-petroleum-products scope;
- Canada: monthly pipeline-only province-to-province movements for crude/equivalents or the broader HGL + refined-products scope.

The broader product scope is disclosed beside refined-product profiles. These routes are context, not gasoline-, diesel-, or jet-specific transfers. Weekly routes are unavailable and are never interpolated. Published directions remain separate, missing routes are not zero, and known inbound/outbound sums are not labelled as official net receipts.

Table 25-10-0075-01 closing inventories are separate inventory-custody context, not origin/destination logistics. After their first successful promotion they can appear only for the exact crude/equivalents or combined HGL/RPP product bucket and source-published geography. They represent month-end stock held by domestic pipeline transporters and must not be labelled as a receipt, transfer, route flow, refinery stock, total commercial stock, or capacity.

### Source boundaries

Unavailable cards are part of the product contract. The active monthly PSM crude balance publishes PADD exports and product supplied, while the separate weekly crude export definition remains U.S.-only; exact frequency and product boundary therefore matter. Other examples include Canada provincial product supplied that is Canada-only and CER activity that cannot be allocated to provinces. The source reason remains visible rather than silently removing the concept or carrying a broader value downward.

## Compact charts and expansion

Profile cards use a readable responsive grid: two or three large charts on wide screens and one on narrow screens. They open in **graph-first mode**: only the measure title, exact geography, source/derived-frequency badge, tiny display-unit control, seasonal graph, and a small latest/change overlay remain on the primary surface. Descriptions, full latest/change cards, boundary prose, and methodology sit behind an accessible **Show details** control and stay mounted so opening or closing them never resets the chart. The same graph-first disclosure pattern is used by the country explorers, weekly desk, distributions, balances, regional-composition charts, and movement views.

Weeks or months form the x-axis, the three most recent calendar years are separate lines, and, when sufficient history exists, the historical minimum-to-maximum and middle-50% bands remain behind them. Hover details report aligned recent-year values and available historical seasonal statistics for the selected week or month. If the baseline is unavailable, the card says so rather than inventing a range. If the latest source row is later and nonnumeric, the small always-visible status note gives both the source period/status and older numeric period so suppression never appears current. Critical stale, incomplete-coverage, forecast, and source-status warnings are never hidden with optional prose. The Expand control is revealed on pointer hover or keyboard focus and remains visible on touch devices. It opens an accessible fixed overlay, traps keyboard focus, closes with the button or Escape, restores focus, and does not depend on the browser Fullscreen API.

The profile charts intentionally focus on observed regional comparison. Forecasts and prediction intervals remain in the country explorer. A native three-week forecast is not converted into a three-month forecast.

## Weekly and monthly views

Native monthly assets pass through unchanged. Monthly routes and Statistics Canada balances cannot be shown as weekly and are never interpolated.

For the same exact selected product, geography, and registered measure, an available native monthly asset takes precedence over a weekly-derived monthly duplicate. Weekly remains available in Weekly mode. Similar-looking but different product boundaries are not deduplicated: monthly PSM crude oil and weekly commercial crude excluding SPR remain separate registered products.

Weekly observations may receive a browser-derived monthly display only when their stable series ID is positively registered in `config/display/weekly-to-monthly.json`. The registry covers the 66 active USA weekly definitions and the two active CER weekly definitions. The result is labelled **Monthly · derived** and **not an official monthly series**.

### Weekly rates

Production, imports, exports, product supplied, net flows, crude inputs, and crude runs are weekly average rates. A weekly period is the inclusive trailing seven-calendar-day interval ending on its published date. Each interval is split across calendar-month boundaries and the monthly value is:

```text
sum(weekly rate * overlap calendar days) / days in calendar month
```

Every calendar day must be covered exactly once. A gap, duplicate day, or nonnumeric contributing week makes the derived month nonnumeric; partial months are not renormalized.

### Stocks and ratios

- stocks use the final expected weekly endpoint in the completed calendar month and are labelled as a last-weekly snapshot, not an official month-end stock;
- days supply uses the final expected weekly reading and is never averaged;
- utilization uses the final expected weekly reading and is never averaged as a percentage.

A true monthly utilization rate would require complete aligned input and operable-capacity components and a ratio of time-integrated sums. Those components are not available in the current public profile, and CER publishes no capacity series.

### Status and lineage

Zero remains zero. Missing, suppressed/withheld, not available, not applicable, preliminary, and use-with-caution statuses remain distinct. A missing or suppressed final snapshot is never replaced with an older numeric reading. Calendar completion is evaluated against the validated asset generation time: an unfinished month is omitted, while a completed month still requires its exact final expected weekly endpoint and becomes explicitly nonnumeric if that endpoint is absent.

Derived assets recompute their seasonal history, latest values, deltas, and distributions from transformed history. Their in-memory lineage records the source checksum, registry methodology, strategy, coverage rule, contributing weekly periods, exact overlap-day weights, and blocking statuses. Canonical observations and files are unchanged.

All nine monthly USA crude balance definitions are also authorized for same-level, mutually exclusive PADD combinations. The browser requires complete exact-period component coverage and recomputes the combined seasonal chart from summed history. Source-published U.S. rows remain authoritative; a computed PADD combination is never relabelled as the official national value, and net receipts has no registered national source row.

## Display units

Each profile card has its own compact chart-edge display-unit selector because stocks, rates, days, and percentages have different dimensions. Its abbreviated labels keep the control narrow; the full meaning remains available in the details and accessible label. Fixed-factor conversions reuse `src/lib/units.ts`. Registered Statistics Canada monthly flows—including the province pipeline-movement card—retain their calendar-normalized daily-rate choices, including `bbl/d`, `kb/d`, and `MMbbl/d`; every route and inbound/outbound known-value sum uses the selected source month's exact day count. The nine new propane/residual-fuel flows receive the same registered treatment after promotion. Residual-fuel ending stocks and both 25-10-0075-01 transporter closing stocks remain volume-only. Frequency conversion occurs before fixed-factor display conversion; neither operation edits source assets. Unregistered USA movement volumes remain volume-only.

## Current hard gaps and expansion boundary

Each country's current deployed page exposes only assets in its promoted last-known-good generation. The active USA registry contains 78 definitions while its public manifest still contains 69; the active Canada registry contains 81 while its public manifest also still contains 69. The new USA monthly PADD crude-balance cards and the new Canada propane, residual-fuel, and transporter-inventory cards require their respective next successful refresh/promotion. Neither registry expansion implies equivalent coverage for every product or geography. Important remaining gaps are:

- weekly EIA exports and product supplied are often U.S.-only;
- weekly EIA surveys do not publish PADD-to-PADD transfers;
- active PADD movement products are crude and total petroleum products, not each refined product;
- Canada movement products are the two broad pipeline buckets, not grade- or product-specific routes;
- Canada transporter inventory is also limited to the two broad table 25-10-0075-01 product buckets, pipeline custody only, and is not a substitute for total commercial or refinery inventory;
- the new propane and residual-fuel balance leaves do not add product-specific province-to-province movements;
- Canada CER refinery regions cannot be joined to province profiles.

Future refined-product onboarding should prefer official EIA Petroleum Supply Monthly PADD supply/disposition and exact movement route facets, plus reviewed Statistics Canada tables where they add non-overlapping concepts. It must register exact provider coordinates, preserve product/geography meanings, add tests and documentation, and remain inside the reviewed sharded-storage gates in [ADR 0007](adr/0007-sharded-canonical-generation-storage.md).

## Refresh behavior

Profiles read the same validated country manifests and chart assets as the main explorers. They automatically reflect each successfully promoted EIA, Statistics Canada, or CER refresh without a separate profile job. A failed provider refresh still leaves the last-known-good generation deployable.

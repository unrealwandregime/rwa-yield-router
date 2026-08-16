# RWA Yield Router Risk Methodology

## Purpose and scope

RWA Yield Router provides a comparative risk framework for products and routes. It is designed to answer a ranking question: **which available routes appear more or less risky relative to one another, given the evidence currently available?** It is not a credit rating, an audit, an actuarial expected-loss model, investment advice, or a guarantee of principal or return.

Scores are calculated at the route level so that the same underlying product can have different risk when held natively, purchased on a DEX, deposited into a lending market, or deployed through a vault. Product-level evidence is inherited by a route only when the exposure is unchanged. Route-specific exposures are always additive and cannot erase an underlying product risk.

Higher scores mean higher comparative risk:

| Composite score | Label                            |
| --------------: | -------------------------------- |
|            0-20 | Low comparative risk             |
|           21-40 | Low to moderate comparative risk |
|           41-60 | Moderate comparative risk        |
|           61-80 | High comparative risk            |
|          81-100 | Very high comparative risk       |

“Low comparative risk” does not mean risk-free or safe. A score of zero is valid only when supported by applicable evidence; missing evidence is never converted to zero.

## Core principles

1. **Evidence before precision.** Every factor exposes its inputs, transformations, source references, confidence, observation time, and calculation time.
2. **Unknown is not low risk.** An unavailable material input remains visibly unavailable and receives a conservative ranking treatment.
3. **Eligibility is a gate.** A favorable risk score never overrides jurisdiction, investor-classification, KYC, product-status, or data-freshness exclusions.
4. **Yield and price return are separate.** Gold-price appreciation, stablecoin price changes, and token premiums or discounts are not APY.
5. **Route risks accumulate.** A gold token in a lending market retains issuer, custody, redemption, and gold-market risks and adds protocol, smart-contract, oracle, liquidity, and other route risks.
6. **Methodologies are immutable after publication.** Historical scores and simulations retain the exact published version that produced them.
7. **Overrides are auditable.** A manual override requires an administrator identity, before and after values, reason, source, verification date, and expiration or review date.

## Factor catalogue

Every applicable factor has a displayed score from 0 to 100, explanation, input metrics, source references, confidence classification, evidence coverage, and `calculatedAt` timestamp. A factor may be `UNAVAILABLE`; it must not be silently omitted or presented as zero.

| Factor                            | What it measures                                                                                           | Representative evidence                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Liquidity                         | Ability to exit near the reference price without delay or material market impact                           | Exit depth, executable slippage by size, turnover, utilization, withdrawal capacity, market fragmentation           |
| Redemption                        | Ability to redeem with the issuer or protocol under stated terms                                           | Notice period, settlement time, windows, minimums, fees, gates, suspension rights, in-kind versus cash settlement   |
| Issuer or counterparty            | Failure or performance risk of an issuer, borrower set, fund vehicle, or contractual counterparty          | Legal obligor, financial disclosures, reserves, bad debt, bankruptcy remoteness, diversification, incident history  |
| Custody                           | Loss, freeze, segregation, and custodian-concentration risk                                                | Custodian identity, account segregation, sub-custodians, insurance scope, attestations, legal title, concentration  |
| Smart contract                    | Exploit or implementation risk in contracts required by the route                                          | Audits, code age, value and time at risk, verified source, incidents, complexity, privileged functions              |
| Oracle                            | Manipulation, staleness, or failure of price and NAV inputs                                                | Feed design, update cadence, deviation thresholds, fallback logic, market depth, dependency concentration           |
| Chain                             | Base-layer, L2, bridge, finality, and liveness risk                                                        | Uptime, reorg/finality model, sequencer controls, bridge dependency, validator concentration, incident history      |
| Stablecoin or depeg               | Failure to maintain a referenced value used by the route                                                   | Backing and redemption design, deviations, liquidity, reserve evidence, dependency and collateral composition       |
| Market price                      | Volatility and divergence between market price and economic reference value                                | Premium/discount to NAV, gold-price exposure, volatility, basis, drawdown, price-discovery quality                  |
| Concentration                     | Dependence on a small number of issuers, protocols, chains, assets, borrowers, venues, or collateral types | Exposure shares, HHI, largest component, correlated dependencies, liquidity-provider concentration                  |
| Yield instability                 | Variability and persistence of non-incentive APY                                                           | Lookback length, volatility, downside deviation, drawdown, utilization sensitivity, source changes                  |
| Incentive dependency              | Reliance on temporary or volatile rewards                                                                  | Incentive share of gross APY, token liquidity, announced end date, emissions schedule, reward volatility            |
| Governance and upgradeability     | Risk introduced by mutable rules and privileged control                                                    | Upgrade keys, timelocks, multisig threshold and independence, emergency powers, governance participation            |
| Operational                       | People, process, reconciliation, key-management, service, and strategy-execution failures                  | Outages, reconciliations, key controls, NAV process, dependency health, incident response, strategy complexity      |
| Legal and eligibility uncertainty | Uncertainty in legal structure, rights, transferability, and user access                                   | Terms, offering documents, jurisdiction and investor-class rules, transfer restrictions, review age, counsel status |
| Data quality                      | Risk of ranking from incomplete, stale, conflicting, weak, or unverifiable evidence                        | Required-field coverage, freshness, source authority, cross-source agreement, provenance, adapter health            |

### Factor scoring

Each methodology version defines factor-specific input transformations and weights. An available factor is calculated with decimal arithmetic:

```text
factorScore = sum(inputRiskScore_j * inputWeight_j) / sum(inputWeight_j)
```

Input risk scores and the result are bounded to `[0, 100]` only after calculation. Intermediate values retain at least six decimal places; persisted and displayed scores are rounded to two decimals. A factor explanation must identify the inputs that materially drove the result.

Common interpretation anchors are:

| Input score | Interpretation                                                                                      |
| ----------: | --------------------------------------------------------------------------------------------------- |
|        0-20 | Stronger controls or exit characteristics relative to the covered universe; residual risk remains   |
|       21-40 | Limited weaknesses with generally usable controls or liquidity                                      |
|       41-60 | Material dependencies, uncertainty, volatility, or exit friction                                    |
|       61-80 | Significant weakness, concentration, restriction, instability, or adverse history                   |
|      81-100 | Severe impairment, extreme dependency, active adverse condition, or route near exclusion thresholds |

These anchors do not replace factor-specific transformations. For example, liquidity uses executable size and slippage rather than a reviewer’s subjective label, while legal uncertainty uses sourced access rules and review age.

### Confidence and missing evidence

Confidence describes evidence quality, not safety. The supported classifications are `VERIFIED_OFFICIAL`, `DIRECT_API`, `ONCHAIN_DERIVED`, `ISSUER_REPORTED`, `THIRD_PARTY`, `MANUALLY_VERIFIED`, `ESTIMATED`, `STALE`, and `UNAVAILABLE`.

For a factor with a non-zero category weight:

- If all required inputs are present, the calculated factor score is used.
- If optional inputs are missing but minimum coverage is met, the factor is calculated, its coverage is shown, and the data-quality factor increases.
- If a required input is missing or minimum coverage is not met, the displayed factor is `UNAVAILABLE`. For composite ranking only, methodology v1 uses an explicit **unknown-risk proxy of 75**. The UI must show both `Unavailable` and `75 used for comparative ranking`; it must not display 75 as an observed factor score.
- Weights are never renormalized around an unavailable factor. Renormalization would reward missing evidence.
- A factor with a category weight of zero is `NOT_APPLICABLE` in that category baseline, not `0 risk`.

The v1 data-quality factor is itself calculated from:

| Data-quality component                              |   Weight |
| --------------------------------------------------- | -------: |
| Missing required or material inputs                 |      35% |
| Freshness relative to metric-specific service level |      30% |
| Source authority and verification state             |      20% |
| Material cross-source disagreement                  |      10% |
| Provenance integrity and adapter health             |       5% |
| **Total**                                           | **100%** |

Freshness is evaluated against each metric’s configured cadence, not one global timeout. An overdue observation changes status to `STALE`; a missing value is never replaced with zero. Active adapter failures and unexplained source disagreement create data-quality events and may make the route ineligible for normal optimization.

Worker recalculation selects exactly one published methodology whose half-open effective interval contains the calculation cutoff, then loads and validates its complete relational category-weight table. Overlapping intervals, unsupported calculation versions or policy shapes, and incomplete weights fail closed. Factor evidence is re-evaluated at that same cutoff against the source registry’s freshness threshold, publication/lifecycle state, and observation/fetch timestamps. Writing a newer composite never makes old factor evidence current again.

## Category weights — methodology v1

Weights are percentages of the composite route score. Every category totals exactly 100%. The weight table is configuration stored with the immutable methodology version; application code must validate the total before publication.

| Risk factor                       | Tokenized T-bill | Stablecoin vault | DeFi lending | Money-market token | Gold-backed token / route | Cash-equivalent on-chain |
| --------------------------------- | ---------------: | ---------------: | -----------: | -----------------: | ------------------------: | -----------------------: |
| Liquidity                         |              15% |              14% |          14% |                14% |                       14% |                      15% |
| Redemption                        |              15% |               1% |           2% |                15% |                       12% |                      10% |
| Issuer or counterparty            |              18% |               2% |           8% |                16% |                       14% |                      12% |
| Custody                           |              15% |               2% |           2% |                14% |                       16% |                       8% |
| Smart contract                    |               5% |              18% |          17% |                 6% |                        5% |                      10% |
| Oracle                            |               1% |               2% |          10% |                 1% |                        4% |                       4% |
| Chain                             |               2% |               2% |           5% |                 2% |                        3% |                       5% |
| Stablecoin or depeg               |               0% |              12% |           8% |                 2% |                        0% |                      10% |
| Market price                      |               7% |               3% |           6% |                 5% |                       10% |                       3% |
| Concentration                     |               5% |              10% |           6% |                 5% |                        4% |                       5% |
| Yield instability                 |               1% |              10% |           5% |                 3% |                        2% |                       5% |
| Incentive dependency              |               0% |               8% |           3% |                 0% |                        1% |                       3% |
| Governance and upgradeability     |               1% |               6% |           6% |                 1% |                        2% |                       3% |
| Operational                       |               1% |               6% |           2% |                 4% |                        4% |                       3% |
| Legal and eligibility uncertainty |              10% |               1% |           1% |                 8% |                        6% |                       2% |
| Data quality                      |               4% |               3% |           5% |                 4% |                        3% |                       2% |
| **Total**                         |         **100%** |         **100%** |     **100%** |           **100%** |                  **100%** |                 **100%** |

Weight rationale:

- **Tokenized T-bills** emphasize issuer, custody, redemption, liquidity, and legal access. Market/NAV risk remains visible; depeg and incentive factors are not part of the native category baseline.
- **Stablecoin vaults** emphasize smart contracts, strategy operations, liquidity, depeg exposure, concentration, yield instability, incentives, and upgradeability. Small issuer, custody, redemption, and legal weights preserve indirect dependencies.
- **DeFi lending** emphasizes contract, liquidity/utilization, oracle/liquidation, collateral market quality, bad-debt counterparties, depeg, governance, chain, and data quality.
- **Money-market tokens** emphasize issuer, custody, redemption, liquidity, and legal structure, with smaller on-chain and yield-stability exposures.
- **Gold-backed tokens and gold routes** emphasize custody, issuer, redemption, liquidity, market premium/discount and gold-price exposure. Native gold yield is zero unless a verified issuer mechanism exists; lending or vault yield is separately scored as route yield.
- **Cash-equivalent on-chain products** balance liquidity, issuer, redemption, contract, stablecoin, custody, and chain dependencies because the category includes both off-chain-backed and protocol-native structures.

If a route materially changes the exposure model—for example, a tokenized T-bill deposited into a DeFi vault—the route keeps inherited product-factor scores but uses the category methodology for the route’s economic yield source and dependencies. The UI must identify the selected category and inherited exposures. A future multi-layer weighting model requires a new methodology version; administrators may not silently adjust weights per route.

## Composite comparative risk score

For category weights `w_i` expressed as percentages and effective factor values `e_i`:

```text
effectiveFactor_i = observedFactor_i, when available
effectiveFactor_i = 75, when required evidence is unavailable and w_i > 0

compositeRisk = sum(w_i * effectiveFactor_i) / 100
```

The result is bounded to `[0, 100]` and rounded to two decimals for display. The record stores unrounded input values, each observation reference, weights, unknown proxies, factor timestamps, calculation time, and methodology version.

The composite is `PROVISIONAL` when any positively weighted factor uses the unknown proxy. The UI shows evidence coverage and names every unavailable factor. Routes with missing critical identity, eligibility, status, price/NAV, or yield-source evidence are excluded from the standard optimizer even if a provisional composite can be calculated.

A request-time calculation supplied with no factor evidence is proxy-only: its evidence coverage is
`0%`, every positively weighted factor remains unavailable, and any displayed composite is
`ESTIMATED`. It must never be labelled current, verified, or direct-API risk merely because the APY
and liquidity came from an official provider. Request-time values do not acquire persisted
observation IDs and cannot satisfy optimizer provenance gates.

## Comparative risk-adjusted APY

The product label is exactly **“Comparative risk-adjusted APY.”** It is a ranking adjustment, not an expected return, forecast, probability of loss, or promise of performance.

### Penalty groups

All sixteen risk factors feed exactly one visible penalty group:

| Penalty component            | Included risk factors                                        |
| ---------------------------- | ------------------------------------------------------------ |
| `liquidityPenalty`           | Liquidity                                                    |
| `redemptionPenalty`          | Redemption; legal and eligibility uncertainty                |
| `issuerPenalty`              | Issuer or counterparty; operational                          |
| `custodyPenalty`             | Custody                                                      |
| `smartContractPenalty`       | Smart contract; oracle; chain; governance and upgradeability |
| `concentrationPenalty`       | Concentration                                                |
| `yieldInstabilityPenalty`    | Yield instability                                            |
| `incentiveDependencyPenalty` | Incentive dependency                                         |
| `marketOrDepegPenalty`       | Market price; stablecoin or depeg                            |
| `dataQualityPenalty`         | Data quality                                                 |

Within a group, the group severity is the category-weighted mean of its effective factors. Its weight share is the sum of those category weights. If the share is zero, the component is `NOT_APPLICABLE` and contributes zero.

### Penalty formula

Methodology v1 uses a versioned maximum annual comparative penalty budget `B = 12.00 percentage points`:

```text
groupSeverity_g = sum(w_i * effectiveFactor_i) / sum(w_i)  for factors i in group g
groupWeightShare_g = sum(w_i) / 100

penalty_g_pp = B * groupWeightShare_g * (groupSeverity_g / 100)^2

comparativeRiskAdjustedAPY = netAPY
  - liquidityPenalty
  - redemptionPenalty
  - issuerPenalty
  - custodyPenalty
  - smartContractPenalty
  - concentrationPenalty
  - yieldInstabilityPenalty
  - incentiveDependencyPenalty
  - marketOrDepegPenalty
  - dataQualityPenalty
```

Penalties and APYs are expressed in annual percentage points. The quadratic curve makes a move from 80 to 90 more consequential than a move from 20 to 30 while remaining deterministic and inspectable. The ten group weight shares always sum to 100%, so the total v1 penalty cannot exceed 12.00 percentage points. This bound is a ranking calibration, not a maximum possible economic loss.

Example: cash-equivalent on-chain liquidity has a 15% category weight. At a liquidity score of 60, its penalty is `12.00 * 0.15 * 0.60^2 = 0.648` percentage points. The UI displays 0.65 pp plus the score, weight, formula, evidence, and methodology version.

Rules:

- A provider field named net APY is not automatically the user's final net APY. Morpho provider net
  APY is displayed as provider-reported before user-specific transaction costs and is used only as
  a before-transaction-cost input when matching observations have been persisted.
- `netAPY` must already account for disclosed fees and horizon-annualized entry, exit, gas, and slippage estimates. Risk penalties do not replace transaction-cost calculations.
- If net APY is unavailable, Comparative risk-adjusted APY is unavailable.
- A provisional score can produce a provisional ranking value using the visible unknown proxy, but not an apparently verified value.
- Negative results are valid and are not clamped to zero.
- Ineligible, paused, closed, stale-critical, or unverified routes are excluded from standard optimizer results.
- User risk profiles alter eligibility limits and optimization constraints, not the historical published factor evidence. Any user-adjustable what-if weights are labeled a simulation and never overwrite the platform methodology.
- Every component is returned by the API and inspectable in the UI; only returning the final adjusted APY is non-compliant.

## Eligibility, status, and hard exclusions

Risk scoring is downstream of hard filters. Standard ranking and optimization exclude a route when any of the following applies:

- Jurisdiction or investor classification is known to be ineligible.
- KYC is required and the user disallows KYC.
- Eligibility is unknown and the user’s minimum-confidence policy requires a verified answer.
- Product or route status is paused, closed, deprecated, unavailable, or not published.
- A critical required observation is stale or unavailable.
- Available liquidity, TVL/AUM, chain, product, or confidence constraints are not met.
- Incentive yield is disallowed and the route cannot separate and remove it.

Unknown eligibility is displayed as `Awaiting verification`; it is never interpreted as globally available. Advanced research mode may display excluded records but must allocate zero capital and show the exclusion reason.

## Methodology governance and auditability

A methodology version includes:

- Immutable identifier and semantic version
- Draft, reviewed, published, superseded, and effective timestamps
- Author and independent reviewer identities
- Factor definitions, input transformations, score anchors, and required inputs
- Six complete category-weight tables and validation that each totals 100%
- Confidence mapping, coverage thresholds, unknown-risk proxy, and staleness rules
- Penalty grouping, curve, and annual penalty budget
- Release notes and comparison with the prior version

Publishing requires two-person review, automated weight-sum and boundary tests, deterministic fixture tests, documentation review, and an effective time. Published versions are append-only. Corrections create a new version rather than mutating history. Each factor snapshot, composite snapshot, API response, downloadable report, saved comparison, and route simulation stores the methodology version used.

Material methodology changes are announced before or at activation and old scores remain queryable. Backfills are stored as newly calculated records with their methodology version and calculation timestamp; they never rewrite the score a user previously saw.

## Required validation tests

At minimum, automated tests cover:

- All six category weights total exactly 100% using decimal arithmetic.
- Factor and composite boundaries at 0 and 100.
- An unavailable positively weighted factor uses 75 without changing its displayed status.
- No weight renormalization occurs when evidence is missing.
- Zero-weight factors are `NOT_APPLICABLE`, not low risk.
- Penalty groups include every factor exactly once and their shares total 100%.
- The v1 total penalty is bounded by 12.00 percentage points.
- Negative and zero net APY, missing net APY, stale data, and unknown fees.
- Incentive expiration and separation of base versus reward-token APY.
- Gold native yield remains zero absent a verified issuer yield mechanism.
- Category, methodology-version, rounding, and deterministic replay behavior.
- Ineligible, paused, unavailable, stale-critical, and unverified routes receive no standard optimizer allocation.

## User-facing disclosure

Every risk view and simulation must state:

> Risk scores and Comparative risk-adjusted APY are transparent comparative methodologies based on available data. They are not forecasts, credit ratings, guarantees, or individualized investment advice. Data can be delayed, incomplete, or inaccurate; APYs are variable; product access depends on jurisdiction and investor status. Verify terms and eligibility directly with the issuer or protocol.

import type {
  ComputedTaxYear,
  FilingStatus,
  Form1040Outputs,
  SCorp1120SOutputs,
  SetupConfig,
  StateFilingOutputs,
  TaxYearRecord,
} from '../types/tax';

interface TaxBracket {
  upTo: number;
  rate: number;
}

// 2025 Federal Ordinary Income Tax Brackets (base year; indexed forward by inflation_rate)
const BASE_BRACKETS_2025: Record<FilingStatus, TaxBracket[]> = {
  married_filing_jointly: [
    { upTo: 23850, rate: 0.1 },
    { upTo: 96950, rate: 0.12 },
    { upTo: 206700, rate: 0.22 },
    { upTo: 394600, rate: 0.24 },
    { upTo: 501050, rate: 0.32 },
    { upTo: 751600, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  single: [
    { upTo: 11925, rate: 0.1 },
    { upTo: 48475, rate: 0.12 },
    { upTo: 103350, rate: 0.22 },
    { upTo: 197300, rate: 0.24 },
    { upTo: 250525, rate: 0.32 },
    { upTo: 626350, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  head_of_household: [
    { upTo: 17000, rate: 0.1 },
    { upTo: 64850, rate: 0.12 },
    { upTo: 103350, rate: 0.22 },
    { upTo: 197300, rate: 0.24 },
    { upTo: 250500, rate: 0.32 },
    { upTo: 626350, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  married_filing_separately: [
    { upTo: 11925, rate: 0.1 },
    { upTo: 48475, rate: 0.12 },
    { upTo: 103350, rate: 0.22 },
    { upTo: 197300, rate: 0.24 },
    { upTo: 250525, rate: 0.32 },
    { upTo: 375800, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
};

// 2025 Standard Deductions
const BASE_STD_DEDUCTION_2025: Record<FilingStatus, number> = {
  married_filing_jointly: 30000,
  single: 15000,
  head_of_household: 22500,
  married_filing_separately: 15000,
};

// 2025 LTCG / Qualified Dividend Thresholds
const BASE_LTCG_2025: Record<FilingStatus, { zeroUpTo: number; fifteenUpTo: number }> = {
  married_filing_jointly: { zeroUpTo: 96700, fifteenUpTo: 600050 },
  single: { zeroUpTo: 48350, fifteenUpTo: 533400 },
  head_of_household: { zeroUpTo: 64750, fifteenUpTo: 566700 },
  married_filing_separately: { zeroUpTo: 48350, fifteenUpTo: 300000 },
};

// 2025 QBI Section 199A Thresholds
const BASE_QBI_THRESHOLD_2025: Record<FilingStatus, { start: number; phaseoutRange: number }> = {
  married_filing_jointly: { start: 394600, phaseoutRange: 100000 },
  single: { start: 197300, phaseoutRange: 50000 },
  head_of_household: { start: 197300, phaseoutRange: 50000 },
  married_filing_separately: { start: 197300, phaseoutRange: 50000 },
};

// State Tax Configuration
export interface StateTaxRule {
  code: string;
  name: string;
  mode: 'none' | 'flat' | 'progressive';
  flatRate?: number;
  brackets?: TaxBracket[]; // MFJ-equivalent simplified schedule
  stdDeduction: number;
  pteAvailable: boolean;
  pteRate: number;
  scorpMinTax: number;
  scorpEntityRate: number;
}

export const STATE_TAX_RULES: Record<string, StateTaxRule> = {
  AZ: {
    code: 'AZ',
    name: 'Arizona',
    mode: 'flat',
    flatRate: 0.025,
    stdDeduction: 29200,
    pteAvailable: true,
    pteRate: 0.0298,
    scorpMinTax: 50,
    scorpEntityRate: 0,
  },
  CA: {
    code: 'CA',
    name: 'California',
    mode: 'progressive',
    brackets: [
      { upTo: 21512, rate: 0.01 },
      { upTo: 50998, rate: 0.02 },
      { upTo: 80490, rate: 0.04 },
      { upTo: 111732, rate: 0.06 },
      { upTo: 141212, rate: 0.08 },
      { upTo: 721318, rate: 0.093 },
      { upTo: 865574, rate: 0.103 },
      { upTo: 1442628, rate: 0.113 },
      { upTo: Infinity, rate: 0.123 },
    ],
    stdDeduction: 11080,
    pteAvailable: true,
    pteRate: 0.093,
    scorpMinTax: 800,
    scorpEntityRate: 0.015,
  },
  WA: {
    code: 'WA',
    name: 'Washington',
    mode: 'none',
    stdDeduction: 0,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  TX: {
    code: 'TX',
    name: 'Texas',
    mode: 'none',
    stdDeduction: 0,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  NV: {
    code: 'NV',
    name: 'Nevada',
    mode: 'none',
    stdDeduction: 0,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  FL: {
    code: 'FL',
    name: 'Florida',
    mode: 'none',
    stdDeduction: 0,
    pteAvailable: false,
    pteRate: 0,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  CO: {
    code: 'CO',
    name: 'Colorado',
    mode: 'flat',
    flatRate: 0.044,
    stdDeduction: 30000,
    pteAvailable: true,
    pteRate: 0.044,
    scorpMinTax: 0,
    scorpEntityRate: 0,
  },
  NY: {
    code: 'NY',
    name: 'New York',
    mode: 'progressive',
    brackets: [
      { upTo: 17150, rate: 0.04 },
      { upTo: 23600, rate: 0.045 },
      { upTo: 27900, rate: 0.0525 },
      { upTo: 161550, rate: 0.055 },
      { upTo: 323200, rate: 0.06 },
      { upTo: 2155350, rate: 0.0685 },
      { upTo: Infinity, rate: 0.0965 },
    ],
    stdDeduction: 16050,
    pteAvailable: true,
    pteRate: 0.0685,
    scorpMinTax: 300,
    scorpEntityRate: 0,
  },
  OR: {
    code: 'OR',
    name: 'Oregon',
    mode: 'progressive',
    brackets: [
      { upTo: 8600, rate: 0.0475 },
      { upTo: 21500, rate: 0.0675 },
      { upTo: 250000, rate: 0.0875 },
      { upTo: Infinity, rate: 0.099 },
    ],
    stdDeduction: 5495,
    pteAvailable: true,
    pteRate: 0.09,
    scorpMinTax: 150,
    scorpEntityRate: 0,
  },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round0(n: number): number {
  return Math.round(n);
}

function inflationFactor(taxYear: number, rate: number): number {
  const delta = Math.max(0, taxYear - 2025);
  return Math.pow(1 + rate, delta);
}

function computeProgressiveTax(
  taxableIncome: number,
  brackets: TaxBracket[],
  scale = 1
): { tax: number; marginalRate: number } {
  if (taxableIncome <= 0) {
    return { tax: 0, marginalRate: brackets[0]?.rate ?? 0.1 };
  }
  let remaining = taxableIncome;
  let prevCap = 0;
  let tax = 0;
  let marginalRate = brackets[0].rate;

  for (const bracket of brackets) {
    const cap = bracket.upTo === Infinity ? Infinity : round0(bracket.upTo * scale);
    const width = cap === Infinity ? remaining : Math.max(0, cap - prevCap);
    const slice = Math.min(remaining, width);
    if (slice > 0) {
      tax += slice * bracket.rate;
      marginalRate = bracket.rate;
      remaining -= slice;
    }
    prevCap = cap;
    if (remaining <= 0) break;
  }

  return { tax: round0(tax), marginalRate };
}

function computeSocialSecurityTaxable(
  ssGross: number,
  otherIncomePlusTaxExempt: number,
  filingStatus: FilingStatus
): number {
  if (ssGross <= 0) return 0;
  const provisional = otherIncomePlusTaxExempt + 0.5 * ssGross;
  const base1 = filingStatus === 'married_filing_jointly' ? 32000 : filingStatus === 'married_filing_separately' ? 0 : 25000;
  const base2 = filingStatus === 'married_filing_jointly' ? 44000 : filingStatus === 'married_filing_separately' ? 0 : 34000;

  if (provisional <= base1) return 0;
  if (provisional <= base2) {
    return round0(Math.min(0.5 * ssGross, 0.5 * (provisional - base1)));
  }
  const tier1Max = filingStatus === 'married_filing_jointly' ? 6000 : filingStatus === 'married_filing_separately' ? 0 : 4500;
  const tier2 = 0.85 * (provisional - base2) + Math.min(tier1Max, 0.5 * ssGross);
  return round0(Math.min(0.85 * ssGross, tier2));
}

function computeIrmaa(
  magi: number,
  filingStatus: FilingStatus,
  primaryAge: number,
  spouseAge: number | null,
  scale: number
): { tier: string; annualSurcharge: number } {
  const enrollees =
    (primaryAge >= 65 ? 1 : 0) + (spouseAge !== null && spouseAge >= 65 ? 1 : 0);
  if (enrollees === 0) {
    return { tier: 'Not Medicare-eligible (<65)', annualSurcharge: 0 };
  }

  const mfj = filingStatus === 'married_filing_jointly';
  const thresholds = mfj
    ? [212000, 266000, 334000, 400000, 750000]
    : [106000, 133000, 167000, 200000, 500000];
  // Combined Part B + Part D annualized IRMAA surcharge per enrollee (2025 base)
  const perEnrolleeSurcharges = [0, 1052, 2642, 4232, 5822, 6352];
  const labels = [
    'Standard (No IRMAA)',
    'Tier 1 IRMAA',
    'Tier 2 IRMAA',
    'Tier 3 IRMAA',
    'Tier 4 IRMAA',
    'Tier 5 IRMAA',
  ];

  let idx = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (magi > thresholds[i] * scale) {
      idx = i + 1;
    }
  }

  return {
    tier: labels[idx],
    annualSurcharge: round0(perEnrolleeSurcharges[idx] * enrollees * scale),
  };
}

/**
 * Runs the 4-layer deterministic annual calculation sequence (Module 3 §3)
 * across the entire 6-year rolling horizon, carrying forward stock basis and AAA.
 */
export function calculateSixYearPlan(
  setup: SetupConfig,
  years: TaxYearRecord[]
): ComputedTaxYear[] {
  const results: ComputedTaxYear[] = [];
  let runningStockBasis: number | null = null;
  let runningAaa: number | null = null;

  for (let i = 0; i < years.length; i++) {
    const yr = years[i];
    const scale = inflationFactor(yr.tax_year, setup.assumptions.inflation_rate);
    const primaryAge = yr.tax_year - setup.primary_birth_year;
    const spouseAge =
      setup.filing_status === 'married_filing_jointly' && setup.spouse_birth_year
        ? yr.tax_year - setup.spouse_birth_year
        : null;

    // ------------------------------------------------------------------
    // LAYER 1: Entity & Compensation Layer (Form 1120-S)
    // ------------------------------------------------------------------
    const scorpIn = yr.scorp_1120s;
    const dbpIn = yr.dbp_and_retirement;

    const ssWageBase = round0(176100 * scale);
    let employerPayrollTaxes = 0;
    let ordinaryIncome1120s = 0;
    const pteTaxPaidByState: Record<string, number> = {};
    let pteTaxPaidTotal = 0;
    const stockBasisBeginning: number =
      i === 0 || runningStockBasis === null
        ? scorpIn.stock_basis_beginning
        : runningStockBasis;
    const aaaBeginning: number =
      i === 0 || runningAaa === null ? scorpIn.aaa_balance_beginning : runningAaa;
    let stockBasisAdditions = 0;
    let stockBasisReductions = 0;
    let stockBasisEnding: number = stockBasisBeginning;
    let aaaEnding: number = aaaBeginning;
    let excessDistributionCapGain = 0;
    let reasonableCompRatio = 0;

    if (setup.has_scorp) {
      // Employer FICA (6.2% up to SS wage base + 1.45% Medicare) + FUTA cap
      const ssTax = Math.min(scorpIn.officer_w2_wages, ssWageBase) * 0.062;
      const medTax = scorpIn.officer_w2_wages * 0.0145;
      const futa = scorpIn.officer_w2_wages > 0 ? 420 : 0;
      employerPayrollTaxes = round0(ssTax + medTax + futa);

      const dbpEntityDeduction =
        setup.has_dbp && dbpIn.dbp_status !== 'terminated'
          ? dbpIn.dbp_actual_contribution
          : 0;
      const employer401kDeduction = setup.has_401k_or_ira
        ? Math.min(dbpIn.qualified_plan_contribution * 0.5, 23500 * scale)
        : 0;

      const prePteOrdinaryIncome =
        yr.is_locked_actuals && scorpIn.locked_ordinary_income_override !== undefined
          ? scorpIn.locked_ordinary_income_override
          : round0(
              scorpIn.gross_receipts_revenue -
                scorpIn.operating_expenses -
                scorpIn.officer_w2_wages -
                employerPayrollTaxes -
                dbpEntityDeduction -
                employer401kDeduction
            );

      // State PTE entity-level taxes (deductible on 1120-S when enabled)
      if (setup.has_pte && scorpIn.pte_election_active && prePteOrdinaryIncome > 0) {
        for (const sf of yr.state_filings) {
          const rule = STATE_TAX_RULES[sf.state_code];
          if (sf.state_pte_elected && rule?.pteAvailable) {
            const apportioned = prePteOrdinaryIncome * sf.state_apportionment_factor;
            const pteAmt = round0(Math.max(0, apportioned * rule.pteRate));
            pteTaxPaidByState[sf.state_code] = pteAmt;
            pteTaxPaidTotal += pteAmt;
          }
        }
      }

      ordinaryIncome1120s =
        yr.is_locked_actuals && scorpIn.locked_ordinary_income_override !== undefined
          ? scorpIn.locked_ordinary_income_override
          : round0(prePteOrdinaryIncome - pteTaxPaidTotal);

      // Stock basis & AAA rollforward
      stockBasisAdditions = Math.max(0, ordinaryIncome1120s);
      const lossReduction = ordinaryIncome1120s < 0 ? Math.abs(ordinaryIncome1120s) : 0;
      const basisBeforeDist = stockBasisBeginning + stockBasisAdditions - lossReduction;
      if (scorpIn.scorp_distributions_total > Math.max(0, basisBeforeDist)) {
        excessDistributionCapGain = round0(
          scorpIn.scorp_distributions_total - Math.max(0, basisBeforeDist)
        );
      }
      stockBasisReductions = lossReduction + scorpIn.scorp_distributions_total;

      stockBasisEnding =
        yr.is_locked_actuals && scorpIn.locked_stock_basis_ending_override !== undefined
          ? scorpIn.locked_stock_basis_ending_override
          : round0(Math.max(0, basisBeforeDist - scorpIn.scorp_distributions_total));

      aaaEnding = round0(
        aaaBeginning + ordinaryIncome1120s - scorpIn.scorp_distributions_total
      );

      const denom = scorpIn.officer_w2_wages + Math.max(0, ordinaryIncome1120s);
      reasonableCompRatio = denom > 0 ? round2(scorpIn.officer_w2_wages / denom) : 0;

      runningStockBasis = stockBasisEnding;
      runningAaa = aaaEnding;
    }

    const scorpOut: SCorp1120SOutputs = {
      employer_payroll_taxes: employerPayrollTaxes,
      pte_tax_paid_by_state: pteTaxPaidByState,
      pte_tax_paid_total: pteTaxPaidTotal,
      ordinary_business_income_1120s: ordinaryIncome1120s,
      stock_basis_additions: stockBasisAdditions,
      stock_basis_reductions: stockBasisReductions,
      stock_basis_ending: stockBasisEnding,
      aaa_balance_ending: aaaEnding,
      excess_distribution_capital_gain: excessDistributionCapGain,
      reasonable_comp_ratio: reasonableCompRatio,
    };

    // ------------------------------------------------------------------
    // LAYER 2 & 3: Retirement & Household Form 1040 Layer
    // ------------------------------------------------------------------
    const f1040In = yr.form_1040;
    const effectiveK1Ordinary =
      setup.has_scorp && scorpIn.auto_sync_k1 && !yr.is_locked_actuals
        ? ordinaryIncome1120s
        : f1040In.schedule_k1_ordinary_income;

    const effectiveW2 =
      setup.has_scorp && scorpIn.auto_sync_k1 && !yr.is_locked_actuals
        ? Math.max(f1040In.w2_wages_total, scorpIn.officer_w2_wages)
        : f1040In.w2_wages_total;

    const effectiveLtcg =
      f1040In.long_term_capital_gain_loss + excessDistributionCapGain;
    const netCapitalGainLoss = Math.max(
      -3000,
      f1040In.short_term_capital_gain_loss + effectiveLtcg
    );

    const annuityTaxable = setup.has_annuity
      ? Math.max(f1040In.pensions_and_annuities_taxable, round0(dbpIn.annuity_payout_amount * 0.75))
      : f1040In.pensions_and_annuities_taxable;

    const incomeBeforeSS =
      effectiveW2 +
      f1040In.taxable_interest +
      f1040In.ordinary_dividends +
      netCapitalGainLoss +
      f1040In.schedule_1_other_income +
      effectiveK1Ordinary +
      f1040In.schedule_k1_other_items +
      f1040In.ira_distributions_taxable +
      annuityTaxable;

    const ssTaxable = computeSocialSecurityTaxable(
      f1040In.social_security_gross,
      incomeBeforeSS + f1040In.tax_exempt_interest,
      setup.filing_status
    );

    const totalIncome = round0(incomeBeforeSS + ssTaxable);

    // Above-the-line adjustments: self-employed / >2% S-Corp health insurance + employee pre-tax 401(k)/IRA adjustment
    const seHealthAdjustment = setup.has_scorp
      ? Math.min(f1040In.health_insurance_premiums, effectiveW2)
      : 0;
    const employeeRetirementAdj =
      setup.has_401k_or_ira && !setup.has_scorp
        ? Math.min(dbpIn.qualified_plan_contribution, round0(23500 * scale))
        : 0;
    const adjustmentsToIncome = round0(seHealthAdjustment + employeeRetirementAdj);
    const agi = round0(Math.max(0, totalIncome - adjustmentsToIncome));

    // Standard vs Itemized Deduction (including age 65+ add-ons)
    const baseStd = round0(BASE_STD_DEDUCTION_2025[setup.filing_status] * scale);
    const perSeniorAdd =
      setup.filing_status === 'married_filing_jointly'
        ? round0(1600 * scale)
        : round0(2000 * scale);
    const seniorCount =
      (primaryAge >= 65 ? 1 : 0) + (spouseAge !== null && spouseAge >= 65 ? 1 : 0);
    const standardDeduction = baseStd + seniorCount * perSeniorAdd;

    const deductionAmount =
      f1040In.deduction_method === 'itemized'
        ? Math.max(f1040In.itemized_deductions_input, 0)
        : standardDeduction;

    // QBI (Section 199A) Deduction
    const taxableBeforeQbi = Math.max(0, agi - deductionAmount);
    let qbiDeduction = 0;
    if (setup.has_scorp && effectiveK1Ordinary > 0) {
      const qbiBase = round0(effectiveK1Ordinary * 0.2);
      const qbiCapTaxable = round0(
        Math.max(0, taxableBeforeQbi - Math.max(0, effectiveLtcg) - f1040In.qualified_dividends) *
          0.2
      );
      const qbiThreshold = BASE_QBI_THRESHOLD_2025[setup.filing_status];
      const scaledStart = qbiThreshold.start * scale;
      const w2Limit = round0(scorpIn.officer_w2_wages * 0.5);

      if (taxableBeforeQbi <= scaledStart) {
        qbiDeduction = Math.min(qbiBase, qbiCapTaxable);
      } else {
        const phaseFraction = Math.min(
          1,
          (taxableBeforeQbi - scaledStart) / (qbiThreshold.phaseoutRange * scale)
        );
        const limitedQbi =
          qbiBase - phaseFraction * Math.max(0, qbiBase - w2Limit);
        qbiDeduction = round0(Math.min(Math.max(0, limitedQbi), qbiCapTaxable));
      }
    }

    const computedTaxableIncome = round0(Math.max(0, taxableBeforeQbi - qbiDeduction));
    const taxableIncome =
      yr.is_locked_actuals && f1040In.locked_taxable_income_override !== undefined
        ? f1040In.locked_taxable_income_override
        : computedTaxableIncome;

    // Split Ordinary vs Preferential (Qualified Dividends + Net LTCG)
    const preferentialIncome = Math.min(
      taxableIncome,
      Math.max(0, f1040In.qualified_dividends + Math.max(0, effectiveLtcg))
    );
    const ordinaryTaxableIncome = Math.max(0, taxableIncome - preferentialIncome);

    const ordinaryResult = computeProgressiveTax(
      ordinaryTaxableIncome,
      BASE_BRACKETS_2025[setup.filing_status],
      scale
    );

    // Preferential Capital Gains Tax stacked on top of ordinary taxable income
    const ltcgLimits = BASE_LTCG_2025[setup.filing_status];
    const zeroCap = round0(ltcgLimits.zeroUpTo * scale);
    const fifteenCap = round0(ltcgLimits.fifteenUpTo * scale);
    let prefTax = 0;
    if (preferentialIncome > 0) {
      const zeroRoom = Math.max(0, zeroCap - ordinaryTaxableIncome);
      const inZero = Math.min(preferentialIncome, zeroRoom);
      const afterZero = preferentialIncome - inZero;
      const fifteenRoom = Math.max(
        0,
        fifteenCap - Math.max(ordinaryTaxableIncome, zeroCap)
      );
      const inFifteen = Math.min(afterZero, fifteenRoom);
      const inTwenty = Math.max(0, afterZero - inFifteen);
      prefTax = round0(inFifteen * 0.15 + inTwenty * 0.2);
    }

    // Net Investment Income Tax (3.8% NIIT)
    const niitThreshold =
      setup.filing_status === 'married_filing_jointly'
        ? 250000
        : setup.filing_status === 'married_filing_separately'
        ? 125000
        : 200000;
    const netInvIncome = Math.max(
      0,
      f1040In.taxable_interest +
        f1040In.ordinary_dividends +
        Math.max(0, netCapitalGainLoss)
    );
    const niitTax =
      agi > niitThreshold
        ? round0(Math.min(netInvIncome, agi - niitThreshold) * 0.038)
        : 0;

    const federalIncomeTax =
      yr.is_locked_actuals && f1040In.locked_federal_tax_override !== undefined
        ? f1040In.locked_federal_tax_override
        : round0(ordinaryResult.tax + prefTax + niitTax);

    const effectiveTaxRate = agi > 0 ? round2((federalIncomeTax / agi) * 100) : 0;
    const marginalTaxRate = round2(ordinaryResult.marginalRate * 100);

    const irmaa = computeIrmaa(
      agi + f1040In.tax_exempt_interest,
      setup.filing_status,
      primaryAge,
      spouseAge,
      scale
    );

    const form1040Out: Form1040Outputs = {
      social_security_taxable: ssTaxable,
      total_income: totalIncome,
      adjustments_to_income: adjustmentsToIncome,
      adjusted_gross_income: agi,
      deduction_amount: deductionAmount,
      qualified_business_income_deduction: qbiDeduction,
      taxable_income: taxableIncome,
      ordinary_taxable_income: ordinaryTaxableIncome,
      preferential_income: preferentialIncome,
      federal_income_tax: federalIncomeTax,
      niit_tax: niitTax,
      marginal_tax_rate: marginalTaxRate,
      effective_tax_rate: effectiveTaxRate,
      irmaa_tier: irmaa.tier,
      irmaa_annual_surcharge: irmaa.annualSurcharge,
    };

    // ------------------------------------------------------------------
    // LAYER 4: Multi-State & Residency Layer
    // ------------------------------------------------------------------
    const stateOutputs: StateFilingOutputs[] = [];
    const activeStateFilings = setup.multi_state_active
      ? yr.state_filings
      : yr.state_filings.slice(0, 1);

    // First pass: calculate raw tax per state
    const preliminary = activeStateFilings.map((sf) => {
      const rule = STATE_TAX_RULES[sf.state_code] ?? {
        code: sf.state_code,
        name: sf.state_code,
        mode: 'flat' as const,
        flatRate: 0.045,
        stdDeduction: 15000,
        pteAvailable: false,
        pteRate: 0,
        scorpMinTax: 0,
        scorpEntityRate: 0,
      };

      // Apportioned / allocated income:
      // Residents tax 100% of AGI (with OSTC for non-resident states);
      // Part-year residents allocate by residency_day_or_income_ratio (or apportionment factor for K-1);
      // Non-residents tax only state-apportioned S-Corp/source income.
      let stateAllocatedIncome = 0;
      if (sf.residency_status === 'resident') {
        stateAllocatedIncome = agi;
      } else if (sf.residency_status === 'part_year_resident') {
        const ratio =
          sf.residency_day_or_income_ratio > 0
            ? sf.residency_day_or_income_ratio
            : sf.state_apportionment_factor;
        stateAllocatedIncome = round0(agi * ratio);
      } else {
        stateAllocatedIncome = round0(
          Math.max(0, effectiveK1Ordinary + effectiveW2 * 0.25) *
            sf.state_apportionment_factor
        );
      }

      const proratedStd =
        sf.residency_status === 'resident'
          ? round0(rule.stdDeduction * scale)
          : round0(
              rule.stdDeduction *
                scale *
                (sf.residency_day_or_income_ratio || sf.state_apportionment_factor)
            );
      const stateTaxable = round0(Math.max(0, stateAllocatedIncome - proratedStd));

      let rawPersonalTax = 0;
      if (rule.mode === 'flat' && rule.flatRate) {
        rawPersonalTax = round0(stateTaxable * rule.flatRate);
      } else if (rule.mode === 'progressive' && rule.brackets) {
        rawPersonalTax = computeProgressiveTax(stateTaxable, rule.brackets, scale).tax;
      }

      const ptePaid = pteTaxPaidByState[sf.state_code] ?? 0;
      // State PTE credit offsets personal state tax on the K-1 portion
      const pteCredit =
        setup.has_pte && sf.state_pte_elected ? Math.min(rawPersonalTax, ptePaid) : 0;

      // S-Corp entity-level minimum/franchise tax (e.g., CA 1.5% / $800 min)
      const entityStateTax = setup.has_scorp
        ? Math.max(
            rule.scorpMinTax,
            round0(
              Math.max(0, ordinaryIncome1120s) *
                sf.state_apportionment_factor *
                rule.scorpEntityRate
            )
          )
        : 0;

      return {
        sf,
        rule,
        stateAllocatedIncome,
        stateTaxable,
        rawPersonalTax,
        ptePaid,
        pteCredit,
        entityStateTax,
      };
    });

    // Second pass: Other-State Tax Credit (OSTC) for resident state paying tax to non-resident state
    const nonResidentTaxPaidTotal = preliminary
      .filter((p) => p.sf.residency_status === 'non_resident')
      .reduce((acc, p) => acc + p.rawPersonalTax, 0);

    for (const item of preliminary) {
      let ostcLimitation = 0;
      let ostcClaimed = 0;
      if (item.sf.residency_status === 'resident' && nonResidentTaxPaidTotal > 0) {
        const nonResRatio = preliminary
          .filter((p) => p.sf.residency_status === 'non_resident')
          .reduce((acc, p) => acc + p.sf.state_apportionment_factor, 0);
        ostcLimitation = round0(item.rawPersonalTax * Math.min(1, nonResRatio));
        ostcClaimed = Math.min(nonResidentTaxPaidTotal, ostcLimitation);
      }

      const finalPersonalStateTax = Math.max(
        0,
        item.rawPersonalTax -
          item.pteCredit -
          ostcClaimed -
          item.sf.other_state_credits_claimed
      );

      const totalStateLiability = round0(finalPersonalStateTax + item.entityStateTax);
      const netDueOrRefund = round0(
        totalStateLiability - item.sf.state_tax_withholding_and_estimates
      );

      stateOutputs.push({
        ...item.sf,
        state_apportioned_income: item.stateAllocatedIncome,
        state_taxable_income: item.stateTaxable,
        state_income_tax_liability: totalStateLiability,
        state_pte_payment_amount: item.ptePaid,
        state_pte_credit_or_exclusion_amount: item.pteCredit,
        credit_for_taxes_paid_to_other_states: ostcClaimed,
        other_state_tax_credit_limitation: ostcLimitation,
        state_net_tax_due_or_refund: netDueOrRefund,
      });
    }

    const totalStateTax = stateOutputs.reduce(
      (sum, s) => sum + s.state_income_tax_liability,
      0
    );
    const totalEntityAndPayrollTax = round0(employerPayrollTaxes + pteTaxPaidTotal);
    const totalAllInTax = round0(
      federalIncomeTax + totalStateTax + totalEntityAndPayrollTax
    );
    const allInEffectiveRate =
      agi > 0 ? round2((totalAllInTax / agi) * 100) : 0;

    // Net household cash flow estimate (W-2 + distributions + investment/retirement inflows - all-in tax - retirement outflows - health premiums)
    const cashInflows =
      effectiveW2 +
      (setup.has_scorp ? scorpIn.scorp_distributions_total : 0) +
      f1040In.taxable_interest +
      f1040In.tax_exempt_interest +
      f1040In.ordinary_dividends +
      Math.max(0, f1040In.short_term_capital_gain_loss + f1040In.long_term_capital_gain_loss) +
      f1040In.ira_distributions_gross +
      f1040In.pensions_and_annuities_gross +
      f1040In.social_security_gross;

    const estimatedNetCashFlow = round0(
      cashInflows -
        federalIncomeTax -
        totalStateTax -
        f1040In.health_insurance_premiums -
        (setup.has_401k_or_ira ? dbpIn.qualified_plan_contribution * 0.5 : 0)
    );

    results.push({
      tax_year: yr.tax_year,
      record_mode: yr.record_mode,
      is_locked_actuals: yr.is_locked_actuals,
      primary_age: primaryAge,
      spouse_age: spouseAge,
      form_1040_in: {
        ...f1040In,
        w2_wages_total: effectiveW2,
        schedule_k1_ordinary_income: effectiveK1Ordinary,
      },
      form_1040_out: form1040Out,
      scorp_in: {
        ...scorpIn,
        stock_basis_beginning: stockBasisBeginning,
        aaa_balance_beginning: aaaBeginning,
      },
      scorp_out: scorpOut,
      dbp_in: dbpIn,
      state_filings_out: stateOutputs,
      total_state_tax: totalStateTax,
      total_entity_and_payroll_tax: totalEntityAndPayrollTax,
      total_all_in_tax: totalAllInTax,
      all_in_effective_rate: allInEffectiveRate,
      estimated_net_cash_flow: estimatedNetCashFlow,
    });
  }

  return results;
}

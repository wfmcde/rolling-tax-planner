import ExcelJS from 'exceljs';
import type {
  ComputedTaxYear,
  FilingStatus,
  PnlBalanceSheetState,
  SetupConfig,
  TaxYearRecord,
} from '../types/tax';
import { DEFAULT_PROFILE_SEED, isDefaultSeedSetup } from '../data/profiles';
import { getPersonNames } from '../engine/scheduleCatalog';
import { getSetupBusinessIdentity } from './setupHelpers';

export interface ShadowReturnExportParams {
  setup: SetupConfig;
  years: TaxYearRecord[];
  computed: ComputedTaxYear[];
  selectedYear: number;
  pnlState?: PnlBalanceSheetState;
}

interface BrandingConfig {
  creator: string;
  title: string;
  filenamePrefix: string;
  eyebrow: string;
  headerLeft: string;
  headerRight: string;
  disclaimerEntity: string;
  disclaimerTaxpayers: string;
  isDefaultSeed: boolean;
}

interface YearInputColumn {
  year: number;
  primaryOwnershipPct: number;
  spouseOwnershipPct: number;
  caRevenue: number;
  azRevenue: number;
  otherRevenue: number;
  scorpInterest: number;
  officerW2: number;
  staffW2: number;
  rents: number;
  payrollTaxes: number;
  caEntityStateTax: number;
  dbpContribution: number;
  er401kMatch: number;
  sehiMedicare: number;
  advertising: number;
  otherOpex: number;
  nondeductibleMeals: number;
  caDeprAdj: number;
  caConformityAdj: number;
  caPteActive: 0 | 1;
  azPteActive: 0 | 1;
  caSb132Adj: number;
  begCash: number;
  endCash: number;
  otherAssetsEoy: number;
  apCcEoy: number;
  pensionPayableEoy: number;
  paidInCapital: number;
  begAaa: number;
  capitalContributions: number;
  distributions: number;
  primaryBegStockBasis: number;
  spouseBegStockBasis: number;
  caBegStockBasis: number;
  ca100sEstPaid: number;
  primaryEe401k: number;
  spouseEe401k: number;
  otherW2Wages: number;
  personalInterest: number;
  taxExemptInterest: number;
  ordinaryDividends: number;
  qualifiedDividends: number;
  iraTaxable: number;
  pensionsTaxable: number;
  ssGross: number;
  brokerageCapGain: number;
  otherSch1Adj: number;
  itemizedDeductions: number;
  seniors65PlusCount: number;
  ssTaxable: number;
  fedWithholding: number;
  fedEstimates: number;
  caResidencyFactor: number;
  caWithholdingEst: number;
  azWithholdingEst: number;
}

interface YearTaxTableParams {
  year: number;
  fedBrackets: number[];
  fedRates: number[];
  fedStdDed: number;
  fedSeniorAddon: number;
  seniorDedMax: number;
  seniorPhaseoutThreshold: number;
  seniorPhaseoutRate: number;
  qbiRate: number;
  ltcg0Ceiling: number;
  ltcg15Ceiling: number;
  niitThreshold: number;
  niitRate: number;
  azFlatRate: number;
  azStdDed: number;
  azPteRate: number;
  az120sMinTax: number;
  ca100sRate: number;
  ca100sMinTax: number;
  caPteRate: number;
  caStdDed: number;
  caExemptionCredit: number;
  caBaseExemptionCount: number;
  caMentalHealthThreshold: number;
  caMentalHealthRate: number;
  caBrackets: number[];
  caRates: number[];
}

interface EvaluatedYear {
  grossReceipts: number;
  caPteAmt: number;
  azPteAmt: number;
  line12Taxes: number;
  totalDeductions: number;
  obi: number;
  scorpInterest: number;
  nondedMeals: number;
  distributions: number;
  totalAssets: number;
  retainedEarningsPlug: number;
  totalLiabEq: number;
  bookNetIncome: number;
  m1FedIncome: number;
  aaaSubtotal: number;
  endingAaa: number;
  pObi: number;
  pInt: number;
  pNonded: number;
  pDist: number;
  sObi: number;
  sInt: number;
  sNonded: number;
  sDist: number;
  pCapContrib: number;
  pIncAdd: number;
  pBasisBeforeDist: number;
  pExcessGain: number;
  pBasisAfterDist: number;
  pReduct: number;
  pEndBasis: number;
  sCapContrib: number;
  sIncAdd: number;
  sBasisBeforeDist: number;
  sExcessGain: number;
  sBasisAfterDist: number;
  sReduct: number;
  sEndBasis: number;
  combEndBasis: number;
  combExcessGain: number;
  azSalesRatio: number;
  azApportionedIncome: number;
  az120sMin: number;
  az120sTotal: number;
  caSalesRatio: number;
  caTaxAddback: number;
  ca100sNetIncome: number;
  ca100sCalcTax: number;
  ca100sFranchiseTax: number;
  ca100sBalDue: number;
  caK1Adj: number;
  ca100sTotalTax: number;
  w2Box1: number;
  line2bInt: number;
  schD: number;
  totalIncome: number;
  sch1Adj: number;
  agi: number;
  stdOrItemized: number;
  seniorMax: number;
  seniorExcess: number;
  seniorReduction: number;
  seniorAllowed: number;
  qbiBase: number;
  qbi20: number;
  tiBeforeQbi: number;
  netCapGain: number;
  qbiCap20: number;
  qbiAllowed: number;
  taxableIncome: number;
  prefIncome: number;
  ordTaxableIncome: number;
  irsLookupBase: number;
  ordTax: number;
  pref0: number;
  pref15: number;
  pref20: number;
  prefTax: number;
  line16Tax: number;
  niit: number;
  totalFedTax: number;
  fedPayments: number;
  fedBalDue: number;
  azRatio: number;
  azProratedStdDed: number;
  azTaxable: number;
  azGrossTax: number;
  azForm309Credit: number;
  azPteCredit: number;
  azNetTax: number;
  azBalDue: number;
  caAdd: number;
  caOtherSub: number;
  caSchCaB: number;
  caAgi: number;
  caDed: number;
  caTaxable: number;
  caProgTax: number;
  caMentalHealth: number;
  caExempCredits: number;
  caFullYearTax: number;
  caTaxBeforePte: number;
  caPteCredit: number;
  caNetTax: number;
  caBalDue: number;
  caPteCarryforward: number;
}

// ---------------------------------------------------------------------------
// Palette & Formatting Constants
// ---------------------------------------------------------------------------
const COLORS = {
  navy: '0F243E',
  slateNavy: '1B365D',
  gold: 'D4A843',
  white: 'FFFFFF',
  subtitleText: 'CBD5E1',
  sectionBg: 'E8EEF5',
  sectionText: '0F243E',
  headerBg: '1E3A5F',
  zebraBg: 'F8FAFC',
  totalBg: 'EEF2F7',
  inputBg: 'EFF6FF',
  inputText: '1D4ED8',
  borderLight: 'CBD5E1',
  borderDark: '64748B',
  greenBg: 'DCFCE7',
  greenText: '166534',
  redBg: 'FEE2E2',
  redText: '991B1B',
  amberBg: 'FEF3C7',
  amberText: '92400E',
  creamBg: 'FFFBEB',
  stoneText: '44403C',
  mutedText: '64748B',
};

const FMT = {
  currency: '$#,##0;($#,##0);"-"',
  percent1: '0.0%',
  percent2: '0.00%',
  integer: '#,##0',
};

const FONT_NAME = 'Calibri';

const TAB_NAMES = [
  'Dashboard & Variance',
  'Inputs',
  '1120-S (Fed S-Corp)',
  'K-1 & Form 7203',
  'AZ 120S & CA 100S',
  '1040 (Fed Personal)',
  'AZ 140NR & CA 540',
  'Tax Tables',
] as const;

function r0(n: number): number {
  return Math.round(n);
}

function getBranding(setup: SetupConfig): BrandingConfig {
  if (isDefaultSeedSetup(setup)) {
    const b = DEFAULT_PROFILE_SEED.shadow_return_seed.branding;
    return {
      creator: b.creator,
      title: b.title,
      filenamePrefix: b.filename_prefix,
      eyebrow: b.eyebrow,
      headerLeft: b.header_left,
      headerRight: b.header_right,
      disclaimerEntity: b.disclaimer_entity,
      disclaimerTaxpayers: b.disclaimer_taxpayers,
      isDefaultSeed: true,
    };
  }
  const biz = getSetupBusinessIdentity(setup);
  const { primaryName: primary, spouseName: spouse } = getPersonNames(setup);
  const taxpayers =
    setup.filing_status === 'married_filing_jointly' && spouse
      ? `${primary} & ${spouse}`
      : primary;
  const entityLabel = biz.businessName || taxpayers || 'Tax Planning Household';
  const websiteSuffix = biz.businessWebsite ? `  |  ${biz.businessWebsite}` : '';
  const safePrefix =
    entityLabel
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 28) || 'Tax_Planner';
  return {
    creator: entityLabel,
    title: `${entityLabel} Shadow Tax Return & CPA Verification Suite`,
    filenamePrefix: safePrefix,
    eyebrow: `${entityLabel.toUpperCase()}  |  EXECUTIVE TAX & FINANCIAL PLANNING${websiteSuffix}`,
    headerLeft: entityLabel,
    headerRight: `Executive Tax & Financial Planning${biz.businessWebsite ? ` | ${biz.businessWebsite}` : ''}`,
    disclaimerEntity: entityLabel,
    disclaimerTaxpayers: taxpayers,
    isDefaultSeed: false,
  };
}

export function getShadowReturnFilename(setup: SetupConfig, baseYear: number, selectedYear: number): string {
  const b = getBranding(setup);
  return `${b.filenamePrefix}_Shadow_Tax_Return_${baseYear}_${selectedYear}.xlsx`;
}

// ---------------------------------------------------------------------------
// Tax Table Builder (Statutory Parameters, Inflation-Indexed per Setup)
// ---------------------------------------------------------------------------
function getTaxTableParams(
  year: number,
  filingStatus: FilingStatus,
  inflationRate: number
): YearTaxTableParams {
  const isMfj = filingStatus === 'married_filing_jointly';
  const isHoh = filingStatus === 'head_of_household';
  const yrsFrom2025 = Math.max(0, year - 2025);
  const factor = Math.pow(1 + (Number.isFinite(inflationRate) ? inflationRate : 0.025), yrsFrom2025);
  const idx = (base: number, step = 50): number =>
    yrsFrom2025 === 0 ? base : Math.round((base * factor) / step) * step;

  // 2025 statutory Federal ordinary brackets
  const fedBase2025 = isMfj
    ? [0, 23850, 96950, 206700, 394600, 501050, 751600]
    : isHoh
    ? [0, 17000, 64850, 103350, 197300, 250500, 626350]
    : [0, 11925, 48475, 103350, 197300, 250525, 626350];

  const fedStdBase = isMfj ? 31500 : isHoh ? 23625 : 15750;
  const fedSeniorAddonBase = isMfj ? 1600 : 2000;
  const ltcg0Base = isMfj ? 96700 : isHoh ? 64750 : 48350;
  const ltcg15Base = isMfj ? 600050 : isHoh ? 566700 : 533400;
  const niitThreshold = isMfj ? 250000 : filingStatus === 'married_filing_separately' ? 125000 : 200000;

  // 2025 statutory CA brackets
  const caBase2025 = isMfj
    ? [0, 22158, 52528, 82904, 115084, 145448, 742954, 891542, 1485906]
    : isHoh
    ? [0, 22173, 52530, 67716, 83805, 98990, 505208, 606251, 1010417]
    : [0, 11079, 26264, 41452, 57542, 72724, 371477, 445771, 742953];

  const caStdBase = isMfj ? 11412 : 5706;
  const azStdBase = isMfj ? 31500 : isHoh ? 23625 : 15750;

  return {
    year,
    fedBrackets: fedBase2025.map((b) => (b === 0 ? 0 : idx(b, 50))),
    fedRates: [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
    fedStdDed: idx(fedStdBase, 50),
    fedSeniorAddon: idx(fedSeniorAddonBase, 50),
    seniorDedMax: year <= 2028 ? 6000 : 0,
    seniorPhaseoutThreshold: isMfj ? 150000 : 75000,
    seniorPhaseoutRate: 0.06,
    qbiRate: 0.2,
    ltcg0Ceiling: idx(ltcg0Base, 50),
    ltcg15Ceiling: idx(ltcg15Base, 50),
    niitThreshold,
    niitRate: 0.038,
    azFlatRate: 0.025,
    azStdDed: idx(azStdBase, 50),
    azPteRate: 0.0298,
    az120sMinTax: 50,
    ca100sRate: 0.015,
    ca100sMinTax: 800,
    caPteRate: 0.093,
    caStdDed: idx(caStdBase, 10),
    caExemptionCredit: idx(153, 1),
    caBaseExemptionCount: isMfj ? 2 : 1,
    caMentalHealthThreshold: 1000000,
    caMentalHealthRate: 0.01,
    caBrackets: caBase2025.map((b) => (b === 0 ? 0 : idx(b, 10))),
    caRates: [0.01, 0.02, 0.04, 0.06, 0.08, 0.093, 0.103, 0.113, 0.123],
  };
}

// ---------------------------------------------------------------------------
// Input Column Extraction (Base Year vs Selected Year)
// ---------------------------------------------------------------------------
function extractYearInputs(
  setup: SetupConfig,
  rec: TaxYearRecord,
  comp: ComputedTaxYear,
  prevComp: ComputedTaxYear | undefined,
  isBaseCol: boolean,
  pnlState?: PnlBalanceSheetState
): YearInputColumn {
  const isDefault = isDefaultSeedSetup(setup);
  const seed = DEFAULT_PROFILE_SEED.shadow_return_seed;

  // Base year for default seed uses exact 2025 filed return seed
  if (isBaseCol && isDefault && rec.tax_year === 2025) {
    const f = seed.filed_2025;
    return {
      year: 2025,
      primaryOwnershipPct: f.primary_ownership_pct,
      spouseOwnershipPct: f.spouse_ownership_pct,
      caRevenue: f.ca_revenue,
      azRevenue: f.az_revenue,
      otherRevenue: f.other_revenue,
      scorpInterest: f.scorp_interest,
      officerW2: f.officer_w2,
      staffW2: f.staff_w2,
      rents: f.rents,
      payrollTaxes: f.payroll_taxes,
      caEntityStateTax: f.ca_entity_state_tax,
      dbpContribution: f.dbp_contribution,
      er401kMatch: f.er_401k_match,
      sehiMedicare: f.sehi_medicare,
      advertising: f.advertising,
      otherOpex: f.other_opex,
      nondeductibleMeals: f.nondeductible_meals,
      caDeprAdj: f.ca_depr_adj,
      caConformityAdj: f.ca_conformity_adj,
      caPteActive: 0,
      azPteActive: 0,
      caSb132Adj: 0,
      begCash: f.beg_cash,
      endCash: f.end_cash,
      otherAssetsEoy: f.other_assets_eoy,
      apCcEoy: f.ap_cc_eoy,
      pensionPayableEoy: f.pension_payable_eoy,
      paidInCapital: f.paid_in_capital,
      begAaa: f.beg_aaa,
      capitalContributions: f.capital_contributions,
      distributions: f.distributions,
      primaryBegStockBasis: f.primary_beg_stock_basis,
      spouseBegStockBasis: f.spouse_beg_stock_basis,
      caBegStockBasis: f.ca_beg_stock_basis,
      ca100sEstPaid: f.ca_100s_est_paid,
      primaryEe401k: f.primary_ee_401k,
      spouseEe401k: f.spouse_ee_401k,
      otherW2Wages: f.other_w2_wages,
      personalInterest: f.personal_interest,
      taxExemptInterest: f.tax_exempt_interest,
      ordinaryDividends: f.ordinary_dividends,
      qualifiedDividends: f.qualified_dividends,
      iraTaxable: f.ira_taxable,
      pensionsTaxable: f.pensions_taxable,
      ssGross: f.ss_gross,
      brokerageCapGain: f.brokerage_cap_gain,
      otherSch1Adj: f.other_sch1_adj,
      itemizedDeductions: f.itemized_deductions,
      seniors65PlusCount: f.seniors_65_plus_count,
      ssTaxable: f.ss_taxable,
      fedWithholding: f.fed_withholding,
      fedEstimates: f.fed_estimates,
      caResidencyFactor: f.ca_residency_factor,
      caWithholdingEst: f.ca_withholding_est,
      azWithholdingEst: f.az_withholding_est,
    };
  }

  const scIn = comp.scorp_in;
  const scOut = comp.scorp_out;
  const f1040In = comp.form_1040_in;
  const f1040Out = comp.form_1040_out;
  const dbpIn = comp.dbp_in;

  const isMfj = setup.filing_status === 'married_filing_jointly';
  const rawP = scIn.bill_ownership_pct ?? (isMfj ? 51 : 100);
  const rawS = scIn.debra_ownership_pct ?? (isMfj ? 100 - rawP : 0);
  const pctSum = rawP + rawS || 100;
  const primaryOwnershipPct = rawP / pctSum;
  const spouseOwnershipPct = rawS / pctSum;

  const grossReceipts = setup.has_scorp ? r0(scIn.gross_receipts_revenue) : 0;
  const caFiling = comp.state_filings_out.find((s) => s.state_code === 'CA');
  const azFiling = comp.state_filings_out.find((s) => s.state_code === 'AZ');

  // Apportioned CA & AZ revenue
  let caRevenue = 0;
  let azRevenue = 0;
  if (setup.has_scorp && grossReceipts > 0) {
    if (scIn.ca_revenue > 0 || scIn.az_revenue > 0) {
      caRevenue = r0(scIn.ca_revenue);
      azRevenue = r0(scIn.az_revenue);
    } else {
      const caFactor = caFiling?.state_apportionment_factor ?? 0;
      const azFactor = azFiling?.state_apportionment_factor ?? 0;
      caRevenue = r0(grossReceipts * caFactor);
      azRevenue = r0(grossReceipts * azFactor);
    }
  }
  const otherRevenue = Math.max(0, grossReceipts - caRevenue - azRevenue);
  const scorpInterest = setup.has_scorp ? r0(scIn.schedule_k_interest_income ?? 0) : 0;

  // 1120-S Deductions (exact parity with taxEngine)
  const useDetailed = Boolean(scIn.use_detailed_1120s_deductions);
  const officerW2 = setup.has_scorp
    ? r0(useDetailed ? (scIn.compensation_of_officers ?? scIn.bill_w2_wages) : scIn.bill_w2_wages)
    : 0;
  const staffW2 = setup.has_scorp
    ? r0(useDetailed ? (scIn.salaries_and_wages ?? scIn.debra_w2_wages) : scIn.debra_w2_wages)
    : 0;

  const matchingPnl = pnlState && pnlState.projection_year === rec.tax_year ? pnlState : undefined;
  const effOpEx = setup.has_scorp ? r0(scOut.effective_operating_expenses) : 0;

  let rents = 0;
  let caEntityStateTax = 0;
  let advertising = 0;
  let otherOpex = effOpEx;

  if (setup.has_scorp) {
    if (useDetailed) {
      rents = r0(scIn.rents ?? 0);
      caEntityStateTax = r0(scIn.ftb_state_taxes_input ?? 0);
      advertising = r0(scIn.advertising ?? 0);
      otherOpex = r0(scIn.other_deductions ?? 0);
    } else if (matchingPnl) {
      const pnlRents = r0((matchingPnl.pnl.rents?.ytd ?? 0) + (matchingPnl.pnl.rents?.remaining ?? 0));
      const pnlFtb = r0((matchingPnl.pnl.ca_ftb_tax?.ytd ?? 0) + (matchingPnl.pnl.ca_ftb_tax?.remaining ?? 0));
      if (pnlRents + pnlFtb <= effOpEx) {
        rents = pnlRents;
        caEntityStateTax = pnlFtb;
        otherOpex = effOpEx - rents - caEntityStateTax;
      }
    }
  }

  const payrollTaxes = setup.has_scorp ? r0(scOut.employer_payroll_taxes) : 0;
  const dbpContribution = setup.has_scorp && setup.has_dbp ? r0(dbpIn.dbp_actual_contribution) : 0;
  const er401kMatch = setup.has_scorp ? r0(f1040Out.employer_401k_total) : 0;
  const sehiMedicare = setup.has_scorp ? r0(f1040Out.sehi_medicare_premiums_effective) : 0;
  const nondeductibleMeals = setup.has_scorp ? r0(scIn.schedule_k_nondeductible_expenses ?? 0) : 0;

  // PTE toggles driven strictly by active app state
  const pteGlobal = Boolean(setup.has_pte && scIn.pte_election_active);
  const caPteActive: 0 | 1 = pteGlobal && caFiling?.state_pte_elected ? 1 : 0;
  const azPteActive: 0 | 1 = pteGlobal && azFiling?.state_pte_elected ? 1 : 0;

  // Default 2026 overrides (strictly isolated to DEFAULT_PROFILE_SEED)
  const isDefault2026 = isDefault && rec.tax_year === 2026;
  const caDeprAdj = isDefault2026 ? seed.projected_2026_overrides.ca_depr_disposal_adj : 0;
  const caConformityAdj = r0(caFiling?.state_conformity_adjustment ?? 0);

  // Balance Sheet & Basis
  const bs = matchingPnl?.balance_sheet;
  const begCash = r0(bs?.operating_cash_beg ?? 0);
  const endCash = r0(bs?.operating_cash_ye_override ?? bs?.operating_cash_ytd ?? begCash);
  const apCcEoy = r0(bs?.cc_ap_ye ?? 0);
  const pensionPayableEoy = r0(bs?.pension_payable_ye ?? 0);
  const begAaa = isDefault2026
    ? seed.projected_2026_overrides.beg_aaa
    : r0(prevComp ? prevComp.scorp_out.aaa_balance_ending : scIn.aaa_balance_beginning);

  const begBasisTotal = r0(prevComp ? prevComp.scorp_out.stock_basis_ending : scIn.stock_basis_beginning);
  const primaryBegStockBasis =
    scIn.bill_stock_basis_beginning !== undefined && !prevComp
      ? r0(scIn.bill_stock_basis_beginning)
      : r0(begBasisTotal * primaryOwnershipPct);
  const spouseBegStockBasis =
    scIn.debra_stock_basis_beginning !== undefined && !prevComp
      ? r0(scIn.debra_stock_basis_beginning)
      : Math.max(0, begBasisTotal - primaryBegStockBasis);

  const ca100sEstPaid = isDefault2026
    ? seed.projected_2026_overrides.ca_100s_est_paid
    : caRevenue > 0 || (caFiling?.residency_day_or_income_ratio ?? 0) > 0
    ? r0(scIn.ca_franchise_tax_input ?? 800)
    : 0;

  // Personal 1040 Inputs
  const primaryEe401k = r0(f1040Out.employee_401k_bill);
  const spouseEe401k = r0(f1040Out.employee_401k_debra);
  const otherW2Wages = setup.has_scorp ? 0 : r0(f1040In.w2_wages_total);
  const personalInterest = Math.max(0, r0(f1040In.taxable_interest - scorpInterest));
  const brokerageCapGain = r0(
    f1040In.short_term_capital_gain_loss +
      f1040In.long_term_capital_gain_loss -
      (f1040In.schedule_d_includes_excess_gain ? scOut.excess_distribution_capital_gain : 0)
  );

  const pAge = comp.primary_age ?? 0;
  const sAge = comp.spouse_age ?? 0;
  const seniors65PlusCount = (pAge >= 65 ? 1 : 0) + (isMfj && sAge >= 65 ? 1 : 0);

  const caResidencyFactor = caFiling
    ? caFiling.residency_status === 'resident'
      ? 1
      : caFiling.residency_status === 'part_year_resident'
      ? caFiling.residency_day_or_income_ratio
      : caFiling.state_apportionment_factor
    : 0;

  return {
    year: rec.tax_year,
    primaryOwnershipPct,
    spouseOwnershipPct,
    caRevenue,
    azRevenue,
    otherRevenue,
    scorpInterest,
    officerW2,
    staffW2,
    rents,
    payrollTaxes,
    caEntityStateTax,
    dbpContribution,
    er401kMatch,
    sehiMedicare,
    advertising,
    otherOpex,
    nondeductibleMeals,
    caDeprAdj,
    caConformityAdj,
    caPteActive,
    azPteActive,
    caSb132Adj: 0,
    begCash,
    endCash,
    otherAssetsEoy: 0,
    apCcEoy,
    pensionPayableEoy,
    paidInCapital: setup.has_scorp ? 1000 : 0,
    begAaa,
    capitalContributions: setup.has_scorp ? r0(scIn.capital_contributions) : 0,
    distributions: setup.has_scorp ? r0(scIn.scorp_distributions_total) : 0,
    primaryBegStockBasis,
    spouseBegStockBasis,
    caBegStockBasis: primaryBegStockBasis + spouseBegStockBasis,
    ca100sEstPaid,
    primaryEe401k,
    spouseEe401k,
    otherW2Wages,
    personalInterest,
    taxExemptInterest: r0(f1040In.tax_exempt_interest),
    ordinaryDividends: r0(f1040In.ordinary_dividends),
    qualifiedDividends: r0(f1040In.qualified_dividends),
    iraTaxable: r0(f1040In.ira_distributions_taxable),
    pensionsTaxable: r0(f1040In.pensions_and_annuities_taxable),
    ssGross: r0(f1040Out.social_security_gross_effective),
    brokerageCapGain,
    otherSch1Adj: r0(f1040In.schedule_1_adjustments_input ?? 0),
    itemizedDeductions: f1040In.deduction_method === 'itemized' ? r0(f1040In.itemized_deductions_input) : 0,
    seniors65PlusCount,
    ssTaxable: r0(f1040Out.social_security_taxable),
    fedWithholding: 0,
    fedEstimates: 0,
    caResidencyFactor,
    caWithholdingEst: r0(caFiling?.state_tax_withholding_and_estimates ?? 0),
    azWithholdingEst: r0(azFiling?.state_tax_withholding_and_estimates ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Exact JS Formula Mirror (populates cached `result` on every Excel formula)
// ---------------------------------------------------------------------------
function progressiveTax(income: number, brackets: number[], rates: number[]): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const lo = brackets[i];
    const hi = i + 1 < brackets.length ? brackets[i + 1] : Infinity;
    if (income > lo) {
      tax += (Math.min(income, hi) - lo) * rates[i];
    }
  }
  return r0(tax);
}

function evaluateYear(inp: YearInputColumn, tbl: YearTaxTableParams): EvaluatedYear {
  const grossReceipts = inp.caRevenue + inp.azRevenue + inp.otherRevenue;
  const prePteDed =
    inp.officerW2 +
    inp.staffW2 +
    inp.rents +
    inp.payrollTaxes +
    inp.caEntityStateTax +
    inp.dbpContribution +
    inp.er401kMatch +
    inp.sehiMedicare +
    inp.advertising +
    inp.otherOpex;
  const prePteObi = grossReceipts - prePteDed;
  const caSalesRatio = grossReceipts > 0 ? inp.caRevenue / grossReceipts : 0;
  const azSalesRatio = grossReceipts > 0 ? inp.azRevenue / grossReceipts : 0;
  const caPteAmt = inp.caPteActive === 1 ? r0(Math.max(0, prePteObi * caSalesRatio) * tbl.caPteRate) : 0;
  const azPteAmt = inp.azPteActive === 1 ? r0(Math.max(0, prePteObi * azSalesRatio) * tbl.azPteRate) : 0;
  const line12Taxes = inp.payrollTaxes + inp.caEntityStateTax + caPteAmt + azPteAmt;
  const totalDeductions = prePteDed + caPteAmt + azPteAmt;
  const obi = grossReceipts - totalDeductions;

  const totalAssets = inp.endCash + inp.otherAssetsEoy;
  const retainedEarningsPlug = totalAssets - inp.apCcEoy - inp.pensionPayableEoy - inp.paidInCapital;
  const totalLiabEq = inp.apCcEoy + inp.pensionPayableEoy + inp.paidInCapital + retainedEarningsPlug;
  const bookNetIncome = obi + inp.scorpInterest - inp.nondeductibleMeals;
  const m1FedIncome = bookNetIncome + inp.nondeductibleMeals;
  const aaaSubtotal = inp.begAaa + obi + inp.scorpInterest - inp.nondeductibleMeals;
  const endingAaa = aaaSubtotal - inp.distributions;

  // K-1 & Form 7203
  const pObi = r0(obi * inp.primaryOwnershipPct);
  const pInt = r0(inp.scorpInterest * inp.primaryOwnershipPct);
  const pNonded = r0(inp.nondeductibleMeals * inp.primaryOwnershipPct);
  const pDist = r0(inp.distributions * inp.primaryOwnershipPct);
  const sObi = obi - pObi;
  const sInt = inp.scorpInterest - pInt;
  const sNonded = inp.nondeductibleMeals - pNonded;
  const sDist = inp.distributions - pDist;

  const pCapContrib = r0(inp.capitalContributions * inp.primaryOwnershipPct);
  const pIncAdd = Math.max(0, pObi) + pInt;
  const pBasisBeforeDist = inp.primaryBegStockBasis + pCapContrib + pIncAdd;
  const pExcessGain = Math.max(0, pDist - pBasisBeforeDist);
  const pBasisAfterDist = Math.max(0, pBasisBeforeDist - pDist);
  const pReduct = pNonded + Math.abs(Math.min(0, pObi));
  const pEndBasis = Math.max(0, pBasisAfterDist - pReduct);

  const sCapContrib = inp.capitalContributions - pCapContrib;
  const sIncAdd = Math.max(0, sObi) + sInt;
  const sBasisBeforeDist = inp.spouseBegStockBasis + sCapContrib + sIncAdd;
  const sExcessGain = Math.max(0, sDist - sBasisBeforeDist);
  const sBasisAfterDist = Math.max(0, sBasisBeforeDist - sDist);
  const sReduct = sNonded + Math.abs(Math.min(0, sObi));
  const sEndBasis = Math.max(0, sBasisAfterDist - sReduct);

  const combEndBasis = pEndBasis + sEndBasis;
  const combExcessGain = pExcessGain + sExcessGain;

  // AZ 120S & CA 100S
  const azApportionedIncome = r0(obi * azSalesRatio);
  const az120sMin = inp.azRevenue > 0 ? tbl.az120sMinTax : 0;
  const az120sTotal = az120sMin + azPteAmt;

  const caTaxAddback = inp.caEntityStateTax + caPteAmt;
  const ca100sNetIncome = r0(Math.max(0, (obi + inp.caDeprAdj) * caSalesRatio));
  const ca100sCalcTax = r0(ca100sNetIncome * tbl.ca100sRate);
  const ca100sFranchiseTax =
    inp.caRevenue > 0 || inp.caResidencyFactor > 0 ? Math.max(tbl.ca100sMinTax, ca100sCalcTax) : 0;
  const ca100sBalDue = ca100sFranchiseTax - inp.ca100sEstPaid;
  const caK1Adj = inp.caDeprAdj;
  const ca100sTotalTax = ca100sFranchiseTax + caPteAmt;

  // 1040 Federal Personal
  const w2Box1 =
    Math.max(0, inp.officerW2 - inp.primaryEe401k) +
    Math.max(0, inp.staffW2 - inp.spouseEe401k) +
    inp.otherW2Wages +
    inp.sehiMedicare;
  const line2bInt = inp.personalInterest + inp.scorpInterest;
  const schD = inp.brokerageCapGain + combExcessGain;
  const totalIncome =
    w2Box1 +
    line2bInt +
    inp.ordinaryDividends +
    inp.iraTaxable +
    inp.pensionsTaxable +
    inp.ssTaxable +
    schD +
    obi;
  const sch1Adj = inp.otherSch1Adj + inp.sehiMedicare;
  const agi = totalIncome - sch1Adj;

  const stdOrItemized = Math.max(
    tbl.fedStdDed + inp.seniors65PlusCount * tbl.fedSeniorAddon,
    inp.itemizedDeductions
  );
  const seniorMax = inp.seniors65PlusCount * tbl.seniorDedMax;
  const seniorExcess = Math.max(0, agi - tbl.seniorPhaseoutThreshold);
  const seniorReduction =
    inp.seniors65PlusCount * Math.min(tbl.seniorDedMax, r0(seniorExcess * tbl.seniorPhaseoutRate));
  const seniorAllowed = Math.max(0, seniorMax - seniorReduction);

  const qbiBase = Math.max(0, obi);
  const qbi20 = r0(qbiBase * tbl.qbiRate);
  const tiBeforeQbi = Math.max(0, agi - stdOrItemized - seniorAllowed);
  const netCapGain = inp.qualifiedDividends + Math.max(0, schD);
  const qbiCap20 = r0(Math.max(0, tiBeforeQbi - netCapGain) * tbl.qbiRate);
  const qbiAllowed = Math.min(qbi20, qbiCap20);

  const taxableIncome = Math.max(0, agi - stdOrItemized - seniorAllowed - qbiAllowed);
  const prefIncome = Math.min(taxableIncome, netCapGain);
  const ordTaxableIncome = Math.max(0, taxableIncome - prefIncome);
  const irsLookupBase =
    ordTaxableIncome >= 3000 && ordTaxableIncome < 100000
      ? Math.floor(ordTaxableIncome / 50) * 50 + 25
      : ordTaxableIncome;
  const ordTax = progressiveTax(irsLookupBase, tbl.fedBrackets, tbl.fedRates);
  const pref0 = Math.min(prefIncome, Math.max(0, tbl.ltcg0Ceiling - ordTaxableIncome));
  const pref15 = Math.min(
    Math.max(0, prefIncome - pref0),
    Math.max(0, tbl.ltcg15Ceiling - Math.max(ordTaxableIncome, tbl.ltcg0Ceiling))
  );
  const pref20 = Math.max(0, prefIncome - pref0 - pref15);
  const prefTax = r0(pref15 * 0.15 + pref20 * 0.2);
  const line16Tax = ordTax + prefTax;
  const niit = r0(
    Math.max(0, Math.min(line2bInt + inp.ordinaryDividends + Math.max(0, schD), agi - tbl.niitThreshold)) *
      tbl.niitRate
  );
  const totalFedTax = line16Tax + niit;
  const fedPayments = inp.fedWithholding + inp.fedEstimates;
  const fedBalDue = totalFedTax - fedPayments;

  // CA 540 / 540NR (evaluated before AZ Form 309 reverse credit)
  const caAdd = Math.max(0, inp.caConformityAdj) + Math.max(0, caK1Adj);
  const caOtherSub = Math.abs(Math.min(0, inp.caConformityAdj)) + Math.abs(Math.min(0, caK1Adj));
  const caSchCaB = caOtherSub + inp.ssTaxable;
  const caAgi = Math.max(0, agi + caAdd - caSchCaB);
  const caDed = Math.max(tbl.caStdDed, inp.itemizedDeductions);
  const caTaxable = Math.max(0, caAgi - caDed);
  const caProgTax = progressiveTax(caTaxable, tbl.caBrackets, tbl.caRates);
  const caMentalHealth = r0(Math.max(0, caTaxable - tbl.caMentalHealthThreshold) * tbl.caMentalHealthRate);
  const caExempCredits = (tbl.caBaseExemptionCount + inp.seniors65PlusCount) * tbl.caExemptionCredit;
  const caFullYearTax = Math.max(0, caProgTax + caMentalHealth - caExempCredits);
  const caTaxBeforePte = r0(caFullYearTax * inp.caResidencyFactor);
  const caPteCredit = inp.caPteActive === 1 ? Math.max(0, caPteAmt - inp.caSb132Adj) : 0;
  const caNetTax = Math.max(0, caTaxBeforePte - caPteCredit);
  const caBalDue = caNetTax - inp.caWithholdingEst;
  const caPteCarryforward = inp.caPteActive === 1 ? Math.max(0, caPteCredit - caTaxBeforePte) : 0;

  // AZ 140NR
  const azRatio = agi > 0 ? Math.min(1, Math.max(0, azApportionedIncome / agi)) : 0;
  const azProratedStdDed = r0(tbl.azStdDed * azRatio);
  const azTaxable = Math.max(0, azApportionedIncome - azProratedStdDed);
  const azGrossTax = r0(azTaxable * tbl.azFlatRate);
  const azForm309Credit =
    inp.caResidencyFactor > 0 && caTaxBeforePte > 0
      ? Math.min(azGrossTax, r0(caTaxBeforePte * azRatio))
      : 0;
  const azPteCredit = inp.azPteActive === 1 ? azPteAmt : 0;
  const azNetTax = Math.max(0, azGrossTax - azForm309Credit - azPteCredit);
  const azBalDue = azNetTax - inp.azWithholdingEst;

  return {
    grossReceipts,
    caPteAmt,
    azPteAmt,
    line12Taxes,
    totalDeductions,
    obi,
    scorpInterest: inp.scorpInterest,
    nondedMeals: inp.nondeductibleMeals,
    distributions: inp.distributions,
    totalAssets,
    retainedEarningsPlug,
    totalLiabEq,
    bookNetIncome,
    m1FedIncome,
    aaaSubtotal,
    endingAaa,
    pObi,
    pInt,
    pNonded,
    pDist,
    sObi,
    sInt,
    sNonded,
    sDist,
    pCapContrib,
    pIncAdd,
    pBasisBeforeDist,
    pExcessGain,
    pBasisAfterDist,
    pReduct,
    pEndBasis,
    sCapContrib,
    sIncAdd,
    sBasisBeforeDist,
    sExcessGain,
    sBasisAfterDist,
    sReduct,
    sEndBasis,
    combEndBasis,
    combExcessGain,
    azSalesRatio,
    azApportionedIncome,
    az120sMin,
    az120sTotal,
    caSalesRatio,
    caTaxAddback,
    ca100sNetIncome,
    ca100sCalcTax,
    ca100sFranchiseTax,
    ca100sBalDue,
    caK1Adj,
    ca100sTotalTax,
    w2Box1,
    line2bInt,
    schD,
    totalIncome,
    sch1Adj,
    agi,
    stdOrItemized,
    seniorMax,
    seniorExcess,
    seniorReduction,
    seniorAllowed,
    qbiBase,
    qbi20,
    tiBeforeQbi,
    netCapGain,
    qbiCap20,
    qbiAllowed,
    taxableIncome,
    prefIncome,
    ordTaxableIncome,
    irsLookupBase,
    ordTax,
    pref0,
    pref15,
    pref20,
    prefTax,
    line16Tax,
    niit,
    totalFedTax,
    fedPayments,
    fedBalDue,
    azRatio,
    azProratedStdDed,
    azTaxable,
    azGrossTax,
    azForm309Credit,
    azPteCredit,
    azNetTax,
    azBalDue,
    caAdd,
    caOtherSub,
    caSchCaB,
    caAgi,
    caDed,
    caTaxable,
    caProgTax,
    caMentalHealth,
    caExempCredits,
    caFullYearTax,
    caTaxBeforePte,
    caPteCredit,
    caNetTax,
    caBalDue,
    caPteCarryforward,
  };
}

// ---------------------------------------------------------------------------
// Worksheet Styling & Helper Primitives
// ---------------------------------------------------------------------------
function colLetter(n: number): string {
  let s = '';
  let k = n;
  while (k > 0) {
    const m = (k - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    k = Math.floor((k - 1) / 26);
  }
  return s;
}

function applyBannerAndPrint(
  ws: ExcelJS.Worksheet,
  lastCol: number,
  title: string,
  subtitle: string,
  branding: BrandingConfig,
  colWidths: number[]
): void {
  const endCol = colLetter(lastCol);
  colWidths.forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });

  ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: true }];

  // Row 1 — Executive Navy Banner with Gold Eyebrow + White Title
  ws.mergeCells(`A1:${endCol}1`);
  const r1 = ws.getRow(1);
  r1.height = 40;
  const c1 = ws.getCell('A1');
  c1.value = {
    richText: [
      {
        text: `${branding.eyebrow}\n`,
        font: { name: FONT_NAME, size: 8.5, bold: true, color: { argb: COLORS.gold } },
      },
      {
        text: title,
        font: { name: FONT_NAME, size: 13.5, bold: true, color: { argb: COLORS.white } },
      },
    ],
  };
  c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  c1.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };

  // Row 2 — Slate Navy Subtitle with Gold Bottom Border
  ws.mergeCells(`A2:${endCol}2`);
  const r2 = ws.getRow(2);
  r2.height = 20;
  const c2 = ws.getCell('A2');
  c2.value = subtitle;
  c2.font = { name: FONT_NAME, size: 9.5, italic: true, color: { argb: COLORS.subtitleText } };
  c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateNavy } };
  c2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  for (let c = 1; c <= lastCol; c++) {
    ws.getRow(2).getCell(c).border = {
      bottom: { style: 'medium', color: { argb: COLORS.gold } },
    };
  }

  ws.getRow(3).height = 8;

  // Print Setup & Headers/Footers
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.65, bottom: 0.65, header: 0.25, footer: 0.25 },
  };
  ws.headerFooter = {
    oddHeader: `&L&"Calibri,Bold"&8${branding.headerLeft}&R&"Calibri,Regular"&8${branding.headerRight}`,
    oddFooter:
      '&L&"Calibri,Italic"&8Shadow Tax Return & CPA Verification Model (Not a Filed Return)&R&"Calibri,Regular"&8Page &P of &N',
  };
}

function styleTableHeader(ws: ExcelJS.Worksheet, rowNum: number, labels: string[]): void {
  const row = ws.getRow(rowNum);
  row.height = 22;
  labels.forEach((lbl, idx) => {
    const cell = row.getCell(idx + 1);
    cell.value = lbl;
    cell.font = { name: FONT_NAME, size: 9.5, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: idx >= 2 && idx <= 4 ? 'right' : 'left',
      wrapText: true,
    };
    cell.border = {
      bottom: { style: 'thin', color: { argb: COLORS.gold } },
    };
  });
}

function styleSectionRow(ws: ExcelJS.Worksheet, rowNum: number, lastCol: number, label: string): void {
  ws.mergeCells(`A${rowNum}:${colLetter(lastCol)}${rowNum}`);
  const row = ws.getRow(rowNum);
  row.height = 20;
  const c = row.getCell(1);
  c.value = label;
  c.font = { name: FONT_NAME, size: 9.5, bold: true, color: { argb: COLORS.sectionText } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.sectionBg } };
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  for (let col = 1; col <= lastCol; col++) {
    row.getCell(col).border = {
      top: { style: 'thin', color: { argb: COLORS.borderLight } },
      bottom: { style: 'thin', color: { argb: COLORS.borderDark } },
    };
  }
}

interface DataRowOpts {
  bold?: boolean;
  total?: boolean;
  inputCols?: boolean;
  numFmt?: string;
  zebra?: boolean;
  note?: string;
}

function setDataRow(
  ws: ExcelJS.Worksheet,
  rowNum: number,
  code: string,
  label: string,
  colC: ExcelJS.CellValue,
  colD: ExcelJS.CellValue,
  colE: ExcelJS.CellValue,
  colF: ExcelJS.CellValue,
  opts: DataRowOpts = {}
): void {
  const row = ws.getRow(rowNum);
  row.height = opts.total ? 21 : 19;
  const numFmt = opts.numFmt ?? FMT.currency;
  const bg = opts.total ? COLORS.totalBg : opts.zebra ? COLORS.zebraBg : undefined;

  const vals: ExcelJS.CellValue[] = [code, label, colC, colD, colE, colF];
  vals.forEach((val, idx) => {
    const cell = row.getCell(idx + 1);
    cell.value = val;
    const isNumericCol = idx === 2 || idx === 3 || (idx === 4 && typeof val !== 'string');
    const isInput = opts.inputCols && (idx === 2 || idx === 3);

    cell.font = {
      name: FONT_NAME,
      size: 9.5,
      bold: Boolean(opts.bold || opts.total),
      color: {
        argb: isInput
          ? COLORS.inputText
          : idx === 5
          ? COLORS.mutedText
          : COLORS.sectionText,
      },
      italic: idx === 5 && !opts.bold,
    };

    if (isInput) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.inputBg } };
    } else if (bg) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    }

    if (isNumericCol) {
      cell.numFmt = numFmt;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    } else {
      cell.alignment = { vertical: 'middle', horizontal: idx === 0 ? 'center' : 'left', wrapText: idx === 5 };
    }

    cell.border = opts.total
      ? {
          top: { style: 'thin', color: { argb: COLORS.borderDark } },
          bottom: { style: 'double', color: { argb: COLORS.navy } },
        }
      : {
          bottom: { style: 'hair', color: { argb: COLORS.borderLight } },
        };
  });
}

function f(formula: string, result: number | string): ExcelJS.CellFormulaValue {
  return { formula, result };
}

function progressiveFormula(
  taxableCell: string,
  tblCol: 'C' | 'D',
  startRow: number,
  count: number
): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = startRow + i;
    const rateRef = `'Tax Tables'!E${r}`;
    const loRef = `'Tax Tables'!${tblCol}${r}`;
    if (i < count - 1) {
      const hiRef = `'Tax Tables'!${tblCol}${r + 1}`;
      parts.push(`MAX(0,MIN(${taxableCell},${hiRef})-${loRef})*${rateRef}`);
    } else {
      parts.push(`MAX(0,${taxableCell}-${loRef})*${rateRef}`);
    }
  }
  return `ROUND(${parts.join('+')},0)`;
}

// ---------------------------------------------------------------------------
// Main Workbook Builder (Exported for Browser Download & Node Unit Testing)
// ---------------------------------------------------------------------------
export async function buildShadowTaxReturnWorkbook(
  params: ShadowReturnExportParams
): Promise<ExcelJS.Workbook> {
  const { setup, years, computed, selectedYear, pnlState } = params;
  const branding = getBranding(setup);

  const baseComp = computed.find((c) => c.tax_year === 2025) ?? computed[0];
  const baseRec = years.find((y) => y.tax_year === baseComp.tax_year) ?? years[0];
  const baseYear = baseComp.tax_year;

  const selComp =
    computed.find((c) => c.tax_year === selectedYear) ??
    computed.find((c) => c.tax_year === setup.current_tax_year) ??
    computed[1] ??
    computed[0];
  const selRec = years.find((y) => y.tax_year === selComp.tax_year) ?? years[1] ?? years[0];
  const prevSelComp = computed.find((c) => c.tax_year === selComp.tax_year - 1);
  const projYear = selComp.tax_year;

  const baseInp = extractYearInputs(setup, baseRec, baseComp, undefined, true, pnlState);
  const projInp = extractYearInputs(setup, selRec, selComp, prevSelComp, false, pnlState);

  const infl = setup.assumptions.inflation_rate ?? 0.025;
  const baseTbl = getTaxTableParams(baseYear, setup.filing_status, infl);
  const projTbl = getTaxTableParams(projYear, setup.filing_status, infl);

  const baseEval = evaluateYear(baseInp, baseTbl);
  const projEval = evaluateYear(projInp, projTbl);

  const { primaryName: primaryLabel, spouseName: spouseLabel } = getPersonNames(setup);
  const baseColHdr = `${baseYear} Filed`;
  const projColHdr = `${projYear} Projected`;

  const wb = new ExcelJS.Workbook();
  wb.creator = branding.creator;
  wb.lastModifiedBy = branding.creator;
  wb.title = branding.title;
  wb.subject = `Shadow Tax Return (${baseYear} Filed vs. ${projYear} Projected)`;
  wb.created = new Date();
  wb.modified = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  // Create all 8 tabs in exact required order
  const wsDash = wb.addWorksheet(TAB_NAMES[0]);
  const wsInputs = wb.addWorksheet(TAB_NAMES[1]);
  const ws1120s = wb.addWorksheet(TAB_NAMES[2]);
  const wsK1 = wb.addWorksheet(TAB_NAMES[3]);
  const wsStateBiz = wb.addWorksheet(TAB_NAMES[4]);
  const ws1040 = wb.addWorksheet(TAB_NAMES[5]);
  const wsStateInd = wb.addWorksheet(TAB_NAMES[6]);
  const wsTables = wb.addWorksheet(TAB_NAMES[7]);

  // =========================================================================
  // TAB 8: Tax Tables
  // =========================================================================
  applyBannerAndPrint(
    wsTables,
    5,
    `STATUTORY TAX TABLES & PARAMETERS (${baseYear} vs. ${projYear})`,
    `Federal (${setup.filing_status.replace(/_/g, ' ').toUpperCase()}), Arizona, and California statutory brackets, deductions & rates`,
    branding,
    [10, 42, 16, 16, 16]
  );
  styleTableHeader(wsTables, 4, ['Code', 'Tax Parameter / Bracket Threshold', baseColHdr, projColHdr, 'Rate / Unit']);

  styleSectionRow(wsTables, 5, 5, 'FEDERAL ORDINARY INCOME TAX BRACKETS');
  baseTbl.fedBrackets.forEach((b, i) => {
    const r = 6 + i;
    const row = wsTables.getRow(r);
    row.height = 19;
    row.getCell(1).value = `FED-${i + 1}`;
    row.getCell(2).value = `Federal ${(baseTbl.fedRates[i] * 100).toFixed(0)}% Bracket Floor`;
    row.getCell(3).value = b;
    row.getCell(4).value = projTbl.fedBrackets[i];
    row.getCell(5).value = baseTbl.fedRates[i];
    row.getCell(3).numFmt = FMT.currency;
    row.getCell(4).numFmt = FMT.currency;
    row.getCell(5).numFmt = FMT.percent1;
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
    for (let c = 1; c <= 5; c++) {
      row.getCell(c).font = { name: FONT_NAME, size: 9.5 };
      if (i % 2 === 1) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
    }
  });

  styleSectionRow(wsTables, 13, 5, 'FEDERAL STANDARD DEDUCTION, ENHANCED SENIOR DEDUCTION, QBI & LTCG');
  const fedParams: Array<[number, string, string, number, number, string, string]> = [
    [14, 'STD-1', 'Federal Base Standard Deduction', baseTbl.fedStdDed, projTbl.fedStdDed, FMT.currency, 'Statutory'],
    [15, 'STD-2', 'Additional Standard Deduction (Per Age 65+ Senior)', baseTbl.fedSeniorAddon, projTbl.fedSeniorAddon, FMT.currency, 'Per Senior'],
    [16, 'SEN-1', 'Sch 1-A Enhanced Senior Deduction Max (Per Senior)', baseTbl.seniorDedMax, projTbl.seniorDedMax, FMT.currency, '2025-2028'],
    [17, 'SEN-2', 'Enhanced Senior Deduction MAGI Phase-out Floor', baseTbl.seniorPhaseoutThreshold, projTbl.seniorPhaseoutThreshold, FMT.currency, 'MAGI Floor'],
    [18, 'SEN-3', 'Enhanced Senior Deduction Phase-out Rate', baseTbl.seniorPhaseoutRate, projTbl.seniorPhaseoutRate, FMT.percent1, '6.0% / $1'],
    [19, 'QBI-1', 'Form 8995 Qualified Business Income Deduction Rate', baseTbl.qbiRate, projTbl.qbiRate, FMT.percent1, 'IRC 199A'],
    [20, 'LTCG-0', 'Long-Term Capital Gain / Qual Div 0% Ceiling', baseTbl.ltcg0Ceiling, projTbl.ltcg0Ceiling, FMT.currency, '0% Cap'],
    [21, 'LTCG-15', 'Long-Term Capital Gain / Qual Div 15% Ceiling', baseTbl.ltcg15Ceiling, projTbl.ltcg15Ceiling, FMT.currency, '15% Cap'],
    [22, 'NIIT-1', 'Form 8960 NIIT MAGI Threshold', baseTbl.niitThreshold, projTbl.niitThreshold, FMT.currency, 'Unindexed'],
    [23, 'NIIT-2', 'Form 8960 NIIT Rate', baseTbl.niitRate, projTbl.niitRate, FMT.percent2, '3.80%'],
  ];
  fedParams.forEach(([r, code, lbl, v1, v2, fmt, unit], idx) => {
    const row = wsTables.getRow(r);
    row.height = 19;
    row.getCell(1).value = code;
    row.getCell(2).value = lbl;
    row.getCell(3).value = v1;
    row.getCell(4).value = v2;
    row.getCell(5).value = unit;
    row.getCell(3).numFmt = fmt;
    row.getCell(4).numFmt = fmt;
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
    for (let c = 1; c <= 5; c++) {
      row.getCell(c).font = { name: FONT_NAME, size: 9.5, color: { argb: c === 5 ? COLORS.mutedText : COLORS.sectionText } };
      if (idx % 2 === 1) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
    }
  });

  styleSectionRow(wsTables, 24, 5, 'ARIZONA STATUTORY TAX PARAMETERS');
  const azParams: Array<[number, string, string, number, number, string, string]> = [
    [25, 'AZ-1', 'Arizona Flat Personal Income Tax Rate', baseTbl.azFlatRate, projTbl.azFlatRate, FMT.percent2, '2.50% Flat'],
    [26, 'AZ-2', 'Arizona Standard Deduction', baseTbl.azStdDed, projTbl.azStdDed, FMT.currency, 'Matches Fed'],
    [27, 'AZ-3', 'Arizona PTE Elective Entity Tax Rate', baseTbl.azPteRate, projTbl.azPteRate, FMT.percent2, '2.98% PTE'],
    [28, 'AZ-4', 'Arizona Form 120S Minimum Corporate Tax', baseTbl.az120sMinTax, projTbl.az120sMinTax, FMT.currency, '$50 Min'],
  ];
  azParams.forEach(([r, code, lbl, v1, v2, fmt, unit], idx) => {
    const row = wsTables.getRow(r);
    row.height = 19;
    row.getCell(1).value = code;
    row.getCell(2).value = lbl;
    row.getCell(3).value = v1;
    row.getCell(4).value = v2;
    row.getCell(5).value = unit;
    row.getCell(3).numFmt = fmt;
    row.getCell(4).numFmt = fmt;
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
    for (let c = 1; c <= 5; c++) {
      row.getCell(c).font = { name: FONT_NAME, size: 9.5, color: { argb: c === 5 ? COLORS.mutedText : COLORS.sectionText } };
      if (idx % 2 === 1) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
    }
  });

  styleSectionRow(wsTables, 29, 5, 'CALIFORNIA STATUTORY PARAMETERS (FORM 100S & FORM 540)');
  const caParams: Array<[number, string, string, number, number, string, string]> = [
    [30, 'CA-1', 'California Form 100S Franchise Tax Rate', baseTbl.ca100sRate, projTbl.ca100sRate, FMT.percent2, '1.50%'],
    [31, 'CA-2', 'California Form 100S Minimum Franchise Tax', baseTbl.ca100sMinTax, projTbl.ca100sMinTax, FMT.currency, '$800 Min'],
    [32, 'CA-3', 'California AB 150 / SB 132 PTE Elective Rate', baseTbl.caPteRate, projTbl.caPteRate, FMT.percent2, '9.30% PTE'],
    [33, 'CA-4', 'California Standard Deduction', baseTbl.caStdDed, projTbl.caStdDed, FMT.currency, 'Statutory'],
    [34, 'CA-5', 'California Personal / Senior Exemption Credit', baseTbl.caExemptionCredit, projTbl.caExemptionCredit, FMT.currency, 'Per Exemp'],
    [35, 'CA-6', 'California Base Personal Exemption Count', baseTbl.caBaseExemptionCount, projTbl.caBaseExemptionCount, FMT.integer, 'Filing Status'],
    [36, 'CA-7', 'California Mental Health Services Tax Threshold', baseTbl.caMentalHealthThreshold, projTbl.caMentalHealthThreshold, FMT.currency, 'Prop 63'],
    [37, 'CA-8', 'California Mental Health Services Tax Rate', baseTbl.caMentalHealthRate, projTbl.caMentalHealthRate, FMT.percent2, '1.00%'],
  ];
  caParams.forEach(([r, code, lbl, v1, v2, fmt, unit], idx) => {
    const row = wsTables.getRow(r);
    row.height = 19;
    row.getCell(1).value = code;
    row.getCell(2).value = lbl;
    row.getCell(3).value = v1;
    row.getCell(4).value = v2;
    row.getCell(5).value = unit;
    row.getCell(3).numFmt = fmt;
    row.getCell(4).numFmt = fmt;
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
    for (let c = 1; c <= 5; c++) {
      row.getCell(c).font = { name: FONT_NAME, size: 9.5, color: { argb: c === 5 ? COLORS.mutedText : COLORS.sectionText } };
      if (idx % 2 === 1) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
    }
  });

  styleSectionRow(wsTables, 38, 5, 'CALIFORNIA PROGRESSIVE INCOME TAX BRACKETS (FORM 540)');
  baseTbl.caBrackets.forEach((b, i) => {
    const r = 39 + i;
    const row = wsTables.getRow(r);
    row.height = 19;
    row.getCell(1).value = `CA-B${i + 1}`;
    row.getCell(2).value = `California ${(baseTbl.caRates[i] * 100).toFixed(1)}% Bracket Floor`;
    row.getCell(3).value = b;
    row.getCell(4).value = projTbl.caBrackets[i];
    row.getCell(5).value = baseTbl.caRates[i];
    row.getCell(3).numFmt = FMT.currency;
    row.getCell(4).numFmt = FMT.currency;
    row.getCell(5).numFmt = FMT.percent2;
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
    for (let c = 1; c <= 5; c++) {
      row.getCell(c).font = { name: FONT_NAME, size: 9.5 };
      if (i % 2 === 1) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
    }
  });

  // =========================================================================
  // TAB 2: Inputs (EXACT Row 64 = Taxable Social Security Benefits)
  // =========================================================================
  applyBannerAndPrint(
    wsInputs,
    6,
    `CENTRAL MODEL INPUTS (${baseYear} FILED BASELINE & ${projYear} PROJECTED)`,
    `Blue-shaded cells are editable model drivers; PTE toggles dynamically recalculate 1120-S, K-1, 1040, and State tabs`,
    branding,
    [9, 46, 17, 17, 12, 36]
  );
  styleTableHeader(wsInputs, 4, ['Code', 'Input Parameter', baseColHdr, projColHdr, 'Unit', 'Source / Model Driver Notes']);

  styleSectionRow(wsInputs, 5, 6, 'SECTION A — OWNERSHIP, ENTITY REVENUE & STATE APPORTIONMENT');
  setDataRow(wsInputs, 6, 'A1', `${primaryLabel} Ownership Percentage`, baseInp.primaryOwnershipPct, projInp.primaryOwnershipPct, '%', 'K-1 & Form 7203 Primary allocation', { inputCols: true, numFmt: FMT.percent1 });
  setDataRow(wsInputs, 7, 'A2', `${spouseLabel || 'Spouse'} Ownership Percentage`, baseInp.spouseOwnershipPct, projInp.spouseOwnershipPct, '%', 'K-1 & Form 7203 Spouse allocation', { inputCols: true, numFmt: FMT.percent1, zebra: true });
  setDataRow(wsInputs, 8, 'A3', 'CA-Sourced S-Corp Gross Receipts', baseInp.caRevenue, projInp.caRevenue, '$', 'CA Form 100S single-sales factor numerator', { inputCols: true });
  setDataRow(wsInputs, 9, 'A4', 'AZ-Sourced S-Corp Gross Receipts', baseInp.azRevenue, projInp.azRevenue, '$', 'AZ Form 120S sales factor numerator', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 10, 'A5', 'Other-State S-Corp Gross Receipts', baseInp.otherRevenue, projInp.otherRevenue, '$', 'Non-CA / Non-AZ gross receipts', { inputCols: true });
  setDataRow(wsInputs, 11, 'A6', 'Total S-Corp Gross Receipts (Formula)', f('SUM(C8:C10)', baseEval.grossReceipts), f('SUM(D8:D10)', projEval.grossReceipts), '$', 'Auto-sum of state-apportioned revenue', { total: true });
  setDataRow(wsInputs, 12, 'A7', 'S-Corp Bank Interest Income (Sch K Line 4)', baseInp.scorpInterest, projInp.scorpInterest, '$', 'Flows to Sch K, K-1s, Form 7203 & 1040 Line 2b', { inputCols: true });

  styleSectionRow(wsInputs, 14, 6, 'SECTION B — 1120-S DEDUCTIONS, RETIREMENT, DEPRECIATION & PTE ELECTIONS');
  setDataRow(wsInputs, 15, 'B1', `Officer Compensation (${primaryLabel} Gross W-2)`, baseInp.officerW2, projInp.officerW2, '$', 'Form 1120-S Line 7', { inputCols: true });
  setDataRow(wsInputs, 16, 'B2', `Salaries & Wages (${spouseLabel || 'Staff'} Gross W-2)`, baseInp.staffW2, projInp.staffW2, '$', 'Form 1120-S Line 8', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 17, 'B3', 'Rents (1120-S Line 11)', baseInp.rents, projInp.rents, '$', 'Office / facility lease expense', { inputCols: true });
  setDataRow(wsInputs, 18, 'B4', 'Employer Payroll Taxes (1120-S Line 12a)', baseInp.payrollTaxes, projInp.payrollTaxes, '$', 'Employer FICA / FUTA / SUI', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 19, 'B5', 'CA Entity / State & Local Taxes Paid (Line 12b)', baseInp.caEntityStateTax, projInp.caEntityStateTax, '$', 'FTB franchise / LLC / state taxes (excl. PTE)', { inputCols: true });
  setDataRow(wsInputs, 20, 'B6', 'Defined Benefit Plan (DBP) Contribution (Line 17a)', baseInp.dbpContribution, projInp.dbpContribution, '$', 'Actuarial employer DBP contribution', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 21, 'B7', 'Employer 401(k) Match / Profit Sharing (Line 17b)', baseInp.er401kMatch, projInp.er401kMatch, '$', 'Safe-harbor / employer 401(k) contribution', { inputCols: true });
  setDataRow(wsInputs, 22, 'B8', 'S-Corp >2% Owner Health / Medicare SEHI (Line 18)', baseInp.sehiMedicare, projInp.sehiMedicare, '$', 'Deducted on 1120-S, added to Box 1, deducted Sch 1', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 23, 'B9', 'Advertising (1120-S Line 16)', baseInp.advertising, projInp.advertising, '$', 'Direct advertising expense', { inputCols: true });
  setDataRow(wsInputs, 24, 'B10', 'Operating Expenses (1120-S Statement 1 / Line 19)', baseInp.otherOpex, projInp.otherOpex, '$', 'Professional fees, software, travel, 50% meals, misc', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 25, 'B11', 'Nondeductible Expenses — 50% Meals (Sch K 16c / M-1)', baseInp.nondeductibleMeals, projInp.nondeductibleMeals, '$', 'Reduces AAA & Form 7203 basis after distributions', { inputCols: true });
  setDataRow(wsInputs, 26, 'B12', 'CA vs. Federal Depreciation / Disposal Adjustment', baseInp.caDeprAdj, projInp.caDeprAdj, '$', 'CA Form 100S & Sch K-1(100S) adjustment', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 27, 'B13', 'CA Conformity Adjustment to Federal AGI (Sch CA)', baseInp.caConformityAdj, projInp.caConformityAdj, '$', 'Net Schedule CA conformity additions / (subtractions)', { inputCols: true });
  setDataRow(wsInputs, 28, 'B14', 'CA PTE Election Active Toggle (1 = ON, 0 = OFF)', baseInp.caPteActive, projInp.caPteActive, 'Toggle', 'Driven by app active PTE toggle', { inputCols: true, numFmt: FMT.integer, zebra: true });
  setDataRow(
    wsInputs,
    29,
    'B15',
    'CA PTE Election Amount (9.3% CA Net Income; $0 if OFF)',
    f(`IF(C28=1,ROUND(MAX(0,(C11-SUM(C15:C24))*IF(C11>0,C8/C11,0))*'Tax Tables'!C32,0),0)`, baseEval.caPteAmt),
    f(`IF(D28=1,ROUND(MAX(0,(D11-SUM(D15:D24))*IF(D11>0,D8/D11,0))*'Tax Tables'!D32,0),0)`, projEval.caPteAmt),
    '$',
    'Flows to 1120-S Line 12, CA 100S & CA 540 PTE credit',
    { bold: true }
  );
  setDataRow(wsInputs, 30, 'B16', 'AZ PTE Election Active Toggle (1 = ON, 0 = OFF)', baseInp.azPteActive, projInp.azPteActive, 'Toggle', 'Driven by app active PTE toggle', { inputCols: true, numFmt: FMT.integer, zebra: true });
  setDataRow(
    wsInputs,
    31,
    'B17',
    'AZ PTE Election Amount (2.98% AZ Net Income; $0 if OFF)',
    f(`IF(C30=1,ROUND(MAX(0,(C11-SUM(C15:C24))*IF(C11>0,C9/C11,0))*'Tax Tables'!C27,0),0)`, baseEval.azPteAmt),
    f(`IF(D30=1,ROUND(MAX(0,(D11-SUM(D15:D24))*IF(D11>0,D9/D11,0))*'Tax Tables'!D27,0),0)`, projEval.azPteAmt),
    '$',
    'Flows to 1120-S Line 12, AZ 120S & AZ 140NR PTE credit',
    { bold: true }
  );
  setDataRow(wsInputs, 32, 'B18', 'CA SB 132 Missed-Prepayment Credit Reduction ($125 if missed)', baseInp.caSb132Adj, projInp.caSb132Adj, '$', 'Reduces CA 540 PTE credit if June 15 prepayment missed', { inputCols: true, zebra: true });

  styleSectionRow(wsInputs, 34, 6, 'SECTION C — BALANCE SHEET (SCH L), AAA, DISTRIBUTIONS & STOCK BASIS');
  setDataRow(wsInputs, 35, 'C1', 'Schedule L — Cash (Beginning of Year)', baseInp.begCash, projInp.begCash, '$', 'Operating bank cash BOY', { inputCols: true });
  setDataRow(wsInputs, 36, 'C2', 'Schedule L — Cash (End of Year)', baseInp.endCash, projInp.endCash, '$', 'Operating bank cash EOY', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 37, 'C3', 'Schedule L — Other Current / Fixed Assets (EOY)', baseInp.otherAssetsEoy, projInp.otherAssetsEoy, '$', 'Receivables / net fixed assets EOY', { inputCols: true });
  setDataRow(wsInputs, 38, 'C4', 'Schedule L — Accounts Payable & Credit Cards (EOY)', baseInp.apCcEoy, projInp.apCcEoy, '$', 'Current liabilities EOY', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 39, 'C5', 'Schedule L — Pension / Retirement Payable (EOY)', baseInp.pensionPayableEoy, projInp.pensionPayableEoy, '$', 'Accrued DBP / 401(k) contribution payable', { inputCols: true });
  setDataRow(wsInputs, 40, 'C6', 'Schedule L — Paid-in Capital / Capital Stock', baseInp.paidInCapital, projInp.paidInCapital, '$', 'Initial member equity / capital stock', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 41, 'C7', 'Schedule M-2 — Beginning AAA Balance', baseInp.begAaa, projInp.begAaa, '$', 'Accumulated Adjustments Account BOY', { inputCols: true });
  setDataRow(wsInputs, 42, 'C8', 'Shareholder Capital Contributions (Current Year)', baseInp.capitalContributions, projInp.capitalContributions, '$', 'Paid-in capital additions increasing Form 7203 basis', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 43, 'C9', 'Shareholder Distributions (Current Year Total)', baseInp.distributions, projInp.distributions, '$', 'Pro-rata distributions (Form 1120-S Sch K Line 16d)', { inputCols: true });
  setDataRow(wsInputs, 44, 'C10', `Beginning Federal Stock Basis — ${primaryLabel}`, baseInp.primaryBegStockBasis, projInp.primaryBegStockBasis, '$', 'Form 7203 Part I Line 1 (Primary)', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 45, 'C11', `Beginning Federal Stock Basis — ${spouseLabel || 'Spouse'}`, baseInp.spouseBegStockBasis, projInp.spouseBegStockBasis, '$', 'Form 7203 Part I Line 1 (Spouse)', { inputCols: true });
  setDataRow(wsInputs, 46, 'C12', 'Beginning California Stock Basis (Combined)', baseInp.caBegStockBasis, projInp.caBegStockBasis, '$', 'CA basis tracking reference', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 47, 'C13', 'CA Form 100S Estimated Franchise Tax Paid', baseInp.ca100sEstPaid, projInp.ca100sEstPaid, '$', 'Applied against CA 100S franchise tax due', { inputCols: true });

  styleSectionRow(wsInputs, 49, 6, 'SECTION D — PERSONAL FORM 1040, RETIREMENT, SOCIAL SECURITY & STATE INPUTS');
  setDataRow(wsInputs, 50, 'D1', `${primaryLabel} Employee 401(k) Elective Deferral`, baseInp.primaryEe401k, projInp.primaryEe401k, '$', 'Reduces Primary W-2 Box 1 taxable wages', { inputCols: true });
  setDataRow(wsInputs, 51, 'D2', `${spouseLabel || 'Spouse'} Employee 401(k) Elective Deferral`, baseInp.spouseEe401k, projInp.spouseEe401k, '$', 'Reduces Spouse W-2 Box 1 taxable wages', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 52, 'D3', 'Other Non-Entity W-2 Taxable Wages', baseInp.otherW2Wages, projInp.otherW2Wages, '$', 'Outside employer W-2 Box 1 wages (if any)', { inputCols: true });
  setDataRow(wsInputs, 53, 'D4', 'Personal Taxable Interest (1099-INT, Excl. K-1)', baseInp.personalInterest, projInp.personalInterest, '$', 'Combined with K-1 interest on 1040 Line 2b', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 54, 'D5', 'Tax-Exempt Interest (Form 1040 Line 2a)', baseInp.taxExemptInterest, projInp.taxExemptInterest, '$', 'Municipal bond interest (MAGI / IRMAA)', { inputCols: true });
  setDataRow(wsInputs, 55, 'D6', 'Ordinary Dividends (1099-DIV, Line 3b)', baseInp.ordinaryDividends, projInp.ordinaryDividends, '$', 'Total ordinary dividends (incl. qualified)', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 56, 'D7', 'Qualified Dividends (1099-DIV, Line 3a)', baseInp.qualifiedDividends, projInp.qualifiedDividends, '$', 'Taxed at 0%/15%/20% preferential LTCG rates', { inputCols: true });
  setDataRow(wsInputs, 57, 'D8', 'Taxable IRA Distributions (1099-R, Line 4b)', baseInp.iraTaxable, projInp.iraTaxable, '$', 'Traditional IRA / RMD taxable distributions', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 58, 'D9', 'Taxable Pensions & Annuities (1099-R, Line 5b)', baseInp.pensionsTaxable, projInp.pensionsTaxable, '$', 'Taxable pension / annuity payouts', { inputCols: true });
  setDataRow(wsInputs, 59, 'D10', 'Gross Social Security Benefits (Form 1040 Line 6a)', baseInp.ssGross, projInp.ssGross, '$', 'Total SSA-1099 gross benefits', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 60, 'D11', 'Brokerage Net Capital Gain / (Loss) (Excl. Form 7203)', baseInp.brokerageCapGain, projInp.brokerageCapGain, '$', 'Combined with Form 7203 excess gain on Sch D', { inputCols: true });
  setDataRow(wsInputs, 61, 'D12', 'Other Schedule 1 Adjustments (Excl. SEHI)', baseInp.otherSch1Adj, projInp.otherSch1Adj, '$', 'HSA / IRA / other Sch 1 above-the-line adjustments', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 62, 'D13', 'Itemized Deductions Input (Sch A; $0 = Standard)', baseInp.itemizedDeductions, projInp.itemizedDeductions, '$', 'Compared vs. Standard + Age 65+ add-on', { inputCols: true });
  setDataRow(wsInputs, 63, 'D14', 'Qualifying Seniors Age 65+ Count (0, 1, or 2)', baseInp.seniors65PlusCount, projInp.seniors65PlusCount, 'Count', 'Drives Std Ded add-on, Sch 1-A Senior Ded & CA Exemp', { inputCols: true, numFmt: FMT.integer, zebra: true });
  // EXACTLY ROW 64 — Taxable Social Security Benefits (linked as +Inputs!C64 / +Inputs!D64 on SchCA-B Row 22)
  setDataRow(wsInputs, 64, 'D15', 'Taxable Social Security Benefits (Form 1040 Line 6b)', baseInp.ssTaxable, projInp.ssTaxable, '$', 'Fed Line 6b & 100% subtracted on CA SchCA-B Row 22', { inputCols: true, bold: true });
  setDataRow(wsInputs, 65, 'D16', 'Federal W-2 / 1099 Tax Withholding', baseInp.fedWithholding, projInp.fedWithholding, '$', 'Form 1040 Line 25d', { inputCols: true, zebra: true });
  setDataRow(wsInputs, 66, 'D17', 'Federal 1040-ES Estimated Tax Payments', baseInp.fedEstimates, projInp.fedEstimates, '$', 'Form 1040 Line 26', { inputCols: true });
  setDataRow(wsInputs, 67, 'D18', 'CA Residency / Part-Year Factor (100% = Full-Year)', baseInp.caResidencyFactor, projInp.caResidencyFactor, '%', 'Applied to CA 540 / 540NR tax calculation', { inputCols: true, numFmt: FMT.percent1, zebra: true });
  setDataRow(wsInputs, 68, 'D19', 'CA Personal Tax Withholding & Estimated Payments', baseInp.caWithholdingEst, projInp.caWithholdingEst, '$', 'Applied on CA Form 540 / 540NR', { inputCols: true });
  setDataRow(wsInputs, 69, 'D20', 'AZ Personal Tax Withholding & Estimated Payments', baseInp.azWithholdingEst, projInp.azWithholdingEst, '$', 'Applied on AZ Form 140NR', { inputCols: true, zebra: true });

  styleSectionRow(wsInputs, 71, 6, `SECTION E — ${projYear} CPA DRAFT VERIFICATION INPUTS (LEAVE BLANK UNTIL CPA DRAFT RECEIVED)`);
  const cpaDraftLabels = [
    'CPA Draft — 1120-S Gross Receipts',
    'CPA Draft — 1120-S Ordinary Business Income (OBI)',
    'CPA Draft — Form 7203 Ending Stock Basis',
    'CPA Draft — Form 1040 Adjusted Gross Income (AGI)',
    'CPA Draft — Form 8995 QBI Deduction',
    'CPA Draft — Form 1040 Taxable Income',
    'CPA Draft — Form 1040 Total Tax',
    'CPA Draft — CA 540 / 540NR Tax',
    'CPA Draft — AZ 140NR Tax',
    'CPA Draft — CA 100S Franchise Tax',
  ];
  cpaDraftLabels.forEach((lbl, i) => {
    const r = 72 + i;
    setDataRow(wsInputs, r, `E${i + 1}`, lbl, 'N/A (Filed)', null, '$', 'Enter CPA draft figure to trigger Dashboard variance', {
      inputCols: true,
      zebra: i % 2 === 1,
    });
    // Style Col C as muted text since Section E is for Selected Year CPA Draft
    const cCell = wsInputs.getRow(r).getCell(3);
    cCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
    cCell.font = { name: FONT_NAME, size: 9, italic: true, color: { argb: COLORS.mutedText } };
    cCell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // =========================================================================
  // TAB 3: 1120-S (Fed S-Corp)
  // =========================================================================
  applyBannerAndPrint(
    ws1120s,
    6,
    `FORM 1120-S — U.S. INCOME TAX RETURN FOR AN S CORPORATION (${baseYear} & ${projYear})`,
    'Page 1 Income & Deductions, Statement 1, Schedule K, Schedule L, Schedule M-1, and Schedule M-2 (AAA)',
    branding,
    [11, 46, 17, 17, 16, 34]
  );
  styleTableHeader(ws1120s, 4, ['Line', 'Form 1120-S Description', baseColHdr, projColHdr, 'YoY Change', 'Formula / Tax Reference']);

  styleSectionRow(ws1120s, 5, 6, 'PAGE 1 — INCOME & DEDUCTIONS');
  setDataRow(ws1120s, 6, 'Line 1c', 'Gross Receipts or Sales (Net)', f('Inputs!C11', baseEval.grossReceipts), f('Inputs!D11', projEval.grossReceipts), f('D6-C6', projEval.grossReceipts - baseEval.grossReceipts), 'Total state-apportioned revenue', { bold: true });
  styleSectionRow(ws1120s, 7, 6, 'DEDUCTIONS (LINES 7–21)');
  setDataRow(ws1120s, 8, 'Line 7', `Compensation of Officers (${primaryLabel} W-2)`, f('Inputs!C15', baseInp.officerW2), f('Inputs!D15', projInp.officerW2), f('D8-C8', projInp.officerW2 - baseInp.officerW2), 'Reasonable officer compensation');
  setDataRow(ws1120s, 9, 'Line 8', `Salaries and Wages (${spouseLabel || 'Staff'} W-2)`, f('Inputs!C16', baseInp.staffW2), f('Inputs!D16', projInp.staffW2), f('D9-C9', projInp.staffW2 - baseInp.staffW2), 'Non-officer W-2 salaries', { zebra: true });
  setDataRow(ws1120s, 10, 'Line 11', 'Rents', f('Inputs!C17', baseInp.rents), f('Inputs!D17', projInp.rents), f('D10-C10', projInp.rents - baseInp.rents), 'Facility / office rent');
  setDataRow(ws1120s, 11, 'Line 12a', 'Taxes & Licenses — Employer Payroll Taxes', f('Inputs!C18', baseInp.payrollTaxes), f('Inputs!D18', projInp.payrollTaxes), f('D11-C11', projInp.payrollTaxes - baseInp.payrollTaxes), 'Employer FICA / FUTA / SUI', { zebra: true });
  setDataRow(ws1120s, 12, 'Line 12b', 'Taxes & Licenses — CA Entity / State & Local Taxes', f('Inputs!C19', baseInp.caEntityStateTax), f('Inputs!D19', projInp.caEntityStateTax), f('D12-C12', projInp.caEntityStateTax - baseInp.caEntityStateTax), 'FTB franchise & non-PTE state taxes');
  setDataRow(ws1120s, 13, 'Line 12c', 'Taxes & Licenses — CA + AZ Elective PTE Taxes (Notice 2020-75)', f('Inputs!C29+Inputs!C31', baseEval.caPteAmt + baseEval.azPteAmt), f('Inputs!D29+Inputs!D31', projEval.caPteAmt + projEval.azPteAmt), f('D13-C13', projEval.caPteAmt + projEval.azPteAmt - (baseEval.caPteAmt + baseEval.azPteAmt)), 'Auto-deducted when CA/AZ PTE toggle = 1', { zebra: true });
  setDataRow(ws1120s, 14, 'Line 12', 'Total Taxes and Licenses (Subtotal)', f('SUM(C11:C13)', baseEval.line12Taxes), f('SUM(D11:D13)', projEval.line12Taxes), f('D14-C14', projEval.line12Taxes - baseEval.line12Taxes), 'Includes CA + AZ PTE payments if elected', { bold: true });
  setDataRow(ws1120s, 15, 'Line 16', 'Advertising', f('Inputs!C23', baseInp.advertising), f('Inputs!D23', projInp.advertising), f('D15-C15', projInp.advertising - baseInp.advertising), 'Marketing & advertising', { zebra: true });
  setDataRow(ws1120s, 16, 'Line 17', 'Pension, Profit-Sharing, DBP & ER 401(k) Plans', f('Inputs!C20+Inputs!C21', baseInp.dbpContribution + baseInp.er401kMatch), f('Inputs!D20+Inputs!D21', projInp.dbpContribution + projInp.er401kMatch), f('D16-C16', projInp.dbpContribution + projInp.er401kMatch - (baseInp.dbpContribution + baseInp.er401kMatch)), 'DBP + Employer 401(k) match');
  setDataRow(ws1120s, 17, 'Line 18', 'Employee Benefit Programs (>2% Owner SEHI / Medicare)', f('Inputs!C22', baseInp.sehiMedicare), f('Inputs!D22', projInp.sehiMedicare), f('D17-C17', projInp.sehiMedicare - baseInp.sehiMedicare), 'IRC §162(l) shareholder health', { zebra: true });
  setDataRow(ws1120s, 18, 'Line 19', 'Other Deductions (Statement 1 — Operating Expenses)', f('Inputs!C24', baseInp.otherOpex), f('Inputs!D24', projInp.otherOpex), f('D18-C18', projInp.otherOpex - baseInp.otherOpex), '1120-S Statement 1 total');
  setDataRow(ws1120s, 19, 'Line 21', 'Total Deductions', f('C8+C9+C10+C14+C15+C16+C17+C18', baseEval.totalDeductions), f('D8+D9+D10+D14+D15+D16+D17+D18', projEval.totalDeductions), f('D19-C19', projEval.totalDeductions - baseEval.totalDeductions), 'Sum of Lines 7 through 19', { bold: true });
  setDataRow(ws1120s, 20, 'Line 22', 'Ordinary Business Income (Loss) — OBI', f('C6-C19', baseEval.obi), f('D6-D19', projEval.obi), f('D20-C20', projEval.obi - baseEval.obi), 'Flows to Sch K Line 1, K-1s & Form 1040 Sch E', { total: true });

  styleSectionRow(ws1120s, 22, 6, 'STATEMENT 1 & SCHEDULE K — SHAREHOLDERS\' PRO RATA SHARE ITEMS');
  setDataRow(ws1120s, 23, 'Stmt 1', 'Other Deductions Detail (Operating Expenses Net of 50% Meals)', f('C18', baseInp.otherOpex), f('D18', projInp.otherOpex), f('D23-C23', projInp.otherOpex - baseInp.otherOpex), 'Ties to Form 1120-S Page 1 Line 19');
  setDataRow(ws1120s, 24, 'Sch K-1', 'Ordinary Business Income (Loss)', f('C20', baseEval.obi), f('D20', projEval.obi), f('D24-C24', projEval.obi - baseEval.obi), 'Allocated pro rata on Schedule K-1', { zebra: true });
  setDataRow(ws1120s, 25, 'Sch K-4', 'Interest Income (S-Corp Bank Accounts)', f('Inputs!C12', baseEval.scorpInterest), f('Inputs!D12', projEval.scorpInterest), f('D25-C25', projEval.scorpInterest - baseEval.scorpInterest), 'Flows to K-1 Box 4 & Form 1040 Line 2b');
  setDataRow(ws1120s, 26, 'Sch K-16c', 'Nondeductible Expenses (50% Business Meals)', f('Inputs!C25', baseEval.nondedMeals), f('Inputs!D25', projEval.nondedMeals), f('D26-C26', projEval.nondedMeals - baseEval.nondedMeals), 'Schedule M-1 add-back & Form 7203 basis reduction', { zebra: true });
  setDataRow(ws1120s, 27, 'Sch K-16d', 'Distributions (Property / Cash to Shareholders)', f('Inputs!C43', baseEval.distributions), f('Inputs!D43', projEval.distributions), f('D27-C27', projEval.distributions - baseEval.distributions), 'Tested against Form 7203 basis before nondeductibles');

  styleSectionRow(ws1120s, 29, 6, 'SCHEDULE L — BALANCE SHEET PER BOOKS (END OF YEAR)');
  setDataRow(ws1120s, 30, 'Sch L-1', 'Cash (End of Year)', f('Inputs!C36', baseInp.endCash), f('Inputs!D36', projInp.endCash), f('D30-C30', projInp.endCash - baseInp.endCash), 'Operating bank accounts EOY');
  setDataRow(ws1120s, 31, 'Sch L-14', 'Other Current & Fixed Assets (End of Year)', f('Inputs!C37', baseInp.otherAssetsEoy), f('Inputs!D37', projInp.otherAssetsEoy), f('D31-C31', projInp.otherAssetsEoy - baseInp.otherAssetsEoy), 'Receivables / net depreciable assets', { zebra: true });
  setDataRow(ws1120s, 32, 'Sch L-15', 'Total Assets', f('C30+C31', baseEval.totalAssets), f('D30+D31', projEval.totalAssets), f('D32-C32', projEval.totalAssets - baseEval.totalAssets), 'Matches Total Liabilities & Shareholders\' Equity', { bold: true });
  setDataRow(ws1120s, 33, 'Sch L-16', 'Accounts Payable & Credit Cards', f('Inputs!C38', baseInp.apCcEoy), f('Inputs!D38', projInp.apCcEoy), f('D33-C33', projInp.apCcEoy - baseInp.apCcEoy), 'Short-term trade payables / cards');
  setDataRow(ws1120s, 34, 'Sch L-18', 'Other Current Liabilities (Accrued Pension / DBP Payable)', f('Inputs!C39', baseInp.pensionPayableEoy), f('Inputs!D39', projInp.pensionPayableEoy), f('D34-C34', projInp.pensionPayableEoy - baseInp.pensionPayableEoy), 'Accrued retirement contributions payable EOY', { zebra: true });
  setDataRow(ws1120s, 35, 'Sch L-22', 'Capital Stock / Paid-in Capital', f('Inputs!C40', baseInp.paidInCapital), f('Inputs!D40', projInp.paidInCapital), f('D35-C35', projInp.paidInCapital - baseInp.paidInCapital), 'Paid-in member equity');
  setDataRow(ws1120s, 36, 'Sch L-24', 'Retained Earnings / AAA Equity Balance', f('C32-C33-C34-C35', baseEval.retainedEarningsPlug), f('D32-D33-D34-D35', projEval.retainedEarningsPlug), f('D36-C36', projEval.retainedEarningsPlug - baseEval.retainedEarningsPlug), 'Accumulated retained earnings / (deficit)', { zebra: true });
  setDataRow(ws1120s, 37, 'Sch L-27', 'Total Liabilities & Shareholders\' Equity', f('SUM(C33:C36)', baseEval.totalLiabEq), f('SUM(D33:D36)', projEval.totalLiabEq), f('D37-C37', projEval.totalLiabEq - baseEval.totalLiabEq), 'Balanced: Total Assets = Total Liab + Equity', { total: true });

  styleSectionRow(ws1120s, 39, 6, 'SCHEDULE M-1 — RECONCILIATION OF INCOME (LOSS) PER BOOKS WITH INCOME PER RETURN');
  setDataRow(ws1120s, 40, 'M-1 L1', 'Net Income (Loss) per Books', f('C24+C25-C26', baseEval.bookNetIncome), f('D24+D25-D26', projEval.bookNetIncome), f('D40-C40', projEval.bookNetIncome - baseEval.bookNetIncome), 'Taxable K-1 income less 50% nondeductible meals');
  setDataRow(ws1120s, 41, 'M-1 L3b', 'Add: Expenses Recorded on Books Not Included on Sch K (50% Meals)', f('C26', baseEval.nondedMeals), f('D26', projEval.nondedMeals), f('D41-C41', projEval.nondedMeals - baseEval.nondedMeals), '50% disallowed business meals', { zebra: true });
  setDataRow(ws1120s, 42, 'M-1 L8', 'Income (Loss) — Schedule K Line 18 Reconciliation', f('C40+C41', baseEval.m1FedIncome), f('D40+D41', projEval.m1FedIncome), f('D42-C42', projEval.m1FedIncome - baseEval.m1FedIncome), 'Ties exactly to Sch K Line 1 + Line 4', { bold: true });

  styleSectionRow(ws1120s, 44, 6, 'SCHEDULE M-2 — ANALYSIS OF ACCUMULATED ADJUSTMENTS ACCOUNT (AAA)');
  setDataRow(ws1120s, 45, 'M-2 L1', 'Balance at Beginning of Tax Year', f('Inputs!C41', baseInp.begAaa), f('Inputs!D41', projInp.begAaa), f('D45-C45', projInp.begAaa - baseInp.begAaa), 'Prior year Schedule M-2 ending balance');
  setDataRow(ws1120s, 46, 'M-2 L2', 'Ordinary Income from Page 1, Line 22', f('C20', baseEval.obi), f('D20', projEval.obi), f('D46-C46', projEval.obi - baseEval.obi), 'Increases AAA', { zebra: true });
  setDataRow(ws1120s, 47, 'M-2 L3', 'Other Additions (Schedule K Interest Income)', f('C25', baseEval.scorpInterest), f('D25', projEval.scorpInterest), f('D47-C47', projEval.scorpInterest - baseEval.scorpInterest), 'Taxable portfolio income increases AAA');
  setDataRow(ws1120s, 48, 'M-2 L5', 'Other Reductions (Nondeductible 50% Meals)', f('-C26', -baseEval.nondedMeals), f('-D26', -projEval.nondedMeals), f('D48-C48', -(projEval.nondedMeals - baseEval.nondedMeals)), 'Nondeductible expenses reduce AAA', { zebra: true });
  setDataRow(ws1120s, 49, 'M-2 L6', 'Combine Lines 1 through 5 (AAA Before Distributions)', f('SUM(C45:C48)', baseEval.aaaSubtotal), f('SUM(D45:D48)', projEval.aaaSubtotal), f('D49-C49', projEval.aaaSubtotal - baseEval.aaaSubtotal), 'Subtotal prior to distributions', { bold: true });
  setDataRow(ws1120s, 50, 'M-2 L7', 'Distributions Other Than Dividend Distributions', f('-C27', -baseEval.distributions), f('-D27', -projEval.distributions), f('D50-C50', -(projEval.distributions - baseEval.distributions)), 'Shareholder draws during year', { zebra: true });
  setDataRow(ws1120s, 51, 'M-2 L8', 'Balance at End of Tax Year (Ending AAA)', f('C49+C50', baseEval.endingAaa), f('D49+D50', projEval.endingAaa), f('D51-C51', projEval.endingAaa - baseEval.endingAaa), 'Carries forward to next tax year', { total: true });

  // =========================================================================
  // TAB 4: K-1 & Form 7203
  // =========================================================================
  applyBannerAndPrint(
    wsK1,
    6,
    `SCHEDULE K-1 ALLOCATIONS & FORM 7203 STOCK BASIS WATERFALL (${baseYear} & ${projYear})`,
    'IRS ordering rules: Beginning Basis + Contributions + Income → Distributions (Excess Gain to Sch D) → Nondeductibles',
    branding,
    [11, 46, 17, 17, 16, 34]
  );
  styleTableHeader(wsK1, 4, ['Ref', 'Shareholder K-1 / Form 7203 Line', baseColHdr, projColHdr, 'YoY Change', 'IRS Ordering / Flow Note']);

  styleSectionRow(wsK1, 5, 6, `PART I — SCHEDULE K-1 ALLOCATION: ${primaryLabel.toUpperCase()}`);
  setDataRow(wsK1, 6, 'K1-P%', `${primaryLabel} Ownership Percentage`, f('Inputs!C6', baseInp.primaryOwnershipPct), f('Inputs!D6', projInp.primaryOwnershipPct), f('D6-C6', projInp.primaryOwnershipPct - baseInp.primaryOwnershipPct), 'Shareholder stock ownership %', { numFmt: FMT.percent1 });
  setDataRow(wsK1, 7, 'Box 1', 'Ordinary Business Income (Loss)', f(`ROUND('1120-S (Fed S-Corp)'!C20*C6,0)`, baseEval.pObi), f(`ROUND('1120-S (Fed S-Corp)'!D20*D6,0)`, projEval.pObi), f('D7-C7', projEval.pObi - baseEval.pObi), 'Pro rata share of 1120-S Line 22', { zebra: true });
  setDataRow(wsK1, 8, 'Box 4', 'Interest Income', f(`ROUND('1120-S (Fed S-Corp)'!C25*C6,0)`, baseEval.pInt), f(`ROUND('1120-S (Fed S-Corp)'!D25*D6,0)`, projEval.pInt), f('D8-C8', projEval.pInt - baseEval.pInt), 'Pro rata share of Sch K Line 4');
  setDataRow(wsK1, 9, 'Box 16C', 'Nondeductible Expenses (50% Meals)', f(`ROUND('1120-S (Fed S-Corp)'!C26*C6,0)`, baseEval.pNonded), f(`ROUND('1120-S (Fed S-Corp)'!D26*D6,0)`, projEval.pNonded), f('D9-C9', projEval.pNonded - baseEval.pNonded), 'Reduces basis after distributions', { zebra: true });
  setDataRow(wsK1, 10, 'Box 16D', 'Distributions', f(`ROUND('1120-S (Fed S-Corp)'!C27*C6,0)`, baseEval.pDist), f(`ROUND('1120-S (Fed S-Corp)'!D27*D6,0)`, projEval.pDist), f('D10-C10', projEval.pDist - baseEval.pDist), 'Pro rata shareholder distributions');

  styleSectionRow(wsK1, 12, 6, `PART II — SCHEDULE K-1 ALLOCATION: ${(spouseLabel || 'Spouse').toUpperCase()}`);
  setDataRow(wsK1, 13, 'K1-S%', `${spouseLabel || 'Spouse'} Ownership Percentage`, f('Inputs!C7', baseInp.spouseOwnershipPct), f('Inputs!D7', projInp.spouseOwnershipPct), f('D13-C13', projInp.spouseOwnershipPct - baseInp.spouseOwnershipPct), 'Shareholder stock ownership %', { numFmt: FMT.percent1 });
  setDataRow(wsK1, 14, 'Box 1', 'Ordinary Business Income (Loss)', f(`'1120-S (Fed S-Corp)'!C20-C7`, baseEval.sObi), f(`'1120-S (Fed S-Corp)'!D20-D7`, projEval.sObi), f('D14-C14', projEval.sObi - baseEval.sObi), 'Exact complement to prevent rounding drift', { zebra: true });
  setDataRow(wsK1, 15, 'Box 4', 'Interest Income', f(`'1120-S (Fed S-Corp)'!C25-C8`, baseEval.sInt), f(`'1120-S (Fed S-Corp)'!D25-D8`, projEval.sInt), f('D15-C15', projEval.sInt - baseEval.sInt), 'Pro rata share of Sch K Line 4');
  setDataRow(wsK1, 16, 'Box 16C', 'Nondeductible Expenses (50% Meals)', f(`'1120-S (Fed S-Corp)'!C26-C9`, baseEval.sNonded), f(`'1120-S (Fed S-Corp)'!D26-D9`, projEval.sNonded), f('D16-C16', projEval.sNonded - baseEval.sNonded), 'Reduces basis after distributions', { zebra: true });
  setDataRow(wsK1, 17, 'Box 16D', 'Distributions', f(`'1120-S (Fed S-Corp)'!C27-C10`, baseEval.sDist), f(`'1120-S (Fed S-Corp)'!D27-D10`, projEval.sDist), f('D17-C17', projEval.sDist - baseEval.sDist), 'Pro rata shareholder distributions');

  styleSectionRow(wsK1, 19, 6, `PART III — FORM 7203 STOCK BASIS WATERFALL: ${primaryLabel.toUpperCase()}`);
  setDataRow(wsK1, 20, '7203-1', 'Stock Basis at Beginning of Tax Year', f('Inputs!C44', baseInp.primaryBegStockBasis), f('Inputs!D44', projInp.primaryBegStockBasis), f('D20-C20', projInp.primaryBegStockBasis - baseInp.primaryBegStockBasis), 'Prior year Form 7203 Line 15');
  setDataRow(wsK1, 21, '7203-2', 'Capital Contributions Made During Year', f('ROUND(Inputs!C42*C6,0)', baseEval.pCapContrib), f('ROUND(Inputs!D42*D6,0)', projEval.pCapContrib), f('D21-C21', projEval.pCapContrib - baseEval.pCapContrib), 'Direct paid-in capital', { zebra: true });
  setDataRow(wsK1, 22, '7203-3', 'Income Additions (Positive K-1 OBI + K-1 Interest)', f('MAX(0,C7)+C8', baseEval.pIncAdd), f('MAX(0,D7)+D8', projEval.pIncAdd), f('D22-C22', projEval.pIncAdd - baseEval.pIncAdd), 'IRC §1367(a)(1) increases');
  setDataRow(wsK1, 23, '7203-5', 'Stock Basis Before Distributions', f('C20+C21+C22', baseEval.pBasisBeforeDist), f('D20+D21+D22', projEval.pBasisBeforeDist), f('D23-C23', projEval.pBasisBeforeDist - baseEval.pBasisBeforeDist), 'Available basis to absorb tax-free draws', { bold: true });
  setDataRow(wsK1, 24, '7203-6', 'Less: Non-Dividend Distributions (K-1 Box 16D)', f('C10', baseEval.pDist), f('D10', projEval.pDist), f('D24-C24', projEval.pDist - baseEval.pDist), 'Tested BEFORE nondeductibles per IRC §1368', { zebra: true });
  setDataRow(wsK1, 25, 'Sch D', 'Excess Distribution Capital Gain (Form 8949 / Sch D)', f('MAX(0,C24-C23)', baseEval.pExcessGain), f('MAX(0,D24-D23)', projEval.pExcessGain), f('D25-C25', projEval.pExcessGain - baseEval.pExcessGain), 'Taxable LTCG if distributions exceed basis', { bold: true });
  setDataRow(wsK1, 26, '7203-7', 'Stock Basis After Distributions', f('MAX(0,C23-C24)', baseEval.pBasisAfterDist), f('MAX(0,D23-D24)', projEval.pBasisAfterDist), f('D26-C26', projEval.pBasisAfterDist - baseEval.pBasisAfterDist), 'Cannot drop below $0', { zebra: true });
  setDataRow(wsK1, 27, '7203-8', 'Less: Nondeductible Expenses & Ordinary Losses', f('C9+ABS(MIN(0,C7))', baseEval.pReduct), f('D9+ABS(MIN(0,D7))', projEval.pReduct), f('D27-C27', projEval.pReduct - baseEval.pReduct), 'IRC §1367(a)(2) reductions');
  setDataRow(wsK1, 28, '7203-15', `${primaryLabel} Ending Stock Basis`, f('MAX(0,C26-C27)', baseEval.pEndBasis), f('MAX(0,D26-D27)', projEval.pEndBasis), f('D28-C28', projEval.pEndBasis - baseEval.pEndBasis), 'Carries forward to next tax year', { bold: true });

  styleSectionRow(wsK1, 30, 6, `PART IV — FORM 7203 STOCK BASIS WATERFALL: ${(spouseLabel || 'Spouse').toUpperCase()}`);
  setDataRow(wsK1, 31, '7203-1', 'Stock Basis at Beginning of Tax Year', f('Inputs!C45', baseInp.spouseBegStockBasis), f('Inputs!D45', projInp.spouseBegStockBasis), f('D31-C31', projInp.spouseBegStockBasis - baseInp.spouseBegStockBasis), 'Prior year Form 7203 Line 15');
  setDataRow(wsK1, 32, '7203-2', 'Capital Contributions Made During Year', f('Inputs!C42-C21', baseEval.sCapContrib), f('Inputs!D42-D21', projEval.sCapContrib), f('D32-C32', projEval.sCapContrib - baseEval.sCapContrib), 'Direct paid-in capital', { zebra: true });
  setDataRow(wsK1, 33, '7203-3', 'Income Additions (Positive K-1 OBI + K-1 Interest)', f('MAX(0,C14)+C15', baseEval.sIncAdd), f('MAX(0,D14)+D15', projEval.sIncAdd), f('D33-C33', projEval.sIncAdd - baseEval.sIncAdd), 'IRC §1367(a)(1) increases');
  setDataRow(wsK1, 34, '7203-5', 'Stock Basis Before Distributions', f('C31+C32+C33', baseEval.sBasisBeforeDist), f('D31+D32+D33', projEval.sBasisBeforeDist), f('D34-C34', projEval.sBasisBeforeDist - baseEval.sBasisBeforeDist), 'Available basis to absorb tax-free draws', { bold: true });
  setDataRow(wsK1, 35, '7203-6', 'Less: Non-Dividend Distributions (K-1 Box 16D)', f('C17', baseEval.sDist), f('D17', projEval.sDist), f('D35-C35', projEval.sDist - baseEval.sDist), 'Tested BEFORE nondeductibles per IRC §1368', { zebra: true });
  setDataRow(wsK1, 36, 'Sch D', 'Excess Distribution Capital Gain (Form 8949 / Sch D)', f('MAX(0,C35-C34)', baseEval.sExcessGain), f('MAX(0,D35-D34)', projEval.sExcessGain), f('D36-C36', projEval.sExcessGain - baseEval.sExcessGain), 'Taxable LTCG if distributions exceed basis', { bold: true });
  setDataRow(wsK1, 37, '7203-7', 'Stock Basis After Distributions', f('MAX(0,C34-C35)', baseEval.sBasisAfterDist), f('MAX(0,D34-D35)', projEval.sBasisAfterDist), f('D37-C37', projEval.sBasisAfterDist - baseEval.sBasisAfterDist), 'Cannot drop below $0', { zebra: true });
  setDataRow(wsK1, 38, '7203-8', 'Less: Nondeductible Expenses & Ordinary Losses', f('C16+ABS(MIN(0,C14))', baseEval.sReduct), f('D16+ABS(MIN(0,D14))', projEval.sReduct), f('D38-C38', projEval.sReduct - baseEval.sReduct), 'IRC §1367(a)(2) reductions');
  setDataRow(wsK1, 39, '7203-15', `${spouseLabel || 'Spouse'} Ending Stock Basis`, f('MAX(0,C37-C38)', baseEval.sEndBasis), f('MAX(0,D37-D38)', projEval.sEndBasis), f('D39-C39', projEval.sEndBasis - baseEval.sEndBasis), 'Carries forward to next tax year', { bold: true });

  styleSectionRow(wsK1, 41, 6, 'PART V — COMBINED FORM 7203 SUMMARY (FLOWS TO DASHBOARD & FORM 1040 SCHEDULE D)');
  setDataRow(wsK1, 42, '7203-TOT', 'Combined Ending Federal Stock Basis', f('C28+C39', baseEval.combEndBasis), f('D28+D39', projEval.combEndBasis), f('D42-C42', projEval.combEndBasis - baseEval.combEndBasis), 'Total shareholder stock basis EOY', { total: true });
  setDataRow(wsK1, 43, '8949-TOT', 'Combined Excess Distribution Capital Gain (To 1040 Sch D)', f('C25+C36', baseEval.combExcessGain), f('D25+D36', projEval.combExcessGain), f('D43-C43', projEval.combExcessGain - baseEval.combExcessGain), 'Auto-flows to Form 1040 Line 7 (Schedule D)', { total: true });

  // =========================================================================
  // TAB 5: AZ 120S & CA 100S
  // =========================================================================
  applyBannerAndPrint(
    wsStateBiz,
    6,
    `STATE S-CORP RETURNS — ARIZONA FORM 120S & CALIFORNIA FORM 100S (${baseYear} & ${projYear})`,
    'AZ double-weighted sales apportionment & PTE tax; CA single-sales factor, 1.5% franchise tax ($800 min), K-1 adjustments & PTE',
    branding,
    [11, 46, 17, 17, 16, 34]
  );
  styleTableHeader(wsStateBiz, 4, ['Ref', 'State S-Corp Return Line', baseColHdr, projColHdr, 'YoY Change', 'Statutory Apportionment / PTE Note']);

  styleSectionRow(wsStateBiz, 5, 6, 'PART I — ARIZONA FORM 120S (S CORPORATION INCOME TAX RETURN)');
  setDataRow(wsStateBiz, 6, '120S-A1', 'Arizona-Sourced Gross Receipts', f('Inputs!C9', baseInp.azRevenue), f('Inputs!D9', projInp.azRevenue), f('D6-C6', projInp.azRevenue - baseInp.azRevenue), 'AZ market-sourced service sales');
  setDataRow(wsStateBiz, 7, '120S-A2', 'Everywhere Total Gross Receipts', f('Inputs!C11', baseEval.grossReceipts), f('Inputs!D11', projEval.grossReceipts), f('D7-C7', projEval.grossReceipts - baseEval.grossReceipts), 'Denominator for AZ sales factor', { zebra: true });
  setDataRow(wsStateBiz, 8, '120S-A3', 'AZ Sales Ratio (AZ Sales / Total Sales)', f('IF(C7>0,C6/C7,0)', baseEval.azSalesRatio), f('IF(D7>0,D6/D7,0)', projEval.azSalesRatio), f('D8-C8', projEval.azSalesRatio - baseEval.azSalesRatio), 'Sales factor numerator/denominator', { numFmt: FMT.percent2 });
  setDataRow(wsStateBiz, 9, '120S-A4', 'AZ Apportionment Factor (Double-Weighted / Enhanced Sales)', f('C8', baseEval.azSalesRatio), f('D8', projEval.azSalesRatio), f('D9-C9', projEval.azSalesRatio - baseEval.azSalesRatio), 'Enhanced 100% sales election for service entities', { numFmt: FMT.percent2, zebra: true });
  setDataRow(wsStateBiz, 10, '120S-L1', 'Federal Form 1120-S Ordinary Business Income', f(`'1120-S (Fed S-Corp)'!C20`, baseEval.obi), f(`'1120-S (Fed S-Corp)'!D20`, projEval.obi), f('D10-C10', projEval.obi - baseEval.obi), 'Starting point from Fed 1120-S Line 22');
  setDataRow(wsStateBiz, 11, '120S-L10', 'Arizona-Apportioned S-Corp Net Income (To AZ 140NR)', f('ROUND(C10*C9,0)', baseEval.azApportionedIncome), f('ROUND(D10*D9,0)', projEval.azApportionedIncome), f('D11-C11', projEval.azApportionedIncome - baseEval.azApportionedIncome), 'Flows to AZ Form 140NR Line AZ-2', { bold: true, zebra: true });
  setDataRow(wsStateBiz, 12, '120S-L16', 'Arizona Form 120S Minimum Corporate Tax', f(`IF(C6>0,'Tax Tables'!C28,0)`, baseEval.az120sMin), f(`IF(D6>0,'Tax Tables'!D28,0)`, projEval.az120sMin), f('D12-C12', projEval.az120sMin - baseEval.az120sMin), '$50 minimum if AZ-sourced activity');
  setDataRow(wsStateBiz, 13, '120S-PTE', 'Arizona Elective PTE Entity Tax (2.98% when ON)', f('Inputs!C31', baseEval.azPteAmt), f('Inputs!D31', projEval.azPteAmt), f('D13-C13', projEval.azPteAmt - baseEval.azPteAmt), 'Generates 100% credit on AZ 140NR when ON', { zebra: true });
  setDataRow(wsStateBiz, 14, '120S-TOT', 'Total AZ Form 120S Entity Payment (Min + PTE)', f('C12+C13', baseEval.az120sTotal), f('D12+D13', projEval.az120sTotal), f('D14-C14', projEval.az120sTotal - baseEval.az120sTotal), 'Total entity-level remittance to ADOR', { total: true });

  styleSectionRow(wsStateBiz, 16, 6, 'PART II — CALIFORNIA FORM 100S (CALIFORNIA S CORPORATION FRANCHISE OR INCOME TAX RETURN)');
  setDataRow(wsStateBiz, 17, '100S-A1', 'California-Sourced Gross Receipts', f('Inputs!C8', baseInp.caRevenue), f('Inputs!D8', projInp.caRevenue), f('D17-C17', projInp.caRevenue - baseInp.caRevenue), 'CA market-based sourcing (R&TC §25136)');
  setDataRow(wsStateBiz, 18, '100S-A2', 'Everywhere Total Gross Receipts', f('Inputs!C11', baseEval.grossReceipts), f('Inputs!D11', projEval.grossReceipts), f('D18-C18', projEval.grossReceipts - baseEval.grossReceipts), 'Denominator for CA single-sales factor', { zebra: true });
  setDataRow(wsStateBiz, 19, '100S-A3', 'CA Single-Sales Factor Apportionment %', f('IF(C18>0,C17/C18,0)', baseEval.caSalesRatio), f('IF(D18>0,D17/D18,0)', projEval.caSalesRatio), f('D19-C19', projEval.caSalesRatio - baseEval.caSalesRatio), 'CA mandatory single-sales factor', { numFmt: FMT.percent2 });
  setDataRow(wsStateBiz, 20, '100S-L1', 'Federal Form 1120-S Ordinary Business Income', f(`'1120-S (Fed S-Corp)'!C20`, baseEval.obi), f(`'1120-S (Fed S-Corp)'!D20`, projEval.obi), f('D20-C20', projEval.obi - baseEval.obi), 'Starting point from Fed 1120-S Line 22', { zebra: true });
  setDataRow(wsStateBiz, 21, '100S-L2', 'Memo: CA Franchise & PTE Taxes Deducted on Fed 1120-S', f('Inputs!C19+Inputs!C29', baseEval.caTaxAddback), f('Inputs!D19+Inputs!D29', projEval.caTaxAddback), f('D21-C21', projEval.caTaxAddback - baseEval.caTaxAddback), 'Reference add-back schedule');
  setDataRow(wsStateBiz, 22, '100S-L12', 'CA vs. Federal Depreciation / Asset Disposal Adjustment', f('Inputs!C26', baseInp.caDeprAdj), f('Inputs!D26', projInp.caDeprAdj), f('D22-C22', projInp.caDeprAdj - baseInp.caDeprAdj), 'Fed bonus / §179 vs. CA basis disposal diff', { zebra: true });
  setDataRow(wsStateBiz, 23, '100S-L18', 'CA Net Income for Franchise Tax (Apportioned)', f('ROUND(MAX(0,(C20+C22)*C19),0)', baseEval.ca100sNetIncome), f('ROUND(MAX(0,(D20+D22)*D19),0)', projEval.ca100sNetIncome), f('D23-C23', projEval.ca100sNetIncome - baseEval.ca100sNetIncome), 'Subject to 1.5% CA S-Corp franchise tax');
  setDataRow(wsStateBiz, 24, '100S-L21a', 'Calculated 1.5% CA Franchise Tax', f(`ROUND(C23*'Tax Tables'!C30,0)`, baseEval.ca100sCalcTax), f(`ROUND(D23*'Tax Tables'!D30,0)`, projEval.ca100sCalcTax), f('D24-C24', projEval.ca100sCalcTax - baseEval.ca100sCalcTax), '1.5% of CA apportioned net income', { zebra: true });
  setDataRow(wsStateBiz, 25, '100S-L21', 'CA Form 100S Franchise Tax (Greater of 1.5% or $800 Min)', f(`IF(OR(C17>0,Inputs!C67>0),MAX('Tax Tables'!C31,C24),0)`, baseEval.ca100sFranchiseTax), f(`IF(OR(D17>0,Inputs!D67>0),MAX('Tax Tables'!D31,D24),0)`, projEval.ca100sFranchiseTax), f('D25-C25', projEval.ca100sFranchiseTax - baseEval.ca100sFranchiseTax), 'Ties to Dashboard Tie-Out & Variance Tracker', { total: true });
  setDataRow(wsStateBiz, 26, '100S-L33', 'Less: CA Form 100S Estimated Tax Paid', f('Inputs!C47', baseInp.ca100sEstPaid), f('Inputs!D47', projInp.ca100sEstPaid), f('D26-C26', projInp.ca100sEstPaid - baseInp.ca100sEstPaid), 'Form 100-ES prepayment');
  setDataRow(wsStateBiz, 27, '100S-L38', 'CA 100S Franchise Tax Balance Due / (Overpayment)', f('C25-C26', baseEval.ca100sBalDue), f('D25-D26', projEval.ca100sBalDue), f('D27-C27', projEval.ca100sBalDue - baseEval.ca100sBalDue), 'Net due with Form 100S', { zebra: true });
  setDataRow(wsStateBiz, 28, 'K1-100S', 'CA Schedule K-1 (100S) Net Adjustment vs. Fed K-1', f('C22', baseEval.caK1Adj), f('D22', projEval.caK1Adj), f('D28-C28', projEval.caK1Adj - baseEval.caK1Adj), 'Flows to CA Form 540 Schedule CA');
  setDataRow(wsStateBiz, 29, '3893-PTE', 'CA Elective PTE Tax (Form 3893 — 9.3% when ON)', f('Inputs!C29', baseEval.caPteAmt), f('Inputs!D29', projEval.caPteAmt), f('D29-C29', projEval.caPteAmt - baseEval.caPteAmt), 'Flows to CA 540 PTE Credit (net of SB 132)', { bold: true, zebra: true });
  setDataRow(wsStateBiz, 30, '100S-TOT', 'Total CA 100S Entity Liability (Franchise + PTE)', f('C25+C29', baseEval.ca100sTotalTax), f('D25+D29', projEval.ca100sTotalTax), f('D30-C30', projEval.ca100sTotalTax - baseEval.ca100sTotalTax), 'Total entity-level remittance to FTB', { total: true });

  // =========================================================================
  // TAB 6: 1040 (Fed Personal)
  // =========================================================================
  applyBannerAndPrint(
    ws1040,
    6,
    `FORM 1040 — U.S. INDIVIDUAL INCOME TAX RETURN & SUPPORTING WORKSHEETS (${baseYear} & ${projYear})`,
    'Pages 1–2 plus Worksheet A (Sch 1-A Senior Deduction), Worksheet B (Form 8995 QBI), and Worksheet C (QDCG & IRS Tax Table)',
    branding,
    [11, 46, 17, 17, 16, 34]
  );
  styleTableHeader(ws1040, 4, ['Line', 'Form 1040 / Supporting Worksheet Line', baseColHdr, projColHdr, 'YoY Change', 'Statutory / Cross-Sheet Reference']);

  styleSectionRow(ws1040, 5, 6, 'FORM 1040 PAGE 1 — INCOME & ADJUSTED GROSS INCOME');
  setDataRow(ws1040, 6, 'Line 1a', 'W-2 Box 1 Taxable Wages (Gross Less EE 401(k) + SEHI)', f('MAX(0,Inputs!C15-Inputs!C50)+MAX(0,Inputs!C16-Inputs!C51)+Inputs!C52+Inputs!C22', baseEval.w2Box1), f('MAX(0,Inputs!D15-Inputs!D50)+MAX(0,Inputs!D16-Inputs!D51)+Inputs!D52+Inputs!D22', projEval.w2Box1), f('D6-C6', projEval.w2Box1 - baseEval.w2Box1), 'Officer + Staff Box 1 taxable wages');
  setDataRow(ws1040, 7, 'Line 2b', 'Taxable Interest (1099-INT + S-Corp K-1 Box 4)', f(`Inputs!C53+'1120-S (Fed S-Corp)'!C25`, baseEval.line2bInt), f(`Inputs!D53+'1120-S (Fed S-Corp)'!D25`, projEval.line2bInt), f('D7-C7', projEval.line2bInt - baseEval.line2bInt), 'Personal + pass-through bank interest', { zebra: true });
  setDataRow(ws1040, 8, 'Line 3b', 'Ordinary Dividends (1099-DIV)', f('Inputs!C55', baseInp.ordinaryDividends), f('Inputs!D55', projInp.ordinaryDividends), f('D8-C8', projInp.ordinaryDividends - baseInp.ordinaryDividends), 'Includes qualified dividends (Line 3a)');
  setDataRow(ws1040, 9, 'Line 4b', 'Taxable IRA Distributions (1099-R)', f('Inputs!C57', baseInp.iraTaxable), f('Inputs!D57', projInp.iraTaxable), f('D9-C9', projInp.iraTaxable - baseInp.iraTaxable), 'Traditional IRA / RMD distributions', { zebra: true });
  setDataRow(ws1040, 10, 'Line 5b', 'Taxable Pensions and Annuities (1099-R)', f('Inputs!C58', baseInp.pensionsTaxable), f('Inputs!D58', projInp.pensionsTaxable), f('D10-C10', projInp.pensionsTaxable - baseInp.pensionsTaxable), 'Taxable pension / annuity income');
  setDataRow(ws1040, 11, 'Line 6b', 'Taxable Social Security Benefits (Inputs!Row 64)', f('Inputs!C64', baseInp.ssTaxable), f('Inputs!D64', projInp.ssTaxable), f('D11-C11', projInp.ssTaxable - baseInp.ssTaxable), 'Exempt in CA (subtracted on SchCA-B Row 22)', { zebra: true });
  setDataRow(ws1040, 12, 'Line 7', 'Schedule D Net Capital Gain / (Loss) (Incl. Form 7203 Excess)', f(`Inputs!C60+'K-1 & Form 7203'!C43`, baseEval.schD), f(`Inputs!D60+'K-1 & Form 7203'!D43`, projEval.schD), f('D12-C12', projEval.schD - baseEval.schD), 'Brokerage Sch D + Form 7203 excess dist gain');
  setDataRow(ws1040, 13, 'Line 8', 'Schedule 1 / Schedule E S-Corp K-1 Ordinary Income', f(`'1120-S (Fed S-Corp)'!C20`, baseEval.obi), f(`'1120-S (Fed S-Corp)'!D20`, projEval.obi), f('D13-C13', projEval.obi - baseEval.obi), 'Direct link to Form 1120-S Line 22', { zebra: true });
  setDataRow(ws1040, 14, 'Line 9', 'Total Income', f('SUM(C6:C13)', baseEval.totalIncome), f('SUM(D6:D13)', projEval.totalIncome), f('D14-C14', projEval.totalIncome - baseEval.totalIncome), 'Sum of Lines 1a through 8', { bold: true });
  setDataRow(ws1040, 15, 'Line 10', 'Adjustments to Income (Sch 1 Other + >2% Owner SEHI)', f('Inputs!C61+Inputs!C22', baseEval.sch1Adj), f('Inputs!D61+Inputs!D22', projEval.sch1Adj), f('D15-C15', projEval.sch1Adj - baseEval.sch1Adj), 'Above-the-line deductions reducing AGI', { zebra: true });
  setDataRow(ws1040, 16, 'Line 11', 'Adjusted Gross Income (AGI)', f('C14-C15', baseEval.agi), f('D14-D15', projEval.agi), f('D16-C16', projEval.agi - baseEval.agi), 'Feeds Sch 1-A, CA 540, AZ 140NR & Dashboard', { total: true });

  styleSectionRow(ws1040, 17, 6, 'FORM 1040 PAGES 1–2 — DEDUCTIONS, TAXABLE INCOME & TOTAL TAX');
  setDataRow(ws1040, 18, 'Line 12', 'Standard Deduction (Incl. Age 65+ Add-On) or Itemized', f(`MAX('Tax Tables'!C14+Inputs!C63*'Tax Tables'!C15,Inputs!C62)`, baseEval.stdOrItemized), f(`MAX('Tax Tables'!D14+Inputs!D63*'Tax Tables'!D15,Inputs!D62)`, projEval.stdOrItemized), f('D18-C18', projEval.stdOrItemized - baseEval.stdOrItemized), 'Base std ded + Age 65+ add-ons');
  setDataRow(ws1040, 19, 'Sch 1-A', 'Enhanced Senior Deduction (From Worksheet A)', f('C35', baseEval.seniorAllowed), f('D35', projEval.seniorAllowed), f('D19-C19', projEval.seniorAllowed - baseEval.seniorAllowed), '6% phase-out above MAGI threshold', { zebra: true });
  setDataRow(ws1040, 20, 'Line 13', 'Qualified Business Income Deduction (From Worksheet B)', f('C43', baseEval.qbiAllowed), f('D43', projEval.qbiAllowed), f('D20-C20', projEval.qbiAllowed - baseEval.qbiAllowed), 'Form 8995 20% QBI deduction');
  setDataRow(ws1040, 21, 'Line 15', 'Federal Taxable Income', f('MAX(0,C16-C18-C19-C20)', baseEval.taxableIncome), f('MAX(0,D16-D18-D19-D20)', projEval.taxableIncome), f('D21-C21', projEval.taxableIncome - baseEval.taxableIncome), 'Line 11 minus Lines 12, Sch 1-A & 13', { total: true });
  setDataRow(ws1040, 22, 'Line 16', 'Income Tax (From Worksheet C — QDCG & IRS Tax Table)', f('C55', baseEval.line16Tax), f('D55', projEval.line16Tax), f('D22-C22', projEval.line16Tax - baseEval.line16Tax), 'Ordinary + 0%/15%/20% preferential tax');
  setDataRow(ws1040, 23, 'Line 23', 'Net Investment Income Tax (Form 8960 — 3.8% NIIT)', f(`ROUND(MAX(0,MIN(C7+C8+MAX(0,C12),C16-'Tax Tables'!C22))*'Tax Tables'!C23,0)`, baseEval.niit), f(`ROUND(MAX(0,MIN(D7+D8+MAX(0,D12),D16-'Tax Tables'!D22))*'Tax Tables'!D23,0)`, projEval.niit), f('D23-C23', projEval.niit - baseEval.niit), 'Applies above NIIT MAGI threshold', { zebra: true });
  setDataRow(ws1040, 24, 'Line 24', 'Federal Total Tax', f('C22+C23', baseEval.totalFedTax), f('D22+D23', projEval.totalFedTax), f('D24-C24', projEval.totalFedTax - baseEval.totalFedTax), 'Ties to Dashboard Tie-Out & Variance Tracker', { total: true });
  setDataRow(ws1040, 25, 'L25d+26', 'Less: Federal Withholding & 1040-ES Estimated Payments', f('Inputs!C65+Inputs!C66', baseEval.fedPayments), f('Inputs!D65+Inputs!D66', projEval.fedPayments), f('D25-C25', projEval.fedPayments - baseEval.fedPayments), 'Total federal tax prepayments');
  setDataRow(ws1040, 26, 'Line 37', 'Federal Balance Due / (Overpayment)', f('C24-C25', baseEval.fedBalDue), f('D24-D25', projEval.fedBalDue), f('D26-C26', projEval.fedBalDue - baseEval.fedBalDue), 'Net amount due or refund', { bold: true, zebra: true });

  styleSectionRow(ws1040, 28, 6, 'WORKSHEET A — SCHEDULE 1-A ENHANCED SENIOR DEDUCTION (6% PHASE-OUT ABOVE THRESHOLD)');
  setDataRow(ws1040, 29, 'WksA-1', 'Qualifying Seniors Age 65+ Count', f('Inputs!C63', baseInp.seniors65PlusCount), f('Inputs!D63', projInp.seniors65PlusCount), f('D29-C29', projInp.seniors65PlusCount - baseInp.seniors65PlusCount), '0, 1, or 2 eligible taxpayers', { numFmt: FMT.integer });
  setDataRow(ws1040, 30, 'WksA-2', 'Maximum Deduction Before Phase-out ($6,000 / Senior)', f(`C29*'Tax Tables'!C16`, baseEval.seniorMax), f(`D29*'Tax Tables'!D16`, projEval.seniorMax), f('D30-C30', projEval.seniorMax - baseEval.seniorMax), 'Statutory OBBBA 2025-2028 senior deduction', { zebra: true });
  setDataRow(ws1040, 31, 'WksA-3', 'Modified Adjusted Gross Income (Form 1040 Line 11)', f('C16', baseEval.agi), f('D16', projEval.agi), f('D31-C31', projEval.agi - baseEval.agi), 'MAGI for phase-out test');
  setDataRow(ws1040, 32, 'WksA-4', 'Phase-out Threshold ($150,000 MFJ / $75,000 Single)', f(`'Tax Tables'!C17`, baseTbl.seniorPhaseoutThreshold), f(`'Tax Tables'!D17`, projTbl.seniorPhaseoutThreshold), f('D32-C32', projTbl.seniorPhaseoutThreshold - baseTbl.seniorPhaseoutThreshold), 'Statutory phase-out floor', { zebra: true });
  setDataRow(ws1040, 33, 'WksA-5', 'Excess MAGI Above Phase-out Threshold', f('MAX(0,C31-C32)', baseEval.seniorExcess), f('MAX(0,D31-D32)', projEval.seniorExcess), f('D33-C33', projEval.seniorExcess - baseEval.seniorExcess), 'Subject to 6% reduction per senior');
  setDataRow(ws1040, 34, 'WksA-6', 'Phase-out Reduction (6% × Excess MAGI per Senior)', f(`C29*MIN('Tax Tables'!C16,ROUND(C33*'Tax Tables'!C18,0))`, baseEval.seniorReduction), f(`D29*MIN('Tax Tables'!D16,ROUND(D33*'Tax Tables'!D18,0))`, projEval.seniorReduction), f('D34-C34', projEval.seniorReduction - baseEval.seniorReduction), '12% combined phase-out for 2 MFJ seniors', { zebra: true });
  setDataRow(ws1040, 35, 'WksA-7', 'Allowed Schedule 1-A Enhanced Senior Deduction', f('MAX(0,C30-C34)', baseEval.seniorAllowed), f('MAX(0,D30-D34)', projEval.seniorAllowed), f('D35-C35', projEval.seniorAllowed - baseEval.seniorAllowed), 'Flows to Form 1040 Line Sch 1-A (Row 19)', { bold: true });

  styleSectionRow(ws1040, 37, 6, 'WORKSHEET B — FORM 8995 QUALIFIED BUSINESS INCOME (QBI) 20% DEDUCTION');
  setDataRow(ws1040, 38, '8995-L2', 'Qualified Business Income (S-Corp K-1 OBI)', f('MAX(0,C13)', baseEval.qbiBase), f('MAX(0,D13)', projEval.qbiBase), f('D38-C38', projEval.qbiBase - baseEval.qbiBase), 'Positive K-1 OBI eligible for §199A');
  setDataRow(ws1040, 39, '8995-L5', '20% of Qualified Business Income', f(`ROUND(C38*'Tax Tables'!C19,0)`, baseEval.qbi20), f(`ROUND(D38*'Tax Tables'!D19,0)`, projEval.qbi20), f('D39-C39', projEval.qbi20 - baseEval.qbi20), 'Preliminary 20% QBI deduction', { zebra: true });
  setDataRow(ws1040, 40, '8995-L11', 'Taxable Income Before QBI Deduction', f('MAX(0,C16-C18-C19)', baseEval.tiBeforeQbi), f('MAX(0,D16-D18-D19)', projEval.tiBeforeQbi), f('D40-C40', projEval.tiBeforeQbi - baseEval.tiBeforeQbi), 'AGI less Std/Itemized & Senior Deduction');
  setDataRow(ws1040, 41, '8995-L12', 'Less: Net Capital Gain (Qual Div + Positive Sch D)', f('Inputs!C56+MAX(0,C12)', baseEval.netCapGain), f('Inputs!D56+MAX(0,D12)', projEval.netCapGain), f('D41-C41', projEval.netCapGain - baseEval.netCapGain), 'Preferential income excluded from §199A cap', { zebra: true });
  setDataRow(ws1040, 42, '8995-L14', '20% of Ordinary Taxable Income Cap', f(`ROUND(MAX(0,C40-C41)*'Tax Tables'!C19,0)`, baseEval.qbiCap20), f(`ROUND(MAX(0,D40-D41)*'Tax Tables'!D19,0)`, projEval.qbiCap20), f('D42-C42', projEval.qbiCap20 - baseEval.qbiCap20), 'IRC §199A(a)(2) taxable income limitation');
  setDataRow(ws1040, 43, '8995-L15', 'Allowed Form 8995 QBI Deduction (Lesser of L5 or L14)', f('MIN(C39,C42)', baseEval.qbiAllowed), f('MIN(D39,D42)', projEval.qbiAllowed), f('D43-C43', projEval.qbiAllowed - baseEval.qbiAllowed), 'Flows to Form 1040 Line 13 (Row 20)', { bold: true });

  styleSectionRow(ws1040, 45, 6, 'WORKSHEET C — QUALIFIED DIVIDENDS & CAPITAL GAIN TAX WORKSHEET (WITH IRS $50 TAX TABLE RULE)');
  setDataRow(ws1040, 46, 'QDCG-1', 'Form 1040 Line 15 Taxable Income', f('C21', baseEval.taxableIncome), f('D21', projEval.taxableIncome), f('D46-C46', projEval.taxableIncome - baseEval.taxableIncome), 'Total taxable income');
  setDataRow(ws1040, 47, 'QDCG-4', 'Preferential Income (Qual Div + Net Capital Gain)', f('MIN(C46,Inputs!C56+MAX(0,C12))', baseEval.prefIncome), f('MIN(D46,Inputs!D56+MAX(0,D12))', projEval.prefIncome), f('D47-C47', projEval.prefIncome - baseEval.prefIncome), 'Eligible for 0% / 15% / 20% LTCG tiers', { zebra: true });
  setDataRow(ws1040, 48, 'QDCG-5', 'Ordinary Taxable Income', f('MAX(0,C46-C47)', baseEval.ordTaxableIncome), f('MAX(0,D46-D47)', projEval.ordTaxableIncome), f('D48-C48', projEval.ordTaxableIncome - baseEval.ordTaxableIncome), 'Taxed at ordinary progressive brackets');
  setDataRow(ws1040, 49, 'IRS-Tbl', 'IRS Tax Table Lookup Base ($50 Midpoint if $3k–$100k)', f('IF(AND(C48>=3000,C48<100000),INT(C48/50)*50+25,C48)', baseEval.irsLookupBase), f('IF(AND(D48>=3000,D48<100000),INT(D48/50)*50+25,D48)', projEval.irsLookupBase), f('D49-C49', projEval.irsLookupBase - baseEval.irsLookupBase), 'Exact IRS Form 1040 Tax Table rule', { zebra: true });
  setDataRow(ws1040, 50, 'QDCG-22', 'Tax on Ordinary Taxable Income (7-Bracket Formula)', f(progressiveFormula('C49', 'C', 6, 7), baseEval.ordTax), f(progressiveFormula('D49', 'D', 6, 7), projEval.ordTax), f('D50-C50', projEval.ordTax - baseEval.ordTax), 'Computed dynamically from Tax Tables tab');
  setDataRow(ws1040, 51, 'QDCG-9', 'Preferential Income Taxed at 0%', f(`MIN(C47,MAX(0,'Tax Tables'!C20-C48))`, baseEval.pref0), f(`MIN(D47,MAX(0,'Tax Tables'!D20-D48))`, projEval.pref0), f('D51-C51', projEval.pref0 - baseEval.pref0), '0% LTCG bracket capacity above ordinary TI', { zebra: true });
  setDataRow(ws1040, 52, 'QDCG-16', 'Preferential Income Taxed at 15%', f(`MIN(MAX(0,C47-C51),MAX(0,'Tax Tables'!C21-MAX(C48,'Tax Tables'!C20)))`, baseEval.pref15), f(`MIN(MAX(0,D47-D51),MAX(0,'Tax Tables'!D21-MAX(D48,'Tax Tables'!D20)))`, projEval.pref15), f('D52-C52', projEval.pref15 - baseEval.pref15), '15% LTCG tier');
  setDataRow(ws1040, 53, 'QDCG-19', 'Preferential Income Taxed at 20%', f('MAX(0,C47-C51-C52)', baseEval.pref20), f('MAX(0,D47-D51-D52)', projEval.pref20), f('D53-C53', projEval.pref20 - baseEval.pref20), '20% LTCG tier above 15% cap', { zebra: true });
  setDataRow(ws1040, 54, 'QDCG-21', 'Total Preferential (Qual Div / LTCG) Tax', f('ROUND(C52*0.15+C53*0.20,0)', baseEval.prefTax), f('ROUND(D52*0.15+D53*0.20,0)', projEval.prefTax), f('D54-C54', projEval.prefTax - baseEval.prefTax), 'Sum of 15% and 20% LTCG taxes');
  setDataRow(ws1040, 55, 'QDCG-25', 'Total Form 1040 Line 16 Income Tax', f('C50+C54', baseEval.line16Tax), f('D50+D54', projEval.line16Tax), f('D55-C55', projEval.line16Tax - baseEval.line16Tax), 'Flows to Form 1040 Line 16 (Row 22)', { total: true });

  // =========================================================================
  // TAB 7: AZ 140NR & CA 540 (EXACT Row 22 = SchCA-B with +Inputs!C64/+Inputs!D64)
  // =========================================================================
  applyBannerAndPrint(
    wsStateInd,
    6,
    `STATE INDIVIDUAL RETURNS — AZ FORM 140NR & CA FORM 540 / 540NR (${baseYear} & ${projYear})`,
    'AZ 2.5% flat rate + Form 309 CA reverse credit + AZ PTE; CA 540/540NR with 100% SS exemption (Row 22) + CA PTE credit',
    branding,
    [11, 46, 17, 17, 16, 34]
  );
  styleTableHeader(wsStateInd, 4, ['Ref', 'State Individual Tax Line', baseColHdr, projColHdr, 'YoY Change', 'Statutory / Cross-Sheet Reference']);

  styleSectionRow(wsStateInd, 5, 6, 'PART I — ARIZONA FORM 140NR (NONRESIDENT PERSONAL INCOME TAX RETURN)');
  setDataRow(wsStateInd, 6, 'AZ-1', 'Federal Adjusted Gross Income (Form 1040 Line 11)', f(`'1040 (Fed Personal)'!C16`, baseEval.agi), f(`'1040 (Fed Personal)'!D16`, projEval.agi), f('D6-C6', projEval.agi - baseEval.agi), 'Denominator for AZ income ratio');
  setDataRow(wsStateInd, 7, 'AZ-2', 'Arizona-Apportioned S-Corp K-1 Income (From AZ 120S)', f(`'AZ 120S & CA 100S'!C11`, baseEval.azApportionedIncome), f(`'AZ 120S & CA 100S'!D11`, projEval.azApportionedIncome), f('D7-C7', projEval.azApportionedIncome - baseEval.azApportionedIncome), 'Arizona-sourced pass-through income', { zebra: true });
  setDataRow(wsStateInd, 8, 'AZ-3', 'Arizona Income Ratio (AZ Sourced / Federal AGI)', f('IF(C6>0,MIN(1,MAX(0,C7/C6)),0)', baseEval.azRatio), f('IF(D6>0,MIN(1,MAX(0,D7/D6)),0)', projEval.azRatio), f('D8-C8', projEval.azRatio - baseEval.azRatio), 'Prorates AZ standard deduction & Form 309', { numFmt: FMT.percent2 });
  setDataRow(wsStateInd, 9, 'AZ-4', 'Prorated Arizona Standard Deduction', f(`ROUND('Tax Tables'!C26*C8,0)`, baseEval.azProratedStdDed), f(`ROUND('Tax Tables'!D26*D8,0)`, projEval.azProratedStdDed), f('D9-C9', projEval.azProratedStdDed - baseEval.azProratedStdDed), 'AZ standard deduction × AZ income ratio', { zebra: true });
  setDataRow(wsStateInd, 10, 'AZ-5', 'Arizona Taxable Income', f('MAX(0,C7-C9)', baseEval.azTaxable), f('MAX(0,D7-D9)', projEval.azTaxable), f('D10-C10', projEval.azTaxable - baseEval.azTaxable), 'AZ gross income less prorated deduction');
  setDataRow(wsStateInd, 11, 'AZ-6', 'Arizona Gross Tax (2.5% Flat Rate)', f(`ROUND(C10*'Tax Tables'!C25,0)`, baseEval.azGrossTax), f(`ROUND(D10*'Tax Tables'!D25,0)`, projEval.azGrossTax), f('D11-C11', projEval.azGrossTax - baseEval.azGrossTax), '2.5% flat statutory AZ tax rate', { zebra: true });
  setDataRow(wsStateInd, 12, 'AZ-7', 'Less: Form 309 Reverse Credit for Taxes Paid to CA', f('IF(AND(Inputs!C67>0,C31>0),MIN(C11,ROUND(C31*C8,0)),0)', baseEval.azForm309Credit), f('IF(AND(Inputs!D67>0,D31>0),MIN(D11,ROUND(D31*D8,0)),0)', projEval.azForm309Credit), f('D12-C12', projEval.azForm309Credit - baseEval.azForm309Credit), 'CA-AZ reverse credit state agreement');
  setDataRow(wsStateInd, 13, 'AZ-8', 'Less: Arizona PTE Tax Credit (If AZ PTE Elected)', f(`IF(Inputs!C30=1,'AZ 120S & CA 100S'!C13,0)`, baseEval.azPteCredit), f(`IF(Inputs!D30=1,'AZ 120S & CA 100S'!D13,0)`, projEval.azPteCredit), f('D13-C13', projEval.azPteCredit - baseEval.azPteCredit), '100% credit for AZ 120S PTE payment', { zebra: true });
  setDataRow(wsStateInd, 14, 'AZ-9', 'AZ Form 140NR Net Personal Income Tax', f('MAX(0,C11-C12-C13)', baseEval.azNetTax), f('MAX(0,D11-D12-D13)', projEval.azNetTax), f('D14-C14', projEval.azNetTax - baseEval.azNetTax), 'Ties to Dashboard Tie-Out & Variance Tracker', { total: true });
  setDataRow(wsStateInd, 15, 'AZ-10', 'Less: AZ Withholding & Estimated Payments', f('Inputs!C69', baseInp.azWithholdingEst), f('Inputs!D69', projInp.azWithholdingEst), f('D15-C15', projInp.azWithholdingEst - baseInp.azWithholdingEst), 'AZ tax prepayments');
  setDataRow(wsStateInd, 16, 'AZ-11', 'AZ Form 140NR Balance Due / (Overpayment)', f('C14-C15', baseEval.azBalDue), f('D14-D15', projEval.azBalDue), f('D16-C16', projEval.azBalDue - baseEval.azBalDue), 'Net due or refund on Form 140NR', { zebra: true });

  styleSectionRow(wsStateInd, 18, 6, 'PART II — CALIFORNIA FORM 540 / 540NR (CALIFORNIA PERSONAL INCOME TAX RETURN)');
  setDataRow(wsStateInd, 19, 'CA-1', 'Federal Adjusted Gross Income (Form 1040 Line 11)', f(`'1040 (Fed Personal)'!C16`, baseEval.agi), f(`'1040 (Fed Personal)'!D16`, projEval.agi), f('D19-C19', projEval.agi - baseEval.agi), 'Starting point for CA Form 540 / 540NR');
  setDataRow(wsStateInd, 20, 'SchCA-A', 'CA Schedule CA Additions (Conformity + Positive K-1 Adj)', f(`MAX(0,Inputs!C27)+MAX(0,'AZ 120S & CA 100S'!C28)`, baseEval.caAdd), f(`MAX(0,Inputs!D27)+MAX(0,'AZ 120S & CA 100S'!D28)`, projEval.caAdd), f('D20-C20', projEval.caAdd - baseEval.caAdd), 'CA conformity & K-1(100S) additions', { zebra: true });
  setDataRow(wsStateInd, 21, 'SchCA-B1', 'CA Other Subtractions (Depr / Disposal & Conformity)', f(`ABS(MIN(0,Inputs!C27))+ABS(MIN(0,'AZ 120S & CA 100S'!C28))`, baseEval.caOtherSub), f(`ABS(MIN(0,Inputs!D27))+ABS(MIN(0,'AZ 120S & CA 100S'!D28))`, projEval.caOtherSub), f('D21-C21', projEval.caOtherSub - baseEval.caOtherSub), 'Includes CA vs. Fed depreciation disposal adj');
  // EXACTLY ROW 22 — SchCA-B including +Inputs!C64 / +Inputs!D64 for California's 100% Social Security Exemption
  setDataRow(wsStateInd, 22, 'SchCA-B', 'CA Subtractions (Other + 100% Social Security Exemption)', f('C21+Inputs!C64', baseEval.caSchCaB), f('D21+Inputs!D64', projEval.caSchCaB), f('D22-C22', projEval.caSchCaB - baseEval.caSchCaB), 'Automatically subtracts 100% of Taxable SS (+Inputs!Row 64)', { bold: true, zebra: true });
  setDataRow(wsStateInd, 23, 'CA-17', 'California Adjusted Gross Income (CA AGI)', f('MAX(0,C19+C20-C22)', baseEval.caAgi), f('MAX(0,D19+D20-D22)', projEval.caAgi), f('D23-C23', projEval.caAgi - baseEval.caAgi), 'Fed AGI + SchCA-A − SchCA-B', { bold: true });
  setDataRow(wsStateInd, 24, 'CA-18', 'California Standard or Itemized Deduction', f(`MAX('Tax Tables'!C33,Inputs!C62)`, baseEval.caDed), f(`MAX('Tax Tables'!D33,Inputs!D62)`, projEval.caDed), f('D24-C24', projEval.caDed - baseEval.caDed), 'Greater of CA Standard or Itemized', { zebra: true });
  setDataRow(wsStateInd, 25, 'CA-19', 'California Taxable Income (Full-Year Base)', f('MAX(0,C23-C24)', baseEval.caTaxable), f('MAX(0,D23-D24)', projEval.caTaxable), f('D25-C25', projEval.caTaxable - baseEval.caTaxable), 'Taxed under CA 9-bracket progressive schedule');
  setDataRow(wsStateInd, 26, 'CA-31', 'California Progressive Tax (9-Bracket Formula)', f(progressiveFormula('C25', 'C', 39, 9), baseEval.caProgTax), f(progressiveFormula('D25', 'D', 39, 9), projEval.caProgTax), f('D26-C26', projEval.caProgTax - baseEval.caProgTax), 'Computed dynamically from Tax Tables tab', { zebra: true });
  setDataRow(wsStateInd, 27, 'CA-62', 'Mental Health Services Tax (1% over $1,000,000)', f(`ROUND(MAX(0,C25-'Tax Tables'!C36)*'Tax Tables'!C37,0)`, baseEval.caMentalHealth), f(`ROUND(MAX(0,D25-'Tax Tables'!D36)*'Tax Tables'!D37,0)`, projEval.caMentalHealth), f('D27-C27', projEval.caMentalHealth - baseEval.caMentalHealth), 'Prop 63 1% surtax');
  setDataRow(wsStateInd, 28, 'CA-32', 'Less: CA Personal & Age 65+ Exemption Credits', f(`('Tax Tables'!C35+Inputs!C63)*'Tax Tables'!C34`, baseEval.caExempCredits), f(`('Tax Tables'!D35+Inputs!D63)*'Tax Tables'!D34`, projEval.caExempCredits), f('D28-C28', projEval.caExempCredits - baseEval.caExempCredits), 'Personal + Senior 65+ exemption credits', { zebra: true });
  setDataRow(wsStateInd, 29, 'CA-35', 'CA Full-Year Net Tax (Before Residency Factor & PTE)', f('MAX(0,C26+C27-C28)', baseEval.caFullYearTax), f('MAX(0,D26+D27-D28)', projEval.caFullYearTax), f('D29-C29', projEval.caFullYearTax - baseEval.caFullYearTax), 'Full-year CA tax after exemption credits');
  setDataRow(wsStateInd, 30, '540NR%', 'CA Residency / 540NR Income Apportionment Factor', f('Inputs!C67', baseInp.caResidencyFactor), f('Inputs!D67', projInp.caResidencyFactor), f('D30-C30', projInp.caResidencyFactor - baseInp.caResidencyFactor), '100% for full-year CA resident', { numFmt: FMT.percent1, zebra: true });
  setDataRow(wsStateInd, 31, 'CA-40', 'CA Tax Before PTE Credit (540 / 540NR)', f('ROUND(C29*C30,0)', baseEval.caTaxBeforePte), f('ROUND(D29*D30,0)', projEval.caTaxBeforePte), f('D31-C31', projEval.caTaxBeforePte - baseEval.caTaxBeforePte), 'Basis for AZ Form 309 reverse credit', { bold: true });
  setDataRow(wsStateInd, 32, '3804-CR', 'Less: CA PTE Credit (Net of SB 132 Adjustment if Applicable)', f(`IF(Inputs!C28=1,MAX(0,'AZ 120S & CA 100S'!C29-Inputs!C32),0)`, baseEval.caPteCredit), f(`IF(Inputs!D28=1,MAX(0,'AZ 120S & CA 100S'!D29-Inputs!D32),0)`, projEval.caPteCredit), f('D32-C32', projEval.caPteCredit - baseEval.caPteCredit), 'Applied when CA PTE toggle = 1 (net of $125 SB 132 if missed)', { zebra: true });
  setDataRow(wsStateInd, 33, 'CA-64', 'CA Form 540 / 540NR Net Personal Income Tax', f('MAX(0,C31-C32)', baseEval.caNetTax), f('MAX(0,D31-D32)', projEval.caNetTax), f('D33-C33', projEval.caNetTax - baseEval.caNetTax), 'Ties to Dashboard Tie-Out & Variance Tracker', { total: true });
  setDataRow(wsStateInd, 34, 'CA-75', 'Less: CA Withholding & Estimated Payments', f('Inputs!C68', baseInp.caWithholdingEst), f('Inputs!D68', projInp.caWithholdingEst), f('D34-C34', projInp.caWithholdingEst - baseInp.caWithholdingEst), 'CA tax prepayments');
  setDataRow(wsStateInd, 35, 'CA-100', 'CA Form 540 / 540NR Balance Due / (Overpayment)', f('C33-C34', baseEval.caBalDue), f('D33-D34', projEval.caBalDue), f('D35-C35', projEval.caBalDue - baseEval.caBalDue), 'Net due or refund on Form 540 / 540NR', { zebra: true });
  setDataRow(wsStateInd, 36, '3804-CF', 'CA Unused PTE Credit Carryforward (5-Year Carryforward)', f('IF(Inputs!C28=1,MAX(0,C32-C31),0)', baseEval.caPteCarryforward), f('IF(Inputs!D28=1,MAX(0,D32-D31),0)', projEval.caPteCarryforward), f('D36-C36', projEval.caPteCarryforward - baseEval.caPteCarryforward), 'Unused AB 150 / SB 132 credit carries forward 5 yrs');

  // =========================================================================
  // TAB 1: Dashboard & Variance (EXACT Rows 36-37 = Disclaimer Box A36:G37)
  // =========================================================================
  applyBannerAndPrint(
    wsDash,
    7,
    `SHADOW TAX RETURN DASHBOARD & CPA VARIANCE VERIFICATION (${baseYear} & ${projYear})`,
    `Section 1: 16-Row ${baseYear} Filed Return Tie-Out Proof  |  Section 2: ${projYear} Shadow Return vs. CPA Draft Tracker`,
    branding,
    [16, 38, 16, 16, 16, 16, 22]
  );

  // Section 1 — 16-Row Filed Return Tie-Out Proof (Rows 4–22)
  styleSectionRow(wsDash, 4, 7, `SECTION 1 — ${baseYear} FILED RETURN TIE-OUT PROOF (SHADOW FORMULAS VS. ${baseYear} CPA FILED RETURN)`);
  styleTableHeader(wsDash, 5, ['Form / Line', 'Tax Return Verification Metric', 'Shadow Formula', `${baseYear} CPA Filed`, 'Variance ($)', 'Tie-Out Status', 'Notes']);

  const cpaTargets = branding.isDefaultSeed
    ? DEFAULT_PROFILE_SEED.shadow_return_seed.filed_2025.cpa_filed_tieout
    : {
        gross_receipts: baseEval.grossReceipts,
        total_deductions: baseEval.totalDeductions,
        obi_1120s: baseEval.obi,
        ending_stock_basis: baseEval.combEndBasis,
        excess_dist_cap_gain: baseEval.combExcessGain,
        w2_box1: baseEval.w2Box1,
        total_income_1040: baseEval.totalIncome,
        agi_1040: baseEval.agi,
        std_or_itemized_ded: baseEval.stdOrItemized,
        senior_deduction: baseEval.seniorAllowed,
        qbi_deduction: baseEval.qbiAllowed,
        taxable_income_1040: baseEval.taxableIncome,
        total_tax_1040: baseEval.totalFedTax,
        ca_540_tax: baseEval.caNetTax,
        az_140nr_tax: baseEval.azNetTax,
        ca_100s_franchise_tax: baseEval.ca100sFranchiseTax,
      };

  const tieOutRows: Array<[string, string, string, number, number, string]> = [
    ['1120-S Line 1c', 'Gross Receipts or Sales', `'1120-S (Fed S-Corp)'!C6`, baseEval.grossReceipts, cpaTargets.gross_receipts, 'CA + AZ apportioned revenue'],
    ['1120-S Line 21', 'Total Business Deductions', `'1120-S (Fed S-Corp)'!C19`, baseEval.totalDeductions, cpaTargets.total_deductions, 'W-2, DBP, 401(k), OpEx & Taxes'],
    ['1120-S Line 22', 'Ordinary Business Income (OBI)', `'1120-S (Fed S-Corp)'!C20`, baseEval.obi, cpaTargets.obi_1120s, 'Flows to Sch K & K-1s'],
    ['Form 7203', 'Combined Ending Stock Basis', `'K-1 & Form 7203'!C42`, baseEval.combEndBasis, cpaTargets.ending_stock_basis, 'IRS ordering rules'],
    ['Form 7203 / Sch D', 'Excess Distribution Capital Gain', `'K-1 & Form 7203'!C43`, baseEval.combExcessGain, cpaTargets.excess_dist_cap_gain, 'Form 8949 / Sch D LTCG'],
    ['1040 Line 1a', 'W-2 Box 1 Taxable Wages', `'1040 (Fed Personal)'!C6`, baseEval.w2Box1, cpaTargets.w2_box1, 'Net of EE 401(k) deferrals'],
    ['1040 Line 9', 'Total Income', `'1040 (Fed Personal)'!C14`, baseEval.totalIncome, cpaTargets.total_income_1040, 'All federal income sources'],
    ['1040 Line 11', 'Adjusted Gross Income (AGI)', `'1040 (Fed Personal)'!C16`, baseEval.agi, cpaTargets.agi_1040, 'Total income less Sch 1 adj'],
    ['1040 Line 12', 'Standard / Itemized Deduction', `'1040 (Fed Personal)'!C18`, baseEval.stdOrItemized, cpaTargets.std_or_itemized_ded, 'Incl. Age 65+ add-ons'],
    ['1040 Sch 1-A', 'Enhanced Senior Deduction', `'1040 (Fed Personal)'!C19`, baseEval.seniorAllowed, cpaTargets.senior_deduction, '6% MAGI phase-out'],
    ['1040 Line 13', 'Form 8995 QBI Deduction (20%)', `'1040 (Fed Personal)'!C20`, baseEval.qbiAllowed, cpaTargets.qbi_deduction, 'IRC §199A limitation'],
    ['1040 Line 15', 'Federal Taxable Income', `'1040 (Fed Personal)'!C21`, baseEval.taxableIncome, cpaTargets.taxable_income_1040, 'AGI less deductions & QBI'],
    ['1040 Line 24', 'Federal Total Tax', `'1040 (Fed Personal)'!C24`, baseEval.totalFedTax, cpaTargets.total_tax_1040, 'IRS Tax Table + QDCG'],
    ['CA Form 540', 'California Personal Income Tax', `'AZ 140NR & CA 540'!C33`, baseEval.caNetTax, cpaTargets.ca_540_tax, 'Net of CA exemption credits'],
    ['AZ Form 140NR', 'Arizona Personal Income Tax', `'AZ 140NR & CA 540'!C14`, baseEval.azNetTax, cpaTargets.az_140nr_tax, 'Net of Form 309 CA credit'],
    ['CA Form 100S', 'California S-Corp Franchise Tax', `'AZ 120S & CA 100S'!C25`, baseEval.ca100sFranchiseTax, cpaTargets.ca_100s_franchise_tax, '1.5% rate / $800 minimum'],
  ];

  let exactTieCount = 0;
  let totalAbsVar = 0;
  tieOutRows.forEach(([ref, desc, formulaRef, shadowVal, cpaVal, note], idx) => {
    const r = 6 + idx;
    const diff = shadowVal - cpaVal;
    const status = Math.abs(diff) <= 1 ? 'EXACT TIE' : 'CHECK';
    if (status === 'EXACT TIE') exactTieCount++;
    totalAbsVar += Math.abs(diff);

    const row = wsDash.getRow(r);
    row.height = 18.5;
    row.getCell(1).value = ref;
    row.getCell(2).value = desc;
    row.getCell(3).value = f(formulaRef, shadowVal);
    row.getCell(4).value = cpaVal;
    row.getCell(5).value = f(`C${r}-D${r}`, diff);
    row.getCell(6).value = f(`IF(ABS(E${r})<=1,"EXACT TIE","CHECK")`, status);
    row.getCell(7).value = note;

    for (let c = 1; c <= 7; c++) {
      const cell = row.getCell(c);
      cell.font = {
        name: FONT_NAME,
        size: 9,
        bold: c === 6,
        italic: c === 7,
        color: {
          argb:
            c === 6
              ? status === 'EXACT TIE'
                ? COLORS.greenText
                : COLORS.redText
              : c === 7
              ? COLORS.mutedText
              : COLORS.sectionText,
        },
      };
      if (c === 6) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: status === 'EXACT TIE' ? COLORS.greenBg : COLORS.redBg },
        };
      } else if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
      }
      if (c >= 3 && c <= 5) {
        cell.numFmt = FMT.currency;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: c === 1 || c === 6 ? 'center' : 'left', vertical: 'middle' };
      }
      cell.border = { bottom: { style: 'hair', color: { argb: COLORS.borderLight } } };
    }
  });

  // Row 22 — Section 1 Summary Row
  const r22 = wsDash.getRow(22);
  r22.height = 20;
  r22.getCell(1).value = 'PROOF';
  r22.getCell(2).value = `${baseYear} Filed Return Tie-Out Verification Summary`;
  r22.getCell(3).value = '';
  r22.getCell(4).value = 'Total Abs Var:';
  r22.getCell(5).value = f('SUMPRODUCT(ABS(E6:E21))', totalAbsVar);
  r22.getCell(6).value = f('COUNTIF(F6:F21,"EXACT TIE")&" / 16 EXACT TIE"', `${exactTieCount} / 16 EXACT TIE`);
  r22.getCell(7).value = exactTieCount === 16 ? 'All 16 filed return checkpoints tie to $0' : 'Review flagged CHECK lines';
  for (let c = 1; c <= 7; c++) {
    const cell = r22.getCell(c);
    cell.font = {
      name: FONT_NAME,
      size: 9.5,
      bold: true,
      color: { argb: c === 6 ? COLORS.greenText : COLORS.sectionText },
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: c === 6 ? COLORS.greenBg : COLORS.totalBg },
    };
    cell.alignment = {
      horizontal: c === 1 || c === 6 ? 'center' : c >= 4 && c <= 5 ? 'right' : 'left',
      vertical: 'middle',
    };
    if (c === 5) cell.numFmt = FMT.currency;
    cell.border = {
      top: { style: 'thin', color: { argb: COLORS.borderDark } },
      bottom: { style: 'double', color: { argb: COLORS.navy } },
    };
  }

  // Conditional Formatting for Section 1 Status Column (F6:F21)
  wsDash.addConditionalFormatting({
    ref: 'F6:F21',
    rules: [
      {
        type: 'cellIs',
        operator: 'equal',
        priority: 1,
        formulae: ['"EXACT TIE"'],
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.greenBg } },
          font: { color: { argb: COLORS.greenText }, bold: true },
        },
      },
      {
        type: 'cellIs',
        operator: 'equal',
        priority: 2,
        formulae: ['"CHECK"'],
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.redBg } },
          font: { color: { argb: COLORS.redText }, bold: true },
        },
      },
    ],
  });

  // Section 2 — 10-Row Selected Year Shadow Return vs. CPA Draft Tracker (Rows 23–34)
  styleSectionRow(
    wsDash,
    23,
    7,
    `SECTION 2 — ${projYear} SHADOW RETURN VS. CPA DRAFT TRACKER (ENTER CPA DRAFT ON INPUTS!D72:D81)`
  );
  styleTableHeader(wsDash, 24, [
    'Form / Line',
    'Key Tax Metric',
    `${baseYear} Baseline`,
    `${projYear} Shadow Return`,
    `${projYear} CPA Draft`,
    'Variance ($)',
    'Review Status',
  ]);

  const trackerRows: Array<[string, string, string, number, string, number, number]> = [
    ['1120-S Line 1c', '1120-S Gross Receipts', `'1120-S (Fed S-Corp)'!C6`, baseEval.grossReceipts, `'1120-S (Fed S-Corp)'!D6`, projEval.grossReceipts, 72],
    ['1120-S Line 22', '1120-S OBI', `'1120-S (Fed S-Corp)'!C20`, baseEval.obi, `'1120-S (Fed S-Corp)'!D20`, projEval.obi, 73],
    ['Form 7203', 'Form 7203 Ending Stock Basis', `'K-1 & Form 7203'!C42`, baseEval.combEndBasis, `'K-1 & Form 7203'!D42`, projEval.combEndBasis, 74],
    ['1040 Line 11', 'Form 1040 AGI', `'1040 (Fed Personal)'!C16`, baseEval.agi, `'1040 (Fed Personal)'!D16`, projEval.agi, 75],
    ['Form 8995', 'Form 8995 QBI', `'1040 (Fed Personal)'!C20`, baseEval.qbiAllowed, `'1040 (Fed Personal)'!D20`, projEval.qbiAllowed, 76],
    ['1040 Line 15', 'Form 1040 Taxable Income', `'1040 (Fed Personal)'!C21`, baseEval.taxableIncome, `'1040 (Fed Personal)'!D21`, projEval.taxableIncome, 77],
    ['1040 Line 24', 'Form 1040 Total Tax', `'1040 (Fed Personal)'!C24`, baseEval.totalFedTax, `'1040 (Fed Personal)'!D24`, projEval.totalFedTax, 78],
    ['CA 540 / 540NR', 'CA 540NR Tax', `'AZ 140NR & CA 540'!C33`, baseEval.caNetTax, `'AZ 140NR & CA 540'!D33`, projEval.caNetTax, 79],
    ['AZ 140NR', 'AZ 140NR Tax', `'AZ 140NR & CA 540'!C14`, baseEval.azNetTax, `'AZ 140NR & CA 540'!D14`, projEval.azNetTax, 80],
    ['CA 100S', 'CA 100S Franchise Tax', `'AZ 120S & CA 100S'!C25`, baseEval.ca100sFranchiseTax, `'AZ 120S & CA 100S'!D25`, projEval.ca100sFranchiseTax, 81],
  ];

  trackerRows.forEach(([ref, desc, cFormula, cVal, dFormula, dVal, inputRow], idx) => {
    const r = 25 + idx;
    const row = wsDash.getRow(r);
    row.height = 19;
    row.getCell(1).value = ref;
    row.getCell(2).value = desc;
    row.getCell(3).value = f(cFormula, cVal);
    row.getCell(4).value = f(dFormula, dVal);
    // CRITICAL: Wrap Column E CPA Draft link in =IF(ref="","",ref) so blank draft cells cleanly yield "Awaiting CPA Draft"
    row.getCell(5).value = f(`IF(Inputs!D${inputRow}="","",Inputs!D${inputRow})`, '');
    row.getCell(6).value = f(`IF(E${r}="","",D${r}-E${r})`, '');
    row.getCell(7).value = f(
      `IF(E${r}="","Awaiting CPA Draft",IF(ABS(F${r})<=1,"EXACT TIE",IF(ABS(F${r})<=25,"MINOR ROUNDING","INVESTIGATE")))`,
      'Awaiting CPA Draft'
    );

    for (let c = 1; c <= 7; c++) {
      const cell = row.getCell(c);
      cell.font = {
        name: FONT_NAME,
        size: 9,
        bold: c === 4 || c === 7,
        italic: c === 7,
        color: { argb: c === 5 ? COLORS.inputText : c === 7 ? COLORS.mutedText : COLORS.sectionText },
      };
      if (c === 5) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.inputBg } };
      } else if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
      }
      if (c >= 3 && c <= 6) {
        cell.numFmt = FMT.currency;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: c === 1 || c === 7 ? 'center' : 'left', vertical: 'middle' };
      }
      cell.border = { bottom: { style: 'hair', color: { argb: COLORS.borderLight } } };
    }
  });

  // Conditional Formatting for Section 2 Review Status Column (G25:G34)
  wsDash.addConditionalFormatting({
    ref: 'G25:G34',
    rules: [
      {
        type: 'cellIs',
        operator: 'equal',
        priority: 1,
        formulae: ['"EXACT TIE"'],
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.greenBg } },
          font: { color: { argb: COLORS.greenText }, bold: true },
        },
      },
      {
        type: 'cellIs',
        operator: 'equal',
        priority: 2,
        formulae: ['"INVESTIGATE"'],
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.redBg } },
          font: { color: { argb: COLORS.redText }, bold: true },
        },
      },
      {
        type: 'cellIs',
        operator: 'equal',
        priority: 3,
        formulae: ['"MINOR ROUNDING"'],
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORS.amberBg } },
          font: { color: { argb: COLORS.amberText }, bold: true },
        },
      },
    ],
  });

  wsDash.getRow(35).height = 10;

  // EXACTLY ROWS 36–37: Disclaimer Box (A36:G36 Amber Header, A37:G37 Cream Wrapped Body)
  wsDash.mergeCells('A36:G36');
  const r36 = wsDash.getRow(36);
  r36.height = 20;
  const c36 = wsDash.getCell('A36');
  c36.value = 'IMPORTANT DISCLAIMER — SHADOW TAX RETURN & PLANNING MODEL';
  c36.font = { name: FONT_NAME, size: 9.5, bold: true, color: { argb: COLORS.amberText } };
  c36.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.amberBg } };
  c36.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  for (let c = 1; c <= 7; c++) {
    r36.getCell(c).border = {
      top: { style: 'thin', color: { argb: COLORS.gold } },
      left: c === 1 ? { style: 'thin', color: { argb: COLORS.gold } } : undefined,
      right: c === 7 ? { style: 'thin', color: { argb: COLORS.gold } } : undefined,
    };
  }

  wsDash.mergeCells('A37:G37');
  const r37 = wsDash.getRow(37);
  r37.height = 58;
  const c37 = wsDash.getCell('A37');
  c37.value = `This workbook is an internal shadow tax return and financial planning verification model prepared for ${branding.disclaimerEntity} and ${branding.disclaimerTaxpayers}. It is NOT an official IRS, FTB, or ADOR tax return and does not constitute formal tax, legal, or accounting advice. All projected ${projYear} calculations, PTE elections, stock basis waterfalls, and state apportionment schedules are preliminary planning estimates intended solely for reconciliation against CPA-prepared draft returns prior to filing. Consult your licensed CPA or tax advisor before making tax elections or remittances.`;
  c37.font = { name: FONT_NAME, size: 9, italic: true, color: { argb: COLORS.stoneText } };
  c37.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.creamBg } };
  c37.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
  for (let c = 1; c <= 7; c++) {
    r37.getCell(c).border = {
      bottom: { style: 'thin', color: { argb: COLORS.gold } },
      left: c === 1 ? { style: 'thin', color: { argb: COLORS.gold } } : undefined,
      right: c === 7 ? { style: 'thin', color: { argb: COLORS.gold } } : undefined,
    };
  }

  return wb;
}

/**
 * Generates the 8-tab Shadow Tax Return Excel workbook and triggers a browser download.
 */
export async function exportShadowTaxReturnXlsx(params: ShadowReturnExportParams): Promise<string> {
  const wb = await buildShadowTaxReturnWorkbook(params);
  const baseComp = params.computed.find((c) => c.tax_year === 2025) ?? params.computed[0];
  const selComp =
    params.computed.find((c) => c.tax_year === params.selectedYear) ??
    params.computed.find((c) => c.tax_year === params.setup.current_tax_year) ??
    params.computed[1] ??
    params.computed[0];

  const filename = getShadowReturnFilename(params.setup, baseComp.tax_year, selComp.tax_year);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return filename;
}

import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL_NAME = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add or select an API key in Settings > Secrets to use AI-assisted intake and grounded narratives.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatApiError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('GEMINI_API_KEY')) {
    return { status: 503, message: msg };
  }
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message: 'Gemini API authentication failed. Please verify your API key in Settings > Secrets.',
    };
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'Gemini API rate limit or quota reached. Please wait a moment and try again.',
    };
  }
  return { status: 500, message: `AI request failed: ${msg}` };
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'rolling-tax-planner' });
  });

  /**
   * Module 4 §2: Guided Natural-Language Setup
   * Translates plain-English descriptions into Module 1 setup flags with provenance & confidence tags.
   */
  app.post('/api/ai/intake-setup', async (req: Request, res: Response) => {
    try {
      const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
      if (!description) {
        res.status(400).json({ error: 'Please provide a household or entity description.' });
        return;
      }

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `Extract structured Module 1 tax planning setup flags from this taxpayer description:\n\n"""\n${description}\n"""`,
        config: {
          systemInstruction:
            'You are a structured tax-planning intake parser for Rolling Tax Planner. Extract ONLY setup flags and profile attributes explicitly stated or strongly implied by the user text. Never invent tax calculations. Tag every extracted field with source_document ("User Natural-Language Intake"), extracted_value (as string), and confidence_level ("high", "medium", or "low"). Valid filing_status values: married_filing_jointly, single, head_of_household, married_filing_separately. Valid entity_type values: none, sole_prop, scorp_llc, partnership, ccorp.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              proposed_setup: {
                type: Type.OBJECT,
                properties: {
                  filing_status: { type: Type.STRING },
                  primary_birth_year: { type: Type.INTEGER },
                  spouse_birth_year: { type: Type.INTEGER },
                  entity_type: { type: Type.STRING },
                  has_scorp: { type: Type.BOOLEAN },
                  has_dbp: { type: Type.BOOLEAN },
                  has_401k_or_ira: { type: Type.BOOLEAN },
                  has_annuity: { type: Type.BOOLEAN },
                  has_pte: { type: Type.BOOLEAN },
                  multi_state_active: { type: Type.BOOLEAN },
                  residency_change_active: { type: Type.BOOLEAN },
                },
              },
              provenance: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    field_path: { type: Type.STRING },
                    label: { type: Type.STRING },
                    source_document: { type: Type.STRING },
                    extracted_value: { type: Type.STRING },
                    confidence_level: { type: Type.STRING },
                    notes: { type: Type.STRING },
                  },
                },
              },
              follow_up_questions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  /**
   * Module 4 §2: Year 1 Actuals Document Parsing
   * Parses pasted Form 1040, Form 1120-S, Schedule K-1, and state summary text into Module 2 fields
   * with provenance & confidence tagging requiring explicit user confirmation before locking Year 1.
   */
  app.post('/api/ai/extract-actuals', async (req: Request, res: Response) => {
    try {
      const documentText = typeof req.body?.documentText === 'string' ? req.body.documentText.trim() : '';
      const sourceLabel = typeof req.body?.sourceLabel === 'string' && req.body.sourceLabel.trim()
        ? req.body.sourceLabel.trim()
        : 'Pasted Tax Return Summary';

      if (!documentText) {
        res.status(400).json({ error: 'Please paste return text (Form 1040, 1120-S, K-1, or state summary).' });
        return;
      }

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `Source document label: ${sourceLabel}\n\nExtract Module 2 Year 1 actuals fields from the following tax document text:\n\n"""\n${documentText}\n"""`,
        config: {
          systemInstruction:
            'You are a tax document extraction assistant for Rolling Tax Planner. Parse ONLY explicitly present numerical and categorical fields from the pasted return text into canonical Module 2 field paths (e.g., form_1040.w2_wages_total, form_1040.schedule_k1_ordinary_income, form_1040.taxable_interest, form_1040.ordinary_dividends, form_1040.qualified_dividends, form_1040.long_term_capital_gain_loss, form_1040.social_security_gross, form_1040.deduction_method, form_1040.locked_taxable_income_override, scorp_1120s.entity_name, scorp_1120s.gross_receipts_revenue, scorp_1120s.officer_w2_wages, scorp_1120s.scorp_distributions_total, scorp_1120s.stock_basis_ending, dbp_and_retirement.dbp_actual_contribution, dbp_and_retirement.dbp_target_termination_year). Never compute or fabricate missing lines. Tag every extracted item with source_document, extracted_value, and confidence_level ("high", "medium", or "low").',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detected_tax_year: { type: Type.INTEGER },
              detected_forms: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              extracted_fields: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    field_path: { type: Type.STRING },
                    label: { type: Type.STRING },
                    source_document: { type: Type.STRING },
                    extracted_value: { type: Type.STRING },
                    numeric_value: { type: Type.NUMBER },
                    confidence_level: { type: Type.STRING },
                    notes: { type: Type.STRING },
                  },
                },
              },
              reconciliation_warnings: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  /**
   * Module 4 §4: Plain-English Explanation & Scenario Narrative
   * Grounded strictly in deterministic calculation engine outputs.
   */
  app.post('/api/ai/explain', async (req: Request, res: Response) => {
    try {
      const { baseline, alternative, alternativeName, issues, userQuestion } = req.body ?? {};
      if (!Array.isArray(baseline) || baseline.length === 0) {
        res.status(400).json({ error: 'Deterministic baseline forecast output is required.' });
        return;
      }

      const ai = getGeminiClient();
      const payload = {
        baseline_six_year_output: baseline,
        alternative_scenario_name: alternativeName ?? null,
        alternative_six_year_output: alternative ?? null,
        active_guardrail_issues: issues ?? [],
        user_focus_question: userQuestion || 'Provide a clear six-year executive briefing of the tax trajectory, key multi-year drivers, guardrail priorities, and scenario comparison if provided.',
      };

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: JSON.stringify(payload, null, 2),
        config: {
          systemInstruction:
            'You are the grounded tax planning narrator for Rolling Tax Planner. Follow Module 4 §4 rules strictly:\n' +
            '1. GROUNDED ATTRIBUTION: Every dollar figure, marginal/effective rate, or year-over-year variance you cite MUST come verbatim from the deterministic JSON provided and reference the exact named field in parentheses (e.g., federal_income_tax, adjusted_gross_income, qualified_business_income_deduction, stock_basis_ending, state_income_tax_liability). Never invent, estimate, or recompute tax figures.\n' +
            '2. ACRONYM CLARITY: Spell out specialized tax and plan acronyms on first use — e.g., Defined Benefit Plan (DBP), Pass-Through Entity (PTE), Qualified Business Income (QBI), Accumulated Adjustments Account (AAA), Adjusted Gross Income (AGI), Income-Related Monthly Adjustment Amount (IRMAA).\n' +
            '3. SIX-YEAR HORIZON FOCUS: Analyze multi-year trajectories across the full 6-year rolling window (Year 1 locked actuals + Years 2-6 forecast) rather than isolated single-year snapshots. If an alternative scenario is included, contrast cumulative 6-year totals and key inflection years.\n' +
            '4. STRUCTURE: Return clean, scannable sections with clear headings (Executive Summary, Multi-Year Drivers, Scenario Delta [if applicable], Guardrail & Compliance Watchlist, Planning Scope Note).\n' +
            '5. DISCLAIMER: Conclude with a concise reminder that projections are educational planning models and complex items (actuarial DBP funding limits, multi-state nexus, reasonable compensation) require CPA and enrolled actuary review.',
        },
      });

      res.json({ narrative: response.text ?? '' });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // Dev vs Production static / Vite serving
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Rolling Tax Planner listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start Rolling Tax Planner server:', err);
  process.exit(1);
});

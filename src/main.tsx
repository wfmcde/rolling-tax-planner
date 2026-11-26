import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (
    window as unknown as {
      __runTaxEngineStressSuite?: () => Promise<unknown>;
    }
  ).__runTaxEngineStressSuite = async () => {
    const { runTaxEngineStressSuite } = await import('./tests/taxEngineStressSuite');
    const report = runTaxEngineStressSuite();
    console.info(
      `[TaxEngineStressSuite] ${report.passedCases}/${report.totalCases} PASSED (${report.failedCases} failed) in ${report.durationMs}ms (seed=${report.seed})`
    );
    if (report.failures.length > 0) {
      console.table(report.failures);
    }
    return report;
  };
}


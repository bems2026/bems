import { useState, type ChangeEvent } from 'react';
import { importCredentials, type ImportResult } from '@/lib/credentials';

/** Larger than any real export, and the proxy refuses more than 1 MiB anyway. */
const MAX_FILE_BYTES = 1_000_000;

/**
 * Hands a key tool's export to the Pi (2026-09-17).
 *
 * Onboarding no longer needs an IoT Core subscription: the operator pairs devices in Smart Life,
 * exports the account's devices with a key tool on their own machine, and gives the file to this
 * panel. The proxy stores the keys on the Pi (`POST /api/credentials/import`) and answers with counts,
 * never a key. The pasted text is cleared as soon as the proxy has it, so it does not sit on screen.
 *
 * "Lists every device" matters beyond bookkeeping: only a complete export lets a device's ABSENCE
 * count towards calling a flow node re-paired (server/deviceSources.mjs), so it is asked, not assumed.
 */
export function ImportKeysPanel({ open, onImported }: { open: boolean; onImported: () => void }) {
  const [content, setContent] = useState('');
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setResult({ ok: false, format: null, added: 0, updated: 0, total: 0, complete: false, problems: [`${file.name} is larger than any device export should be`] });
      return;
    }
    setContent(await file.text());
    setResult(null);
  };

  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await importCredentials(content, complete);
      setResult(r);
      if (r.ok) {
        setContent('');
        onImported();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    // Held open while there is a result to read: a successful import usually clears the very reason
    // `open` was true (a device waiting on its key), and closing then would hide the confirmation.
    <details className="enroll-wizard__import" open={open || result !== null || undefined}>
      <summary>Import keys from a key tool</summary>
      <p className="enroll-wizard__note">
        Paired something new in Smart Life? Export the account&apos;s devices with a key tool (a JSON or CSV
        with each device&apos;s id and local key — <code>tinytuya wizard</code>&apos;s <code>devices.json</code> works
        too) and load it here. The keys are stored on the Pi only and are never shown again; a key stays
        valid until that device is removed and re-paired.
      </p>
      <label className="enroll-wizard__field">
        <span>Export file</span>
        <input type="file" accept=".json,.csv,application/json,text/csv" onChange={(e) => void onFile(e)} />
      </label>
      <label className="enroll-wizard__field">
        <span>…or paste it</span>
        <textarea
          className="enroll-wizard__paste"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </label>
      <label className="enroll-wizard__check">
        <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} />
        <span>This export lists every device in the account</span>
      </label>
      <small className="enroll-wizard__note">
        Tick it only for a whole-account export. A device missing from a complete list, and silent on the
        network, is what marks its flow node as left behind by a re-pair.
      </small>
      <div className="enroll-wizard__actions">
        <button type="button" className="enroll-wizard__apply" disabled={busy || !content.trim()} onClick={() => void submit()}>
          {busy ? 'Importing…' : 'Import keys'}
        </button>
      </div>
      {result && <ImportResultView result={result} />}
    </details>
  );
}

function ImportResultView({ result }: { result: ImportResult }) {
  if (!result.ok) {
    return (
      <div className="enroll-wizard__result enroll-wizard__result--bad" role="alert">
        <strong>Nothing imported</strong>
        <ul>{result.problems.map((p) => <li key={p}>{p}</li>)}</ul>
      </div>
    );
  }
  return (
    <div className="enroll-wizard__result" role="status">
      <strong>
        Imported: {result.added} added, {result.updated} updated — {result.total === 1 ? '1 device now holds a key' : `${result.total} devices now hold a key`}
        {result.complete ? ', recorded as the complete account list' : ''}.
      </strong>
      {result.problems.length > 0 && (
        <>
          <p className="enroll-wizard__note">Skipped:</p>
          <ul>{result.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </>
      )}
    </div>
  );
}

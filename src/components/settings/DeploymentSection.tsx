import { Server } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { InfoHint } from '@/components/ui/InfoHint';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { SITE } from '@shared/siteConfig.mjs';

/**
 * What this installation is set to — read-only, on purpose.
 *
 * WHY READ-ONLY. Every fact here is owned somewhere the browser cannot safely write. The site's
 * identity, timezone and aircon floor live in `shared/sites/<id>/site.mjs` and are mirrored into
 * the `sites` row, which is deliberately unwritable from here (see
 * `supabase/phase24_site_ui_prefs.sql` for the full reasoning — that row carries the policy floor
 * `validateCommand` enforces server-side). The dispatch gate and policy come from the proxy's own
 * environment. Offering an editable field for any of them would either do nothing or desync the
 * two places the fact is written down.
 *
 * WHY SHOW IT AT ALL. "Which deployment am I looking at, and what is it allowed to do" is the
 * first question anybody asks of an unfamiliar install, and until now the only way to answer it
 * was to read `server/.env` over SSH. Every value below is one this app already knows.
 *
 * NOT SHOWN: anything the browser cannot observe. Retention, the alert channel and the ingest
 * cadence are server-side and a page reporting a default it has not read would be inventing.
 */
export function DeploymentSection() {
  const hardwareDispatch = useCapabilitiesStore((s) => s.hardwareDispatchEnabled);
  const dispatchClasses = useCapabilitiesStore((s) => s.dispatchClasses);
  const policy = useCapabilitiesStore((s) => s.dispatchPolicy);
  const cloudConfigured = useCapabilitiesStore((s) => s.cloudFallbackConfigured);
  const backlog = useCapabilitiesStore((s) => s.auditBufferPending);

  /** `null` is "not answered yet", and it renders as such rather than as a `false`. The whole
   * capabilities store draws that distinction; a settings page that flattened it would report a
   * closed gate on a deployment that simply had not replied. */
  const unknown = <span className="settings-facts__unknown">not reported</span>;

  return (
    <Card className="settings-card">
      <h2 className="card-title">
        <Server size={16} className="title-icon" aria-hidden="true" />
        Deployment
        <InfoHint label="Why none of this is editable">
          Each of these is written down somewhere this page cannot safely change — the site file that every deployment is built
          from, or the bridge&rsquo;s own environment. A field here that silently did nothing would be worse than a fact you can
          read.
        </InfoHint>
      </h2>

      <dl className="settings-facts">
        <div className="settings-facts__row">
          <dt>Site</dt>
          <dd>
            {SITE.display_name} <span className="mono settings-facts__id">{SITE.id}</span>
          </dd>
        </div>
        <div className="settings-facts__row">
          <dt>Timezone</dt>
          <dd>
            {SITE.timezone} <span className="settings-facts__id">UTC{SITE.utc_offset_minutes >= 0 ? '+' : '−'}{Math.abs(SITE.utc_offset_minutes) / 60}</span>
          </dd>
        </div>
        <div className="settings-facts__row">
          <dt>Aircon floor</dt>
          <dd>
            {SITE.policy?.acu_min_setpoint_c == null ? (
              'No policy floor — the hardware range applies'
            ) : (
              <>
                {SITE.policy.acu_min_setpoint_c}&nbsp;°C
                <InfoHint label="Where the floor is enforced">
                  Enforced by the bridge, not by this page. A setpoint request below it is refused server-side, so a command that
                  never went through this dashboard is refused too.
                </InfoHint>
              </>
            )}
          </dd>
        </div>
        <div className="settings-facts__row">
          <dt>Commands reach hardware</dt>
          <dd>
            {hardwareDispatch === null ? unknown : hardwareDispatch ? 'Yes' : 'No — commands are logged but change nothing'}
          </dd>
        </div>
        <div className="settings-facts__row">
          <dt>Classes that dispatch</dt>
          <dd>{dispatchClasses === null ? unknown : dispatchClasses.length === 0 ? 'None' : dispatchClasses.join(', ')}</dd>
        </div>
        <div className="settings-facts__row">
          <dt>Command path</dt>
          <dd>
            {policy === null
              ? unknown
              : policy === 'local-only'
                ? 'Local network only'
                : cloudConfigured
                  ? 'Local first, vendor cloud as a fallback'
                  : 'Local network — no vendor fallback configured'}
            <InfoHint label="What the command path means">
              The devices sit on this building&rsquo;s own network and are commanded directly, so switching a light needs no
              internet at all. A vendor fallback, where one is configured, is only ever tried after the local path has failed.
            </InfoHint>
          </dd>
        </div>
        <div className="settings-facts__row">
          <dt>Audit backlog</dt>
          <dd>
            {backlog === null
              ? unknown
              : backlog === 0
                ? 'None — every command is recorded'
                : `${backlog} command${backlog === 1 ? '' : 's'} recorded locally, waiting to upload`}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

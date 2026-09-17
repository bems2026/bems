/**
 * Builds the two control endpoints the flow was missing: outlets and the aircon.
 *
 * Lights already had one (`POST /light/:id` -> "Auth + validate" -> Lighting Logic Hub), which
 * is why lights were the only class the app could really switch. These mirror that chain node
 * for node so all three classes work the same way, rather than inventing a second style of
 * write path next to the one that already works.
 *
 * Pure: takes a flow array, returns a new one. No I/O, so the shape of what gets deployed is
 * unit-testable without a live Node-RED — see test/add-device-endpoints.test.mjs.
 *
 * The auth check is deliberately identical to the light endpoint's, reading the same
 * `LIGHT_API_TOKEN`. One shared secret for one trust boundary (only the proxy is meant to
 * reach any of these) beats three tokens to rotate and three places to get it wrong. Its name
 * is now narrower than its job; renaming it means re-rotating on the Pi, so it is left alone
 * and documented instead.
 */

import { ACU_AUTH_FN } from './airconSources.mjs';

/** The outlet hub takes `{topic, payload}`; the ACU takes a full aircon state (see airconSources.mjs). */
const OUTLET_AUTH_FN = `const TOKEN = env.get('LIGHT_API_TOKEN');
if (!TOKEN || msg.req.headers['x-auth-token'] !== TOKEN) {
    msg.statusCode = 401;
    msg.payload = { ok:false, error:'unauthorized' };
    return [null, msg];
}
// The target is the wire key the Outlet Logic Hub already switches on: CO<n>_<socket>.
// Validated against that exact shape rather than trusted, since it arrives from the network.
const target = String(msg.req.params.target || '');
if (!/^CO[1-7]_[12]$/.test(target)) {
    msg.statusCode = 400;
    msg.payload = { ok:false, error:'target must look like CO3_1' };
    return [null, msg];
}
let s = msg.payload && msg.payload.state;
if (typeof s === 'string') s = ['on','true','1'].includes(s.toLowerCase());
s = Boolean(s);
msg.topic = target;
msg.payload = s;
delete msg.loop_prevention;
return [msg, null];`;

// The ACU validator lives in airconSources.mjs, shared with the aircon refactor so a fresh install and
// a refactored flow accept exactly the same bodies.

const RESPOND_FN = `msg.statusCode = 200;
msg.payload = { ok: true };
return msg;`;

const node = (extra) => ({ x: 0, y: 0, wires: [], ...extra });

/**
 * @param {Array} flows        the live flow
 * @param {object} opts
 * @param {string} opts.switchTabId  tab to place the outlet endpoint's nodes on
 * @param {string} opts.acuTabId     tab to place the ACU endpoint's nodes on
 * @param {string} opts.outletHubId  node id of "Outlet Logic Hub"
 * @param {string} opts.acuLogicId   node id of "AC Master Logic"
 */
export function addDeviceEndpoints(flows, { switchTabId, acuTabId, outletHubId, acuLogicId }) {
  const out = flows.map((n) => ({ ...n }));
  const has = (url) => out.some((n) => n.type === 'http in' && n.url === url);

  if (!has('/outlet/:target')) {
    out.push(
      node({ id: 'bems_outlet_in', type: 'http in', name: 'POST /outlet/:target', url: '/outlet/:target', method: 'post', z: switchTabId, wires: [['bems_outlet_auth']] }),
      node({ id: 'bems_outlet_auth', type: 'function', name: 'Outlet auth + validate', func: OUTLET_AUTH_FN, outputs: 2, z: switchTabId, wires: [[outletHubId, 'bems_outlet_ok'], ['bems_outlet_reply']] }),
      node({ id: 'bems_outlet_ok', type: 'function', name: 'Outlet 200 response', func: RESPOND_FN, outputs: 1, z: switchTabId, wires: [['bems_outlet_reply']] }),
      node({ id: 'bems_outlet_reply', type: 'http response', name: 'Outlet reply', z: switchTabId, wires: [] }),
    );
  }

  if (!has('/acu')) {
    out.push(
      node({ id: 'bems_acu_in', type: 'http in', name: 'POST /acu', url: '/acu', method: 'post', z: acuTabId, wires: [['bems_acu_auth']] }),
      // No parallel "200 response" node: that answered before anything was known, so a dead hub or a
      // state with no IR code still read as success. AC Master Logic's third output is the reply —
      // wired by `npm run aircon:pi`, which a fresh install runs next.
      node({ id: 'bems_acu_auth', type: 'function', name: 'ACU auth + validate', func: ACU_AUTH_FN, outputs: 2, z: acuTabId, wires: [[acuLogicId], ['bems_acu_reply']] }),
      node({ id: 'bems_acu_reply', type: 'http response', name: 'ACU reply', z: acuTabId, wires: [] }),
    );
  }

  return out;
}

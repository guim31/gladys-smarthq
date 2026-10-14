// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`) and the keys of the scene triggers
// the hub fires (manifest `scene_triggers`). Keys are forever once published.
//
// `appliance_command`: pause or stop the cycle of a dishwasher whose remote
// control is enabled on the appliance. Never a start nor a resume: a
// dishwasher heats water (Guilhem's rule). GE exposes no pause or stop for
// washers and dryers, and an oven is never driven remotely.
// -----------------------------------------------------------------------------

import { TRIGGERS } from './hub.js';

export const SCENE_TRIGGER_KEYS = Object.values(TRIGGERS);

/** Handlers of the scene actions, by key. */
export function createSceneActions({ hub }) {
  return {
    async appliance_command(fields) {
      await hub.runCommand(fields.device, fields.command);
      return { sent: true };
    },
  };
}

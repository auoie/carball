// What a match session's hello asks for (main.ts's): the player's garage car (its model: the server plays it with its
// preset), their car preferences and chat filters; no name (a matchmade join's is its ticket's; a development server
// names an empty one "Player N")
import { storedCar } from "../game/cars";
import type { Settings } from "../settings/settings";
import type { JoinPreferences } from "./connection";

/** `car`: the garage's car (the one last chosen, stored) */
export function joinPreferences(s: Settings, car: number = storedCar()): JoinPreferences {
  return {
    team: 255,
    model: car,
    dodgeDeadzone: s.controller.dodgeDeadzone,
    steeringSensitivity: s.controller.steeringSensitivity,
    airControlSensitivity: s.controller.aerialSensitivity,
    autoSkipReplay: s.options.autoSkipReplay,
    name: "",
    quickChat: s.chat.quickChatFilter,
    blockNonTactical: s.chat.blockNonTactical,
  };
}

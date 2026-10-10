// Online, the cars drawn demolished: those the server's Demo event named, until they respawn. As the game: the
// replicated demolish hides the car, kills its effects, starts the explosion and switches the camera together
// (ReplicatedDemolish -> FinishDemo), so a mispredicted demolition shows nothing and a real one shows all at once,
// not the car vanishing a round trip before its explosion (static analysis RV-84).
export class ServerDemolitions {
  /** Car id -> its spawn count when the server demolished it */
  readonly #demolished = new Map<number, number>();

  /** The server's Demo event for `car`, whose spawn count is `spawnCount` now */
  event(car: number, spawnCount: number): void {
    this.#demolished.set(car, spawnCount);
  }

  /** Whether to draw `car` demolished: named by the server's event and not respawned since (its spawn count moved on) */
  demoed(car: number, spawnCount: number): boolean {
    const at = this.#demolished.get(car);
    if (at === undefined) return false;
    if (at !== spawnCount) {
      this.#demolished.delete(car);
      return false;
    }
    return true;
  }

  /** A car gone (left the match) */
  forget(car: number): void {
    this.#demolished.delete(car);
  }
}

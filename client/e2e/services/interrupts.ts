// The services' stacks taken down when a run is interrupted (RV-1044): Playwright's teardown project runs after a run
// that ends, not one stopped. Ctrl-C (SIGINT) still runs this global setup's teardown, and SIGTERM this handler; either
// takes down the stacks this runner brought up (the lock names it: stacks.ts), synchronously. A run killed outright
// (SIGKILL) leaves them to the next run's pre-clean.
import { downStacksOnInterrupt } from "./stacks";

export default function globalSetup(): () => void {
  const terminated = (): void => {
    downStacksOnInterrupt(process.pid);
    process.exit(143);
  };
  process.once("SIGTERM", terminated);
  return () => {
    process.off("SIGTERM", terminated);
    downStacksOnInterrupt(process.pid);
  };
}

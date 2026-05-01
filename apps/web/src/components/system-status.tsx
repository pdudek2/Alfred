import type { SystemStatusVM } from "../lib/system-status-view-model";

type SystemStatusProps = {
  vm: SystemStatusVM;
};

export function SystemStatus({ vm }: SystemStatusProps) {
  return (
    <div className={`system-status system-status--${vm.tone}`} aria-live="polite">
      <span className="system-status__dot" aria-hidden="true" />
      <span className="system-status__label">{vm.label}</span>
      <span className="system-status__detail">{vm.detail}</span>
    </div>
  );
}

import type { MediaLifecycleService } from "@/lib/media/mediaLifecycleService";
import { DefaultMediaLifecycleService } from "@/lib/media/mediaLifecycleService";
import { mediaTelemetry } from "@/lib/media/mediaTelemetry";

export type DeliveryControlCommand =
  | { action: "suspend"; mediaId: string; reasonCode: string }
  | { action: "recover"; mediaId: string; candidateProcessingRunId?: string };

export type MediaOperatorActor = Readonly<{
  id: string;
  role: "SUPER_ADMIN" | "ADMIN" | "EDITOR" | string;
}>;

export function canPerformMediaEmergencyOperation(actor: MediaOperatorActor): boolean {
  return actor.role === "SUPER_ADMIN" || actor.role === "ADMIN";
}

export async function runDeliveryControl(
  actor: MediaOperatorActor,
  command: DeliveryControlCommand,
  lifecycle: MediaLifecycleService = new DefaultMediaLifecycleService()
): Promise<void> {
  if (!canPerformMediaEmergencyOperation(actor)) {
    throw new Error("FORBIDDEN: actor is not authorized for emergency media operations");
  }

  if (command.action === "suspend") {
    await lifecycle.suspendDelivery(command.mediaId, actor.id, command.reasonCode);
    mediaTelemetry.record({
      event: "DELIVERY_SUSPENDED",
      mediaId: command.mediaId,
      failureCode: command.reasonCode,
    });
  } else if (command.action === "recover") {
    await lifecycle.recoverDelivery(
      command.mediaId,
      actor.id,
      command.candidateProcessingRunId
    );
    mediaTelemetry.record({
      event: "DELIVERY_RECOVERED",
      mediaId: command.mediaId,
    });
  } else {
    const action = (command as { action?: unknown }).action;
    throw new Error(`UNKNOWN_ACTION: ${String(action)}`);
  }
}
